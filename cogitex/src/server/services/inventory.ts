import { and, asc, desc, eq, inArray, sql as dsql } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb } from "@/server/db/client";
import {
  inventoryItems,
  inventoryReservations,
  machineParts,
  suppliers,
  stockLedger,
  workOrderParts,
  workOrders,
} from "@/server/db/schema";
import { can } from "@/server/policies";
import { auditRepo } from "@/server/repos/audit";
import type { AppDb } from "@/server/db/client";

const LEDGER_KINDS = ["receipt", "issue", "adjust", "return"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/* ------------------------------------------------------------------ */
/* stores                                                              */
/* ------------------------------------------------------------------ */

export const inventoryService = {
  async list(ctx: Ctx, opts: { q?: string; lowOnly?: boolean; includeInactive?: boolean } = {}) {
    const db = await getDb();
    const conds = [eq(inventoryItems.organizationId, ctx.orgId)];
    if (!opts.includeInactive) conds.push(eq(inventoryItems.active, true));
    if (opts.q) {
      const needle = `%${opts.q}%`;
      conds.push(dsql`(lower(${inventoryItems.name}) like lower(${needle}) or lower(${inventoryItems.sku}) like lower(${needle}))`);
    }
    const rows = await db
      .select()
      .from(inventoryItems)
      .where(and(...conds))
      .orderBy(asc(inventoryItems.name));
    if (opts.lowOnly) return rows.filter((r) => Number(r.qtyOnHand) <= Number(r.reorderPoint));
    return rows;
  },

  /** low-stock count for the Today card (cheap aggregate) */
  async lowStockCount(ctx: Ctx): Promise<number> {
    const db = await getDb();
    const rows = await db
      .select({ n: dsql<number>`count(*)::int` })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.organizationId, ctx.orgId),
          eq(inventoryItems.active, true),
          dsql`${inventoryItems.qtyOnHand} <= ${inventoryItems.reorderPoint}`,
        ),
      );
      return rows[0]?.n ?? 0;
  },

  async byId(ctx: Ctx, id: string) {
    const db = await getDb();
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const rows = await db
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.organizationId, ctx.orgId), eq(inventoryItems.id, id)))
      .limit(1);
    return rows[0] ?? null;
  },

  async ledger(ctx: Ctx, itemId: string, limit = 60) {
    const db = await getDb();
    return db
      .select()
      .from(stockLedger)
      .where(and(eq(stockLedger.organizationId, ctx.orgId), eq(stockLedger.itemId, itemId)))
      .orderBy(desc(stockLedger.createdAt))
      .limit(limit);
  },

  /** availability = on-hand âˆ’ Î£ open reservations */
  async availability(ctx: Ctx, itemId: string): Promise<{ onHand: number; reserved: number; available: number }> {
    const db = await getDb();
    const open = await db
      .select({ x: dsql<string>`coalesce(sum(${inventoryReservations.qty}), 0)` })
      .from(inventoryReservations)
      .where(
        and(
          eq(inventoryReservations.organizationId, ctx.orgId),
          eq(inventoryReservations.itemId, itemId),
          eq(inventoryReservations.status, "open"),
        ),
      );
    const item = await inventoryService.byId(ctx, itemId);
    const onHand = Number(item?.qtyOnHand ?? 0);
    const reserved = Number(open[0]?.x ?? 0);
    return { onHand, reserved, available: onHand - reserved };
  },

  /** open reservations on a work order (prefetched in WO detail) */
  async reservationsForWorkOrder(ctx: Ctx, woId: string) {
    const db = await getDb();
    if (!/^[0-9a-f-]{36}$/.test(woId)) return [];
    return db
      .select({
        id: inventoryReservations.id,
        workOrderId: inventoryReservations.workOrderId,
        itemId: inventoryReservations.itemId,
        qty: inventoryReservations.qty,
        status: inventoryReservations.status,
        createdAt: inventoryReservations.createdAt,
        itemSku: inventoryItems.sku,
        itemName: inventoryItems.name,
      })
      .from(inventoryReservations)
      .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryReservations.itemId))
      .where(and(eq(inventoryReservations.organizationId, ctx.orgId), eq(inventoryReservations.workOrderId, woId), eq(inventoryReservations.status, "open")))
      .orderBy(asc(inventoryReservations.createdAt));
  },

  /** open reservations on a stock item (stock-item page) */
  async reservationsForItem(ctx: Ctx, itemId: string) {
    const db = await getDb();
    if (!/^[0-9a-f-]{36}$/.test(itemId)) return [];
    return db
      .select({
        id: inventoryReservations.id,
        workOrderId: inventoryReservations.workOrderId,
        qty: inventoryReservations.qty,
        createdAt: inventoryReservations.createdAt,
        woNumber: workOrders.number,
        woTitle: workOrders.title,
      })
      .from(inventoryReservations)
      .innerJoin(workOrders, eq(workOrders.id, inventoryReservations.workOrderId))
      .where(and(eq(inventoryReservations.organizationId, ctx.orgId), eq(inventoryReservations.itemId, itemId), eq(inventoryReservations.status, "open")))
      .orderBy(asc(inventoryReservations.createdAt));
  },

  /** issued part lines on a work order */
  async partsForWorkOrder(ctx: Ctx, woId: string) {
    const db = await getDb();
    if (!/^[0-9a-f-]{36}$/.test(woId)) return [];
    return db
      .select()
      .from(workOrderParts)
      .where(and(eq(workOrderParts.organizationId, ctx.orgId), eq(workOrderParts.workOrderId, woId)))
      .orderBy(asc(workOrderParts.qty));
  },

  async suppliers(ctx: Ctx) {
    const db = await getDb();
    return db.select().from(suppliers).where(eq(suppliers.organizationId, ctx.orgId)).orderBy(asc(suppliers.name));
  },

  /** spare parts that fit a machine (used in WO parts pickers) */
  async partsForMachine(ctx: Ctx, machineId: string) {
    const db = await getDb();
    if (!/^[0-9a-f-]{36}$/.test(machineId)) return [];
    return db
      .select({
        id: inventoryItems.id,
        sku: inventoryItems.sku,
        name: inventoryItems.name,
        unit: inventoryItems.unit,
        qtyOnHand: inventoryItems.qtyOnHand,
      })
      .from(machineParts)
      .innerJoin(inventoryItems, eq(inventoryItems.id, machineParts.inventoryItemId))
      .where(and(eq(machineParts.organizationId, ctx.orgId), eq(machineParts.machineId, machineId)))
      .orderBy(asc(inventoryItems.name));
  },
};

