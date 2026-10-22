"use server";

import { redirect } from "next/navigation";
import type { Ctx } from "@/server/ctx";
import { requireCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { machinesService } from "@/server/services/machines";
import { orgMembersService } from "@/server/services/org-members";
import { workOrderService, workOrderWriteService, type WoPriority, type WoType } from "@/server/services/work-orders";

function opt(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value;
}

const TYPES: WoType[] = ["corrective", "preventive", "inspection", "installation"];
const PRIORITIES: WoPriority[] = ["low", "normal", "high", "critical"];

export async function createWorkOrderAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!can(ctx.roles, "wo.plan")) redirect("/work-orders?error=forbidden");
  const title = String(form.get("title") ?? "").trim();
  const typeRaw = String(form.get("type") ?? "corrective");
  const priorityRaw = String(form.get("priority") ?? "normal");
  if (!title) redirect("/work-orders/new?error=fields");
  const type = (TYPES.includes(typeRaw as WoType) ? typeRaw : "corrective") as WoType;
  const priority = (PRIORITIES.includes(priorityRaw as WoPriority) ? priorityRaw : "normal") as WoPriority;

  let woId: string;
  try {
    const wo = await workOrderWriteService.create(ctx, {
      title,
      description: opt(form, "description"),
      machineId: opt(form, "machineId") ?? null,
      type,
      priority,
      templateId: opt(form, "templateId") ?? null,
      assignedTo: opt(form, "assignedTo") ?? null,
      plannedStart: opt(form, "plannedStart") ? new Date(String(form.get("plannedStart"))) : null,
      plannedEnd: opt(form, "plannedEnd") ? new Date(String(form.get("plannedEnd"))) : null,
      source: "manual",
      status: "planned",
    });
    woId = wo.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/work-orders/new?error=${encodeURIComponent(message)}`);
  }
  redirect(`/work-orders/${woId}`);
}

export async function transitionWorkOrderAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const woId = String(form.get("workOrderId") ?? "");
  const to = String(form.get("to") ?? "") as never;
  if (!woId) redirect("/work-orders?error=not_found");
  let wo = null;
  try {
    wo = await workOrderService.byId(ctx, woId);
  } catch {
    wo = null; // e.g. malformed uuid — treat as not found
  }
  if (!wo) redirect("/work-orders?error=not_found");
  try {
    await workOrderWriteService.transition(ctx, woId, to, {
      reason: opt(form, "reason"),
      assignedTo: opt(form, "assignedTo"),
      completedSummary: opt(form, "completedSummary"),
      foundRootCause: opt(form, "foundRootCause"),
      downtimeHours: opt(form, "downtimeHours") ? Number(form.get("downtimeHours")) : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/work-orders/${woId}?error=${encodeURIComponent(message)}`);
  }
  // Optional internal return path (e.g. the planning calendar's day view).
  const back = String(form.get("back") ?? "");
  if (back.startsWith("/") && !back.startsWith("//")) redirect(back);
  redirect(`/work-orders/${woId}?moved=${String(form.get("to"))}`);
}

export async function completeStepAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const woId = String(form.get("workOrderId") ?? "");
  const stepId = String(form.get("stepId") ?? "");
  (!woId || !stepId) && redirect(`/work-orders/?error=not_found`);
  try {
    await workOrderWriteService.completeStep(ctx, woId, stepId, { value: opt(form, "value") });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/work-orders/${woId}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/work-orders/${woId}?step=done`);
}

export async function reopenStepAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const woId = String(form.get("workOrderId") ?? "");
  const stepId = String(form.get("stepId") ?? "");
  (!woId || !stepId) && redirect(`/work-orders/?error=not_found`);
  await workOrderWriteService.reopenStep(ctx, woId, stepId);
  redirect(`/work-orders/${woId}?step=reopened`);
}

export async function logLaborAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const woId = String(form.get("workOrderId") ?? "");
  const minutes = Number(form.get("minutes") ?? 0);
  (!woId ) && redirect(`/work-orders/?error=not_found`);
  try {
    await workOrderWriteService.addLabor(ctx, woId, {
      minutes,
      note: opt(form, "note"),
      userId: opt(form, "userId") ?? ctx.userId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/work-orders/${woId}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/work-orders/${woId}?labor=logged`);
}

