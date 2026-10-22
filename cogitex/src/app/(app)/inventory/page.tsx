import Link from "next/link";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { inventoryService } from "@/server/services/inventory";
import { formatKobo } from "@/lib/money";
import { createItemAction, createSupplierAction } from "./actions";

export const metadata = { title: "Inventory" };

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; low?: string; tab?: string; error?: string; created?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const sp = await searchParams;
  const canManage = can(ctx.roles, "inventory.manage");

  const [items, suppliers] = await Promise.all([
    inventoryService.list(ctx, { q: sp.q, lowOnly: sp.low === "1" }),
    inventoryService.suppliers(ctx),
  ]);
  const lowItems = items.filter((i) => Number(i.qtyOnHand) <= Number(i.reorderPoint));

  const openWoUrlForReserved = (id: string) => `/inventory/${id}`;

  return (
    <>
      <h1>Inventory</h1>
      <p className="lead">
        Spares and consumables with an append-only {`stock ledger`} — every unit on hand is explained by a receipt,
         {` an issue to a work order, or a counted adjustment.`}
      </p>

      {sp.created ? <div className="card"><span className="ok-text">Saved.</span></div> : null}
      {sp.error ? (
        <div className="card"><div className="eyebrow">NOT SAVED</div><span className="error-text">{decodeURIComponent(sp.error)}</span></div>
      ) : null}

      <div className="card">
        <div className="eyebrow">
          {`STOCK ITEMS / ${items.length}${lowItems.length > 0 ? ` — ${lowItems.length} AT/BELOW REORDER` : ""}`}
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <form action="/inventory" method="GET" className="row" style={{ gap: 6 }}>
            <input name="q" defaultValue={sp.q ?? ""} placeholder="search name or SKU" style={{ maxWidth: 220 }} />
            <input type="hidden" name="low" value={sp.low ?? ""} />
            <button type="submit" className="secondary">SEARCH</button>
          </form>
          <div className="row" style={{ gap: 6 }}>
            <Link href={sp.low === "1" ? "/inventory" : "/inventory?low=1"} style={{ fontSize: 10, color: "var(--accent)", textDecoration: "none" }}>
              {sp.low === "1" ? "SHOW ALL" : "LOW STOCK ONLY"}
            </Link>
            <Link href="/inventory?tab=suppliers" style={{ fontSize: 10, color: "var(--dim2)", textDecoration: "none" }}>SUPPLIERS</Link>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="empty-state">No items yet — add the first spare below (open the store often: bearings, seals, filters).</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
            <thead>
              <tr>
                {["SKU", "NAME", "CATEGORY", "ON HAND", "REORDER", "UNIT COST", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: 9, letterSpacing: 1.5, color: "var(--dim2)", borderBottom: "2px solid var(--line)", padding: "6px 8px 6px 0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const low = Number(it.qtyOnHand) <= Number(it.reorderPoint);
                return (
                  <tr key={it.id}>
                    <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", fontFamily: "var(--mono)", fontSize: 11 }}>{it.sku}</td>
                    <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0" }}>{it.name} {!it.active ? <span style={{ color: "var(--dim2)", fontSize: 10 }}>· inactive</span> : null}</td>
                    <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", fontSize: 11 }}>{it.category ?? "—"}</td>
                    <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", fontSize: 11, color: low ? "var(--danger)" : undefined }}>
                      {it.qtyOnHand} {it.unit}{low ? " ⚠ LOW" : ""}
                    </td>
                    <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", fontSize: 11 }}>{it.reorderPoint}</td>
                    <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0", fontSize: 11 }}>{formatKobo(it.unitCostKobo, ctx.currency)}</td>
                    <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0" }}>
                      <Link href={openWoUrlForReserved(it.id)} style={{ color: "var(--accent)", fontSize: 10, textDecoration: "none" }}>OPEN →</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* suppliers live on a light tab for this milestone */}
      <div className="card" id="suppliers">
        <div className="eyebrow">{`SUPPLIERS / ${suppliers.length}`}</div>
        {suppliers.length === 0 ? (
          <p className="empty-state" style={{ margin: 0 }}>No suppliers recorded — useful for lead times and the M5 marketplace compile.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "4px 8px 4px 0", width: "30%" }}>{s.name}</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "4px 8px 4px 0", fontSize: 11 }}>{s.email ?? s.phone ?? "—"}</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "4px 8px 4px 0", fontSize: 11 }}>lead {s.leadTimeDays ?? "—"}d</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "4px 8px 4px 0", fontSize: 10, color: "var(--dim2)" }}>{s.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canManage ? (
        <>
          <form action={createItemAction} className="card">
            <div className="eyebrow">ADD STOCK ITEM</div>
            <div className="row">
              <input name="sku" placeholder="SKU — e.g. BRG-6205-2RS" required style={{ maxWidth: 180 }} />
              <input name="name" placeholder="Item name" required style={{ flex: 1, minWidth: 200 }} />
              <input name="category" placeholder="category (bearings, seals…)" style={{ maxWidth: 170 }} />
              <input name="unit" placeholder="unit (pcs, L…)" defaultValue="pcs" style={{ maxWidth: 90 }} />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <label style={{ fontSize: 10 }}>opening qty<input name="openingQty" inputMode="decimal" defaultValue="0" style={{ maxWidth: 90 }} /></label>
              <label style={{ fontSize: 10 }}>reorder at<input name="reorderPoint" inputMode="decimal" defaultValue="0" style={{ maxWidth: 90 }} /></label>
              <label style={{ fontSize: 10 }}>unit cost ₦<input name="unitCostNaira" inputMode="decimal" defaultValue="0" style={{ maxWidth: 110 }} /></label>
              <input name="locationNote" placeholder="store location (shelf/bay)" style={{ maxWidth: 200 }} />
              <select name="supplierId" defaultValue="">
                <option value="">no supplier</option>
                {suppliers.map((sup) => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
              </select>
              <button type="submit">ADD ITEM</button>
            </div>
          </form>

          <form action={createSupplierAction} className="card" id="add-supplier">
            <div className="eyebrow">ADD SUPPLIER</div>
            <div className="row">
              <input name="name" placeholder="Supplier name" required style={{ flex: 1, minWidth: 180 }} />
              <input name="email" placeholder="email" type="email" style={{ maxWidth: 200 }} />
              <input name="phone" placeholder="phone" style={{ maxWidth: 150 }} />
              <input name="leadTimeDays" placeholder="lead days" inputMode="numeric" style={{ maxWidth: 110 }} />
              <input name="notes" placeholder="notes" style={{ flex: 1, minWidth: 140 }} />
              <button type="submit" className="secondary">ADD SUPPLIER</button>
            </div>
          </form>
        </>
      ) : null}
    </>
  );
}
