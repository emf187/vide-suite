"use server";

import { redirect } from "next/navigation";
import { getCtx } from "@/server/ctx";
import { tasksService } from "@/server/services/tasks";

/** Create a task + the agent instantly pushes it to the person's chat. */
export async function createTaskAction(formData: FormData): Promise<never> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");

  const personId = String(formData.get("personId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const instructions = String(formData.get("instructions") ?? "").trim();
  const hours = Number(formData.get("hours") ?? "8");
  const withMedia = formData.get("withMedia") !== null;
  const withSignature = formData.get("withSignature") !== null;

  if (!personId || title.length < 3 || title.length > 120 || !Number.isFinite(hours) || hours <= 0 || hours > 24 * 14) {
    redirect("/today?error=fields");
  }
  if (!withMedia && !withSignature) redirect("/today?error=no_proof");

  try {
    await tasksService.create(ctx, {
      personId,
      title,
      instructions: instructions || undefined,
      withMedia,
      withSignature,
      dueAt: new Date(Date.now() + hours * 60 * 60 * 1000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "person_not_found") redirect("/today?error=fields");
    throw err;
  }
  redirect("/today?ok=1");
}

/** Re-push a task card (the manual nudge — the agent also nudges on cron). */
export async function pushTaskAction(formData: FormData): Promise<never> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");

  const taskId = String(formData.get("taskId") ?? "").trim();
  const task = taskId ? await tasksService.byId(taskId) : null;
  if (!task || task.organizationId !== ctx.orgId || !task.assigneeId) redirect("/today?error=fields");

  const { personsService } = await import("@/server/services/persons");
  const person = await personsService.byId(task.assigneeId);
  if (!person || person.organizationId !== ctx.orgId) redirect("/today?error=fields");

  await tasksService.push(task, person);
  redirect("/today?ok=pushed");
}
