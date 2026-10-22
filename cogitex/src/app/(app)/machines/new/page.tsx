import Link from "next/link";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { getIntegrations } from "@/lib/integrations/factory";
import { MACHINE_CATEGORIES } from "@/server/services/machines";
import { areasService, sitesService } from "@/server/services/sites";
import { createMachineAction } from "../actions";

export const metadata = { title: "Add Machine" };

export default async function NewMachinePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; tag?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  if (!can(ctx.roles, "plan.manage")) {
    return <p className="empty-state">Only owner / admin / maintenance managers can add machines.</p>;
  }
  const params = await searchParams;
  const [sites, areas, videMachines] = await Promise.all([
    sitesService.list(ctx),
    areasService.list(ctx),
    getIntegrations().vide.listMachines(),
  ]);

  const errorCopy: Record<string, string> = {
    fields: "Name and tag are required.",
    tag_conflict: `Tag ${params.tag} already exists in this organization.`,
    server: "Could not create the machine — check values and try again.",
  };

  return (
    <>
      <h1>Add Machine</h1>
      <p className="lead">Guided setup — identity, location, rated plate, and (optionally) the VIDE devices that watch it.</p>

      {params.error ? (
        <div className="card"><div className="eyebrow">CHECK</div><span className="error-text">{errorCopy[params.error] ?? "Error."}</span></div>
      ) : null}

      <form action={createMachineAction} className="card">
        <div className="eyebrow">1 · IDENTITY</div>
        <div className="row">
          <input name="tag" placeholder="TAG e.g. PUMP-12" maxLength={40} required style={{ maxWidth: 220, textTransform: "uppercase" }} />
          <input name="name" placeholder="Name — e.g. Overhead lines water pump" required style={{ flex: 1, minWidth: 240 }} />
          <select name="category" defaultValue="pump">
            {MACHINE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="row">
          <input name="make" placeholder="Make" />
          <input name="model" placeholder="Model" />
          <input name="serialNumber" placeholder="Serial number" />
          <select name="criticality" defaultValue="B">
            <option value="A">Criticality A — plant stops</option>
            <option value="B">Criticality B — degrades output</option>
            <option value="C">Criticality C — standby/comfort</option>
          </select>
        </div>

        <div className="eyebrow" style={{ marginTop: 16 }}>2 · WHERE IT LIVES</div>
        <div className="row">
          <select name="siteId" defaultValue="">
            <option value="">no site (unassigned)</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </select>
          <select name="areaId" defaultValue="">
            <option value="">no area</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
          <input name="locationNote" placeholder="Location note (bay, wall, floor…)" style={{ flex: 1, minWidth: 200 }} />
        </div>
        {sites.length === 0 ? (
          <p style={{ color: "var(--dim2)", fontSize: 11, margin: "6px 0 0" }}>
            No sites yet — <Link href="/settings/locations" style={{ color: "var(--accent)" }}>create one in Settings → Locations</Link> first (optional).
          </p>
        ) : null}

        <div className="eyebrow" style={{ marginTop: 16 }}>3 · RATED PLATE & DATES</div>
        <div className="row">
          <input name="rated_power_kw" placeholder="Rated power kW" inputMode="decimal" style={{ maxWidth: 180 }} />
          <input name="rated_rpm" placeholder="Rated RPM" inputMode="numeric" style={{ maxWidth: 160 }} />
          <input name="installDate" type="date" />
          <input name="warrantyUntil" type="date" />
        </div>
        <p style={{ color: "var(--dim2)", fontSize: 11, margin: "6px 0 0" }}>Anything you type here is stored in the machine&apos;s rated-specs snapshot for reports and repair briefs.</p>

        <div className="eyebrow" style={{ marginTop: 16 }}>4 · VIDE DEVICES (link telemetry)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "6px 0 0" }}>
          {videMachines.map((vm) => (
            <label key={vm.machineName} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
              <input type="checkbox" name="vide_link" value={vm.machineName} />
              <span>{vm.machineName}</span>
              <span className={vm.healthStatus === "critical" || vm.healthStatus === "warning" ? "error-text" : ""} style={{ fontSize: 10, color: "var(--dim2)" }}>
                (VIDE says: {vm.healthStatus})
              </span>
            </label>
          ))}
          {videMachines.length === 0 ? <span style={{ fontSize: 11, color: "var(--dim2)" }}>VIDE adapter returned no machines.</span> : null}
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <button type="submit">CREATE MACHINE</button>
        </div>
      </form>
    </>
  );
}
