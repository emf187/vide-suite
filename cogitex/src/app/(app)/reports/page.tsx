import Link from "next/link";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { machinesService } from "@/server/services/machines";
import { reportsService } from "@/server/services/reports";
import { formatDateTime } from "@/lib/time";
import { generateReportAction } from "./actions";

export const metadata = { title: "Reports" };

const PERIODS: [number, string][] = [
  [7, "LAST 7 DAYS"],
  [30, "LAST 30 DAYS"],
  [90, "LAST 90 DAYS"],
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; generated?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const sp = await searchParams;

  const list = await reportsService.list(ctx, 50);
  const maySee = can(ctx.roles, "report.view");
  const machineList = (await machinesService.list(ctx)).filter((m) => m.lifecycleStatus !== "decommissioned");

  return (
    <>
      <h1>Reports</h1>
      <p className="lead">
        {"Deterministic maintenance intelligence — every number comes from the same SQL as the operations screens (calc bundle, versioned). Nothing here is model-computed."}
      </p>

      {sp.generated ? <div className="card"><span className="ok-text">Report generated.</span></div> : null}
      {sp.error ? (
        <div className="card">
          <div className="eyebrow">NOT GENERATED</div>
          <span className="error-text">{decodeURIComponent(sp.error)}</span>
        </div>
      ) : null}

      {maySee ? (
        <div className="card">
          <div className="eyebrow">GENERATE</div>
          <form action={generateReportAction} style={{ display: "grid", gap: 10, marginTop: 8 }}>
            <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <label className="field-label" htmlFor="rp-kind" style={{ width: "auto" }}>KIND</label>
              <select id="rp-kind" name="kind" defaultValue="plant_summary">
                <option value="plant_summary">PLANT SUMMARY — whole org</option>
                <option value="machine_status">MACHINE STATUS — one machine</option>
              </select>
              <label className="field-label" htmlFor="rp-period" style={{ width: "auto" }}>PERIOD</label>
              <select id="rp-period" name="days" defaultValue="30">
                {PERIODS.map(([d, label]) => <option key={d} value={d}>{label}</option>)}
              </select>
            </div>
            <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label className="field-label" htmlFor="rp-machine" style={{ width: "auto" }}>MACHINE (FOR MACHINE STATUS)</label>
              <select id="rp-machine" name="machineId" defaultValue="">
                <option value="">— pick a machine —</option>
                {machineList.map((m) => <option key={m.id} value={m.id}>{m.tag} — {m.name}</option>)}
              </select>
              <button type="submit" style={{ fontSize: 11 }}>GENERATE →</button>
            </div>
          </form>
        </div>
      ) : (
        <div className="card"><span className="error-text">Reports are not available for external-technician roles.</span></div>
      )}

      <div className="card">
        <div className="eyebrow">{`GENERATED / ${list.length}`}</div>
        {list.length === 0 ? (
          <p className="empty-state" style={{ margin: "8px 0 0" }}>No reports yet — generate one above.</p>
        ) : (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr>
                {["GENERATED", "KIND", "SCOPE", "PERIOD", "CALC"].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: 9, letterSpacing: 1.5, color: "var(--dim2)", borderBottom: "2px solid var(--line)", padding: "6px 8px 6px 0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", color: "var(--dim2)", fontSize: 10, whiteSpace: "nowrap" }}>
                    <Link href={`/reports/${r.id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{formatDateTime(r.generatedAt, ctx.timezone)}</Link>
                  </td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", fontSize: 11 }}>
                    {r.kind === "machine_status" ? "MACHINE STATUS" : "PLANT SUMMARY"}
                  </td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", fontSize: 11 }}>
                    {r.scope?.machineId ? "one machine" : "all machines"}
                  </td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", fontSize: 11 }}>{r.periodDays} days</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 0 6px 0", fontSize: 10, color: "var(--dim2)" }}>v{r.calcVersion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
