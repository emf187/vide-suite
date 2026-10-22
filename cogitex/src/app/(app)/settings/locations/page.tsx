import Link from "next/link";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { areasService, sitesService } from "@/server/services/sites";
import { formatDateTime } from "@/lib/time";
import { createAreaAction, createSiteAction } from "../../machines/actions";

export const metadata = { title: "Locations" };

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const sp = await searchParams;
  const mayManage = can(ctx.roles, "plan.manage");
  const [sites, areas] = await Promise.all([sitesService.list(ctx), areasService.list(ctx)]);

  return (
    <>
      <h1>Locations</h1>
      <p className="lead">Sites and areas give every machine an address — filters, reports and worker maps build on it.</p>

      {sp.error ? <div className="card"><span className="error-text">{sp.error === "dup_code" ? "Code already used (codes are unique per site)." : sp.error}</span></div> : null}
      {sp.created ? <div className="card"><span className="ok-text">Created.</span></div> : null}

      <div className="card">
        <div className="eyebrow">{`SITES / ${sites.length}`}</div>
        {sites.length === 0 ? (
          <p className="empty-state" style={{ margin: 0 }}>No sites yet.</p>
        ) : (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id}>
                  <td style={{ padding: "4px 10px 4px 0", color: "var(--dim2)", width: 80 }}>{s.code}</td>
                  <td style={{ padding: "4px 10px 4px 0" }}>{s.name}</td>
                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {areas.filter((a) => a.siteId === s.id).map((a) => (
                      <span key={a.id} style={{ fontSize: 10, border: "1px solid var(--line)", padding: "1px 6px", color: "var(--dim)" }}>
                        {a.code} {a.kind === "line" ? "· line" : ""}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {mayManage ? (
        <>
          <form action={createSiteAction} className="card">
            <div className="eyebrow">ADD SITE</div>
            <div className="row">
              <input name="code" placeholder="Code e.g. PLT1" required style={{ maxWidth: 140, textTransform: "uppercase" }} />
              <input name="name" placeholder="Site name e.g. Anyanwu Plant 1" required style={{ flex: 1, minWidth: 200 }} />
              <input name="address" placeholder="Address (optional)" style={{ flex: 1, minWidth: 200 }} />
              <button type="submit">ADD SITE</button>
            </div>
          </form>

          <form action={createAreaAction} className="card">
            <input type="hidden" name="kind" value="area" />
            <div className="eyebrow">ADD AREA / PRODUCTION LINE</div>
            <div className="row">
              <select name="siteId" required defaultValue="">
                <option value="" disabled>choose site</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
              </select>
              <input name="code" placeholder="Code e.g. LINE-B" required style={{ maxWidth: 140, textTransform: "uppercase" }} />
              <input name="name" placeholder="Name e.g. Weaving line B" required style={{ flex: 1, minWidth: 200 }} />
              <button type="submit">ADD AREA</button>
            </div>
            {sites.length === 0 ? (
              <p style={{ fontSize: 11, color: "var(--dim2)" }}>Create a site first.</p>
            ) : null}
          </form>
        </>
      ) : null}
    </>
  );
}
