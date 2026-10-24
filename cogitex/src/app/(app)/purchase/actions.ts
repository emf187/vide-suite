"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/ctx";
import { can } from "@/server/policies";

/**
 * DEMO purchase module actions (sprint item 4). Writes are gated on
 * settings.manage (owner/admin) — a purchase is an owner-level event.
 * Every action follows the redirect-outside-the-catch rule: service calls
 * throw plain Errors; next/navigation redirect is never caught by a broad
 * try/catch (it would self-cancel the destination).
 */

async function requirePurchaser(purchaseId: string): Promise<void> {
  const ctx = await requireCtx();
  if (!can(ctx.roles, "settings.manage")) redirect(`/purchase/${purchaseId}?error=forbidden`);
}

export async function startPurchaseAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!can(ctx.roles, "settings.manage")) redirect("/purchase?error=forbidden");
  const planKey = String(form.get("planKey") ?? "");
  const { purchasesService } = await import("@/server/services/purchase");
  let started: Awaited<ReturnType<typeof purchasesService.start>>;
  try {
    started = await purchasesService.start(ctx, planKey, ctx.email);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/purchase?error=${encodeURIComponent(message)}`);
  }
  if (started.error) redirect(`/purchase?error=${encodeURIComponent(started.error)}`);
  revalidatePath("/purchase");
  // paystack_test sends the browser to the provider's TEST checkout; demo
  // channel routes to the built-in fake checkout page.
  if (started.checkoutUrl && /^https?:\/\//.test(started.checkoutUrl)) redirect(started.checkoutUrl);
  redirect(started.checkoutUrl ?? `/purchase/${started.purchase.id}`);
}

export async function confirmDemoPaymentAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const purchaseId = String(form.get("purchaseId") ?? "");
  if (!can(ctx.roles, "settings.manage")) redirect(`/purchase/${purchaseId}?error=forbidden`);
  const { purchasesService } = await import("@/server/services/purchase");
  let message = "";
  let ok = false;
  try {
    await purchasesService.confirmDemo(ctx, purchaseId);
    ok = true;
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  revalidatePath("/purchase");
  revalidatePath(`/purchase/${purchaseId}`);
  if (ok) redirect(`/purchase/${purchaseId}?paid=1`);
  redirect(`/purchase/${purchaseId}?error=${encodeURIComponent(message)}`);
}

export async function declineDemoPaymentAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const purchaseId = String(form.get("purchaseId") ?? "");
  if (!can(ctx.roles, "settings.manage")) redirect(`/purchase/${purchaseId}?error=forbidden`);
  const { purchasesService } = await import("@/server/services/purchase");
  let message = "";
  let ok = false;
  try {
    await purchasesService.failDemo(ctx, purchaseId);
    ok = true;
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  revalidatePath("/purchase");
  revalidatePath(`/purchase/${purchaseId}`);
  if (ok) redirect(`/purchase/${purchaseId}?failed=1`);
  redirect(`/purchase/${purchaseId}?error=${encodeURIComponent(message)}`);
}

export async function abandonPurchaseAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const purchaseId = String(form.get("purchaseId") ?? "");
  if (!can(ctx.roles, "settings.manage")) redirect(`/purchase/${purchaseId}?error=forbidden`);
  const { purchasesService } = await import("@/server/services/purchase");
  let message = "";
  let ok = false;
  try {
    await purchasesService.abandon(ctx, purchaseId);
    ok = true;
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  revalidatePath("/purchase");
  revalidatePath(`/purchase/${purchaseId}`);
  if (ok) redirect(`/purchase/${purchaseId}?abandoned=1`);
  redirect(`/purchase/${purchaseId}?error=${encodeURIComponent(message)}`);
}

/** TEST-key flow: pull the row's truth from Paystack's verify endpoint. */
export async function checkPaymentAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const purchaseId = String(form.get("purchaseId") ?? "");
  if (!can(ctx.roles, "settings.manage")) redirect(`/purchase/${purchaseId}?error=forbidden`);
  const { purchasesService } = await import("@/server/services/purchase");
  let result: "success" | "abandoned" | "failed" | "error";
  let error = "";
  try {
    const checked = await purchasesService.check(ctx, purchaseId);
    result = checked.result ?? "error";
    error = checked.error ?? "";
  } catch (err) {
    result = "error";
    error = err instanceof Error ? err.message : String(err);
  }
  revalidatePath("/purchase");
  revalidatePath(`/purchase/${purchaseId}`);
  if (result === "success") redirect(`/purchase/${purchaseId}?paid=1`);
  if (result === "abandoned") redirect(`/purchase/${purchaseId}?abandoned=1`);
  if (result === "failed") redirect(`/purchase/${purchaseId}?failed=1`);
  redirect(`/purchase/${purchaseId}?error=${encodeURIComponent(error || "check_failed")}`);
}
