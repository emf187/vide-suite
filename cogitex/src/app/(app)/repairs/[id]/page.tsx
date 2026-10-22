import Link from "next/link";
import { notFound } from "next/navigation";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { repairRequestsService, type RepairRequestStatus } from "@/server/services/repair-requests";
import { formatDateTime } from "@/lib/time";
import { formatKobo } from "@/lib/money";
import type { CompiledBrief } from "@/server/services/repair-requests";
import {
  confirmRepairAction,
  demoAdvanceAction,
  discardRepairAction,
  refreshRepairAction,
  sendRepairAction,
  withdrawRepairAction,
} from "../actions";

export const metadata = { title: "Repair request" };

const TIMELINE_STEPS: RepairRequestStatus[] = ["compiled", "sent", "matched", "quoted", "accepted", "en_route", "on_site", "completed", "confirmed"];
const URGENCY_CLASS: Record<string, string> = { critical: "urgency-high", high: "urgency-medium", medium: "", low: "" };

/** which simulated webhook steps make sense from the current status (demo aid) */
const NEXT_DEMO: Record<string, RepairRequestStatus[]> = {
  sent: ["matched", "declined"],
  matched: ["quoted"],
  quoted: ["accepted", "withdrawn"],
  accepted: ["en_route"],
  en_route: ["on_site"],
  on_site: ["completed"],
};

