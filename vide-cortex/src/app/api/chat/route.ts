/**
 * VIDE assistant bridge — POST /api/chat
 *
 * The console's chat panels send { message, context? } here; the route builds a live
 * FLEET DATA block from the deterministic SIM engine (worst machines first) and calls
 * OpenRouter. No simulated answers: every reply is produced by the configured LLM; on
 * failure the client gets an honest error instead of an invented one.
 *
 * Config (env, gitignored):
 *   OPENROUTER_API_KEY    required
 *   OPENROUTER_BASE_URL   default https://openrouter.ai/api/v1
 *   OPENROUTER_MODEL      default openai/gpt-4o-mini
 */
import { NextResponse } from "next/server";
import { MOCK_FLEET, simCriticalEvents, simHealthStatus, simReadingLevels } from "@/lib/api/mock/fleet";
import { simEnabled } from "@/lib/sim/state";

export const dynamic = "force-dynamic";

const STATUS_RANK: Record<string, number> = { critical: 3, warning: 2, watch: 1, healthy: 0 };

function fleetData(): string {
  if (!simEnabled()) {
    return "SIMULATION IS OFF — the VIDE console has no live telemetry right now. Say so plainly if the question needs live data.";
  }
  const t = Date.now();
  const events = simCriticalEvents(t, 12);
  const worst = MOCK_FLEET.map((m) => ({
    name: m.name,
    type: m.type,
    site: m.siteCode ?? "",
    status: simHealthStatus(m, t),
    temperatureC: Math.round((m.temp.base + m.temp.perDay * 60) * 10) / 10,
    vibrationMmS: Math.round((m.vib.base + m.vib.perDay * 60) * 100) / 100,
  }))
    .sort((a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) || b.temperatureC - a.temperatureC)
    .slice(0, 10);

  const bySeverity = {
    critical: simCriticalEvents(t, 50).filter((e) => e.severity === "critical").length,
    warning: simCriticalEvents(t, 50).filter((e) => e.severity === "warning").length,
  };

  return [
    `Fleet: ${MOCK_FLEET.length} machines, worst-first by status:`,
    JSON.stringify(worst),
    `Open anomalies: ${bySeverity.critical} critical, ${bySeverity.warning} warning. Latest events:`,
    JSON.stringify(events.map((e) => ({ machine: e.machineName, faultType: e.faultType, severity: e.severity }))),
  ].join("\n");
}

export async function POST(req: Request): Promise<Response> {
  let body: { message?: unknown; context?: unknown; history?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
  const context = typeof body.context === "string" ? body.context.trim().slice(0, 2000) : "";
  if (!message) return NextResponse.json({ ok: false, error: "message_required" }, { status: 400 });

  // Multi-turn: the client sends its recent exchanges for follow-up context only.
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  if (Array.isArray(body.history)) {
    for (const t of body.history.slice(-6)) {
      if (typeof t !== "object" || t === null) continue;
      const cand = t as { role?: unknown; text?: unknown };
      if ((cand.role === "user" || cand.role === "agent") && typeof cand.text === "string" && cand.text.trim()) {
        turns.push({ role: cand.role === "user" ? "user" : "assistant", content: cand.text.trim().slice(0, 500) });
      }
    }
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "OPENROUTER_API_KEY is not configured on the backend — no answer is invented in its place." },
      { status: 503 },
    );
  }
  const base = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const model = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";

  const system = [
    "You are the VIDE assistant embedded in the VIDE CORTEX console (industrial IoT monitoring: temperature, vibration, power).",
    "Answer the operator's question naturally and briefly (max ~120 words).",
    "Earlier turns may be included — use them only for follow-up context (pronouns like 'it'/'them').",
    "Use ONLY the machines, readings, statuses and event names given in the FLEET DATA and CONTEXT blocks — never invent machines, numbers or events.",
    "If the data does not contain what is asked, say so. Reference machines by their exact names.",
  ].join("\n");

  const user = message + (context ? `\n\nCONTEXT:\n${context}` : "") + `\n\nFLEET DATA:\n${fleetData()}`;

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 400,
        messages: [
          { role: "system", content: system },
          ...turns,
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `LLM provider returned ${res.status} — no answer is invented in its place.` },
        { status: 502 },
      );
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return NextResponse.json({ ok: false, error: "llm_empty_reply" }, { status: 502 });
    return NextResponse.json({ ok: true, reply: { text, via: model } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `LLM unreachable — ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
