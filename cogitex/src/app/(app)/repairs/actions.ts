"use server";

import { redirect } from "next/navigation";
import { requireCtx } from "@/server/ctx";
import { repairRequestsWriteService } from "@/server/services/repair-requests";
import type { Urgency } from "@/lib/shared/types";

const BACK = "/repairs";

function fail(message: string): never {
  redirect(`/repairs?error=${encodeURIComponent(message)}`);
}

export async function compileRepairAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const machineId = String(form.get("machineId") ?? "");
  const faultEventId = String(form.get("faultEventId") ?? "");
  const workOrderId = String(form.get("workOrderId") ?? "");
  if (!machineId && !faultEventId && !workOrderId) fail("machine_required");
  try {
    const { requestId } = await repairRequestsWriteService.compile(ctx, {
      machineId: machineId || undefined,
      faultEventId: faultEventId || undefined,
      workOrderId: workOrderId || undefined,
    });
    redirect(`/repairs/${requestId}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function sendRepairAction(form: FormData): Promise<void> {
  const id = String(form.get("repairRequestId") ?? "");
  if (!id) fail("not_found");
  const ctx = await requireCtx();
  const urgency = String(form.get("urgency") ?? "medium");
  const notes = String(form.get("notes") ?? "");
  try {
    await repairRequestsWriteService.send(ctx, id, {
      urgency: (["low", "medium", "high", "critical"].includes(urgency) ? urgency : "medium") as Urgency,
      notes,
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  redirect(`/repairs/${id}?moved=sent`);
}

export async function discardRepairAction(form: FormData): Promise<void> {
  const id = String(form.get("repairRequestId") ?? "");
  if (!id) fail("not_found");
  const ctx = await requireCtx();
  try {
    await repairRequestsWriteService.discard(ctx, id);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  redirect(`${BACK}?moved=discarded`);
}

export async function withdrawRepairAction(form: FormData): Promise<void> {
  const id = String(form.get("repairRequestId") ?? "");
  if (!id) fail("not_found");
  const ctx = await requireCtx();
  try {
    await repairRequestsWriteService.withdraw(ctx, id, String(form.get("reason") ?? ""));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  redirect(`/repairs/${id}?moved=withdrawn`);
}

export async function confirmRepairAction(form: FormData): Promise<void> {
  const id = String(form.get("repairRequestId") ?? "");
  const rating = Number(form.get("rating") ?? 0);
  if (!id) fail("not_found");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail("rating_required_1_to_5");
  const ctx = await requireCtx();
  try {
    await repairRequestsWriteService.confirmAndRate(ctx, id, {
      rating: rating as 1 | 2 | 3 | 4 | 5,
      note: String(form.get("note") ?? ""),
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  redirect(`/repairs/${id}?moved=confirmed`);
}

export async function refreshRepairAction(form: FormData): Promise<void> {
  const id = String(form.get("repairRequestId") ?? "");
  if (!id) fail("not_found");
  const ctx = await requireCtx();
  try {
    await repairRequestsWriteService.refreshStatus(ctx, id);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  redirect(`/repairs/${id}?moved=refreshed`);
}

/** DEMO-ONLY: simulate the marketplace's next webhook (mock profile refuses on real). */
export async function demoAdvanceAction(form: FormData): Promise<void> {
  const id = String(form.get("repairRequestId") ?? "");
  const toStatus = String(form.get("toStatus") ?? "");
  if (!id || !toStatus) fail("missing_params");
  const ctx = await requireCtx();
  try {
    await repairRequestsWriteService.demoAdvance(ctx, id, toStatus as Parameters<typeof repairRequestsWriteService.demoAdvance>[2]);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  redirect(`/repairs/${id}?moved=advanced_${toStatus}`);
}
