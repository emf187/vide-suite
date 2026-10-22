"use server";

import { redirect } from "next/navigation";
import { requireCtx } from "@/server/ctx";
import { faultsWriteService } from "@/server/services/faults";

export async function acknowledgeFaultAction(form: FormData): Promise<void> {
  const id = String(form.get("faultId") ?? "");
  const back = `/faults?error=${encodeURIComponent("not_found")}`;
  if (!id) redirect(back);
  const ctx = await requireCtx();
  try {
    await faultsWriteService.acknowledge(ctx, id);
  } catch (err) {
    redirect(`/faults?error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
  redirect("/faults?moved=acknowledged");
}

export async function dismissFaultAction(form: FormData): Promise<void> {
  const id = String(form.get("faultId") ?? "");
  const back = `/faults?error=${encodeURIComponent("not_found")}`;
  if (!id) redirect(back);
  const ctx = await requireCtx();
  try {
    await faultsWriteService.dismiss(ctx, id);
  } catch (err) {
    redirect(`/faults?error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
  redirect("/faults?moved=dismissed");
}

export async function convertFaultAction(form: FormData): Promise<void> {
  const id = String(form.get("faultId") ?? "");
  if (!id) redirect(`/faults?error=${encodeURIComponent("not_found")}`);
  const ctx = await requireCtx();
  let woId: string | undefined;
  try {
    const res = await faultsWriteService.convertToWorkOrder(ctx, id);
    woId = res.woId;
  } catch (err) {
    redirect(`/faults?error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
  redirect(`/work-orders/${woId}?moved=from_fault`);
}
