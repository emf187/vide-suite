import Link from "next/link";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { machinesService } from "@/server/services/machines";
import { decommissionMachineAction } from "../../actions";

export const metadata = { title: "Decommission" };

export default async function DecommissionPage({
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
  if (!can(ctx.roles, "decommission.execute")) {
    return <p className="empty-state">Only owner / admin execute decommissioning.</p>;
  }
  if (machine.lifecycleStatus === "decommissioned") {
    return <p className="empty-state">Already decommissioned.</p>;
  }

  return (
    <>
      <h1>Decommission {machine.tag}</h1>
      <p className="lead">
        A retirement, not a repair. VIDE is notified, the audit trail keeps everything readable,
        and parts you mention can flow to stores in M3.
      </p>

      {sp.error ? <div className="card"><div className="eyebrow">CHECK</div><span className="error-text">{sp.error}</span></div> : null}

      <form action={decommissionMachineAction} className="card">
        <input type="hidden" name="machineId" value={machine.id} />

        <div className="eyebrow">1 · WHY (required)</div>
        <input name="reason" placeholder="Reason — e.g. End-of-life, replaced by PUMP-13" required style={{ width: "100%" }} />

        <div className="eyebrow" style={{ marginTop: 14 }}>2 · WHEN</div>
        <div className="row">
          <input name="effectiveAt" type="datetime-local" />
          <span style={{ fontSize: 11, color: "var(--dim2)" }}>empty = now (UTC instants are stored, displayed in {ctx.timezone})</span>
        </div>

        <div className="eyebrow" style={{ marginTop: 14 }}>3 · OPEN WORK ORDERS POLICY</div>
        <p style={{ fontSize: 11, color: "var(--dim2)", margin: "2px 0 6px" }}>Applies once work orders exist (M2). Recorded now so the decision is captured in the audit trail.</p>
        <div className="row">
          <select name="openWoPolicy" defaultValue="cancel">
            <option value="cancel">CANCEL open work orders</option>
            <option value="close">FORCE-CLOSE open work orders as concluded</option>
          </select>
        </div>

        <div className="eyebrow" style={{ marginTop: 14 }}>4 · PARTS DISPOSITION (free text in M1)</div>
        <input name="partsDisposition" placeholder="e.g. spare impeller to stores; keep motor for cannibalization" style={{ width: "100%" }} />

        <div className="row" style={{ marginTop: 18 }}>
          <button type="submit">DECOMMISSION MACHINE</button>
          <Link href={`/machines/${machine.id}`} style={{ textDecoration: "none" }}><button type="button" className="secondary">STAY</button></Link>
        </div>
      </form>
    </>
  );
}
