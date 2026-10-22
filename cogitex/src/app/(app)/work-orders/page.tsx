import Link from "next/link";
import { getCtx } from "@/server/ctx";
import { machinesService } from "@/server/services/machines";
import { workOrderService } from "@/server/services/work-orders";
import { formatDateTime } from "@/lib/time";

export const metadata = { title: "Work Orders" };

const STATUS_CLASS: Record<string, string> = {
  draft: "urgency-low",
  planned: "urgency-none",
  assigned: "urgency-none",
  in_progress: "urgency-medium",
  on_hold: "urgency-high",
  completed: "urgency-low",
  verified: "",
  closed: "",
  cancelled: "urgency-high",
};

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; mine?: string; priority?: string; q?: string; machineId?: string; error?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const sp = await searchParams;
  const [wos, machines] = await Promise.all([
    workOrderService.list(ctx, { status: sp.status, mine: sp.mine, priority: sp.priority, q: sp.q, machineId: sp.machineId }),
    machinesService.list(ctx),
  ]);

  return (
    <>
      <h1>Work Orders</h1>
      <p className="lead">The ledger of work: corrective and preventive, from manual planning or auto-generated schedules.</p>

      {sp.error ? <div className="card"><span className="error-text">{sp.error}</span></div> : null}

      <div className="card">
        <div className="eyebrow">FILTER</div>
        <form action="/work-orders" method="GET" className="row">
          <input name="q" defaultValue={sp.q ?? ""} placeholder="search title or WO-number…" style={{ flex: 1, minWidth: 170 }} />
          <select name="status" defaultValue={sp.status ?? ""}>
            <option value="">any status</option>
            {["draft", "planned", "assigned", "in_progress", "on_hold", "completed", "verified", "closed", "cancelled"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select name="priority" defaultValue={sp.priority ?? ""}>
            <option value="">any priority</option>
            {["critical", "high", "normal", "low"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select name="machineId" defaultValue={sp.machineId ?? ""}>
            <option value="">any machine</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.tag}</option>)}
          </select>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}>
            <input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === "1"} /> assigned to me
          </label>
          <button type="submit" className="secondary">APPLY</button>
        </form>
      </div>

      <div className="card">
        <div className="eyebrow">{`WORK ORDERS / ${wos.length}`}</div>
        {wos.length === 0 ? (
          <div className="empty-state">
            None yet. <Link href="/work-orders/new" style={{ color: "var(--accent)" }}>Plan a work order</Link> or{" "}
            <Link href="/planning" style={{ color: "var(--accent)" }}>generate from schedules</Link>.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                {["NUMBER", "TITLE", "STATUS", "PRIORITY", "TYPE", "MACHINE", "PLANNED", "ME"].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: 9, letterSpacing: 1.5, color: "var(--dim2)", borderBottom: "2px solid var(--line)", padding: "6px 8px 6px 0", fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wos.map((wo) => (
                <tr key={wo.id}>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "7px 8px 7px 0" }}>
                    <Link href={`/work-orders/${wo.id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{wo.number}</Link>
                  </td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "7px 8px 7px 0" }}>{wo.title}</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "7px 8px 7px 0" }}>
                    <span className={STATUS_CLASS[wo.status] ?? ""}>{wo.status}</span>
                  </td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "7px 8px 7px 0" }}>{wo.priority}</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "7px 8px 7px 0" }}>{wo.source}/{wo.type}</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "7px 8px 7px 0" }}>
                    {wo.machineId ? (machines.find((m) => m.id === wo.machineId)?.tag ?? "—") : "—"}
                  </td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "7px 8px 7px 0" }}>
                    {wo.plannedStart ? formatDateTime(wo.plannedStart, ctx.timezone).slice(0, 12) : "—"}
                  </td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "7px 8px 7px 0" }}>{wo.assignedTo === ctx.userId ? "MINE" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="eyebrow">ACTIONS</div>
        <div className="row">
          <Link href="/work-orders/new" style={{ textDecoration: "none" }}><button type="button">PLAN WORK ORDER</button></Link>
          <Link href="/planning" style={{ textDecoration: "none" }}><button type="button" className="secondary">PLANNING BOARD</button></Link>
        </div>
      </div>
    </>
  );
}
