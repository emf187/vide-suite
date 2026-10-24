import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb } from "@/server/db/client";
import {
  agentToolLogs,
  faultEvents,
  inventoryItems,
  inventoryReservations,
  machines,
  workOrderLabor,
  workOrderParts,
  workOrders,
} from "@/server/db/schema";
import { can, type Ability } from "@/server/policies";
import { auditRepo } from "@/server/repos/audit";
import { faultsService, faultsWriteService } from "@/server/services/faults";
import { workOrderWriteService, type WoStatus } from "@/server/services/work-orders";
import { repairRequestsWriteService } from "@/server/services/repair-requests";
import { maintenanceHistoryService } from "@/server/services/machine-history";
import { notesService } from "@/server/services/machine-notes";
import { computeMetrics, validateNarrative, type FaultCore, type LaborCore, type MachineCore, type PartsCore, type WorkOrderCore } from "@/server/metrics/reports";

/**
 * M7 agent. Two strictly separated halves:
 *  1. INTENT — maps a message to (tool, args). Deterministic local matcher when no
 *     LLM key is configured (keyless demoes, Vercel default); an LLM is only ever
 *     used for this mapping (never to produce numbers) and validated/fenced.
 *  2. TOOLS — read tools scope everything from Ctx (they never accept org params);
 *     write tools run ONLY after the user confirms a stored proposal in the UI.
 * Every call lands in agent_tool_logs; answers cite record ids.
 */

export type Citation = { kind: string; id: string; label: string };

export type AgentReply = {
  text: string;
  citations: Citation[];
  via: "local" | "llm";
  proposal?: { logId: string; tool: string; summary: string };
  /** Internal: raw tool payload used by the LLM phrasing layer. NEVER returned to the UI. */
  data?: unknown;
};

/** Internal phrasing request context; not exported past the service. */
type PhraseContext = AgentHistory;

type ToolName =
  | "machine_brief" | "machine_history" | "fleet_summary" | "open_faults" | "list_open_work_orders" | "stock_lookup"
  | "cost_summary" | "help"
  | "create_work_order" | "acknowledge_fault" | "convert_fault_to_work_order"
  | "compile_repair_request";

type ToolSpec = {
  name: ToolName;
  write: boolean;
  ability: Ability | null; // null → any signed-in member may read
  describe: (args: Record<string, unknown>) => string;
};

const TOOL_SPECS: ToolSpec[] = [
  { name: "machine_brief", write: false, ability: null, describe: () => "look up a machine" },
  { name: "machine_history", write: false, ability: null, describe: (a) => `maintenance history & spend for ${String(a.tag)}` },
  { name: "fleet_summary", write: false, ability: null, describe: () => "summarize the machine fleet" },
  { name: "open_faults", write: false, ability: null, describe: () => "list open faults" },
  { name: "list_open_work_orders", write: false, ability: null, describe: () => "list open work orders" },
  { name: "stock_lookup", write: false, ability: null, describe: () => "look up a stock item" },
  { name: "cost_summary", write: false, ability: "report.view", describe: () => "summarize maintenance cost" },
  { name: "help", write: false, ability: null, describe: () => "show capabilities" },
  { name: "create_work_order", write: true, ability: "wo.plan", describe: (a) => `create work order "${String(a.title)}"` },
  { name: "acknowledge_fault", write: true, ability: "wo.plan", describe: (a) => `acknowledge a fault event` },
  { name: "convert_fault_to_work_order", write: true, ability: "wo.plan", describe: (a) => "convert a fault into a corrective work order" },
  { name: "compile_repair_request", write: true, ability: "repairRequests.send", describe: (a) => "compile a repair-request brief (still human-sent)" },
];

const SPEC = (name: ToolName): ToolSpec => TOOL_SPECS.find((t) => t.name === name)!;

/* ------------------------------------------------------------------ */
/* LLM seam (intent/param extraction ONLY — optional, env-configured)  */
/* ------------------------------------------------------------------ */

function llmConfigured(): boolean {
  return Boolean(process.env.AGENT_LLM_API_KEY);
}

type LlmIntent = { tool: ToolName | "none"; args: Record<string, unknown> };

/**
 * Conversation memory passed to the chat layer (recent turns; see agentService.chat).
 * The deterministic tools never see it — only the intent-LLM and phrasing-LLM use it,
 * purely to resolve follow-up questions ("and which of those are critical?").
 */
export type AgentHistory = { role: "user" | "agent"; text: string }[];

/** Rigid JSON-out chat completion; any failure falls back to the local matcher. */
async function interpretWithLlm(
  message: string,
  machineNames: string[],
  history: AgentHistory,
): Promise<LlmIntent | "error" | null> {
  const key = process.env.AGENT_LLM_API_KEY!;
  const base = process.env.AGENT_LLM_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.AGENT_LLM_MODEL ?? "gpt-4o-mini";
  const system = [
    "You map a maintenance-planner message to exactly ONE tool call. Reply with ONLY minified JSON:",
    '{"tool":"<name>","args":{...}} — every parameter goes INSIDE args, never at the top level.',
    'Examples: {"tool":"machine_brief","args":{"tag":"PUMP-3"}} · {"tool":"open_faults","args":{"severity":"critical"}} ·',
    '{"tool":"list_open_work_orders","args":{}} · {"tool":"stock_lookup","args":{"query":"BRG-6204"}} ·',
    '{"tool":"fleet_summary","args":{}} · {"tool":"cost_summary","args":{"days":30}} · {"tool":"help","args":{}} ·',
    '{"tool":"machine_history","args":{"tag":"PUMP-3"}} — last service history + lifetime/365-day spend for ONE machine ·',
    '{"tool":"create_work_order","args":{"machineTag":"PUMP-3","title":"replace DE bearing","type":"corrective","priority":"high"}} ·',
    '{"tool":"acknowledge_fault","args":{"latest":true}} · {"tool":"convert_fault_to_work_order","args":{"latest":true}} ·',
    '{"tool":"compile_repair_request","args":{"tag":"PUMP-3"}} · {"tool":"none"} — for anything else.',
    machineNames.length ? `Known machine tags: ${machineNames.slice(0, 50).join(", ")}.` : "No machines are linked yet.",
    "Never invent ids, numbers or org names. If unclear, return none.",
    history.length
      ? `RECENT CONVERSATION (use ONLY to resolve pronouns/follow-ups in the message): ${JSON.stringify(
          history.slice(-6).map((h) => `${h.role === "user" ? "user" : "assistant"}: ${h.text.slice(0, 160)}`),
        )}`
      : "",
  ].filter(Boolean).join("\n");
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [{ role: "system", content: system }, { role: "user", content: message.slice(0, 2000) }],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = body.choices?.[0]?.message?.content ?? "";
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const toolName = typeof parsed.tool === "string" ? parsed.tool : "";
    if (!TOOL_SPECS.some((t) => t.name === toolName)) return null;
    // Salvage malformed output: some models drop args and put parameters at the top level
    // ({"tool":"open_faults","severity":"critical"}). Fold anything non-reserved into args.
    const argsObj = (typeof parsed.args === "object" && parsed.args !== null ? parsed.args : {}) as Record<string, unknown>;
    const salvaged: Record<string, unknown> = { ...argsObj };
    for (const [k, v] of Object.entries(parsed)) {
      if (k !== "tool" && k !== "args" && v !== null && typeof v !== "object") salvaged[k] = v;
    }
    return { tool: toolName as ToolName, args: salvaged };
  } catch (err) {
    // Network/shape failure: logged so dev.log can tell "LLM unreachable" apart from "unmapped phrasing".
    console.error("[agent] intent LLM call failed:", err instanceof Error ? err.message : String(err));
    return "error";
  }
}

