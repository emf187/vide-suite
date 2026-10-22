import { and, eq, inArray } from "drizzle-orm";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { agentService } from "@/server/services/agent";
import { formatDateTime } from "@/lib/time";
import { getDb } from "@/server/db/client";
import { machines, workOrders } from "@/server/db/schema";
import { faultsService } from "@/server/services/faults";
import { machinesService } from "@/server/services/machines";
import {
  agentAskAction,
  agentClearAction,
  agentConfirmAction,
  agentDiscardAction,
  readAgentChatHistory,
  type ChatMsg,
} from "./actions";

export const metadata = { title: "Maintenance agent" };
export const dynamic = "force-dynamic";

const OPEN_WO = ["draft", "planned", "assigned", "in_progress", "on_hold"] as const;

function citeHref(c: { kind: string; id: string }): string {
  switch (c.kind) {
    case "machine": return `/machines/${c.id}`;
    case "wo": return `/work-orders/${c.id}`;
    case "sku": return `/inventory/${c.id}`;
    case "repair": return `/repairs/${c.id}`;
    default: return "/faults?status=open"; // fault events have no detail page
  }
}

function ChatTurn({ m, isLast }: { m: ChatMsg; isLast: boolean }) {
  const showProposal = m.proposal && isLast; // only the newest proposal offers buttons
  return (
    <div className={`msg ${m.role === "user" ? "user" : "agent"}`}>
      {m.role === "agent" ? <span className="who">agent</span> : null}
      {m.text}
      {m.citations && m.citations.length > 0 ? (
        <div>
          {m.citations.map((c, j) => (
            <a key={`${c.id}-${j}`} className="cite" href={citeHref(c)}>
              {c.kind}: {c.label}
            </a>
          ))}
        </div>
      ) : null}
      {showProposal && m.proposal ? (
        <div className="proposal">
          <form action={agentConfirmAction} style={{ display: "inline" }}>
            <input type="hidden" name="logId" value={m.proposal.logId} />
            <button type="submit" className="confirm">CONFIRM — EXECUTE</button>
          </form>
          <form action={agentDiscardAction} style={{ display: "inline" }}>
            <input type="hidden" name="logId" value={m.proposal.logId} />
            <button type="submit" className="discard">DISCARD</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Agent as a PLAIN chat window (v3) — entirely server-rendered. SEND is a server action
 * form: it works with JS and (critically) also without it, as a native form POST, which
 * is the one interaction style this workspace's flaky browser profiles never break.
 * The conversation rides a cookie (last 10 turns); every write lands in agent_tool_logs.
 */
export default async function AgentPage() {
  const ctx = await getCtx();
  if (!ctx) return null;

  const [machineRows, openFaults, history, db, logs] = await Promise.all([
    machinesService.list(ctx),
    faultsService.list(ctx, { status: "open" }),
    readAgentChatHistory(),
    getDb(),
    agentService.recentLogs(ctx, 8),
  ]);
  const openWo = await db
    .select({ n: workOrders.id })
    .from(workOrders)
    .where(and(eq(workOrders.organizationId, ctx.orgId), inArray(workOrders.status, [...OPEN_WO])));

  const mayWriteAnywhere = can(ctx.roles, "wo.plan") || can(ctx.roles, "repairRequests.send");
  const faultCrit = openFaults.filter((f) => f.severity === "critical").length;

  const machineLines = machineRows
    .slice(0, 14)
    .map((m) => `${m.tag} — ${m.name}${m.category ? ` (${m.category})` : ""} · criticality ${m.criticality}`);
  const registerText = [
    `${ctx.orgName} · ${machineRows.length} machines on the register · ${openWo.length} open work orders · ${openFaults.length} open faults (${faultCrit} critical).`,
    "",
    "Workspace register:",
    ...machineLines,
    machineRows.length > machineLines.length ? `… and ${machineRows.length - machineLines.length} more on the Machines page.` : "",
  ].join("\n");

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ marginBottom: 3 }}>Maintenance agent</h1>
        <p className="lead" style={{ marginBottom: 0 }}>
          A chat window over your plant&rsquo;s data — answers come from org-scoped tools and cite their records.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="eyebrow">CONTEXT · WHAT THE AGENT SEES</div>
        <p className="kv" style={{ marginTop: 4 }}>
          <span className="k">App</span>
          <span className="v">Cogitex Maintenance — work orders, faults, inventory, repairs, reports. Machine telemetry flows in from VIDE CORTEX.</span>
        </p>
        <p className="kv">
          <span className="k">Role</span>
          <span className="v">{mayWriteAnywhere ? "you may confirm agent-proposed writes" : "read-only role — proposals are refused server-side"}</span>
        </p>
        <p className="kv" style={{ display: "block", whiteSpace: "pre-wrap" }}>
          <span className="v">{registerText}</span>
        </p>
      </div>

      <div className="chat-window">
        <div className="chat-head">
          <span className="chat-dot" />
          <div>
            <div className="who">COGITEX AGENT</div>
            <div className="status">
              {mayWriteAnywhere
                ? "reads org records · proposes writes · waits for your CONFIRM"
                : "read-only role — answers cite org records, writes are refused"}
            </div>
          </div>
        </div>

        <div className="chat-list">
          {history.length === 0 ? (
            <div className="msg agent">
              <span className="who">agent</span>
              {`Context loaded — ${machineRows.length} machines, ${openFaults.length} open faults, ${openWo.length} open work orders. Ask anything, or try "open faults", "stock for <SKU>", "cost last 30 days".${mayWriteAnywhere ? " Writes are PROPOSED first — nothing runs until you press CONFIRM." : ""}`}
            </div>
          ) : (
            history.map((m, i) => <ChatTurn key={i} m={m} isLast={i === history.length - 1} />)
          )}
        </div>

        <form className="chat-composer" action={agentAskAction}>
          <input
            name="message"
            autoComplete="off"
            required
            placeholder='Ask the plant — e.g. "open faults" · "what is wrong with the chiller?" · "cost last 30 days"'
          />
          <button type="submit">SEND →</button>
        </form>
        <form action={agentClearAction} style={{ padding: "0 12px 10px" }}>
          <button type="submit" style={{ background: "none", border: "none", color: "var(--dim2)", fontSize: 10, cursor: "pointer", padding: 0 }}>
            CLEAR WINDOW
          </button>
        </form>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="eyebrow">{`RECENT TOOL ACTIVITY / ${logs.length}`}</div>
        {logs.length === 0 ? (
          <p className="empty-state" style={{ margin: "6px 0 0" }}>No tool calls yet in this workspace.</p>
        ) : (
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", marginTop: 4 }}>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td style={{ padding: "5px 8px 5px 0", color: "var(--dim2)", fontSize: 10, whiteSpace: "nowrap" }}>{formatDateTime(l.createdAt, ctx.timezone)}</td>
                  <td style={{ padding: "5px 8px 5px 0", fontSize: 10.5 }}>{l.tool}{l.via === "llm" ? " (llm)" : ""}</td>
                  <td style={{ padding: "5px 8px 5px 0", fontSize: 10.5 }}>
                    <span className={l.status === "write-executed" ? "ok-text" : l.status === "write-refused" || l.status === "error" ? "error-text" : ""}>{l.status}</span>
                  </td>
                  <td style={{ padding: "5px 0 5px 0", fontSize: 10.5, color: "var(--dim2)" }}>
                    {(l.citations ?? []).map((c, i) => <span key={`${c.id}-${i}`} style={{ marginRight: 6 }}>{c.label}</span>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
