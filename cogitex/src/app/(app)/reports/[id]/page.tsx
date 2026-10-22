import Link from "next/link";
import { notFound } from "next/navigation";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { reportsService } from "@/server/services/reports";
import type { MetricsBundle } from "@/server/metrics/reports";
import { formatKobo } from "@/lib/money";
import { formatDateTime } from "@/lib/time";

export const metadata = { title: "Report" };

function naira(kobo: number | null): string {
  return kobo === null ? "no data" : formatKobo(kobo, "NGN");
}

function hrs(v: number | null): string {
  return v === null ? "no data" : `${v} h`;
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const { id } = await params;
  if (!can(ctx.roles, "report.view")) notFound();

  const r = await reportsService.byId(ctx, id);
  if (!r) notFound();
  const calc = r.calc as MetricsBundle;
  const maxMonth = Math.max(1, ...calc.cost.byMonth.map((m) => m.totalKobo));
  const chips = [
    { k: "MTTR", v: hrs(calc.mttrHours), d: "mean repair time (labor of closed breakdown cards)" },
    { k: "MTBF", v: hrs(calc.mtbfHours), d: "mean time between failures (calendar ÷ breakdown completions)" },
    { k: "UPTIME", v: calc.uptimePct === null ? "no data" : `${calc.uptimePct} %`, d: "downtime share of period" },
    { k: "PLANNED RATIO", v: calc.plannedRatioPct === null ? "no data" : `${calc.plannedRatioPct} %`, d: "planned-family completions ÷ all completions" },
    { k: "BACKLOG", v: `${calc.openBacklog.count}`, d: `open cards${Object.entries(calc.openBacklog.byPriority).length ? ` — ${Object.entries(calc.openBacklog.byPriority).map(([p, n]) => `${p}:${n}`).join(", ")}` : ""}` },
  ];

  return (
    <>
      <div className="row" style={{ alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0 }}>{r.kind === "machine_status" ? "Machine status report" : "Plant summary"}</h1>
          <p className="lead" style={{ margin: "4px 0 0" }}>
            {`${r.periodDays} days · ${r.periodFrom.toISOString().slice(0, 10)} → ${r.periodTo.toISOString().slice(0, 10)} · calc v${r.calcVersion}`}
          </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <a href={`/api/reports/${r.id}/csv`} style={{ textDecoration: "none", fontSize: 11 }}>EXPORT CSV ↓</a>
          <a href={`/api/reports/${r.id}/pdf`} style={{ textDecoration: "none", fontSize: 11 }}>DOWNLOAD PDF ↓</a>
        </div>
      </div>

      <div className="card">
        <div className="eyebrow">{`HEADLINE — ${r.scope?.machineId ? "THIS MACHINE" : "WHOLE PLANT"}`}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginTop: 10, fontSize: 12 }}>
          <div><span style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>{calc.workOrders.completed}</span><br /><span className="dim">completed · {calc.workOrders.open} open</span></div>
          <div><span style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>{calc.faults.total}</span><br /><span className="dim">faults flagged</span></div>
          <div><span style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>{naira(calc.cost.totalKobo)}</span><br /><span className="dim">maintenance cost</span></div>
          <div><span style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>{r.periodDays}</span><br /><span className="dim">days in period</span></div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {chips.map((m) => (
            <span key={m.k} style={{ border: "2px solid var(--line)", padding: "6px 10px", fontSize: 11 }}>
              <span style={{ letterSpacing: 1.5, fontSize: 9, color: "var(--dim2)" }}>{m.k}</span>{" "}
              <span style={{ fontWeight: 700 }}>{m.v}</span>{" "}
              <span className="dim" style={{ fontSize: 9 }}>{m.d}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="eyebrow">COST BY MONTH</div>
        {calc.cost.byMonth.length === 0 ? (
          <p className="empty-state" style={{ margin: "8px 0 0" }}>No cost recorded in this period.</p>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 96, marginTop: 10 }}>
            {calc.cost.byMonth.map((m) => (
              <div key={m.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ fontSize: 9, color: "var(--dim2)" }}>{formatKobo(m.totalKobo, "NGN")}</div>
                <div style={{ width: "70%", background: "var(--accent)", height: `${Math.max(6, (m.totalKobo / maxMonth) * 60)}px` }} />
                <div style={{ fontSize: 9, color: "var(--dim2)" }}>{m.month}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="eyebrow">{`COST BY MACHINE (${calc.cost.byMachine.length})`}</div>
        {calc.cost.byMachine.length === 0 ? (
          <p className="empty-state" style={{ margin: "8px 0 0" }}>No machine-attributed cost in this period.</p>
        ) : (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", marginTop: 8 }}>
            <tbody>
              {calc.cost.byMachine.map((m) => (
                <tr key={m.machineId}>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", fontSize: 11 }}>
                    <Link href={`/machines/${m.machineId}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{m.tag ?? "machine"}</Link>
                  </td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 0 6px 0", fontSize: 11, textAlign: "right" }}>{naira(m.totalKobo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="row" style={{ gap: 14, marginTop: 8, fontSize: 10, color: "var(--dim2)" }}>
          <span>{`LABOR ${naira(calc.cost.laborKobo)}`}</span>
          <span>{`PARTS ${naira(calc.cost.partsKobo)}`}</span>
          <span>{`TYPE MIX ${Object.entries(calc.workOrders.byType).map(([k, v]) => `${k}:${v}`).join(" · ") || "—"}`}</span>
        </div>
      </div>

      <div className="card">
        <div className="eyebrow">PROVENANCE</div>
        <p style={{ fontSize: 10, color: "var(--dim2)", margin: "6px 0 0" }}>
          {`calc bundle version ${calc.calcVersion}, produced by deterministic code (src/server/metrics) over org-scoped rows only · generated ${formatDateTime(r.generatedAt, ctx.timezone)} · any narrative added later must pass the numerals-must-exist-in-calc guard (no model-computed numbers).`}
        </p>
      </div>
    </>
  );
}