export default async function RepairRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ moved?: string; error?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const { id } = await params;
  const sp = await searchParams;

  const req = await repairRequestsService.byId(ctx, id);
  if (!req) notFound();
  const events = await repairRequestsService.events(ctx, req.id);
  const maySend = can(ctx.roles, "repairRequests.send");

  const brief = (req.confirmedBrief ?? req.brief) as unknown as CompiledBrief;
  const snap = brief.machineSnapshot as Record<string, string | null>;
  const cursor = TIMELINE_STEPS.indexOf(req.status as RepairRequestStatus);

  return (
    <>
      <div className="row" style={{ alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0 }}>Repair request</h1>
          <p className="lead" style={{ margin: "4px 0 0" }}>
            {`${String(snap.tag ?? "—")} · ${req.status.toUpperCase()}${req.faultEventId ? " · fault-driven" : ""}`}
            {req.quoteKobo != null ? ` · quote ${formatKobo(req.quoteKobo, "NGN")}` : ""}
          </p>
        </div>
        <span className={URGENCY_CLASS[req.urgency] ?? ""} style={{ fontSize: 12 }}>URGENCY: {req.urgency.toUpperCase()}</span>
      </div>

      {sp.moved ? <div className="card"><span className="ok-text">{`${sp.moved}.`}</span></div> : null}
      {sp.error ? (
        <div className="card">
          <div className="eyebrow">NOT SAVED</div>
          <span className="error-text">{decodeURIComponent(sp.error)}</span>
        </div>
      ) : null}

      {/* status rail */}
      <div className="card">
        <div className="eyebrow">LIFECYCLE</div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {TIMELINE_STEPS.map((s, i) => (
            <span
              key={s}
              style={{
                fontSize: 9, letterSpacing: 1, padding: "3px 8px",
                border: `2px solid ${i <= cursor ? "var(--accent)" : "var(--line)"}`,
                color: i <= cursor ? "var(--accent)" : "var(--dim2)",
              }}
            >
              {s.toUpperCase().replace("_", " ")}
            </span>
          ))}
          {["declined", "withdrawn", "failed"].includes(req.status) ? (
            <span className="urgency-high" style={{ fontSize: 9, letterSpacing: 1, padding: "3px 8px", border: "2px solid var(--acc-red, var(--accent))" }}>
              {req.status.toUpperCase()}{req.cancelledReason ? ` — ${req.cancelledReason}` : ""}
            </span>
          ) : null}
        </div>
      </div>

      {/* compiled brief / confirmation */}
      <div className="card">
        <div className="eyebrow">{req.status === "compiled" ? "CONFIRMATION — REVIEW, EDIT, THEN SEND" : "BRIEF SNAPSHOT"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginTop: 8, fontSize: 11 }}>
          <div><span style={{ color: "var(--dim2)" }}>MACHINE</span><br />{String(snap.tag ?? "—")} — {String(snap.name ?? "")}</div>
          <div><span style={{ color: "var(--dim2)" }}>CATEGORY / CRITICALITY</span><br />{String(snap.category ?? "—")} · {String(snap.criticality ?? "—")}</div>
          <div><span style={{ color: "var(--dim2)" }}>VIDE DEVICE</span><br />{String(snap.videDevice ?? "not linked")}</div>
          {brief.fault ? (
            <>
              <div><span style={{ color: "var(--dim2)" }}>FAULT</span><br />{brief.fault.type} ({brief.fault.severity})</div>
              <div><span style={{ color: "var(--dim2)" }}>FLAGGED</span><br />{brief.fault.flaggedAt ? formatDateTime(brief.fault.flaggedAt, ctx.timezone) : "—"}</div>
              {brief.fault.description ? <div><span style={{ color: "var(--dim2)" }}>DETAIL</span><br />{brief.fault.description}</div> : null}
            </>
          ) : null}
          <div><span style={{ color: "var(--dim2)" }}>SKILL</span><br />{brief.skill}</div>
          <div><span style={{ color: "var(--dim2)" }}>TOOLS</span><br />{brief.tools.join(", ") || "—"}</div>
          <div><span style={{ color: "var(--dim2)" }}>SUGGESTED PARTS</span><br />{brief.suggestedParts.map((p) => p.sku).join(", ") || "—"}</div>
        </div>

        {req.status === "compiled" ? (
          maySend ? (
            <form action={sendRepairAction} style={{ display: "grid", gap: 10, marginTop: 14 }}>
              <input type="hidden" name="repairRequestId" value={req.id} />
              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <label className="field-label" htmlFor="rp-urg" style={{ width: "auto" }}>URGENCY (HUMAN-CHECKED — EDITABLE)</label>
                <select id="rp-urg" name="urgency" defaultValue={req.urgency}>
                  {["low", "medium", "high", "critical"].map((u) => <option key={u} value={u}>{u.toUpperCase()}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="rp-notes">NOTES FOR THE TECHNICIAN</label>
                <textarea id="rp-notes" name="notes" rows={2} placeholder="e.g. Production window 22:00–04:00; lockout-tagout at MCC-3" style={{ width: "100%" }} />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button type="submit" style={{ fontSize: 11 }}>SEND TO MARKETPLACE →</button>
              </div>
            </form>
          ) : null
        ) : null}

        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {maySend && req.status === "compiled" ? (
            <form action={discardRepairAction}>
              <input type="hidden" name="repairRequestId" value={req.id} />
              <button type="submit" className="secondary" style={{ fontSize: 10 }}>DISCARD DRAFT</button>
            </form>
          ) : null}
          {maySend && ["sent", "matched", "quoted"].includes(req.status) ? (
            <>
              <form action={refreshRepairAction}>
                <input type="hidden" name="repairRequestId" value={req.id} />
                <button type="submit" className="secondary" style={{ fontSize: 10 }}>REFRESH STATUS</button>
              </form>
              <form action={withdrawRepairAction} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="hidden" name="repairRequestId" value={req.id} />
                <input name="reason" placeholder="reason (optional)" style={{ width: 180 }} />
                <button type="submit" className="secondary" style={{ fontSize: 10 }}>WITHDRAW</button>
              </form>
            </>
          ) : null}
          {maySend && req.status === "completed" ? (
            <form action={confirmRepairAction} style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
              <input type="hidden" name="repairRequestId" value={req.id} />
              <div>
                <label className="field-label" htmlFor="rp-rating">RATING THE JOB</label>
                <select id="rp-rating" name="rating" defaultValue="5">
                  {([5, 4, 3, 2, 1] as const).map((n) => <option key={n} value={n}>{`${"★".repeat(n)} (${n})`}</option>)}
                </select>
              </div>
              <input name="note" placeholder="root cause / summary (visible to VIDE)" style={{ width: 320 }} />
              <button type="submit" style={{ fontSize: 10 }}>CONFIRM + CLOSE</button>
            </form>
          ) : null}
        </div>

        {maySend && (NEXT_DEMO[req.status]?.length ?? 0) > 0 ? (
          <div style={{ marginTop: 12, borderTop: "2px dashed var(--line)", paddingTop: 10 }}>
            <div className="eyebrow">DEMO — SIMULATE THE MARKETPLACE WEBHOOK</div>
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              {(NEXT_DEMO[req.status] ?? []).map((s) => (
                <form action={demoAdvanceAction} key={s}>
                  <input type="hidden" name="repairRequestId" value={req.id} />
                  <input type="hidden" name="toStatus" value={s} />
                  <button type="submit" className="secondary" style={{ fontSize: 9, padding: "2px 8px" }}>
                    → {s.toUpperCase().replace("_", " ")}
                  </button>
                </form>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* engagement facts */}
      <div className="card">
        <div className="eyebrow">MARKETPLACE</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginTop: 8, fontSize: 11 }}>
          <div><span style={{ color: "var(--dim2)" }}>MARKETPLACE REF</span><br />{req.marketplaceRequestId ?? "—"}</div>
          <div><span style={{ color: "var(--dim2)" }}>TECHNICIAN</span><br />{req.technicianId ? "on file" : "—"}</div>
          <div><span style={{ color: "var(--dim2)" }}>QUOTE</span><br />{req.quoteKobo != null ? formatKobo(req.quoteKobo, req.quoteCurrency ?? "NGN") : "—"}</div>
          <div><span style={{ color: "var(--dim2)" }}>ETA</span><br />{req.etaAt ? formatDateTime(req.etaAt, ctx.timezone) : "—"}</div>
          <div><span style={{ color: "var(--dim2)" }}>OUTCOME</span><br />{req.outcomeSummary ?? "—"}</div>
          <div><span style={{ color: "var(--dim2)" }}>RATING</span><br />{req.rating ? `${"★".repeat(req.rating)}${"☆".repeat(5 - req.rating)}` : "—"}</div>
        </div>
        {req.technicianId ? (
          <p style={{ fontSize: 10, color: "var(--dim2)", marginTop: 10 }}>
            Technician identity snapshot cached app-side; the marketplace owns the directory {req.workOrderId ? (
              <>— WO <Link href={`/work-orders/${req.workOrderId}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{req.marketplaceRequestId ?? "linked"}</Link> relationship on file</>
            ) : null}.
          </p>
        ) : null}
      </div>

      <div className="card">
        <div className="eyebrow">{`EVENT TRAIL / ${events.length}`}</div>
        {events.length === 0 ? (
          <p className="empty-state" style={{ margin: "8px 0 0" }}>No transitions recorded yet.</p>
        ) : (
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", marginTop: 8 }}>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td style={{ padding: "4px 8px 4px 0", color: "var(--dim2)", fontSize: 10, width: 150, whiteSpace: "nowrap" }}>{formatDateTime(e.at, ctx.timezone)}</td>
                  <td style={{ padding: "4px 8px 4px 0", fontSize: 10 }}>
                    {e.fromStatus ? `${e.fromStatus.toUpperCase()} → ` : ""}{e.toStatus.toUpperCase()}
                  </td>
                  <td style={{ padding: "4px 8px 4px 0", fontSize: 10, color: "var(--dim2)" }}>{e.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
