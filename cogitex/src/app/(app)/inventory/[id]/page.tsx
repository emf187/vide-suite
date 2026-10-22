import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { getDb } from "@/server/db/client";
import { suppliers as suppliersTable, workOrders } from "@/server/db/schema";
import { inventoryService } from "@/server/services/inventory";
import { formatKobo } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { adjustAction, cancelReservationAction, receiveAction, reserveFromItemAction, issueFromItemAction, updateItemAction } from "../actions";

export const metadata = { title: "Stock item" };

const OPEN_STATUSES = ["planned", "assigned", "in_progress", "on_hold", "draft"] as const;
const UUID = /^[0-9a-f-]{36}$/;

export default async function InventoryItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; moved?: string; saved?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const item = await inventoryService.byId(ctx, id);
  if (!item) notFound();

  const canManage = can(ctx.roles, "inventory.manage");
  const canExecute = can(ctx.roles, "wo.execute");

  const [ledger, reserves, avail, openWos, allSuppliers, supplierRow] = await Promise.all([
    inventoryService.ledger(ctx, item.id),
    inventoryService.reservationsForItem(ctx, item.id),
    inventoryService.availability(ctx, item.id),
    (async () => {
      const db = await getDb();
      const rows = await db
        .select({ id: workOrders.id, number: workOrders.number, title: workOrders.title, status: workOrders.status })
        .from(workOrders)
        .where(eq(workOrders.organizationId, ctx.orgId))
        .limit(300);
      return rows.filter((w) => (OPEN_STATUSES as readonly string[]).includes(w.status));
    })(),
    inventoryService.suppliers(ctx),
    (async () => {
      if (!item.supplierId) return null;
      const db = await getDb();
      const rows = await db.select().from(suppliersTable).where(eq(suppliersTable.id, item.supplierId)).limit(1);
      return rows[0] ?? null;
    })(),
  ]);

  const low = Number(item.qtyOnHand) <= Number(item.reorderPoint);
  void low;

  return (
    <>
      <p style={{ margin: 0 }}>
        <Link href="/inventory" style={{ color: "var(--dim2)", fontSize: 11, textDecoration: "none" }}>← INVENTORY</Link>
      </p>
      <h1>{item.name}</h1>
      <p className="lead">
        {item.sku} · {item.category ?? "uncategorised"} · <strong>{avail.onHand} {item.unit}</strong> on hand
        {avail.reserved > 0 ? ` (−${avail.reserved} reserved → ${avail.available} available)` : ""}
        {low ? " · ⚠ AT/BELOW REORDER" : ""} · supplier {supplierRow?.name ?? "—"}
        {item.locationNote ? ` · ${item.locationNote}` : ""}
      </p>

      {sp.saved ? <div className="card"><span className="ok-text">Details updated.</span></div> : null}
      {sp.moved ? <div className="card"><span className="ok-text">Ledger updated ({sp.moved}).</span></div> : null}
      {sp.error ? <div className="card"><div className="eyebrow">NOT SAVED</div><span className="error-text">{decodeURIComponent(sp.error)}</span></div> : null}

      <div className="card">
        <div className="eyebrow">DETAILS</div>
        {canManage ? (
          <form action={updateItemAction}>
            <input type="hidden" name="itemId" value={item.id} />
            <div className="row">
              <input name="name" defaultValue={item.name} required style={{ flex: 1, minWidth: 180 }} />
              <input name="category" defaultValue={item.category ?? ""} placeholder="category" style={{ maxWidth: 160 }} />
              <input name="unit" defaultValue={item.unit} style={{ maxWidth: 90 }} />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <label style={{ fontSize: 10 }}>reorder at<input name="reorderPoint" defaultValue={item.reorderPoint} inputMode="decimal" style={{ maxWidth: 90 }} /></label>
              <label style={{ fontSize: 10 }}>unit cost ₦<input name="unitCostNaira" defaultValue={String(item.unitCostKobo / 100)} inputMode="decimal" style={{ maxWidth: 110 }} /></label>
              <input name="locationNote" defaultValue={item.locationNote ?? ""} placeholder="store location" style={{ maxWidth: 200 }} />
              <select name="supplierId" defaultValue={item.supplierId ?? ""}>
                <option value="">no supplier</option>
                {allSuppliers.map((sup) => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
              </select>
              <button type="submit">SAVE</button>
            </div>
          </form>
        ) : (
          <p className="empty-state" style={{ margin: 0 }}>
            Unit cost {formatKobo(item.unitCostKobo, ctx.currency)} · stored at {item.locationNote ?? "—"} · supplied by {supplierRow?.name ?? "—"}
          </p>
        )}
      </div>

      <div className="card">
        <div className="eyebrow">{`STOCK LEDGER / APPEND-ONLY / ${ledger.length} ENTRIES`}</div>
        {ledger.length === 0 ? (
          <p className="empty-state" style={{ margin: 0 }}>No movements yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr>
                {["WHEN", "KIND", "QTY", "BALANCE", "UNIT COST", "REFERENCE"].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: 9, letterSpacing: 1.5, color: "var(--dim2)", borderBottom: "2px solid var(--line)", padding: "6px 8px 6px 0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id}>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "4px 8px 4px 0", fontSize: 10, color: "var(--dim2)", whiteSpace: "nowrap" }}>{formatDateTime(l.createdAt, ctx.timezone)}</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "4px 8px 4px 0", fontSize: 11 }}>{l.kind.toUpperCase()}</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "4px 8px 4px 0", fontSize: 11, fontFamily: "var(--mono)", color: l.qty.startsWith("-") ? "var(--danger)" : "var(--ok, inherit)" }}>
                    {l.qty.startsWith("-") ? "" : "+"}{l.qty}
                  </td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "4px 8px 4px 0", fontSize: 11, fontFamily: "var(--mono)" }}>{l.balanceAfter}</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "4px 8px 4px 0", fontSize: 11 }}>{l.unitCostKobo ? formatKobo(l.unitCostKobo, ctx.currency) : "—"}</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "4px 8px 4px 0", fontSize: 10 }}>{l.reference ?? (
                    l.workOrderId ? <Link href={`/work-orders/${l.workOrderId}`} style={{ color: "var(--accent)", textDecoration: "none" }}>→ work order</Link> : "—"
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canExecute ? (
        <>
          <div className="card">
            <div className="eyebrow">RECEIVE INTO STOCK</div>
            <form action={receiveAction} className="row">
              <input type="hidden" name="itemId" value={item.id} />
              <label style={{ fontSize: 10 }}>qty<input name="qty" inputMode="decimal" required style={{ maxWidth: 90 }} /></label>
              <label style={{ fontSize: 10 }}>unit cost ₦<input name="unitCostNaira" inputMode="decimal" placeholder="keep current" style={{ maxWidth: 130 }} /></label>
              <input name="reference" placeholder="reference — PO #, invoice" style={{ flex: 1, minWidth: 160 }} />
              <button type="submit">RECEIVE</button>
            </form>
          </div>

          <div className="card">
            <div className="eyebrow">{`OPEN RESERVATIONS / ${reserves.length}`}</div>
            {reserves.length === 0 ? (
              <p className="empty-state" style={{ margin: 0 }}>Nothing committed to a job right now.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
                <tbody>
                  {reserves.map((r) => (
                    <tr key={r.id}>
                      <td style={{ borderBottom: "1px dashed var(--line)", padding: "4px 8px 4px 0", width: 90, fontFamily: "var(--mono)", fontSize: 11 }}>
                        <Link href={`/work-orders/${r.workOrderId}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{r.woNumber}</Link>
                      </td>
                      <td style={{ borderBottom: "1px dashed var(--line)", padding: "4px 8px 4px 0", fontSize: 11 }}>{r.woTitle.slice(0, 50)}</td>
                      <td style={{ borderBottom: "1px dashed var(--line)", padding: "4px 8px 4px 0", fontSize: 11 }}>{r.qty} {item.unit}</td>
                      <td style={{ borderBottom: "1px dashed var(--line)", padding: "4px 8px 4px 0", fontSize: 10, color: "var(--dim2)" }}>{formatDateTime(r.createdAt, ctx.timezone)}</td>
                      <td style={{ borderBottom: "1px dashed var(--line)", padding: "4px 8px 4px 0" }}>
                        <form action={cancelReservationAction}>
                          <input type="hidden" name="itemId" value={item.id} />
                          <input type="hidden" name="reservationId" value={r.id} />
                          <button type="submit" className="secondary" style={{ fontSize: 9, padding: "2px 8px" }}>RELEASE</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form action={reserveFromItemAction} className="row" style={{ marginTop: 10 }}>
              <input type="hidden" name="itemId" value={item.id} />
              <label style={{ fontSize: 10 }}>reserve {item.unit} for work order</label>
              <select name="workOrderId" defaultValue="" required>
                <option value="">pick an open work order…</option>
                {openWos.map((w) => <option key={w.id} value={w.id}>{w.number} — {w.title.slice(0, 40)} ({w.status})</option>)}
              </select>
              <input name="qty" inputMode="decimal" placeholder="qty" required style={{ maxWidth: 90 }} />
              <button type="submit" className="secondary">RESERVE</button>
            </form>
          </div>

          <div className="card">
            <div className="eyebrow">ISSUE TO A WORK ORDER (MOVES STOCK NOW)</div>
            {Number(item.qtyOnHand) === 0 ? (
              <p className="empty-state" style={{ margin: 0 }}>On hand is zero — receive before issuing.</p>
            ) : (
              <form action={issueFromItemAction} className="row">
                <input type="hidden" name="itemId" value={item.id} />
                <select name="workOrderId" defaultValue="" required>
                  <option value="">pick an open work order…</option>
                  {openWos.map((w) => <option key={w.id} value={w.id}>{w.number} — {w.title.slice(0, 40)} ({w.status})</option>)}
                </select>
                <label style={{ fontSize: 10 }}>qty<input name="qty" inputMode="decimal" required style={{ maxWidth: 90 }} /></label>
                <input name="note" placeholder="note (optional)" style={{ flex: 1, minWidth: 140 }} />
                <button type="submit">ISSUE</button>
              </form>
            )}
          </div>

          <div className="card">
            <div className="eyebrow">CYCLE COUNT ADJUSTMENT</div>
            <form action={adjustAction} className="row">
              <input type="hidden" name="itemId" value={item.id} />
              <label style={{ fontSize: 10 }}>count to<input name="newQty" inputMode="decimal" required style={{ maxWidth: 90 }} /></label>
              <input name="reason" placeholder="reason (required — audited)" required style={{ flex: 1, minWidth: 200 }} />
              <button type="submit" className="secondary">ADJUST</button>
            </form>
            <p style={{ fontSize: 10, color: "var(--dim2)", margin: "8px 0 0" }}>{`Reservations: ${reserves.length} open · reservations are commitments — issuing to the reserved card consumes them oldest-first.`}</p>
          </div>
        </>
      ) : null}
    </>
  );
}
