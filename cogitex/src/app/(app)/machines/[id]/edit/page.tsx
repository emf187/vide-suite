import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { machinesService } from "@/server/services/machines";
import { areasService, sitesService } from "@/server/services/sites";
import { getIntegrations } from "@/lib/integrations/factory";
import { MACHINE_CATEGORIES } from "@/server/services/machines";
import { listLinkedDevices } from "@/server/services/machine-extras";
import { updateMachineAction, removeMachineAction } from "../../actions";

export const metadata = { title: "Edit Machine" };

const LIFECYCLE_ORDER = ["commissioned", "active", "standby", "under_maintenance", "decommissioned"] as const;

export default async function EditMachinePage({
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
  const machine = await machinesService.byId(ctx, id);
  if (!machine) return <p className="empty-state">Machine not found.</p>;
  if (!can(ctx.roles, "plan.manage")) return <p className="empty-state">Only owner / admin / maintenance managers edit machines.</p>;

  const [sites, areas, videMachines, devices] = await Promise.all([
    sitesService.list(ctx),
    areasService.list(ctx),
    getIntegrations().vide.listMachines(),
    listLinkedDevices(ctx, machine.id),
  ]);
  const activeLinks = new Set(devices.filter((d) => d.unlinkedAt === null).map((d) => d.videMachineName));

  return (
    <>
      <h1>Edit {machine.tag}</h1>
      <p className="lead">Identity card, location, device links. History (lifecycle, documents, work orders) is never rewritten.</p>

      {sp.error ? (
        <div className="card"><div className="eyebrow">CHECK</div><span className="error-text">{sp.error}</span></div>
      ) : null}

      <form action={updateMachineAction} className="card">
        <input type="hidden" name="machineId" value={machine.id} />
        <div className="eyebrow">IDENTITY</div>
        <div className="row">
          <input name="tag" defaultValue={machine.tag} maxLength={40} required style={{ maxWidth: 200, textTransform: "uppercase" }} />
          <input name="name" defaultValue={machine.name} required style={{ flex: 1, minWidth: 240 }} />
          <select name="category" defaultValue={machine.category}>
            {MACHINE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select name="criticality" defaultValue={machine.criticality}>
            <option value="A">Criticality A</option>
            <option value="B">Criticality B</option>
            <option value="C">Criticality C</option>
          </select>
        </div>
        <div className="row">
          <input name="make" defaultValue={machine.make ?? ""} placeholder="Make" />
          <input name="model" defaultValue={machine.model ?? ""} placeholder="Model" />
          <input name="serialNumber" defaultValue={machine.serialNumber ?? ""} placeholder="Serial" />
          <input name="locationNote" defaultValue={machine.locationNote ?? ""} placeholder="Location note" style={{ flex: 1, minWidth: 180 }} />
        </div>
        <div className="row">
          <input name="installDate" type="date" defaultValue={machine.installDate ?? ""} />
          <input name="warrantyUntil" type="date" defaultValue={machine.warrantyUntil ?? ""} />
        </div>

        <div className="eyebrow" style={{ marginTop: 14 }}>LOCATION</div>
        <div className="row">
          <select name="siteId" defaultValue={machine.siteId ?? ""}>
            <option value="">no site</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </select>
          <select name="areaId" defaultValue={machine.areaId ?? ""}>
            <option value="">no area</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </div>

        <div className="eyebrow" style={{ marginTop: 14 }}>VIDE DEVICES</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "6px 0 0" }}>
          {videMachines.map((vm) => (
            <label key={vm.machineName} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
              <input type="checkbox" name="vide_link" value={vm.machineName} defaultChecked={activeLinks.has(vm.machineName)} />
              <span>{vm.machineName}</span>
            </label>
          ))}
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <button type="submit">SAVE CHANGES</button>
        </div>
      </form>

      <form action={removeMachineAction} className="card">
        <input type="hidden" name="machineId" value={machine.id} />
        <div className="eyebrow">REMOVE</div>
        <p style={{ fontSize: 12, color: "var(--dim)", margin: "4px 0 10px" }}>
          Lifecycle status: <strong>{LIFECYCLE_ORDER.includes(machine.lifecycleStatus as never) ? machine.lifecycleStatus : machine.lifecycleStatus}</strong>.
          Prefer <em>decommission</em> for real retirements (history stays, VIDE is notified). Soft remove archives the machine.
          Hard delete is only possible for machines with zero history and needs owner/admin.
        </p>
        <div className="row">
          <select name="mode" defaultValue="soft">
            <option value="soft">SOFT REMOVE (archive, keeps history)</option>
            {can(ctx.roles, "hardDelete") ? <option value="hard">HARD DELETE (only if zero records)</option> : null}
          </select>
          <input name="confirm" placeholder={`type ${machine.tag} to confirm`} required />
          <button type="submit" className="secondary">REMOVE MACHINE</button>
        </div>
      </form>
    </>
  );
}
