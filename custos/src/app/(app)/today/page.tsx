import Link from "next/link";
import { getCtx } from "@/server/ctx";
import { EVIDENCE_KIND_LABEL } from "@/lib/industries";
import { dueLabel, tasksService } from "@/server/services/tasks";
import { personsService } from "@/server/services/persons";
import { createTaskAction, pushTaskAction } from "./actions";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

/**
 * Today — the heads' desk: set tasks (the agent pushes instantly), watch the
 * open board, and see proof (media + typed signatures) return to this desk.
 */
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const sp = await searchParams;
  const people = await personsService.list(ctx);
  const board = await tasksService.openBoard(ctx);
  const proof = await tasksService.proofFeed(ctx);
  const counts = await tasksService.countsLast24h(ctx);
  const errors: Record<string, string> = {
    fields: "Check the fields — pick a person and give the task a title.",
    no_proof: "Tick at least one proof kind (media or signature).",
  };

  return (
    <>
      <h1>Today</h1>
      <p className="lead">
        {ctx.orgName} — set the work, keep the loop. Staff do tasks in ordinary WhatsApp; proof (media + signature)
        lands back on this desk with the audit trail attached.
      </p>

      {sp.ok ? (
        <div className="card" style={{ borderLeft: "3px solid var(--ok)" }}>
          <p style={{ fontSize: 12, margin: 0, color: "var(--ok)" }}>
            {sp.ok === "pushed" ? "Re-pushed — the task card is back in their chat." : "Task set — the agent already delivered it to their chat."}
          </p>
        </div>
      ) : null}
      {sp.error && errors[sp.error] ? (
        <div className="card" style={{ borderLeft: "3px solid var(--crit)" }}>
          <p style={{ fontSize: 12, margin: 0 }} role="alert">{errors[sp.error]}</p>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "14px 0" }}>
        <div className="tile" style={{ flex: 1, minWidth: 140 }}>
          <div className="label">DONE · 24 H</div>
          <div className="value">{counts.done}</div>
          <div className="sub">proof accepted</div>
        </div>
        <div className="tile" style={{ flex: 1, minWidth: 140 }}>
          <div className="label">WAITING</div>
          <div className="value" style={{ color: counts.waiting > 0 ? "var(--accent-deep)" : undefined }}>{counts.waiting}</div>
          <div className="sub">open in the loop</div>
        </div>
        <div className="tile" style={{ flex: 1, minWidth: 140 }}>
          <div className="label">PEOPLE</div>
          <div className="value">{people.length}</div>
          <div className="sub">{people.filter((p) => p.consentStatus === "opted_in").length} opted in</div>
        </div>
      </div>

      <div className="card">
        <div className="eyebrow">SET A TASK</div>
        {people.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--dim)", margin: "8px 0 0" }}>
            Add your people first — <Link href="/people" style={{ color: "var(--accent)" }}>People &amp; consent</Link>.
          </p>
        ) : (
          <form action={createTaskAction} style={{ display: "grid", gap: 10, gridTemplateColumns: "12rem 1fr 8rem auto", margin: "10px 0" }}>
            <div>
              <label className="field-label" htmlFor="personId">FOR</label>
              <select id="personId" name="personId" required>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.consentStatus === "opted_in" ? "in" : "pending"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="title">TASK + INSTRUCTIONS</label>
              <div style={{ display: "grid", gap: 6 }}>
                <input id="title" name="title" required minLength={3} maxLength={120} placeholder="Close the vegetable freezer" />
                <input name="instructions" placeholder='Optional: what "done" looks like ("Below -18 °C; shut the door")' />
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="hours">DUE IN (H)</label>
              <input id="hours" name="hours" type="number" defaultValue={8} min={1} max={336} />
            </div>
            <div style={{ alignSelf: "end" }}>
              <button type="submit" className="auth-btn-primary">SET TASK</button>
            </div>
          </form>
        )}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 2 }}>
          <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" name="withMedia" defaultChecked /> media proof (photo / video / voice / PDF)
          </label>
          <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" name="withSignature" defaultChecked /> signature prompt (typed full name)
          </label>
        </div>
      </div>

      <div className="card">
        <div className="eyebrow">OPEN BOARD · {board.length}</div>
        {board.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--dim)", margin: "8px 0 0" }}>Nothing waiting — the loop is clear.</p>
        ) : (
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", marginTop: 8 }}>
            <tbody>
              {board.map(({ task, person }) => {
                const overdue = task.status === "overdue";
                return (
                  <tr key={task.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "8px 10px 8px 0", fontWeight: 700 }}>{person?.name ?? "?"}</td>
                    <td style={{ padding: "8px 10px 8px 0" }}>{task.title}</td>
                    <td style={{ padding: "8px 10px 8px 0", color: "var(--dim)" }}>due {dueLabel(task.dueAt)}</td>
                    <td style={{ padding: "8px 10px 8px 0", color: overdue ? "var(--crit)" : "var(--warn)", fontWeight: 700 }}>
                      {overdue ? "OVERDUE" : "WAITING"}
                    </td>
                    <td style={{ padding: "8px 0 8px 10px", textAlign: "right" }}>
                      <form action={pushTaskAction}>
                        <input type="hidden" name="taskId" value={task.id} />
                        <button type="submit" className="secondary" style={{ padding: "6px 10px", borderRadius: 8, fontSize: 10 }}>
                          PUSH
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="eyebrow">PROOF FEED · LAST {proof.length}</div>
        {proof.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--dim)", margin: "8px 0 0" }}>
            No signed work yet. It appears here the moment a person finishes the prompts.
          </p>
        ) : (
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", marginTop: 8 }}>
            <tbody>
              {proof.map(({ task, person, evidence }) => (
                <tr key={task.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 10px 8px 0", fontWeight: 700, whiteSpace: "nowrap" }}>{person?.name ?? "?"}</td>
                  <td style={{ padding: "8px 10px 8px 0" }}>
                    {task.title}
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 5 }}>
                      {evidence.map((e) => (
                        <span
                          key={e.id}
                          className="tag"
                          title={e.mediaUrl ?? undefined}
                          style={e.kind === "signature" ? { color: "var(--accent-deep)", borderColor: "var(--accent)" } : undefined}
                        >
                          {EVIDENCE_KIND_LABEL[e.kind] ?? e.kind.toUpperCase()}
                          {e.kind === "signature" && e.value ? ` · ${e.value}` : ""}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: "8px 0 8px 10px", color: "var(--dim)", whiteSpace: "nowrap", textAlign: "right" }}>
                    {task.completedAt ? dueLabel(task.completedAt).replace("today ", "") : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="eyebrow">MILESTONES</div>
        <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
          <tbody>
            {[
              { id: "M0", t: "Security", n: "Signup can never overwrite; resets are expiring tokens.", d: true },
              { id: "M1", t: "Data model + adapter", n: "Bot tables, one adapter, one inbound pipeline, simulator live.", d: true },
              { id: "M2", t: "People & consent", n: "Dashboard intake; person-owned START/STOP with audit; role menus.", d: true },
              { id: "M3", t: "Task + proof loop", n: "Media (photo/video/audio/PDF) + typed signature → heads' dashboard.", d: true },
              { id: "M4", t: "Agent heartbeat", n: "Cron: overdue flip → reminders (12 h gap) → daily digest (24 h gap).", d: true },
              { id: "M5", t: "Problems & gas", n: "Problem → job → close with photo + cost; gas burn-rate.", d: false },
              { id: "M6", t: "Reports", n: "Metrics from code, PDF/HTML report, owner 'report' command.", d: false },
              { id: "M7", t: "WhatsApp mode", n: "Meta Cloud API behind the same adapter; signed webhook; templates.", d: false },
              { id: "M8", t: "Hardening", n: "Full idempotency + tenant-isolation sweep, docs.", d: false },
            ].map((m) => (
              <tr key={m.id}>
                <td style={{ padding: "7px 10px 7px 0", width: 44, color: "var(--accent)", fontWeight: 700, whiteSpace: "nowrap" }}>{m.id}</td>
                <td style={{ padding: "7px 10px 7px 0", minWidth: 150, whiteSpace: "nowrap" }}>{m.t}{m.d ? " ✓" : ""}</td>
                <td style={{ padding: "7px 0", color: "var(--dim)" }}>{m.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="eyebrow">NEXT</div>
        <p style={{ fontSize: 12, color: "var(--dim)", margin: "6px 0 0" }}>
          Open the <Link href="/simulator" style={{ color: "var(--accent)" }}>simulator</Link>, speak as one of your
          people, and watch the loop from the person&apos;s side of the fence.
        </p>
      </div>
    </>
  );
}
