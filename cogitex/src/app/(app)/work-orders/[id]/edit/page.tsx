import Link from "next/link";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { machinesService } from "@/server/services/machines";
import { workOrderService } from "@/server/services/work-orders";
import { updateWorkOrderAction } from "../../actions";

export const metadata = { title: "Edit Card" };

function dtLocal(value: Date | null): string {
  // datetime-local input format from a stored UTC date
  if (!value) return "";
  return value.toISOString().slice(0, 16);
}

export default async function EditWorkOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const { id } = await params;
  const sp = await searchParams;
  if (!can(ctx.roles, "wo.plan")) return <p className="empty-state">Only owner / admin / maintenance managers edit work orders.</p>;

  const [wo, machines] = await Promise.all([workOrderService.byId(ctx, id), machinesService.list(ctx)]);
  if (!wo) return <p className="empty-state">Work order not found.</p>;

  const machineOptions = machines.filter((m) => m.lifecycleStatus !== "decommissioned");
  const day = wo.plannedStart ? wo.plannedStart.toISOString().slice(0, 10) : null;

  return (
    <>
      <h1>Edit Card</h1>
      <p className="lead">
        {wo.number} — {wo.title}. Saving returns you to its planning day.
      </p>

      {sp.error ? (
        <div className="card">
          <div className="eyebrow">CHECK</div>
          <span className="error-text">{decodeURIComponent(sp.error)}</span>
        </div>
      ) : null}

      <form action={updateWorkOrderAction} className="card">
        <input type="hidden" name="workOrderId" value={wo.id} />
        <div className="eyebrow">WHAT</div>
        <div className="row">
          <input name="title" defaultValue={wo.title} required style={{ flex: 1, minWidth: 260 }} />
          <select name="priority" defaultValue={wo.priority}>
            {["low", "normal", "high", "critical"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select name="machineId" defaultValue={wo.machineId ?? ""}>
            <option value="">no machine</option>
            {machineOptions.map((m) => (
              <option key={m.id} value={m.id}>{m.tag} — {m.name}</option>
            ))}
          </select>
        </div>
        <label className="field-label" style={{ marginTop: 10 }}>DESCRIPTION</label>
        <textarea name="description" defaultValue={wo.description ?? ""} rows={3} style={{ width: "100%", minHeight: 64 }} />

        <div className="eyebrow" style={{ marginTop: 14 }}>WHEN</div>
        <div className="row">
          <label style={{ fontSize: 11 }}>planned start<input name="plannedStart" type="datetime-local" defaultValue={dtLocal(wo.plannedStart)} /></label>
          <label style={{ fontSize: 11 }}>planned end<input name="plannedEnd" type="datetime-local" defaultValue={dtLocal(wo.plannedEnd)} /></label>
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <button type="submit" style={{ padding: "10px 18px" }}>SAVE CHANGES</button>
          <Link href={day ? `/planning?month=${day.slice(0, 7)}&day=${day}` : `/work-orders/${wo.id}`} style={{ textDecoration: "none" }}>
            <button type="button" className="secondary" style={{ padding: "10px 14px" }}>CANCEL</button>
          </Link>
        </div>
      </form>

      <div className="row" style={{ marginTop: -8 }}>
        <p style={{ fontSize: 10.5, color: "var(--dim2)", margin: 0 }}>
          Type, status and assignee change on the card via status transitions; this form covers the planning details.
        </p>
      </div>
    </>
  );
}
