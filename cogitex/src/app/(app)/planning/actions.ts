"use server";

import { redirect } from "next/navigation";
import type { Ctx } from "@/server/ctx";
import { requireCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { pmService, schedulesWriteService } from "@/server/services/schedules";

function opt(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value;
}

export async function generatePmAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const dryRun = form.get("dryRun") === "1";
  if (dryRun) {
    const result = await pmService.generate(ctx, { dryRun: true });
    const summary = result.candidates
      .map((c) => `${c.scheduleTitle}${c.machineTag ? ` (${c.machineTag})` : ""}: ${c.basis}`)
      .join(" | ");
    redirect(`/planning?dry=${encodeURIComponent(summary || "nothing due right now")}`);
  }
  try {
    const result = await pmService.generate(ctx, { dryRun: false });
    redirect(`/planning?generated=${result.candidates.length}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/planning?error=${encodeURIComponent(message)}`);
  }
}

export async function createScheduleAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!can(ctx.roles, "wo.plan")) redirect("/planning?error=forbidden");
  const title = String(form.get("title") ?? "").trim();
  const kind = (opt(form, "kind") ?? "calendar") as "calendar" | "runtime" | "condition";
  if (!title) redirect("/planning?error=fields");
  try {
    await schedulesWriteService.create(ctx, {
      title,
      machineId: opt(form, "machineId") ?? null,
      templateId: opt(form, "templateId") ?? null,
      kind,
      intervalDays: opt(form, "intervalDays") ? Number(form.get("intervalDays")) : null,
      runtimeTriggerHours: opt(form, "runtimeTriggerHours") ? Number(form.get("runtimeTriggerHours")) : null,
      conditionMetric: opt(form, "conditionMetric"),
      conditionOp: opt(form, "conditionOp"),
      conditionThreshold: opt(form, "conditionThreshold") ? Number(form.get("conditionThreshold")) : null,
      notes: opt(form, "notes"),
      firstDueAt: opt(form, "firstDueAt") ? new Date(String(form.get("firstDueAt"))) : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/planning?error=${encodeURIComponent(message)}`);
  }
  redirect("/planning?created=schedule");
}

export async function toggleScheduleAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (!can(ctx.roles, "wo.plan")) redirect("/planning?error=forbidden");
  const scheduleId = String(form.get("scheduleId") ?? "");
  const activate = form.get("toggle") === "on";
  try {
    if (activate) await schedulesWriteService.reactivate(ctx, scheduleId);
    else await schedulesWriteService.deactivate(ctx, scheduleId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/planning?error=${encodeURIComponent(message)}`);
  }
  redirect("/planning?updated=schedule");
}
