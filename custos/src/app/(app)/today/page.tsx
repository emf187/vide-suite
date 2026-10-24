import Link from "next/link";
import { getCtx } from "@/server/ctx";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

/**
 * Today — scaffold view. Real task cards arrive in M3; this page already
 * shows the milestone map so the demo story is visible from day one.
 */
export default async function TodayPage() {
  const ctx = await getCtx();
  if (!ctx) return null;

  const milestones: { id: string; title: string; note: string; done: boolean }[] = [
    { id: "M0", title: "Security", note: "Signup can never overwrite; resets are expiring tokens. Built in from day one.", done: true },
    { id: "M1", title: "Data model + adapter", note: "Bot tables, the messaging adapter, the inbound pipeline and the simulator live.", done: true },
    { id: "M2", title: "Registration & menus", note: "START / STOP, unregistered numbers, role-based menus.", done: false },
    { id: "M3", title: "Task flows", note: "All four task types end-to-end with proof on the dashboard.", done: false },
    { id: "M4", title: "Scheduler", note: "Morning summary, reminders, escalation (demo-speed switch).", done: false },
    { id: "M5", title: "Problems & gas", note: "Problem → job → technician close with photo + cost; gas burn-rate.", done: false },
    { id: "M6", title: "Reports", note: "Metrics from code, owner 'report' command, HTML report page.", done: false },
    { id: "M7", title: "WhatsApp mode", note: "Meta Cloud API behind the adapter, signed webhook, templates.", done: false },
    { id: "M8", title: "Hardening", note: "Idempotency + tenant-isolation tests, README with setup.", done: false },
  ];

  return (
    <>
      <h1>Today</h1>
      <p className="lead">
        {ctx.orgName} · the follow-through loop lives here once M1 lands: set
        tasks, staff get them on WhatsApp, proof returns, laggards escalate.
      </p>

      <div className="card">
        <div className="eyebrow">BUILD ORDER</div>
        <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
          <tbody>
            {milestones.map((m) => (
              <tr key={m.id}>
                <td style={{ padding: "7px 10px 7px 0", width: 44, color: "var(--accent)", fontWeight: 700, whiteSpace: "nowrap" }}>{m.id}</td>
                <td style={{ padding: "7px 10px 7px 0", minWidth: 150, whiteSpace: "nowrap" }}>{m.title}{m.done ? " ✓" : ""}</td>
                <td style={{ padding: "7px 0", color: "var(--dim)" }}>{m.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="eyebrow">NEXT</div>
        <p style={{ fontSize: 12, color: "var(--dim)", margin: "6px 0 0" }}>
          M1 wires the messaging adapter (<Link href="/simulator" style={{ color: "var(--accent)" }}>simulator lives here</Link>)
          and the bot tables — people, states, message log, tasks, evidence.
        </p>
      </div>
    </>
  );
}