/** M3: reserve stock for this card (commitment — availability checked server-side). */
export async function reservePartAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const woId = String(form.get("workOrderId") ?? "");
  const back = (msg: string): never => redirect(`/work-orders/${woId}?error=${encodeURIComponent(msg)}`);
  if (!woId) redirect("/work-orders?error=not_found");
  const itemId = String(form.get("itemId") ?? "");
  const qty = Number(form.get("qty") ?? 0);
  if (!itemId) return back("pick_an_item");
  if (!(qty > 0)) return back("qty_must_be_positive");
  try {
    const { inventoryWriteService } = await import("@/server/services/inventory");
    await inventoryWriteService.reserve(ctx, itemId, woId, { qty });
  } catch (err) {
    back(err instanceof Error ? err.message : String(err));
  }
  redirect(`/work-orders/${woId}?part=reserved`);
}

/** M3: issue stock to this card now (ledger moves + part line + fills reserved promises). */
export async function issuePartAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const woId = String(form.get("workOrderId") ?? "");
  const back = (msg: string): never => redirect(`/work-orders/${woId}?error=${encodeURIComponent(msg)}`);
  if (!woId) redirect("/work-orders?error=not_found");
  const itemId = String(form.get("itemId") ?? "");
  const qty = Number(form.get("qty") ?? 0);
  if (!itemId) return back("pick_an_item");
  if (!(qty > 0)) return back("qty_must_be_positive");
  try {
    const { inventoryWriteService } = await import("@/server/services/inventory");
    await inventoryWriteService.issueToWorkOrder(ctx, itemId, woId, { qty, note: String(form.get("note") ?? "").trim() || null });
  } catch (err) {
    back(err instanceof Error ? err.message : String(err));
  }
  redirect(`/work-orders/${woId}?part=issued`);
}

/** M3: release an open reservation from this card (voids the promise, stock stays put). */
export async function releaseReservationAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const woId = String(form.get("workOrderId") ?? "");
  const back = (msg: string): never => redirect(`/work-orders/${woId}?error=${encodeURIComponent(msg)}`);
  if (!woId) redirect("/work-orders?error=not_found");
  const reservationId = String(form.get("reservationId") ?? "");
  try {
    const { inventoryWriteService } = await import("@/server/services/inventory");
    await inventoryWriteService.cancelReservation(ctx, reservationId);
  } catch (err) {
    back(err instanceof Error ? err.message : String(err));
  }
  redirect(`/work-orders/${woId}?part=released`);
}

export async function updateWorkOrderAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!can(ctx.roles, "wo.plan")) redirect("/work-orders?error=forbidden");
  const woId = String(form.get("workOrderId") ?? "");
  if (!woId) redirect("/work-orders?error=not_found");
  const title = String(form.get("title") ?? "").trim();
  if (!title) redirect(`/work-orders/${woId}/edit?error=fields`);
  const priorityRaw = String(form.get("priority") ?? "normal");
  const priority = (PRIORITIES.includes(priorityRaw as WoPriority) ? priorityRaw : "normal") as WoPriority;
  const ps = opt(form, "plannedStart");
  const pe = opt(form, "plannedEnd");
  try {
    await workOrderWriteService.updateBasic(ctx, woId, {
      title,
      description: opt(form, "description"),
      machineId: opt(form, "machineId") ?? null,
      priority,
      plannedStart: ps ? new Date(ps) : null,
      plannedEnd: pe ? new Date(pe) : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/work-orders/${woId}/edit?error=${encodeURIComponent(message)}`);
  }
  // Land back on the calendar day this card now lives on (planning day view).
  if (ps) {
    const day = ps.slice(0, 10);
    redirect(`/planning?month=${day.slice(0, 7)}&day=${day}&woedit=1`);
  }
  redirect(`/work-orders/${woId}?moved=updated`);
}

export async function addPartLineAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!can(ctx.roles, "wo.execute")) redirect("/work-orders?error=forbidden");
  const woId = String(form.get("workOrderId") ?? "");
  const name = String(form.get("name") ?? "").trim();
  if (!name) redirect(`/work-orders/${woId}?error=part_name`);
  const { getDb } = await import("@/server/db/client");
  const { workOrderParts } = await import("@/server/db/schema");
  const db = await getDb();
  await db.insert(workOrderParts).values({
    organizationId: ctx.orgId,
    workOrderId: woId,
    name,
    qty: String(form.get("qty") ?? "1"),
    note: opt(form, "note") ?? null,
  });
  redirect(`/work-orders/${woId}?part=added`);
}