export const inventoryWriteService = {
  /* ------------------------------------------------ item + supplier CRUD */
  async createItem(ctx: Ctx, input: {
    sku: string; name: string; category?: string | null; unit?: string;
    qtyOnHand?: number; reorderPoint?: number; unitCostKobo?: number;
    locationNote?: string | null; supplierId?: string | null;
  }) {
    if (!can(ctx.roles, "inventory.manage")) throw new Error("forbidden:inventory.manage");
    const db = await getDb();
    const sku = input.sku.trim();
    const name = input.name.trim();
    if (!sku) throw new Error("sku_required");
    if (!name) throw new Error("name_required");
    const dup = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.organizationId, ctx.orgId), eq(inventoryItems.sku, sku)))
      .limit(1);
    if (dup[0]) throw new Error("sku_taken");

    const qty = Math.max(0, input.qtyOnHand ?? 0);
    const rows = await db.insert(inventoryItems).values({
      organizationId: ctx.orgId,
      sku,
      name,
      category: input.category?.trim() || null,
      unit: input.unit?.trim() || "pcs",
      qtyOnHand: String(qty),
      reorderPoint: String(Math.max(0, input.reorderPoint ?? 0)),
      unitCostKobo: Math.max(0, Math.round(input.unitCostKobo ?? 0)),
      locationNote: input.locationNote?.trim() || null,
      supplierId: input.supplierId || null,
    }).returning();
    const item = rows[0];
    if (!item) throw new Error("item_insert_failed");

    if (qty > 0) {
      // opening stock booked as a receipt so the ledger explains every unit on hand
      await appendLedger(db, ctx, item.id, "receipt", qty, item.unitCostKobo, "opening stock");
    }
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "inventory.item.created",
      entityType: "inventory_item",
      entityId: item.id,
      diff: { sku, name },
    });
    return item;
  },

  async updateItem(ctx: Ctx, id: string, patch: {
    name?: string; category?: string | null; unit?: string; reorderPoint?: number;
    unitCostKobo?: number; locationNote?: string | null; supplierId?: string | null; active?: boolean;
  }) {
    if (!can(ctx.roles, "inventory.manage")) throw new Error("forbidden:inventory.manage");
    const db = await getDb();
    const item = await inventoryService.byId(ctx, id);
    if (!item) throw new Error("item_not_found");
    const rows = await db.update(inventoryItems).set({
      name: patch.name?.trim() || item.name,
      category: patch.category === undefined ? item.category : patch.category?.trim() || null,
      unit: patch.unit?.trim() || item.unit,
      reorderPoint: patch.reorderPoint !== undefined ? String(Math.max(0, patch.reorderPoint)) : item.reorderPoint,
      unitCostKobo: patch.unitCostKobo !== undefined ? Math.max(0, Math.round(patch.unitCostKobo)) : item.unitCostKobo,
      locationNote: patch.locationNote === undefined ? item.locationNote : patch.locationNote?.trim() || null,
      supplierId: patch.supplierId === undefined ? item.supplierId : patch.supplierId || null,
      active: patch.active ?? item.active,
      updatedAt: new Date(),
    }).where(eq(inventoryItems.id, id)).returning();
    const updated = rows[0];
    if (!updated) throw new Error("item_update_failed");
    return updated;
  },

  async createSupplier(ctx: Ctx, input: { name: string; email?: string | null; phone?: string | null; leadTimeDays?: number | null; notes?: string | null }) {
    if (!can(ctx.roles, "inventory.manage")) throw new Error("forbidden:inventory.manage");
    const db = await getDb();
    const name = input.name.trim();
    if (!name) throw new Error("name_required");
    const rows = await db.insert(suppliers).values({
      organizationId: ctx.orgId,
      name,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      leadTimeDays: input.leadTimeDays ?? null,
      notes: input.notes?.trim() || null,
    }).returning();
    const supplier = rows[0];
    if (!supplier) throw new Error("supplier_insert_failed");
    return supplier;
  },

  /* ------------------------------------------------- ledger movements */
  async receive(ctx: Ctx, itemId: string, opts: { qty: number; unitCostKobo?: number; reference?: string | null }) {
    if (!can(ctx.roles, "wo.execute")) throw new Error("forbidden:wo.execute");
    const db = await getDb();
    const item = await inventoryService.byId(ctx, itemId);
    if (!item) throw new Error("item_not_found");
    const qty = Number(opts.qty);
    if (!(qty > 0)) throw new Error("qty_must_be_positive");
    const cost = opts.unitCostKobo !== undefined ? Math.max(0, Math.round(opts.unitCostKobo)) : item.unitCostKobo;
    const newBalance = Number(item.qtyOnHand) + qty;
    await db.update(inventoryItems).set({ qtyOnHand: String(newBalance), unitCostKobo: cost, updatedAt: new Date() }).where(eq(inventoryItems.id, item.id));
    const row = await appendLedger(db, ctx, item.id, "receipt", qty, cost, opts.reference ?? null, newBalance);
    return row;
  },

  /** issue from stock to a work order â€” ledger + card part line + closes matching reservation */
  async issueToWorkOrder(ctx: Ctx, itemId: string, woId: string, opts: { qty: number; note?: string | null }) {
    if (!can(ctx.roles, "wo.execute")) throw new Error("forbidden:wo.execute");
    const db = await getDb();
    const item = await inventoryService.byId(ctx, itemId);
    if (!item) throw new Error("item_not_found");
    if (!/^[0-9a-f-]{36}$/.test(woId)) throw new Error("wo_not_found");
    const qty = Number(opts.qty);
    if (!(qty > 0)) throw new Error("qty_must_be_positive");
    if (Number(item.qtyOnHand) < qty) throw new Error(`insufficient_stock:${item.qtyOnHand}`);

    const newBalance = Number(item.qtyOnHand) - qty;
    await db.update(inventoryItems).set({ qtyOnHand: String(newBalance), updatedAt: new Date() }).where(eq(inventoryItems.id, item.id));
    const row = await appendLedger(db, ctx, item.id, "issue", -qty, item.unitCostKobo, opts.note ?? null, newBalance, woId);

    await db.insert(workOrderParts).values({
      organizationId: ctx.orgId,
      workOrderId: woId,
      inventoryItemId: item.id,
      name: `${item.sku} â€” ${item.name}`,
      qty: String(qty),
      unitCostKobo: item.unitCostKobo,
      issuedAt: new Date(),
      issuedBy: ctx.userId,
      note: opts.note?.trim() || null,
    });

    // fulfill open reservations for this (item, wo) pair, oldest first, up to the issued qty
    let remaining = qty;
    const open = await db
      .select()
      .from(inventoryReservations)
      .where(
        and(
          eq(inventoryReservations.organizationId, ctx.orgId),
          eq(inventoryReservations.itemId, item.id),
          eq(inventoryReservations.workOrderId, woId),
          eq(inventoryReservations.status, "open"),
        ),
      )
      .orderBy(asc(inventoryReservations.createdAt));
    for (const r of open) {
      if (remaining <= 0) break;
      const need = Number(r.qty);
      if (need <= remaining) {
        await db.update(inventoryReservations).set({ status: "issued", updatedAt: new Date() }).where(eq(inventoryReservations.id, r.id));
        remaining -= need;
      }
      // partial fulfillment keeps the reservation open until fully consumed
    }
    return row;
  },

  /** adjust physical count to `newQty` (delta-ledger row with a reason) */
  async adjustToCount(ctx: Ctx, itemId: string, opts: { newQty: number; reason?: string }) {
    if (!can(ctx.roles, "wo.execute")) throw new Error("forbidden:wo.execute");
    const db = await getDb();
    const item = await inventoryService.byId(ctx, itemId);
    if (!item) throw new Error("item_not_found");
    const newQty = Number(opts.newQty);
    if (!Number.isFinite(newQty) || newQty < 0) throw new Error("new_qty_invalid");
    if (!(opts.reason ?? "").trim()) throw new Error("reason_required:adjust");
    const delta = newQty - Number(item.qtyOnHand);
    if (delta === 0) throw new Error("no_change");
    await db.update(inventoryItems).set({ qtyOnHand: String(newQty), updatedAt: new Date() }).where(eq(inventoryItems.id, item.id));
    return appendLedger(db, ctx, item.id, "adjust", delta, 0, `count adjust: ${opts.reason ?? ""}`.trim(), newQty);
  },

  /* --------------------------------------------------------- reservations */
  async reserve(ctx: Ctx, itemId: string, woId: string, opts: { qty: number }) {
    if (!can(ctx.roles, "wo.execute")) throw new Error("forbidden:wo.execute");
    const db = await getDb();
    const item = await inventoryService.byId(ctx, itemId);
    if (!item) throw new Error("item_not_found");
    if (!/^[0-9a-f-]{36}$/.test(woId)) throw new Error("wo_not_found");
    const qty = Number(opts.qty);
    if (!(qty > 0)) throw new Error("qty_must_be_positive");
    const avail = await inventoryService.availability(ctx, itemId);
    if (avail.available < qty) throw new Error(`insufficient_available:${avail.available}`);
    const rows = await db.insert(inventoryReservations).values({
      organizationId: ctx.orgId,
      itemId,
      workOrderId: woId,
      qty: String(qty),
      createdBy: ctx.userId,
    }).returning();
    const reservation = rows[0];
    if (!reservation) throw new Error("reservation_insert_failed");
    return reservation;
  },

  async cancelReservation(ctx: Ctx, reservationId: string) {
    if (!can(ctx.roles, "wo.execute")) throw new Error("forbidden:wo.execute");
    const db = await getDb();
    if (!/^[0-9a-f-]{36}$/.test(reservationId)) throw new Error("reservation_not_found");
    const rows = await db
      .update(inventoryReservations)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(inventoryReservations.organizationId, ctx.orgId), eq(inventoryReservations.id, reservationId), eq(inventoryReservations.status, "open")))
      .returning();
    if (!rows[0]) throw new Error("reservation_not_found");
    return rows[0];
  },

  /**
   * Called when a work order concludes (completed / verified / closed / cancelled):
   * outstanding promises are voided â€” parts that never got issued go back to "available".
   */
  async releaseOpenReservationsForWorkOrder(db: AppDb, ctx: Ctx, woId: string): Promise<number> {
    const rows = await db
      .update(inventoryReservations)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(inventoryReservations.organizationId, ctx.orgId),
          eq(inventoryReservations.workOrderId, woId),
          eq(inventoryReservations.status, "open"),
        ),
      )
      .returning();
    return rows.length;
  },

  /** link a spare to a machine so WO pickers can shortlist compatible parts */
  async linkMachinePart(ctx: Ctx, machineId: string, itemId: string) {
    if (!can(ctx.roles, "inventory.manage")) throw new Error("forbidden:inventory.manage");
    const db = await getDb();
    if (!/^[0-9a-f-]{36}$/.test(machineId) || !/^[0-9a-f-]{36}$/.test(itemId)) throw new Error("bad_reference");
    await db.insert(machineParts).values({ organizationId: ctx.orgId, machineId, inventoryItemId: itemId, createdBy: ctx.userId }).onConflictDoNothing();
  },
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

