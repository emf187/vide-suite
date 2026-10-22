import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { stageMachineImportAction } from "../actions";

export const metadata = { title: "Import Machines CSV" };

export default async function ImportMachinesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const sp = await searchParams;
  if (!can(ctx.roles, "plan.manage")) return <p className="empty-state">Only owner / admin / maintenance managers import machines.</p>;

  const sample = [
    "name,tag,category,site_code,make,model,serial,install_date,criticality,vide_machine_name",
    "Overhead lines water pump,PUMP-12,pump,PLT1,Grundfos,NB 65-200,SN-88213,2024-03-14,B,PUMP-3",
    "Packet line drive motor,MOTOR-9,motor,PLT1,Brook Crompton,W22 15kW,SN-41007,2023-11-02,C,MOTOR-2",
    "Standby diesel generator,GEN-2,generator,PLT1,Perkins,1106A,SN-7734,2019-06-30,A,GEN-1",
  ].join("\n");

  return (
    <>
      <h1>Import Machines (CSV)</h1>
      <p className="lead">Paste a spreadsheet export. Step 1 validates a dry-run preview; nothing is written until you confirm.</p>

      {sp.error ? (
        <div className="card"><div className="eyebrow">PARSE ERROR</div><span className="error-text">{decodeURIComponent(sp.error)}</span></div>
      ) : null}

      <form action={stageMachineImportAction} className="card">
        <div className="eyebrow">1 · PASTE CSV</div>
        <p style={{ fontSize: 11, color: "var(--dim2)", margin: "2px 0 8px" }}>
          Required columns: <strong>name, tag, category</strong>. Optional: site_code, area_code, make, model, serial,
          install_date, warranty_until, criticality (A|B|C), location_note, vide_machine_name (semicolon-separated).
        </p>
        <textarea
          name="csv"
          rows={10}
          defaultValue={sample}
          style={{ width: "100%", fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
          spellCheck={false}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button type="submit">VALIDATE & PREVIEW (DRY RUN)</button>
        </div>
      </form>
    </>
  );
}
