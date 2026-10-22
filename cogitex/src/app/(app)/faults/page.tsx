import Link from "next/link";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { faultsService } from "@/server/services/faults";
import { machinesService } from "@/server/services/machines";
import { formatDateTime } from "@/lib/time";
import { acknowledgeFaultAction, convertFaultAction, dismissFaultAction } from "./actions";
import { compileRepairAction } from "../repairs/actions";

export const metadata = { title: "Faults" };

const FILTERS = [
  ["all", "ALL"],
  ["open", "OPEN"],
  ["acknowledged", "ACKNOWLEDGED"],
  ["converted", "CONVERTED"],
  ["dismissed", "DISMISSED"],
] as const;

const SEV_CLASS: Record<string, string> = { critical: "urgency-high", warning: "urgency-medium", watch: "" };

export default async function FaultsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; moved?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const sp = await searchParams;
  const status = (FILTERS.find(([k]) => k === (sp.status ?? "all")) ?? FILTERS[0])[0] as
    | "all"
    | "open"
    | "acknowledged"
    | "converted"
    | "dismissed";

  const faults = await faultsService.list(ctx, { status });
  const openCount = await faultsService.openCount(ctx);
  const mayPlan = can(ctx.roles, "wo.plan");

  // prefetch machine tags for the visible rows
  const machineIds = [...new Set(faults.map((f) => f.machineId).filter((x): x is string => Boolean(x)))];
  const tagById = new Map<string, string>();
  await Promise.all(
    machineIds.map(async (mid) => {
      const m = await machinesService.byId(ctx, mid);
      if (m) tagById.set(mid, m.tag);
    }),
  );

  return (
    <>
      <h1>Faults</h1>
      <p className="lead">
        {`Alarms pushed by VIDE (${openCount} open) — resolved strictly by device name inside this org, then triaged here: acknowledge, dismiss, or convert into a work order.`}
      </p>

      {sp.moved ? <div className="card"><span className="ok-text">Fault {sp.moved}.</span></div> : null}
      {sp.error ? <div className="card"><div className="eyebrow">NOT SAVED</div><span className="error-text">{decodeURIComponent(sp.error)}</span></div> : null}

      <div className="card">
        <div className="row" style={{ gap: 12 }}>
          {FILTERS.map(([k, label]) => (
            <Link
              key={k}
              href={`/faults?status=${k}`}
              style={{
                fontSize: 10,
                letterSpacing: 1.5,
                textDecoration: "none",
                color: k === status ? "var(--accent)" : "var(--dim2)",
                borderBottom: k === status ? "2px solid var(--accent)" : "2px solid transparent",
                paddingBottom: 2,
              }}
            >
              {label}
            </Link>
          ))}
        </div>
        {faults.length === 0 ? (
          <p className="empty-state">
            {status === "open" ? "Nothing open — the plant is quiet." : "No events in this view."} The webhook
            endpoint is <span style={{ fontFamily: "var(--mono)", fontSize: 10 }}>POST /api/webhooks/vide</span>.
          </p>
        ) : (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", marginTop: 10 }}>
            <thead>
              <tr>
                {["FLAGGED", "SEVERITY", "MACHINE", "TYPE / DETAIL", "STATE"].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: 9, letterSpacing: 1.5, color: "var(--dim2)", borderBottom: "2px solid var(--line)", padding: "6px 8px 6px 0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {faults.map((f) => {
                const tag = f.machineId ? tagById.get(f.machineId) : undefined;
                const actionable = f.status === "open" || f.status === "acknowledged";
                return (
                  <tr key={f.id}>
                    <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", color: "var(--dim2)", fontSize: 10, whiteSpace: "nowrap" }}>
                      {formatDateTime(f.flaggedAt, ctx.timezone)}
                    </td>
                    <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", fontSize: 10 }}>
                      <span className={SEV_CLASS[f.severity] ?? ""}>{f.severity.toUpperCase()}</span>
                    </td>
                    <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", fontSize: 11 }}>
                      {tag ? (
                        <Link href={`/machines/${f.machineId}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{tag}</Link>
                      ) : (
                        <span style={{ color: "var(--dim2)" }}>{f.videMachineName} (unlinked)</span>
                      )}
                    </td>
                    <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0" }}>
                      <span style={{ fontWeight: 700 }}>{f.faultType}</span>
                      {f.description ? <span style={{ color: "var(--dim2)" }}> — {f.description}</span> : null}
                    </td>
                    <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 0 6px 0", fontSize: 10 }}>
                      <div className="row" style={{ gap: 6, alignItems: "center" }}>
                        <span style={{ color: "var(--dim2)" }}>{f.status.toUpperCase()}</span>
                        {f.woNumber ? (
                          <Link href={`/work-orders/${f.woId}`} style={{ color: "var(--accent)", fontSize: 10, textDecoration: "none" }}>→ {f.woNumber}</Link>
                        ) : null}
                        {mayPlan && actionable ? (
                          <form action={acknowledgeFaultAction}>
                            <input type="hidden" name="faultId" value={f.id} />
                            <button type="submit" className="secondary" style={{ fontSize: 9, padding: "2px 8px" }} disabled={f.status === "acknowledged" ? true : undefined}>
                              ACK
                            </button>
                          </form>
                        ) : null}
                        {mayPlan && f.status === "open" ? (
                          <form action={dismissFaultAction}>
                            <input type="hidden" name="faultId" value={f.id} />
                            <button type="submit" className="secondary" style={{ fontSize: 9, padding: "2px 8px" }}>DISMISS</button>
                          </form>
                        ) : null}
                        {mayPlan && actionable && f.machineId ? (
                          <form action={convertFaultAction}>
                            <input type="hidden" name="faultId" value={f.id} />
                            <button type="submit" style={{ fontSize: 9, padding: "2px 8px" }}>→ WORK ORDER</button>
                          </form>
                        ) : null}
                        {mayPlan && f.machineId && actionable ? (
                          <form action={compileRepairAction}>
                            <input type="hidden" name="faultEventId" value={f.id} />
                            <input type="hidden" name="machineId" value={f.machineId} />
                            <button type="submit" style={{ fontSize: 9, padding: "2px 8px" }}>→ REPAIR REQUEST</button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