async function appendLedger(
  db: AppDb,
  ctx: Ctx,
  itemId: string,
  kind: LedgerKind,
  qty: number,
  unitCostKobo: number,
  reference: string | null,
  balanceAfter?: number,
  workOrderId?: string | null,
) {
  let balance = balanceAfter;
  if (balance === undefined) {
    const rows = await db.select({ h: inventoryItems.qtyOnHand }).from(inventoryItems).where(eq(inventoryItems.id, itemId)).limit(1);
    balance = Number(rows[0]?.h ?? 0);
  }
  const inserted = await db.insert(stockLedger).values({
    organizationId: ctx.orgId,
    itemId,
    kind,
    qty: String(qty),
    unitCostKobo,
    balanceAfter: String(balance),
    reference,
    workOrderId: workOrderId ?? null,
    createdBy: ctx.userId,
  }).returning();
  return inserted[0];
}

/** cost of issued parts on a work order â€” from the immutable part lines (kobo) */
export async function partsCostKobo(ctx: Ctx, woId: string): Promise<number> {
  const db = await getDb();
  if (!/^[0-9a-f-]{36}$/.test(woId)) return 0;
  const rows = await db
    .select({ qty: workOrderParts.qty, cost: workOrderParts.unitCostKobo })
    .from(workOrderParts)
    .where(and(eq(workOrderParts.organizationId, ctx.orgId), eq(workOrderParts.workOrderId, woId)));
  return rows.reduce((s, r) => s + Math.round(Number(r.qty) * r.cost), 0);
}

export async function itemsByIds(ctx: Ctx, ids: string[]) {
  if (ids.length === 0) return [];
  const db = await getDb();
  return db.select().from(inventoryItems).where(and(eq(inventoryItems.organizationId, ctx.orgId), inArray(inventoryItems.id, ids)));
}
