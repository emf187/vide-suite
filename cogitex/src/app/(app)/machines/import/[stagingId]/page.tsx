import Link from "next/link";
import { notFound } from "next/navigation";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { machineImportService, type StagedMachineRow } from "@/server/services/machine-import";
import { commitMachineImportAction } from "../../actions";

export const metadata = { title: "Import Preview" };

const HEADERS = ["ROW", "TAG", "NAME", "CATEGORY", "SITE", "VIDE LINK", "STATUS"];

export default async function ImportPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ stagingId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const { stagingId } = await params;
  const sp = await searchParams;
  if (!can(ctx.roles, "plan.manage")) return <p className="empty-state">Not allowed.</p>;

  const staging = await machineImportService.stagingById(ctx, stagingId);
  if (!staging) notFound();
  if (staging.status !== "pending") {
    return (
      <>
        <h1>Import Preview</h1>
        <div className="card"><span className="ok-text">This staged import is already {staging.status}.</span></div>
        <Link href="/machines">Back to machines</Link>
      </>
    );
  }

  const rows = staging.rows as unknown as StagedMachineRow[];
  const okRows = rows.filter((r) => !r.error);

  return (
    <>
      <h1>Import Preview (dry-run)</h1>
      <p className="lead">Nothing written yet. Confirm to create the green rows — red rows are skipped and explained.</p>

      <div className="card">
        <div className="eyebrow">SUMMARY</div>
        <span className="ok-text">{staging.validCount} valid</span>
        {" · "}
        <span className={staging.errorCount > 0 ? "error-text" : ""}>{staging.errorCount} with errors</span>
      </div>

      <div className="card">
        <div className="eyebrow">DRAFT ROWS</div>
        <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {HEADERS.map((h) => (
                <th key={h} style={{ textAlign: "left", fontSize: 9, letterSpacing: 1.5, color: "var(--dim2)", borderBottom: "2px solid var(--line)", padding: "6px 8px 6px 0" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = r.values;
              return (
                <tr key={r.rowNo}>
                  <td style={{ color: "var(--dim2)", padding: "5px 8px 5px 0" }}>{r.rowNo}</td>
                  <td style={{ padding: "5px 8px 5px 0" }}>{v.tag}</td>
                  <td style={{ padding: "5px 8px 5px 0" }}>{v.name}</td>
                  <td style={{ color: "var(--dim2)" }}>{v.category}</td>
                  <td style={{ color: "var(--dim2)" }}>{v.siteId ? "linked" : "—"}</td>
                  <td style={{ color: "var(--dim2)" }}>{(v.videMachineNames ?? []).join("+") || "—"}</td>
                  <td style={{ padding: "5px 0" }}>
                    {r.error ? <span className="error-text">{r.error}</span> : <span className="ok-text">ready</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {okRows.length > 0 ? (
        <form action={commitMachineImportAction} className="card">
          <input type="hidden" name="stagingId" value={staging.id} />
          <div className="eyebrow">2 · CONFIRM</div>
          <div className="row">
            <button type="submit">{`COMMIT ${okRows.length} VALID ROW(S)`}</button>
            <Link href="/machines/import" style={{ textDecoration: "none" }}><button type="button" className="secondary">EDIT CSV</button></Link>
          </div>
        </form>
      ) : (
        <div className="card"><div className="eyebrow">NOTHING TO CREATE</div><span className="error-text">Every row has errors. Fix the CSV and re-run the dry-run.</span></div>
      )}

      {sp.error ? <div className="card"><span className="error-text">{sp.error}</span></div> : null}
    </>
  );
}
