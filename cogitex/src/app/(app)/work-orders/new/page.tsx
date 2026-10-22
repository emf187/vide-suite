import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { machinesService } from "@/server/services/machines";
import { orgMembersService } from "@/server/services/org-members";
import { schedulesService } from "@/server/services/schedules";
import { createWorkOrderAction } from "../actions";

export const metadata = { title: "Plan Work Order" };

export default async function NewWorkOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; machineId?: string; planned?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const sp = await searchParams;
  if (!can(ctx.roles, "wo.plan")) return <p className="empty-state">Only owner / admin / maintenance managers plan work orders.</p>;

  // Deep-link from the planning day view: /work-orders/new?planned=YYYY-MM-DD
  const plannedParam = /^\d{4}-\d{2}-\d{2}$/.exec(sp.planned ?? "")?.[0];
  const plannedStartDefault = plannedParam ? `${plannedParam}T08:00` : undefined;

  const [machines, members, templates] = await Promise.all([
    machinesService.list(ctx),
    orgMembersService.list(ctx),
    schedulesService.templates(ctx),
  ]);

  return (
    <>
      <h1>Plan Work Order</h1>
      <p className="lead">Corrective or planned — pick a template to copy its checklist steps onto the card.</p>

      {sp.error ? <div className="card"><div className="eyebrow">CHECK</div><span className="error-text">{decodeURIComponent(sp.error)}</span></div> : null}

      <form action={createWorkOrderAction} className="card">
        <div className="eyebrow">WHAT</div>
        <div className="row">
          <input name="title" placeholder="Title — e.g. Replace drive-end bearing" required style={{ flex: 1, minWidth: 260 }} />
          <select name="type" defaultValue="corrective">
            {["corrective", "preventive", "inspection", "installation"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select name="priority" defaultValue="normal">
            <option value="critical">CRITICAL — plant stops</option>
            <option value="high">HIGH — degrades output</option>
            <option value="normal">NORMAL</option>
            <option value="low">LOW — when idle</option>
          </select>
        </div>
        <textarea name="description" rows={3} placeholder="What is failing / what to do (optional)" style={{ width: "100%", marginTop: 8 }} />

        <div className="eyebrow" style={{ marginTop: 14 }}>MACHINE & TEMPLATE</div>
        <div className="row">
          <select name="machineId" defaultValue={sp.machineId ?? ""}>
            <option value="">no machine (plant-level task)</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.tag} — {m.name}</option>)}
          </select>
          <select name="templateId" defaultValue="">
            <option value="">no template (blank checklist)</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div className="eyebrow" style={{ marginTop: 14 }}>WHO & WHEN</div>
        <div className="row">
          <select name="assignedTo" defaultValue="">
            <option value="">unassigned</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.name} ({m.role})</option>)}
          </select>
          <label style={{ fontSize: 11 }}>planned start<input name="plannedStart" type="datetime-local" defaultValue={plannedStartDefault} /></label>
          <label style={{ fontSize: 11 }}>planned end<input name="plannedEnd" type="datetime-local" /></label>
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <button type="submit">CREATE WORK ORDER</button>
        </div>
      </form>
    </>
  );
}
