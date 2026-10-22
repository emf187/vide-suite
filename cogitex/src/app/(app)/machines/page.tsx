import Link from "next/link";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { machinesService } from "@/server/services/machines";
import { sitesService } from "@/server/services/sites";
import { formatDateTime } from "@/lib/time";

export const metadata = { title: "Machines" };

const STATUS_COLORS: Record<string, string> = {
  active: "urgency-none",
  standby: "",
  under_maintenance: "urgency-medium",
  decommissioned: "urgency-high",
  commissioned: "",
};

export default async function MachinesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; siteId?: string; criticality?: string; category?: string; imported?: string; skipped?: string; removed?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const params = await searchParams;
  const [machines, sites] = await Promise.all([
    machinesService.list(ctx, {
      q: params.q,
      status: params.status,
      siteId: params.siteId,
      criticality: params.criticality,
      category: params.category,
    }),
    sitesService.list(ctx),
  ]);
  const mayManage = can(ctx.roles, "plan.manage");

  return (
    <>
      <h1>Machines</h1>
      <p className="lead">The registry: every machine, its tag, where it lives and how it is doing.</p>

      {params.imported ? (
        <div className="card" style={{ borderColor: "var(--ok)" }}>
          <div className="eyebrow">CSV IMPORT COMPLETE</div>
          <span className="ok-text">{params.imported} machines created</span>
          {Number(params.skipped ?? 0) > 0 ? <span className="error-text"> · {params.skipped} rows skipped</span> : null}
        </div>
      ) : null}
      {params.removed ? (
        <div className="card">
          <div className="eyebrow">MACHINE REMOVED</div>
          <span style={{ color: "var(--dim)" }}>Archive entry kept read-only in the audit trail.</span>
        </div>
      ) : null}

      <div className="card">
        <div className="eyebrow">FILTER</div>
        <form action="/machines" method="GET" className="row">
          <input type="text" name="q" defaultValue={params.q ?? ""} placeholder="search name, tag, serial…" style={{ flex: 1, minWidth: 180 }} />
          <select name="status" defaultValue={params.status ?? ""}>
            <option value="">any status</option>
            {["commissioned", "active", "standby", "under_maintenance", "decommissioned"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select name="criticality" defaultValue={params.criticality ?? ""}>
            <option value="">any criticality</option>
            {["A", "B", "C"].map((c) => <option key={c} value={c}>criticality {c}</option>)}
          </select>
          <select name="siteId" defaultValue={params.siteId ?? ""}>
            <option value="">any site</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </select>
          <button type="submit" className="secondary">APPLY</button>
        </form>
      </div>

      <div className="card">
        <div className="eyebrow">{`REGISTRY / ${machines.length} MACHINES`}</div>
        {machines.length === 0 ? (
          <div className="empty-state">
            No machines match. {mayManage ? <Link href="/machines/new" style={{ color: "var(--accent)" }}>Add your first machine</Link> : null} — or{" "}
            <Link href="/machines/import" style={{ color: "var(--accent)" }}>import a CSV list</Link>.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                <th style={thStyle}>TAG</th>
                <th style={thStyle}>NAME</th>
                <th style={thStyle}>STATUS</th>
                <th style={thStyle}>CRIT</th>
                <th style={thStyle}>CATEGORY</th>
                <th style={thStyle}>SITE</th>
                <th style={thStyle}>UPDATED</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => (
                <tr key={m.id}>
                  <td style={tdStyle}><Link href={`/machines/${m.id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{m.tag}</Link></td>
                  <td style={tdStyle}>{m.name}</td>
                  <td style={tdStyle}><span className={STATUS_COLORS[m.lifecycleStatus] ?? ""}>{m.lifecycleStatus}</span></td>
                  <td style={tdStyle}>{m.criticality}</td>
                  <td style={tdStyle}>{m.category}</td>
                  <td style={tdStyle}>{m.siteId ? (sites.find((s) => s.id === m.siteId)?.code ?? "—") : "—"}</td>
                  <td style={tdStyle}>{formatDateTime(m.updatedAt, ctx.timezone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {mayManage ? (
        <div className="card">
          <div className="eyebrow">ACTIONS</div>
          <div className="row" style={{ gap: 8 }}>
            <Link href="/machines/new" style={{ textDecoration: "none" }}><button type="button">ADD MACHINE</button></Link>
            <Link href="/machines/import" style={{ textDecoration: "none" }}><button type="button" className="secondary">IMPORT CSV</button></Link>
          </div>
        </div>
      ) : null}
    </>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  fontSize: 9,
  letterSpacing: 1.5,
  color: "var(--dim2)",
  borderBottom: "2px solid var(--line)",
  padding: "6px 8px 6px 0",
  fontWeight: 700,
};
const tdStyle: React.CSSProperties = {
  borderBottom: "1px dashed var(--line)",
  padding: "7px 8px 7px 0",
};
