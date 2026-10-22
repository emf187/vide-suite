import Link from "next/link";
import { notFound } from "next/navigation";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { machinesService } from "@/server/services/machines";
import { orgMembersService } from "@/server/services/org-members";
import { workOrderService, WO_TRANSITIONS, type WoStatus } from "@/server/services/work-orders";
import { inventoryService } from "@/server/services/inventory";
import { compileRepairAction } from "../../repairs/actions";
import { formatDateTime } from "@/lib/time";
import { formatKobo } from "@/lib/money";
import {
  addPartLineAction,
  completeStepAction,
  issuePartAction,
  logLaborAction,
  releaseReservationAction,
  reopenStepAction,
  reservePartAction,
  transitionWorkOrderAction,
} from "../actions";

export const metadata = { title: "Work Order" };

const STATUS_CLASS: Record<string, string> = {
  in_progress: "urgency-medium",
  on_hold: "urgency-high",
  cancelled: "urgency-high",
};

const TERMINALS: WoStatus[] = ["closed", "cancelled"];

export default async function WorkOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; moved?: string; step?: string; labor?: string; part?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const { id } = await params;
  const sp = await searchParams;
  const wo = await workOrderService.byId(ctx, id);
  if (!wo) notFound();

  const [steps, labor, parts, machine, members, cost, reservations, compatibleItems, allItems] = await Promise.all([
    workOrderService.steps(ctx, wo.id),
    workOrderService.labor(ctx, wo.id),
    workOrderService.parts(ctx, wo.id),
    wo.machineId ? machinesService.byId(ctx, wo.machineId) : Promise.resolve(null),
    orgMembersService.list(ctx),
    workOrderService.costRollup(ctx, wo.id),
    inventoryService.reservationsForWorkOrder(ctx, wo.id),
    wo.machineId ? inventoryService.partsForMachine(ctx, wo.machineId) : Promise.resolve([]),
    inventoryService.list(ctx),
  ]);
  // picker options: machine-compatible spares first (✦), then the rest of active stock
  const compatibleIds = new Set(compatibleItems.map((c) => c.id));
  const itemOptions = [
    ...compatibleItems.map((c) => ({ id: c.id, sku: c.sku, name: c.name, unit: c.unit, qtyOnHand: c.qtyOnHand, compatible: true })),
    ...allItems.filter((i) => !compatibleIds.has(i.id)).map((i) => ({ id: i.id, sku: i.sku, name: i.name, unit: i.unit, qtyOnHand: i.qtyOnHand, compatible: false })),
  ];

  const mayPlan = can(ctx.roles, "wo.plan");
  const mayExecute = can(ctx.roles, "wo.execute");
  const machineName = machine?.tag ?? "—";
  const nexts = TERMINALS.includes(wo.status) ? [] : WO_TRANSITIONS[wo.status];

  return (
    <>
      <div className="row" style={{ alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0 }}>{wo.number}</h1>
          <p className="lead" style={{ margin: "4px 0 0" }}>
            {wo.title} · {machineName} · {wo.type} · priority {wo.priority} · source {wo.source}
          </p>
        </div>
        <span className={STATUS_CLASS[wo.status] ?? ""} style={{ fontSize: 13 }}>{wo.status}</span>
      </div>

      {sp.moved ? <div className="card"><span className="ok-text">Status moved to {sp.moved}.</span></div> : null}
      {sp.error ? <div className="card"><div className="eyebrow">NOT DONE</div><span className="error-text">{decodeURIComponent(sp.error)}</span></div> : null}

      <div className="card">
        <div className="eyebrow">CARD</div>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <tbody>
            {[
              ["Description", wo.description ?? "—"],
              ["Machine", machineName],
              ["Assignee", wo.assignedTo ? (members.find((m) => m.userId === wo.assignedTo)?.name ?? "removed member") : "unassigned"],
              ["Planned", [wo.plannedStart, wo.plannedEnd].map((d) => (d ? formatDateTime(d, ctx.timezone) : null)).filter(Boolean).join(" → ") || "—"],
              ["Actual", [wo.actualStart, wo.actualEnd].map((d) => (d ? formatDateTime(d, ctx.timezone) : null)).filter(Boolean).join(" → ") || "—"],
              ["Created", formatDateTime(wo.createdAt, ctx.timezone)],
              ["Labor", `${cost.laborMinutes} min · ${formatKobo(cost.laborKobo, ctx.currency)}`],
              ["Parts", parts.length === 0 ? "—" : `${parts.length} line(s) · ${formatKobo(cost.partsKobo, ctx.currency)}`],
              ["Downtime", wo.downtimeHours ? `${wo.downtimeHours} h` : "—"],
              ["Verified by", wo.verifiedBy ? (members.find((m) => m.userId === wo.verifiedBy)?.name ?? "—") : "—"],
            ].map(([k, v]) => (
              <tr key={String(k)}>
                <td style={{ color: "var(--dim2)", padding: "4px 12px 4px 0", width: 130 }}>{k}</td>
                <td style={{ padding: "4px 0" }}>{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {wo.description ? <p style={{ fontSize: 12, color: "var(--dim)", margin: "8px 0 0" }}>{wo.description}</p> : null}
      </div>

      {/* ------------------------- status transitions ------------------------- */}
      {nexts.length > 0 ? (
        <div className="card">
          <div className="eyebrow">STATUS — AVAILABLE MOVES</div>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {nexts.map((to) => (
              <form key={to} action={transitionWorkOrderAction} className="row" style={{ gap: 6, alignItems: "flex-end" }}>
                <input type="hidden" name="workOrderId" value={wo.id} />
                <input type="hidden" name="to" value={to} />
                {to === "assigned" ? (
                  <select name="assignedTo" required defaultValue="">
                    <option value="" disabled>assign to…</option>
                    {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                  </select>
                ) : null}
                {to === "cancelled" ? <input name="reason" placeholder="cancel reason (required)" style={{ minWidth: 200 }} required /> : null}
                {to === "completed" ? (
                  <>
                    <input name="completedSummary" placeholder="What was done/found (stored with the card)" style={{ minWidth: 240 }} />
                    <input name="foundRootCause" placeholder="Root cause (optional)" style={{ minWidth: 160 }} />
                    <input name="downtimeHours" placeholder="Downtime hours (number)" inputMode="decimal" style={{ maxWidth: 150 }} />
                  </>
                ) : null}
                {mayPlan || (mayExecute && (to === "in_progress" || to === "on_hold" || to === "completed")) ? (
                  <button type="submit">{to.toUpperCase()}</button>
                ) : (
                  <button type="submit" className="secondary" title="The server enforces the same policy — expect an error toast if you are not allowed">{to.toUpperCase()}</button>
                )}
              </form>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "var(--dim2)", margin: "8px 0 0" }}>
            Policy: executing roles move work; verification must be a different person than the assignee; moves and reasons are audited.
          </p>
        </div>
      ) : (
        <div className="card"><div className="eyebrow">STATUS</div><span>This card is terminal ({wo.status}). History stays read-only.</span></div>
      )}

      {/* --------------- external hand: verified technician (M5) --------------- */}
      {mayPlan && wo.machineId && !["closed", "verified"].includes(wo.status) ? (
        <form action={compileRepairAction} className="card">
          <div className="eyebrow">EXTERNAL HAND — VERIFIED TECHNICIAN</div>
          <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <span style={{ fontSize: 11, color: "var(--dim)" }}>
              Compile a repair brief from this card — machine snapshot, spares, tools — review it, then send.
            </span>
            <input type="hidden" name="workOrderId" value={wo.id} />
            <input type="hidden" name="machineId" value={wo.machineId} />
            <button type="submit" style={{ fontSize: 10 }}>REQUEST TECHNICIAN →</button>
          </div>
        </form>
      ) : null}

      {/* ------------------------------- steps ------------------------------- */}
      <div className="card">
        <div className="eyebrow">{`CHECKLIST / ${steps.filter((s) => s.completedAt).length}/${steps.length} DONE`}</div>
        {steps.length === 0 ? (
          <p className="empty-state" style={{ margin: 0 }}>No steps (blank card). Add steps via a template when planning.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {steps.map((s) => (
              <div key={s.id} className="row" style={{ gap: 8, alignItems: "center", borderBottom: "1px dashed var(--line)", paddingBottom: 6 }}>
                <span style={{ width: 28, color: "var(--dim2)", fontSize: 10 }}>{String(s.seq).padStart(2, "0")}</span>
                <span style={{ flex: 1, fontSize: 12 }}>
                  {s.completedAt ? "✓ " : "□ "}{s.title}
                  {s.requireValue ? <span style={{ color: "var(--dim2)", fontSize: 10 }}> · needs a value</span> : null}
                  {s.value ? <strong> — {s.value}</strong> : null}
                  {s.completedAt ? <span style={{ color: "var(--dim2)", fontSize: 10 }}> · {formatDateTime(s.completedAt, ctx.timezone)}</span> : null}
                </span>
                {s.completedAt ? (
                  mayExecute ? (
                    <form action={reopenStepAction}>
                      <input type="hidden" name="workOrderId" value={wo.id} />
                      <input type="hidden" name="stepId" value={s.id} />
                      <button type="submit" className="secondary" style={{ fontSize: 9, padding: "2px 8px" }}>REOPEN</button>
                    </form>
                  ) : null
                ) : mayExecute && wo.status === "in_progress" ? (
                  <form action={completeStepAction} className="row" style={{ gap: 6 }}>
                    <input type="hidden" name="workOrderId" value={wo.id} />
                    <input type="hidden" name="stepId" value={s.id} />
                    {s.requireValue ? <input name="value" placeholder="value" required style={{ width: 130 }} /> : null}
                    <button type="submit" style={{ fontSize: 9, padding: "3px 8px" }}>DONE</button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ------------------------------- labor ------------------------------- */}
      <div className="card">
        <div className="eyebrow">LABOR LOG</div>
        {labor.length === 0 ? (
          <p className="empty-state" style={{ margin: 0 }}>No labor logged yet.</p>
        ) : (
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
            <tbody>
              {labor.map((l) => (
                <tr key={l.id}>
                  <td style={{ padding: "4px 10px 4px 0", width: 150 }}>{formatDateTime(l.loggedAt, ctx.timezone)}</td>
                  <td style={{ padding: "4px 8px 4px 0" }}>{members.find((m) => m.userId === l.userId)?.name ?? "—"}</td>
                  <td style={{ padding: "4px 8px 4px 0" }}>{l.minutes} min</td>
                  <td style={{ padding: "4px 8px 4px 0" }}>{formatKobo(l.minutes * l.rateKobo, ctx.currency)}</td>
                  <td style={{ color: "var(--dim2)" }}>{l.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {mayExecute ? (
          <form action={logLaborAction} className="row" style={{ marginTop: 10 }}>
            <input type="hidden" name="workOrderId" value={wo.id} />
            <input name="minutes" type="number" min={1} max={1440} placeholder="minutes" required style={{ maxWidth: 110 }} />
            {mayPlan ? (
              <select name="userId" defaultValue={ctx.userId}>
                {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
              </select>
            ) : null}
            <input name="note" placeholder="note (optional)" style={{ flex: 1, minWidth: 160 }} />
            <button type="submit">LOG</button>
          </form>
        ) : null}
      </div>

      {/* ------------------------------- parts ------------------------------- */}
      <div className="card">
        <div className="eyebrow">{`PARTS / ${parts.length} LINE(S) — ${formatKobo(cost.partsKobo, ctx.currency)}`}</div>
        {parts.length === 0 ? <p className="empty-state" style={{ margin: 0 }}>No parts lines yet — reserve or issue stock from inventory.</p> : (
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
            <tbody>
              {parts.map((p) => (
                <tr key={p.id}>
                  <td style={{ padding: "4px 8px 4px 0" }}>
                    {p.inventoryItemId ? (
                      <Link href={`/inventory/${p.inventoryItemId}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{p.name ?? "stock item"}</Link>
                    ) : (p.name ?? "—")}
                  </td>
                  <td style={{ color: "var(--dim2)" }}>qty {p.qty}</td>
                  <td style={{ color: "var(--dim2)" }}>{p.unitCostKobo ? formatKobo(p.unitCostKobo, ctx.currency) : ""}</td>
                  <td style={{ color: "var(--dim2)" }}>{p.note ?? ""}</td>
                  <td style={{ color: "var(--dim2)", fontSize: 10 }}>{p.issuedAt ? `issued ${formatDateTime(p.issuedAt, ctx.timezone)}` : "planned line"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {reservations.length > 0 ? (
          <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr><th style={{ textAlign: "left", fontSize: 9, letterSpacing: 1.5, color: "var(--dim2)", borderBottom: "2px solid var(--line)", padding: "4px 8px 4px 0" }}>RESERVED (COMMITMENTS)</th><th /></tr>
            </thead>
            <tbody>
              {reservations.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: "3px 8px 3px 0" }}>
                    {r.qty} × {r.itemSku} {r.itemName} — reserved
                  </td>
                  <td style={{ padding: "3px 8px 3px 0" }}>
                    {mayExecute ? (
                      <form action={releaseReservationAction} style={{ display: "inline" }}>
                        <input type="hidden" name="workOrderId" value={wo.id} />
                        <input type="hidden" name="reservationId" value={r.id} />
                        <button type="submit" className="secondary" style={{ fontSize: 9, padding: "1px 8px" }}>RELEASE</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {mayExecute ? (
          <div className="row" style={{ marginTop: 10, gap: 10 }}>
            <form action={issuePartAction} className="row" style={{ gap: 6, flex: 1, minWidth: 260 }}>
              <input type="hidden" name="workOrderId" value={wo.id} />
              <select name="itemId" defaultValue="" required style={{ flex: 1, minWidth: 180 }}>
                <option value="">issue stock item…</option>
                {itemOptions.map((it) => (
                  <option key={it.id} value={it.id}>{it.sku} {it.name}{it.compatible ? " ✦" : ""} — {it.qtyOnHand} on hand</option>
                ))}
              </select>
              <input name="qty" type="number" step="0.5" min={0.5} placeholder="qty" style={{ maxWidth: 80 }} />
              <button type="submit">ISSUE</button>
            </form>
            <form action={reservePartAction} className="row" style={{ gap: 6, flex: 1, minWidth: 260 }}>
              <input type="hidden" name="workOrderId" value={wo.id} />
              <select name="itemId" defaultValue="" required style={{ flex: 1, minWidth: 180 }}>
                <option value="">reserve item for later…</option>
                {itemOptions.map((it) => <option key={it.id} value={it.id}>{it.sku} {it.name} — {it.qtyOnHand} on hand</option>)}
              </select>
              <input name="qty" type="number" step="0.5" min={0.5} placeholder="qty" style={{ maxWidth: 80 }} />
              <button type="submit" className="secondary">RESERVE</button>
            </form>
          </div>
        ) : null}
        {mayExecute ? (
          <form action={addPartLineAction} className="row" style={{ marginTop: 8 }}>
            <input type="hidden" name="workOrderId" value={wo.id} />
            <input name="name" placeholder="free-text part line (no stock moved)" required style={{ flex: 1, minWidth: 200 }} />
            <input name="qty" type="number" step="0.5" min={0.5} placeholder="qty" defaultValue={1} style={{ maxWidth: 90 }} />
            <button type="submit" className="secondary">ADD LINE</button>
          </form>
        ) : null}
      </div>

      <div className="card">
        <div className="eyebrow">RELATED</div>
        <div className="row" style={{ gap: 14 }}>
          {wo.machineId ? (
            <Link href={`/machines/${wo.machineId}?tab=maintenance`} style={{ color: "var(--accent)", fontSize: 12 }}>Machine maintenance tab →</Link>
          ) : (
            <span style={{ color: "var(--dim2)", fontSize: 12 }}>No machine attached — attach one via EDIT.</span>
          )}
          <Link href="/work-orders" style={{ color: "var(--dim2)", fontSize: 12 }}>All work orders</Link>
        </div>
      </div>
    </>
  );
}
