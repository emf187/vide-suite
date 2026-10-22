"use server";

import { redirect } from "next/navigation";
import { requireCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { inventoryWriteService } from "@/server/services/inventory";
import { nairaToKobo } from "@/lib/money";

function num(form: FormData, key: string): number | undefined {
  const raw = String(form.get(key) ?? "").trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function str(form: FormData, key: string): string | undefined {
  const raw = String(form.get(key) ?? "").trim();
  return raw.length > 0 ? raw : undefined;
}

const UUID = /^[0-9a-f-]{36}$/;

export async function createItemAction(form: FormData): Promise<void> {
  const back = (msg: string): never => redirect(`/inventory?error=${encodeURIComponent(msg)}`);
  const ctx = await requireCtx();
  if (!can(ctx.roles, "inventory.manage")) back("forbidden:inventory.manage");
  const sku = str(form, "sku");
  const name = str(form, "name");
  if (!sku || !name) return back("sku_and_name_required");
  try {
    await inventoryWriteService.createItem(ctx, {
      sku,
      name,
      category: str(form, "category") ?? null,
      unit: str(form, "unit") ?? "pcs",
      qtyOnHand: num(form, "openingQty") ?? 0,
      reorderPoint: num(form, "reorderPoint") ?? 0,
      unitCostKobo: nairaToKobo(num(form, "unitCostNaira") ?? 0),
      locationNote: str(form, "locationNote") ?? null,
      supplierId: str(form, "supplierId") ?? null,
    });
  } catch (err) {
    back(err instanceof Error ? err.message : String(err));
  }
  redirect("/inventory?created=item");
}

export async function createSupplierAction(form: FormData): Promise<void> {
  const back = (msg: string): never => redirect(`/inventory?tab=suppliers&error=${encodeURIComponent(msg)}`);
  const ctx = await requireCtx();
  if (!can(ctx.roles, "inventory.manage")) back("forbidden:inventory.manage");
  const name = str(form, "name");
  if (!name) return back("name_required");
  try {
    await inventoryWriteService.createSupplier(ctx, {
      name,
      email: str(form, "email") ?? null,
      phone: str(form, "phone") ?? null,
      leadTimeDays: num(form, "leadTimeDays") ?? null,
      notes: str(form, "notes") ?? null,
    });
  } catch (err) {
    back(err instanceof Error ? err.message : String(err));
  }
  redirect("/inventory?tab=suppliers&created=supplier");
}

export async function receiveAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const itemId = String(form.get("itemId") ?? "");
  const back = (msg: string): never => redirect(`/inventory/${itemId}?error=${encodeURIComponent(msg)}`);
  if (!UUID.test(itemId)) redirect("/inventory?error=bad_reference");
  const qty = num(form, "qty");
  if (!qty) return back("qty_required");
  try {
    await inventoryWriteService.receive(ctx, itemId, {
      qty,
      unitCostKobo: num(form, "unitCostNaira") !== undefined ? nairaToKobo(num(form, "unitCostNaira") ?? 0) : undefined,
      reference: str(form, "reference") ?? null,
    });
  } catch (err) {
    back(err instanceof Error ? err.message : String(err));
  }
  redirect(`/inventory/${itemId}?moved=received`);
}

export async function issueFromItemAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const itemId = String(form.get("itemId") ?? "");
  const back = (msg: string): never => redirect(`/inventory/${itemId}?error=${encodeURIComponent(msg)}`);
  if (!UUID.test(itemId)) redirect("/inventory?error=bad_reference");
  const qty = num(form, "qty");
  if (!qty) return back("qty_required");
  const woId = String(form.get("workOrderId") ?? "");
  if (!UUID.test(woId)) return back("pick_a_work_order");
  try {
    await inventoryWriteService.issueToWorkOrder(ctx, itemId, woId, { qty, note: str(form, "note") ?? null });
  } catch (err) {
    back(err instanceof Error ? err.message : String(err));
  }
  redirect(`/inventory/${itemId}?moved=issued`);
}

export async function adjustAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const itemId = String(form.get("itemId") ?? "");
  const back = (msg: string): never => redirect(`/inventory/${itemId}?error=${encodeURIComponent(msg)}`);
  if (!UUID.test(itemId)) redirect("/inventory?error=bad_reference");
  const newQty = num(form, "newQty");
  if (newQty === undefined) return back("new_qty_required");
  const reason = str(form, "reason");
  if (!reason) return back("reason_required:adjust");
  try {
    await inventoryWriteService.adjustToCount(ctx, itemId, { newQty, reason });
  } catch (err) {
    back(err instanceof Error ? err.message : String(err));
  }
  redirect(`/inventory/${itemId}?moved=adjusted`);
}

export async function reserveFromItemAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const itemId = String(form.get("itemId") ?? "");
  const back = (msg: string): never => redirect(`/inventory/${itemId}?error=${encodeURIComponent(msg)}`);
  if (!UUID.test(itemId)) redirect("/inventory?error=bad_reference");
  const qty = num(form, "qty");
  if (!qty) return back("qty_required");
  const woId = String(form.get("workOrderId") ?? "");
  if (!UUID.test(woId)) return back("pick_a_work_order");
  try {
    await inventoryWriteService.reserve(ctx, itemId, woId, { qty });
  } catch (err) {
    back(err instanceof Error ? err.message : String(err));
  }
  redirect(`/inventory/${itemId}?moved=reserved`);
}

export async function cancelReservationAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const itemId = String(form.get("itemId") ?? "");
  const back = (msg: string): never => redirect(`/inventory/${itemId}?error=${encodeURIComponent(msg)}`);
  const reservationId = String(form.get("reservationId") ?? "");
  if (!UUID.test(itemId)) redirect("/inventory?error=bad_reference");
  try {
    await inventoryWriteService.cancelReservation(ctx, reservationId);
  } catch (err) {
    back(err instanceof Error ? err.message : String(err));
  }
  redirect(`/inventory/${itemId}?moved=reservation_cancelled`);
}

export async function updateItemAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const itemId = String(form.get("itemId") ?? "");
  const back = (msg: string): never => redirect(`/inventory/${itemId}?error=${encodeURIComponent(msg)}`);
  if (!UUID.test(itemId)) redirect("/inventory?error=bad_reference");
  try {
    await inventoryWriteService.updateItem(ctx, itemId, {
      name: str(form, "name"),
      category: str(form, "category") ?? null,
      unit: str(form, "unit"),
      reorderPoint: num(form, "reorderPoint"),
      unitCostKobo: num(form, "unitCostNaira") !== undefined ? nairaToKobo(num(form, "unitCostNaira") ?? 0) : undefined,
      locationNote: str(form, "locationNote") ?? null,
    });
  } catch (err) {
    back(err instanceof Error ? err.message : String(err));
  }
  redirect(`/inventory/${itemId}?saved=details`);
}