/**
 * FREE-CHAT layer (grounded). For questions that need no plant tool: the LLM answers
 * conversationally, seeing ONLY (a) the recent conversation and (b) the deterministic
 * plant summary the tools produced. Plant numbers may be echoed from those two sources
 * only — asking beyond them means answering qualitatively or saying so. Any failure
 * returns null and the chat() caller falls back to the capability text (honest).
 */
async function chatWithLlm(question: string, history: AgentHistory, plant: unknown): Promise<string | null> {
  if (!llmConfigured()) return null;
  const key = process.env.AGENT_LLM_API_KEY!;
  const base = process.env.AGENT_LLM_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.AGENT_LLM_MODEL ?? "gpt-4o-mini";
  const system = [
    "You are the Orgo Maintenance assistant chatting with a maintenance planner about their plant.",
    "You get the QUESTION, the recent CONVERSATION, and a PLANT block of verified numbers from this plant's database.",
    "Answer conversationally (max ~120 words). Maintenance questions: be practical and concrete.",
    "PLANT-block numbers may be quoted verbatim. Prior assistant turns came from verified tools — you may reference them in follow-ups.",
    "Never invent OTHER plant numbers, machine tags, ids or events. General maintenance advice needs no numbers — give it freely.",
    "If a question needs data the PLANT block does not contain, say which plant page has it (Faults, Work Orders, Inventory, Reports, Today).",
  ].join("\n");
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: JSON.stringify({
              question,
              conversation: history.slice(-6).map((h) => ({ role: h.role, text: h.text.slice(0, 200) })),
              plant,
            }).slice(0, 8000),
          },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (body.choices?.[0]?.message?.content ?? "").trim().slice(0, 1200);
    return text || null;
  } catch (err) {
    console.error("[agent] chat LLM call failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * PHRASING layer (real-chatbot mode). The tool already ran against the org DB and
 * produced a faithful draft + raw DATA; the LLM now phrases a natural answer that may
 * only echo numbers/ids verbatim from that payload. Any failure (or no LLM key)
 * falls back to the drafted text — an answer is never invented, and cost math stays
 * deterministic (cost_summary skips phrasing so validateNarrative guarantees hold).
 */
async function phraseWithLlm(question: string, reply: AgentReply, history: PhraseContext): Promise<string> {
  if (!reply.data || !llmConfigured()) return reply.text;
  const key = process.env.AGENT_LLM_API_KEY!;
  const base = process.env.AGENT_LLM_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.AGENT_LLM_MODEL ?? "gpt-4o-mini";
  const system = [
    "You are the Orgo Maintenance assistant for a maintenance planner.",
    "You get the user's QUESTION, prior CONVERSATION turns, the DATA the tool returned from the plant database, and a DRAFT reply.",
    "Use the CONVERSATION only for context (pronoun/follow-up resolution) — never as a source of numbers.",
    "Write ONE natural answer to the question using ONLY names, ids and numbers that appear verbatim in the DATA or the DRAFT.",
    "Never compute, convert, round or invent any number. Do not mention the DATA/DRAFT or JSON. Max 100 words, plain text, no headers.",
    "If the data is empty, say what is empty.",
  ].join("\n");
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: JSON.stringify({
              question,
              conversation: history.slice(-6).map((h) => ({ role: h.role, text: h.text.slice(0, 200) })),
              data: reply.data,
              draft: reply.text,
            }).slice(0, 8000),
          },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("[cogitex] phrase LLM HTTP", res.status);
      return reply.text;
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    return text || reply.text;
  } catch (err) {
    console.error("[cogitex] phrase LLM failed:", err instanceof Error ? err.message : String(err));
    return reply.text; // deterministic draft wins on any LLM failure
  }
}

/* ------------------------------------------------------------------ */
/* deterministic matcher                                               */
/* ------------------------------------------------------------------ */

export type Intent = { tool: ToolName | "none"; args: Record<string, unknown>; via: "local" | "llm" };

