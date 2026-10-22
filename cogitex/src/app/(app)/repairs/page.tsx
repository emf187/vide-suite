import Link from "next/link";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { machinesService } from "@/server/services/machines";
import { faultsService } from "@/server/services/faults";
import { repairRequestsService, type RepairRequestStatus } from "@/server/services/repair-requests";
import { formatDateTime } from "@/lib/time";
import { formatKobo } from "@/lib/money";
import { compileRepairAction } from "./actions";

export const metadata = { title: "Repair requests" };

const FILTERS: [string, string][] = [
  ["all", "ALL"],
  ["compiled", "COMPILED"],
  ["sent", "SENT"],
  ["matched", "MATCHED"],
  ["quoted", "QUOTED"],
  ["accepted", "ACCEPTED"],
  ["en_route", "EN ROUTE"],
  ["on_site", "ON SITE"],
  ["completed", "COMPLETED"],
  ["confirmed", "CONFIRMED"],
  ["declined", "DECLINED"],
  ["withdrawn", "WITHDRAWN"],
];

const STATUS_CLASS: Record<string, string> = {
  compiled: "",
  sent: "urgency-medium",
  matched: "urgency-medium",
  quoted: "urgency-medium",
  failed: "urgency-high",
  declined: "urgency-high",
  confirmed: "urn-critical",
  completed: "urn-critical",
};

const URGENCY_CLASS: Record<string, string> = {
  critical: "urgency-high",
  high: "urgency-medium",
  medium: "",
  low: "",
};

function money(kobo: number | null): string {
  return kobo === null ? "—" : formatKobo(kobo, "NGN");
}

export default async function RepairsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; moved?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const sp = await searchParams;
  const raw = sp.status ?? "all";
  const status = (FILTERS.some(([k]) => k === raw) ? raw : "all") as RepairRequestStatus | "all";

  const requests = await repairRequestsService.list(ctx, { status });
  const maySend = can(ctx.roles, "repairRequests.send");

  const machineList = maySend
    ? (await machinesService.list(ctx)).filter((m) => m.lifecycleStatus !== "decommissioned")
    : [];
  const openFaults = maySend ? (await faultsService.list(ctx, { status: "open" })).slice(0, 20) : [];

  return (
    <>
      <h1>Repair requests</h1>
      <p className="lead">
        {"Verified-technician dispatch — a compiled brief (machine snapshot, fault, spares, tools) is human-checked on a confirmation screen before anything is sent. Marketplace statuses flow back in via webhook."}
      </p>

      {sp.moved ? <div className="card"><span className="ok-text">{`${sp.moved}.`}</span></div> : null}
      {sp.error ? (
        <div className="card">
          <div className="eyebrow">NOT SAVED</div>
          <span className="error-text">{decodeURIComponent(sp.error)}</span>
        </div>
      ) : null}

      {maySend ? (
        <div className="card">
          <div className="eyebrow">REQUEST A TECHNICIAN</div>
          <form action={compileRepairAction} style={{ display: "grid", gap: 10, marginTop: 8 }}>
            <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <label className="field-label" htmlFor="rp-machine" style={{ width: "auto" }}>MACHINE</label>
              <select id="rp-machine" name="machineId" style={{ minWidth: 230 }}>
                {machineList.map((m) => (
                  <option key={m.id} value={m.id}>{m.tag} — {m.name}</option>
                ))}
              </select>
              <label className="field-label" htmlFor="rp-fault" style={{ width: "auto" }}>LINK OPEN FAULT (OPTIONAL)</label>
              <select id="rp-fault" name="faultEventId" style={{ minWidth: 230 }}>
                <option value="">— none —</option>
                {openFaults.map((f) => (
                  <option key={f.id} value={f.id}>{f.videMachineName} · {f.faultType} ({f.severity})</option>
                ))}
              </select>
            </div>
            <div>
              <button type="submit" style={{ fontSize: 11 }}>COMPILE BRIEF →</button>
              <span style={{ fontSize: 10, color: "var(--dim2)", marginLeft: 10 }}>
                compile → review → confirm — nothing leaves the plant before you say so.
              </span>
            </div>
          </form>
        </div>
      ) : null}

      <div className="card">
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          {FILTERS.map(([k, label]) => (
            <Link
              key={k}
              href={`/repairs?status=${k}`}
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

        {requests.length === 0 ? (
          <p className="empty-state" style={{ marginTop: 10 }}>
            {status === "all" ? "No repair requests yet — compile a brief above (or from a fault row)." : "Nothing in this view."}
          </p>
        ) : (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", marginTop: 10 }}>
            <thead>
              <tr>
                {["COMPILED", "MACHINE", "BRIEF", "URGENCY", "STATUS", "TECHNICIAN", "QUOTE / RESULT"].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: 9, letterSpacing: 1.5, color: "var(--dim2)", borderBottom: "2px solid var(--line)", padding: "6px 8px 6px 0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", color: "var(--dim2)", fontSize: 10, whiteSpace: "nowrap" }}>
                    {formatDateTime(r.createdAt, ctx.timezone)}
                  </td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", fontSize: 11 }}>
                    {r.machineId && r.machineTag ? (
                      <Link href={`/machines/${r.machineId}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{r.machineTag}</Link>
                    ) : (
                      <span style={{ color: "var(--dim2)" }}>—</span>
                    )}
                  </td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", fontSize: 11, color: "var(--dim)" }}>
                    {r.faultType ?? "preventive repair"}
                  </td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", fontSize: 10 }}>
                    <span className={URGENCY_CLASS[r.urgency] ?? ""}>{r.urgency.toUpperCase()}</span>
                  </td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", fontSize: 10 }}>
                    <Link href={`/repairs/${r.id}`} className={STATUS_CLASS[r.status] ?? ""} style={{ textDecoration: "none" }}>
                      {r.status.toUpperCase()}
                    </Link>
                  </td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", fontSize: 11 }}>
                    {r.techName ? `${r.techName}${r.techRating ? ` ★ ${Number(r.techRating).toFixed(1)}` : ""}` : <span style={{ color: "var(--dim2)" }}>—</span>}
                  </td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 0 6px 0", fontSize: 11, whiteSpace: "nowrap" }}>
                    {r.quoteKobo !== null && r.quoteKobo !== undefined ? money(r.quoteKobo) : r.rating ? `${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