export function matchIntentLocal(message: string, machineList: { tag: string; name: string }[]): Intent {
  const msg = message.toLowerCase();

  // machine reference (tag or name, case-insensitive whole-ish token)
  let hit = machineList.find(
    (m) => new RegExp(`\\b${m.tag.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(msg)
      || (m.name.length > 3 && msg.includes(m.name.toLowerCase())),
  );
  // partial-name resolver: "show UKR chiller's last service…" for "UKR Chiller 01" —
  // ≥2 name tokens (possessive/plural-stripped) prefix-matched against message tokens.
  if (!hit) hit = resolvePartialMachine(message, machineList) ?? undefined;

  // listing intents first — so "open work orders" is never read as a create intent
  if (/\b(work orders|backlog|todo|to-do|queue)\b|\bopen work orders\b|\bwhat('s| is) open\b/.test(msg)) {
    return { tool: "list_open_work_orders", args: {}, via: "local" };
  }
  if (/\b(create|open|raise|plan|schedule|new)\b[^.?!;]*\b(work order\b|wo\b|card|repair job|service|pm)\b/.test(msg) || /\bwork order for\b/.test(msg)) {
    const type = /(preventive|\bpm\b|service)/.test(msg) ? "preventive" : /inspect/.test(msg) ? "inspection" : "corrective";
    const priority = /(critical|urgent|asap|emergency)/.test(msg) ? "critical" : /important|soon/.test(msg) ? "high" : "normal";
    // title = message minus the intent verbs, trimmed to a card-friendly length
    let title = message
      .replace(/\b(gpt|please|now)\b/gi, "")
      .replace(/^(hi|hey|team)[, ]+/i, "")
      .replace(/^\s*(create|open|raise|plan|schedule|new)\b/i, "")
      .replace(/^(a|an|the)\s+/i, "")
      .replace(/\b(new\s+)?work order\b(\s+(for|on|to))?/i, "")
      .replace(/\b(corrective|preventive|inspection|urgent|critical|asap|card|job|with|high|normal|low priority)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s:,\-–]+|[\s:,\-–]+$/g, "")
      .trim();
    if (title.length > 80) title = `${title.slice(0, 77)}...`;
    if (!title) title = hit ? `${hit.tag} maintenance (agent)` : "Agent-created work order";
    return { tool: "create_work_order", args: { machineTag: hit?.tag ?? null, title, type, priority }, via: "local" };
  }

  if (/\b(convert|turn) .*\bfault\b|fault .*\b(into|to) work order\b/.test(msg)) {
    return { tool: "convert_fault_to_work_order", args: { deviceName: hit?.tag ?? null, latest: true }, via: "local" };
  }
  if (/\b(ack|acknowledge)\b.*\bfault\b/.test(msg)) {
    return { tool: "acknowledge_fault", args: { deviceName: hit?.tag ?? null, latest: true }, via: "local" };
  }
  if (/\brepair request\b|\bverified technician\b|\bdispatch .*\btech/.test(msg)) {
    return hit
      ? { tool: "compile_repair_request", args: { tag: hit.tag }, via: "local" }
      : { tool: "none", args: {}, via: "local" };
  }
  // faults BEFORE the stock rule — "how many faults do we have?" must not read as
  // "do we have" = stock. Plain "do we have spare bearings" still hits stock below.
  // history intent (before generic cost/fault rules): an EXISTING machine plus
  // service-history or spend wording — "show {UKR chiller}'s last service and spend".
  // The create/ack rules above own explicit action verbs, so "create a service work
  // order for PUMP-3" never routes here.
  if (
    hit &&
    !/\bfault/.test(msg) &&
    /\bhistory\b|\blast service\b|\bservice(?:d)? history\b|\blast (?:serviced|maintenance|maintained)\b|\bservice record\b|\bspending?\b|\bspent\b|\bcost\b|\bhow much\b/.test(msg)
  ) {
    return { tool: "machine_history", args: { tag: hit.tag }, via: "local" };
  }
  if (/\b(faults?|alarms?)\b/.test(msg)) {
    const severity = /\bcritical|\bdown\b|\bemergency\b/.test(msg) ? "critical" : /\bwarning/.test(msg) ? "warning" : /\bwatch/.test(msg) ? "watch" : null;
    return { tool: "open_faults", args: { severity }, via: "local" };
  }
  // fleet-size questions: "how many machines do we have at the plant?" — must run
  // BEFORE the stock rule, whose bare "do we have" trigger swallows them otherwise.
  if (
    /\bhow many\b(?:\s+(?:of (?:our|the)|connected|registered|linked))*\s+(machines?|units?|assets?|equipment|chillers?|conveyors?|fans?|compressors?|pumps?|motors?)\b/.test(message) ||
    /\b(fleet|machines?)\b.{0,24}\b(size|census|overview|summary|total|status)\b/.test(msg)
  ) {
    return { tool: "fleet_summary", args: {}, via: "local" };
  }
  if (/\b(stock|spare|part|inventory)\b|do we have\b/.test(msg)) {
    const q = extractStockQuery(message);
    return { tool: "stock_lookup", args: { query: q ?? hit?.tag ?? null }, via: "local" };
  }
  // follow-ups without an explicit tag: "what about the chiller?" / "and the fan?" —
  // the machine NOUN resolves against the org register, deterministically.
  if (/\bwhat about\b|\bhow about\b|\band (the|that)\b|\bthat\s+(machine|chiller|fan|conveyor|compressor|pump|motor|unit)\b/.test(msg)) {
    const noun = /(?:the|that)\s+([a-z]+(?:\s+[a-z]+)?)/i.exec(message)?.[1]?.toLowerCase().trim();
    if (noun) {
      const machine = machineList.find((m) => `${m.tag} ${m.name}`.toLowerCase().includes(noun));
      if (machine) return { tool: "machine_brief", args: { tag: machine.tag }, via: "local" };
    }
  }
  if (/\b(cost|spent|maintenance cost|how much)\b/.test(msg)) {
    const days = Number(msg.match(/(\d{1,3})\s*(?:days?|d)\b/)?.[1] ?? (/quarter/.test(msg) ? 90 : 30));
    return { tool: "cost_summary", args: { days: Math.min(365, Math.max(1, days)) }, via: "local" };
  }
  if (/\b(help|what can you|capabilities|how do i use)\b/.test(msg)) {
    return { tool: "help", args: {}, via: "local" };
  }
  // machine question naming a machine that is NOT linked here — answer "not found" scoped
  if (/\bwhat('s| is) wrong (with|about)\b|\bstatus of\b|\btell me about\b/.test(msg)) {
    const tag = /(?:with|about|of)\s+([A-Za-z0-9][\w\-. ]{0,30})/i.exec(message)?.[1]?.trim().split(/\s+/)[0]?.replace(/[?,.!:;]+$/, "");
    return { tool: "machine_brief", args: { tag: tag ?? null }, via: "local" };
  }
  if (hit) {
    return { tool: "machine_brief", args: { tag: hit.tag }, via: "local" };
  }
  return { tool: "none", args: {}, via: "local" };
}

function extractStockQuery(message: string): string | null {
  const quoted = message.match(/"([^"]{2,40})"|'([^']{2,40})'/);
  if (quoted) return quoted[1] ?? quoted[2]!;
  const forToken = message.match(/\b(?:for|of|on|sku)\s+([A-Za-z0-9][A-Za-z0-9\-_.]{1,30})/i);
  if (forToken) return forToken[1]!;
  const caps = message.match(/\b[A-Z][A-Z0-9\-_.]{2,20}\b/);
  return caps?.[0] ?? null;
}

/** words that are never a distinctive machine reference on their own */
const NOT_DISTINCTIVE = new Set([
  "service", "serviced", "maintenance", "maintained", "history", "spend", "spending", "spent",
  "fault", "faults", "repair", "work", "order", "stock", "spare", "part", "cost", "job",
  "last", "first", "next", "this", "that", "today", "yesterday", "week", "month", "year",
  "pump", "motor", "generator", "compressor", "conveyor", "hvac", "chiller", "boiler",
  "cnc", "fan", "mixer", "other", "plant",
]);

/** lowercase token stream; apostrophes dropped; "ukrs"→"ukr", "fans"→"fan" (≥4 chars), "chiller's"→"chiller" */
function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (t.length >= 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}

/**
 * Partial-name machine resolver (deterministic). Example: the pitch question
 * "show UKRs' chiller's last service and spend" must resolve "UKR Chiller 01"
 * even though no full tag or complete name appears:
 *  pass 1 — a consecutive message window equal to a ≥2-tokens PREFIX of the
 *           machine's name tokens ("ukr chiller…");
 *  pass 2 — a single DISTINCTIVE name token (≥4 chars, not a generic word)
 *           that identifies exactly ONE machine in the register ("UKRs'").
 */
function resolvePartialMachine(message: string, machineList: { tag: string; name: string }[]) {
  const msgTokens = tokensOf(message);
  if (msgTokens.length === 0) return null;
  for (const m of machineList) {
    const nameTokens = tokensOf(m.name);
    for (let w = Math.min(nameTokens.length, 4); w >= 2; w--) {
      const prefix = nameTokens.slice(0, w).join(" ");
      for (let i = 0; i + w <= msgTokens.length; i++) {
        if (msgTokens.slice(i, i + w).join(" ") === prefix) return m;
      }
    }
  }
  for (const m of machineList) {
    const nameTokens = tokensOf(m.name).filter((t) => t.length >= 3 && !NOT_DISTINCTIVE.has(t));
    if (nameTokens.length === 0) continue;
    if (!msgTokens.some((t) => t.length >= 3 && !NOT_DISTINCTIVE.has(t) && nameTokens.includes(t))) continue;
    const distinct = nameTokens.some((t) => machineList.some((o) => o !== m && tokensOf(o.name).includes(t)));
    if (distinct) continue; // ambiguous across the register — the noun rule handles category words
    return m;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* tools                                                               */
/* ------------------------------------------------------------------ */

const OPEN_WO: WoStatus[] = ["draft", "planned", "assigned", "in_progress", "on_hold"];
const DONEISH = new Set(["completed", "verified", "closed"]);

export const agentTools = {
  async machine_brief(ctx: Ctx, args: { tag?: string | null }): Promise<AgentReply> {
    const db = await getDb();
    const tag = String(args.tag ?? "").trim();
    if (!tag) return { text: "Which machine? Name its TAG (e.g. PUMP-3).", citations: [], via: "local" };
    const rows = await db.select().from(machines)
      .where(and(eq(machines.organizationId, ctx.orgId), or(ilike(machines.tag, tag), ilike(machines.name, tag))))
      .limit(1);
    const m = rows[0];
    if (!m) return { text: `No machine matching "${tag}" in this workspace.`, citations: [], via: "local" };

    const [faults, openWo, lastWo] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(faultEvents)
        .where(and(eq(faultEvents.organizationId, ctx.orgId), eq(faultEvents.machineId, m.id), eq(faultEvents.status, "open"))),
      db.select({ n: sql<number>`count(*)::int` }).from(workOrders)
        .where(and(eq(workOrders.organizationId, ctx.orgId), eq(workOrders.machineId, m.id), inArray(workOrders.status, OPEN_WO))),
      db.select({ number: workOrders.number, status: workOrders.status, id: workOrders.id }).from(workOrders)
        .where(and(eq(workOrders.organizationId, ctx.orgId), eq(workOrders.machineId, m.id)))
        .orderBy(desc(workOrders.createdAt)).limit(3),
    ]);
    const statusLine = lastWo.length ? ` Last cards: ${lastWo.map((w) => `${w.number} (${w.status})`).join(", ")}.` : "";
    return {
      text: `${m.tag} — ${m.name} (${m.category ?? "?"}, criticality ${m.criticality}, ${m.lifecycleStatus}). Open faults: ${faults[0]?.n ?? 0}. Open work orders: ${openWo[0]?.n ?? 0}.${statusLine}`,
      citations: [{ kind: "machine", id: m.id, label: m.tag }],
      via: "local",
      data: {
        tag: m.tag, name: m.name, category: m.category, criticality: m.criticality, lifecycle: m.lifecycleStatus,
        openFaults: faults[0]?.n ?? 0, openWorkOrders: openWo[0]?.n ?? 0,
        lastCards: lastWo.map((w) => ({ number: w.number, status: w.status })),
      },
    };
  },

  /**
   * THE pitch tool (sprint item 5): "show UKR chiller's last service and spend".
   * Reads the item-1 history service — WO rollups + manual logbook — plus the
   * item-2 notes surface, and answers with last SERVICE + lifetime/365-day SPEND.
   * Every number is verbatim from the payload (kobo), so the phrasing LLM can
   * only restate, never invent.
   */
  async machine_history(ctx: Ctx, args: { tag?: string | null }): Promise<AgentReply> {
    const db = await getDb();
    const tag = String(args.tag ?? "").trim();
    if (!tag) {
      return { text: "Which machine? Name its TAG (e.g. UKR-CH-01) or say something like “show UKR chiller's last service and spend”.", citations: [], via: "local" };
    }
    // exact tag/name first; contains-match as fallback (LLM may pass a partial name)
    const rows = await db.select().from(machines)
      .where(and(eq(machines.organizationId, ctx.orgId), or(ilike(machines.tag, tag), ilike(machines.name, tag))))
      .limit(1);
    const m = rows[0] ?? (await db
      .select()
      .from(machines)
      .where(and(eq(machines.organizationId, ctx.orgId), or(ilike(machines.tag, `%${tag}%`), ilike(machines.name, `%${tag}%`))))
      .limit(1))[0];
    if (!m) return { text: `No machine matching "${tag}" in this workspace.`, citations: [], via: "local" };

    const [history, notes] = await Promise.all([
      maintenanceHistoryService.forMachine(ctx, m.id),
      notesService.list(ctx, m.id),
    ]);
    const s = history.summary;

    const lastService = s.lastServiceAt
      ? `Last service: ${s.lastServiceAt.toISOString().slice(0, 10)} (${s.lastServiceWoNumber}).`
      : "No concluded service on record yet.";
    const spend =
      `Lifetime spend: ${s.totalKobo} kobo ` +
      `(labor ${s.laborKobo} + parts ${s.partsKobo} + manual log ${s.manualKobo}); ` +
      `last 365 days: ${s.last365dKobo} kobo.`;
    const manualTop = [...history.expenses]
      .sort((a, b) => b.amountKobo - a.amountKobo)
      .slice(0, 3)
      .map((e) => `${e.kind} — ${e.description}: ${e.amountKobo} kobo`);
    const expensiveCard = [...history.rows]
      .filter((r) => r.costKobo > 0)
      .sort((a, b) => b.costKobo - a.costKobo)[0];
    const cards = `Cards: ${s.openWorkOrders} open, ${s.concludedWorkOrders} concluded${expensiveCard ? `. Biggest card: ${expensiveCard.wo.number} at ${expensiveCard.costKobo} kobo` : ""}.`;
    const notesLine = notes.length
      ? ` ${notes.length} note${notes.length === 1 ? "" : "s"} on file — latest: “${notes[0]?.title ?? ""}”.` // item-2 notes threaded through
      : "";

    const citations = [{ kind: "machine", id: m.id, label: m.tag }];
    if (s.lastServiceWoNumber) {
      const woRow = history.rows.find((r) => r.wo.number === s.lastServiceWoNumber);
      if (woRow) citations.push({ kind: "wo", id: woRow.wo.id, label: woRow.wo.number });
    }

    return {
      text: `${m.tag} (${m.name}). ${lastService} ${spend}${manualTop.length ? ` Manual log: ${manualTop.join("; ")}.` : ""} ${cards}${notesLine}`,
      citations,
      via: "local",
      data: {
        tag: m.tag,
        name: m.name,
        lastServiceAt: s.lastServiceAt ? s.lastServiceAt.toISOString().slice(0, 10) : null,
        lastServiceWoNumber: s.lastServiceWoNumber,
        spend: {
          totalKobo: s.totalKobo, laborKobo: s.laborKobo, partsKobo: s.partsKobo,
          manualKobo: s.manualKobo, last365dKobo: s.last365dKobo,
        },
        cards: { open: s.openWorkOrders, concluded: s.concludedWorkOrders, biggestCard: expensiveCard ? { number: expensiveCard.wo.number, costKobo: expensiveCard.costKobo } : null },
        manualLog: manualTop,
        notes: { count: notes.length, latestTitle: notes[0]?.title ?? null },
      },
    };
  },

  async fleet_summary(ctx: Ctx): Promise<AgentReply> {
    const db = await getDb();
    const rows = await db
      .select({ id: machines.id, tag: machines.tag, name: machines.name, category: machines.category, criticality: machines.criticality })
      .from(machines)
      .where(eq(machines.organizationId, ctx.orgId));
    if (rows.length === 0) return { text: "No machines are linked to this workspace yet.", citations: [], via: "local" };

    // type census: first machine-kind noun that appears in tag/name/category (each machine counted once)
    const KINDS = ["chiller", "conveyor", "fan", "compressor", "pump", "motor"];
    const kinds: Record<string, number> = {};
    for (const m of rows) {
      const hay = `${m.tag} ${m.name} ${m.category ?? ""}`.toLowerCase();
      for (const k of KINDS) {
        if (hay.includes(k)) {
          kinds[k] = (kinds[k] ?? 0) + 1;
          break;
        }
      }
    }
    const crit: Record<string, number> = {};
    for (const m of rows) crit[m.criticality] = (crit[m.criticality] ?? 0) + 1;

    const faultRows = await db
      .select({ machineId: faultEvents.machineId, n: sql<number>`count(*)::int` })
      .from(faultEvents)
      .where(and(eq(faultEvents.organizationId, ctx.orgId), eq(faultEvents.status, "open")))
      .groupBy(faultEvents.machineId);
    const nByMachine = new Map(faultRows.map((r) => [r.machineId, Number(r.n)]));
    const openFaultsTotal = faultRows.reduce((a, r) => a + Number(r.n), 0);
    const offenders = rows
      .filter((m) => nByMachine.has(m.id))
      .map((m) => ({ machineId: m.id, tag: m.tag, n: nByMachine.get(m.id) ?? 0 }))
      .sort((a, b) => b.n - a.n);
    const worst = offenders.slice(0, 3);

    const openWo = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(workOrders)
      .where(and(eq(workOrders.organizationId, ctx.orgId), inArray(workOrders.status, OPEN_WO)));

    const kindEntries = Object.entries(kinds).sort((a, b) => b[1] - a[1]);
    const critEntries = Object.entries(crit).sort((a, b) => b[1] - a[1]);
    const text = [
      `The plant has ${rows.length} machines.`,
      kindEntries.length ? ` By type: ${kindEntries.map(([k, n]) => `${k} ${n}`).join(", ")}.` : "",
      critEntries.length ? ` By criticality: ${critEntries.map(([k, n]) => `criticality ${k}: ${n}`).join(", ")}.` : "",
      openFaultsTotal ? ` ${offenders.length} machines have open faults (${openFaultsTotal} in total).` : " No machines currently have open faults.",
      Number(openWo[0]?.n ?? 0) ? ` Open work orders: ${Number(openWo[0]?.n)}.` : " No open work orders.",
      worst.length ? ` Most affected: ${worst.map((w) => `${w.tag} (${w.n} faults)`).join(", ")}.` : "",
    ].join("");
    return {
      text,
      citations: worst.map((w) => ({ kind: "machine", id: w.machineId, label: w.tag })),
      via: "local",
      data: {
        totalMachines: rows.length,
        kinds: kindEntries.map(([kind, count]) => ({ kind, count })),
        criticality: critEntries.map(([level, count]) => ({ level, count })),
        machinesWithOpenFaults: offenders.length,
        openFaultsTotal,
        openWorkOrders: Number(openWo[0]?.n ?? 0),
        worstFaults: worst.map((w) => ({ tag: w.tag, openFaults: w.n })),
      },
    };
  },

  async open_faults(ctx: Ctx, args: { severity?: string | null }): Promise<AgentReply> {
    const rows = await faultsService.list(ctx, { status: "open" });
    const sev = args.severity ?? null;
    const shown = (sev ? rows.filter((f) => f.severity === sev) : rows).slice(0, 8);
    if (shown.length === 0) {
      return { text: sev ? `No open ${sev} faults. ` : "No open faults. ", citations: [], via: "local" };
    }
    return {
      text: `${shown.length} open fault${shown.length === 1 ? "" : "s"}${sev ? ` (${sev})` : ""}:\n${shown.map((f) => `• ${f.videMachineName} — ${f.faultType} (${f.severity})`).join("\n")}${rows.length > shown.length ? `\n…and ${rows.length - shown.length} more on the Faults page.` : ""}`,
      citations: shown.map((f) => ({ kind: "fault", id: f.id, label: `${f.videMachineName}/${f.faultType}` })),
      via: "local",
      data: { totalOpen: rows.length, items: shown.map((f) => ({ machine: f.videMachineName, faultType: f.faultType, severity: f.severity, flaggedAt: f.flaggedAt })) },
    };
  },

  async list_open_work_orders(ctx: Ctx): Promise<AgentReply> {
    const db = await getDb();
    const rows = await db
      .select({ id: workOrders.id, number: workOrders.number, title: workOrders.title, status: workOrders.status, priority: workOrders.priority, tag: machines.tag })
      .from(workOrders)
      .leftJoin(machines, eq(machines.id, workOrders.machineId))
      .where(and(eq(workOrders.organizationId, ctx.orgId), inArray(workOrders.status, OPEN_WO)))
      .orderBy(desc(workOrders.createdAt))
      .limit(8);
    if (rows.length === 0) return { text: "The board is clear — no open work orders.", citations: [], via: "local" };
    return {
      text: `${rows.length} open work order${rows.length === 1 ? "" : "s"}:\n${rows.map((w) => `• ${w.number} — ${w.title}${w.tag ? ` (${w.tag})` : ""} [${w.priority}, ${w.status}]`).join("\n")}`,
      citations: rows.map((w) => ({ kind: "wo", id: w.id, label: w.number })),
      via: "local",
      data: { items: rows },
    };
  },

  async stock_lookup(ctx: Ctx, args: { query?: string | null }): Promise<AgentReply> {
    const db = await getDb();
    const q = String(args.query ?? "").trim();
    if (!q) return { text: "Which item? Give a SKU or part name.", citations: [], via: "local" };
    const like = `%${q}%`;
    const items = await db.select().from(inventoryItems)
      .where(and(eq(inventoryItems.organizationId, ctx.orgId), or(ilike(inventoryItems.sku, like), ilike(inventoryItems.name, like))))
      .limit(3);
    if (items.length === 0) return { text: `No stock item matching "${q}".`, citations: [], via: "local" };
    const replies: string[] = [];
    const citations: Citation[] = [];
    const dataItems: Record<string, unknown>[] = [];
    for (const it of items) {
      const openRes = await db.select({ n: sql<number>`coalesce(sum(${inventoryReservations.qty}), 0)::float` }).from(inventoryReservations)
        .where(and(eq(inventoryReservations.organizationId, ctx.orgId), eq(inventoryReservations.itemId, it.id), eq(inventoryReservations.status, "open")));
      const onHand = Number(it.qtyOnHand);
      const reserved = Number(openRes[0]?.n ?? 0);
      const available = Math.round((onHand - reserved) * 1000) / 1000;
      const low = it.reorderPoint !== null && onHand <= Number(it.reorderPoint) ? " — BELOW REORDER POINT" : "";
      const availLow = it.reorderPoint !== null && onHand <= Number(it.reorderPoint);
      replies.push(`• ${it.sku} — ${it.name}: ${available} ${it.unit} available (${reserved} reserved${low})`);
      citations.push({ kind: "sku", id: it.id, label: it.sku });
      dataItems.push({ sku: it.sku, name: it.name, onHand, reserved, available, unit: it.unit, belowReorderPoint: availLow });
    }
    return { text: replies.join("\n"), citations, via: "local", data: { items: dataItems } };
  },

  async cost_summary(ctx: Ctx, args: { days?: number }): Promise<AgentReply> {
    if (!can(ctx.roles, "report.view")) return { text: "Reports are not available to your role.", citations: [], via: "local" };
    const db = await getDb();
    const days = Math.min(365, Math.max(1, Math.round(Number(args.days ?? 30))));
    const to = new Date();
    const from = new Date(Date.now() - days * 86_400_000);

    const woRows = await db.select().from(workOrders).where(eq(workOrders.organizationId, ctx.orgId));
    const ids = new Set(woRows.map((w) => w.id));
    const labor = ids.size ? (await db.select().from(workOrderLabor)).filter((l) => ids.has(l.workOrderId)).map((l) => ({ workOrderId: l.workOrderId, minutes: l.minutes, rateKobo: l.rateKobo })) : [];
    const parts = ids.size ? (await db.select().from(workOrderParts)).filter((p) => ids.has(p.workOrderId)).map((p) => ({ workOrderId: p.workOrderId, qty: p.qty, unitCostKobo: p.unitCostKobo })) : [];
    const faults = (await db.select({ machineId: faultEvents.machineId, severity: faultEvents.severity, faultType: faultEvents.faultType, flaggedAt: faultEvents.flaggedAt }).from(faultEvents).where(and(eq(faultEvents.organizationId, ctx.orgId), gte(faultEvents.flaggedAt, from))));
    const machineRows: MachineCore[] = await db.select({ id: machines.id, tag: machines.tag, name: machines.name, category: machines.category }).from(machines).where(eq(machines.organizationId, ctx.orgId));

    const calc = computeMetrics({
      from, to,
      workOrders: woRows.map((w): WorkOrderCore => ({ id: w.id, number: w.number, title: w.title, machineId: w.machineId, type: w.type, status: w.status, priority: w.priority, plannedStart: w.plannedStart, plannedEnd: w.plannedEnd, actualStart: w.actualStart, actualEnd: w.actualEnd, downtimeHours: w.downtimeHours, completedAt: w.actualEnd, createdAt: w.createdAt })),
      labor: labor as LaborCore[],
      parts: parts as PartsCore[],
      faults: faults as FaultCore[],
      machines: machineRows,
      machineIds: null,
    });

    const nairaText = (kobo: number) => `${kobo} kobo`;
    const text =
      `Maintenance cost over the last ${calc.period.days} days: ${nairaText(calc.cost.totalKobo)} total ` +
      `(${nairaText(calc.cost.laborKobo)} labor + ${nairaText(calc.cost.partsKobo)} parts). ` +
      `${calc.workOrders.completed} work orders completed, ${calc.workOrders.open} open, ${calc.faults.total} faults flagged.`;
    // every numeral in agent text must trace to the calc bundle (brief §5.7)
    const guard = validateNarrative(text, calc);
    if (!guard.ok) {
      return { text: `Maintenance totals for the last ${calc.period.days} days are on the Reports page.`, citations: [], via: "local" };
    }
    return {
      text,
      citations: calc.cost.byMachine.slice(0, 5).map((m) => ({ kind: "machine", id: m.machineId, label: m.tag ?? "machine" })),
      via: "local",
    };
  },

  async help(): Promise<AgentReply> {
    return {
      text: [
        "I read this plant's data (scoped to your org, always):",
        "• “what's wrong with PUMP-3?” — machine brief (faults, open cards)",
        "• “how many machines do we have at the plant?” — fleet size, by type and criticality",
        "• “open faults” / “any critical alarms?” — fault list",
        "• “open work orders” — the live queue",
        "• “stock for BRG-6204?” — on-hand, reserved, available",
        "• “show UKR chiller's last service and spend” — the machine's maintenance history: last service card, lifetime + 365-day spend, notes count",
        "• “cost last 30 days” — deterministic totals (same math as Reports)",
        "Writes are PROPOSED first — I show you exactly what will run, you press CONFIRM:",
        "• “create a work order for PUMP-3: replace DE bearing” (corrective by default; say preventive/inspection)",
        "• “acknowledge the latest fault on PUMP-3”, “convert latest fault on PUMP-3 to a work order”",
        "• “compile a repair request for PUMP-3” — brief draft only; a human always sends it.",
      ].join("\n"),
      citations: [],
      via: "local",
    };
  },
};

/* ------------------------------------------------------------------ */
/* write-tool executions (run ONLY on confirmed proposals)             */
/* ------------------------------------------------------------------ */

export const agentWrites = {
  async create_work_order(ctx: Ctx, args: { machineTag?: string | null; title: string; type?: string; priority?: string }) {
    const db = await getDb();
    let machineId: string | null = null;
    const tag = String(args.machineTag ?? "").trim();
    if (tag) {
      const m = (await db.select({ id: machines.id }).from(machines).where(and(eq(machines.organizationId, ctx.orgId), ilike(machines.tag, tag))).limit(1))[0];
      if (!m) throw new Error("machine_not_found");
      machineId = m.id;
    }
    const type = (["corrective", "preventive", "inspection"].includes(String(args.type)) ? args.type : "corrective") as "corrective" | "preventive" | "inspection";
    const priority = (["low", "normal", "high", "critical"].includes(String(args.priority)) ? args.priority : "normal") as "low" | "normal" | "high" | "critical";
    const title = String(args.title ?? "").trim() || "Agent-created work order";
    const wo = await workOrderWriteService.create(ctx, {
      title: title.slice(0, 120),
      machineId,
      type,
      priority,
      source: "agent",
      status: "planned",
    });
    return {
      text: `Created ${wo.number} — "${title.slice(0, 120)}" (${type}, ${priority}${machineId ? ", assigned to machine on the card" : ""}), status planned.`,
      citations: [{ kind: "wo", id: wo.id, label: wo.number }],
    };
  },

  async acknowledge_fault(ctx: Ctx, args: { faultId?: string; deviceName?: string | null }) {
    const faultId = await resolveFaultId(ctx, args);
    const f = await faultsService.byId(ctx, faultId);
    await faultsWriteService.acknowledge(ctx, faultId);
    return {
      text: `Acknowledged fault ${f?.faultType ?? ""} on ${f?.videMachineName ?? "device"}.`,
      citations: [{ kind: "fault", id: faultId, label: f?.faultType ?? "fault" }],
    };
  },

  async convert_fault_to_work_order(ctx: Ctx, args: { faultId?: string; deviceName?: string | null }) {
    const faultId = await resolveFaultId(ctx, args);
    const f = await faultsService.byId(ctx, faultId);
    const { woId, woNumber } = await faultsWriteService.convertToWorkOrder(ctx, faultId);
    return {
      text: `Converted to ${woNumber} (corrective). Review and assign it on the work-order page.`,
      citations: [
        { kind: "fault", id: faultId, label: f?.faultType ?? "fault" },
        { kind: "wo", id: woId, label: woNumber },
      ],
    };
  },

  async compile_repair_request(ctx: Ctx, args: { tag: string }) {
    const db = await getDb();
    const m = (await db.select({ id: machines.id }).from(machines).where(and(eq(machines.organizationId, ctx.orgId), ilike(machines.tag, String(args.tag)))).limit(1))[0];
    if (!m) throw new Error("machine_not_found");
    const { requestId } = await repairRequestsWriteService.compile(ctx, { machineId: m.id });
    return {
      text: "Compiled a repair-request brief. NOTHING was sent — review it on the repair request page, edit urgency/notes, then SEND TO MARKETPLACE yourself.",
      citations: [{ kind: "repair", id: requestId, label: "repair draft" }],
    };
  },
};

async function resolveFaultId(ctx: Ctx, args: { faultId?: string; deviceName?: string | null }): Promise<string> {
  if (args.faultId) return String(args.faultId);
  const rows = await faultsService.list(ctx, { status: "open" });
  const target = args.deviceName
    ? rows.filter((f) => f.videMachineName.toLowerCase() === String(args.deviceName).toLowerCase())
    : rows;
  const fault = target[0] ?? rows[0];
  if (!fault) throw new Error("no_open_fault");
  return fault.id;
}

/* ------------------------------------------------------------------ */
/* chat orchestration + logs                                           */
/* ------------------------------------------------------------------ */

export const agentService = {
  async chat(ctx: Ctx, message: string, history: AgentHistory = []): Promise<AgentReply> {
    const clean = message.trim().slice(0, 2000);
    if (!clean) return { text: "Ask me anything about this plant.", citations: [], via: "local" };

    const db = await getDb();
    const machineList = (await db.select({ tag: machines.tag, name: machines.name }).from(machines).where(eq(machines.organizationId, ctx.orgId))).map((m) => ({ tag: m.tag, name: m.name }));

    let intent: Intent = matchIntentLocal(clean, machineList);
    if (llmConfigured() && intent.tool === "none") {
      // only off-rulebook phrasings pay the intent round-trip; the rulebook is authoritative
      const llm = await interpretWithLlm(clean, machineList.map((m) => m.tag), history);
      if (llm === "error") {
        // Honest failure: the language service is down, not the question unanswerable.
        return {
          text: "I couldn't reach the assistant's language service just now, so I couldn't interpret that question. The plant data tools still work — try a quick-start chip phrase, or ask again in a moment.",
          citations: [], via: "local",
        };
      }
      if (llm) intent = { tool: llm.tool, args: llm.args ?? {}, via: "llm" };
    }
    if (intent.tool === "none") {
      console.error(`[agent] unmapped message (via ${intent.via}): "${clean.slice(0, 160)}"`);
      // Easy mode: no dead end. Anything that needs no plant tool gets a grounded,
      // conversational LLM answer over the verified plant summary + conversation.
      const plant = await agentTools.fleet_summary(ctx);
      const chatty = plant.data ? await chatWithLlm(clean, history, plant.data) : null;
      if (chatty) return { text: chatty, citations: [], via: "llm" };
      return {
        text: [
          "My language service seems unreachable right now, so I couldn't interpret that question.",
          "Things I answer by keyword anyway: a machine's status (“what's wrong with the chiller?”),",
          "open faults and alarm levels, open work orders, spare-parts stock (“do we have BRG-6204?”),",
          "service costs, and creating / acknowledging / converting work orders and fault work.",
          "Type “help” for the exact phrasings.",
        ].join(" "),
        citations: [], via: intent.via,
      };
    }

    const spec = SPEC(intent.tool);
    // write tools stop at the proposal unless CONFIRMED through confirmProposal()
    if (spec.write) {
      if (!spec.ability || !can(ctx.roles, spec.ability)) {
        await logCall(ctx, { status: "write-refused", tool: intent.tool, args: intent.args, via: intent.via, error: `forbidden:${spec.ability}` });
        return {
          text: `Your role can't ${spec.describe(intent.args)} — this is a planner/maintenance-manager action (${spec.ability}).`,
          citations: [], via: intent.via,
        };
      }
      if (!agentWrites[intent.tool as keyof typeof agentWrites]) {
        return { text: "That write is not implemented yet.", citations: [], via: intent.via };
      }
      const log = await logCall(ctx, { status: "write-proposed", tool: intent.tool, args: intent.args, via: intent.via });
      return {
        text: `Ready to ${spec.describe(intent.args)}. NOTHING has run yet — press CONFIRM to execute, or discard.`,
        citations: [], via: intent.via,
        proposal: { logId: log.id, tool: intent.tool, summary: spec.describe(intent.args) },
      };
    }

    // read tools run live, org-scoped
    const exec = agentTools[intent.tool as keyof typeof agentTools] as ((c: Ctx, a: Record<string, unknown>) => Promise<AgentReply>) | undefined;
    if (!exec || intent.tool === "help") {
      return (intent.tool === "help" ? agentTools.help() : { text: "No tool for that yet.", citations: [], via: intent.via });
    }
    const reply = await exec(ctx, intent.args);
    // Real-chatbot phrasing: the LLM restates the DETERMINISTIC tool result naturally,
    // echoing only its numbers (cost_summary keeps its validated replay-safe text).
    const text =
      reply.data && intent.tool !== "cost_summary" ? await phraseWithLlm(clean, reply, history) : reply.text;
    await logCall(ctx, { status: "read", tool: intent.tool, args: intent.args, via: intent.via, result: { text }, citations: reply.citations });
    return { text, citations: reply.citations, via: intent.via };
  },

  /** Execute a previously-confirmed write proposal (re-verified against Ctx). */
  async confirmProposal(ctx: Ctx, logId: string): Promise<AgentReply> {
    const db = await getDb();
    if (!/^[0-9a-f-]{36}$/.test(logId)) throw new Error("bad_reference");
    const rows = await db.select().from(agentToolLogs)
      .where(and(eq(agentToolLogs.organizationId, ctx.orgId), eq(agentToolLogs.userId, ctx.userId), eq(agentToolLogs.id, logId)))
      .limit(1);
    const proposal = rows[0];
    if (!proposal) throw new Error("proposal_not_found");
    if (proposal.status !== "write-proposed") throw new Error(`not_pending:${proposal.status}`);
    const spec = SPEC(proposal.tool as ToolName);
    if (!spec.ability || !can(ctx.roles, spec.ability)) throw new Error(`forbidden:${spec.ability}`);

    const fn = (agentWrites as unknown as Record<string, (c: Ctx, a: Record<string, unknown>) => Promise<{ text: string; citations: Citation[] }>>)[spec.name];
    if (!fn) throw new Error("tool_unavailable");
    try {
      const out = (await fn(ctx, (proposal.args ?? {}) as Record<string, unknown>)) as { text: string; citations: Citation[] };
      await db.update(agentToolLogs).set({ status: "write-executed", result: { text: out.text }, citations: out.citations }).where(eq(agentToolLogs.id, proposal.id));
      await auditRepo.log(db, {
        organizationId: ctx.orgId,
        actorUserId: ctx.userId,
        actorKind: "agent",
        action: `agent.${spec.name}.executed`,
        entityType: "agent_tool_log",
        entityId: proposal.id,
        diff: { args: proposal.args },
      });
      return { text: out.text, citations: out.citations, via: (proposal.via as "local" | "llm") ?? "local" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.update(agentToolLogs).set({ status: "write-refused", error: msg }).where(eq(agentToolLogs.id, proposal.id));
      throw err;
    }
  },

  /** User pressed DISCARD on a proposal — it is marked refused, not executed. */
  async discardProposal(ctx: Ctx, logId: string): Promise<void> {
    const db = await getDb();
    if (!/^[0-9a-f-]{36}$/.test(logId)) throw new Error("bad_reference");
    const rows = await db.select({ id: agentToolLogs.id, status: agentToolLogs.status }).from(agentToolLogs)
      .where(and(eq(agentToolLogs.organizationId, ctx.orgId), eq(agentToolLogs.userId, ctx.userId), eq(agentToolLogs.id, logId)))
      .limit(1);
    const proposal = rows[0];
    if (!proposal) throw new Error("proposal_not_found");
    if (proposal.status !== "write-proposed") throw new Error(`not_pending:${proposal.status}`);
    await db.update(agentToolLogs).set({ status: "write-refused", error: "discarded_by_user" }).where(eq(agentToolLogs.id, proposal.id));
  },

  async recentLogs(ctx: Ctx, limit = 20) {
    const db = await getDb();
    return db
      .select({ id: agentToolLogs.id, status: agentToolLogs.status, tool: agentToolLogs.tool, createdAt: agentToolLogs.createdAt, via: agentToolLogs.via, citations: agentToolLogs.citations })
      .from(agentToolLogs)
      .where(eq(agentToolLogs.organizationId, ctx.orgId))
      .orderBy(desc(agentToolLogs.createdAt))
      .limit(limit);
  },
};

async function logCall(
  ctx: Ctx,
  input: { status: string; tool: string; args?: Record<string, unknown>; via?: "local" | "llm"; result?: Record<string, unknown>; citations?: Citation[]; error?: string },
): Promise<typeof agentToolLogs.$inferSelect> {
  const db = await getDb();
  const inserted = await db.insert(agentToolLogs).values({
    organizationId: ctx.orgId,
    userId: ctx.userId,
    status: input.status,
    tool: input.tool,
    args: input.args ?? null,
    result: input.result ?? null,
    citations: input.citations ?? [],
    via: input.via ?? "local",
    error: input.error ?? null,
  }).returning();
  const row = inserted[0];
  if (!row) throw new Error("log_insert_failed");
  return row;
}
