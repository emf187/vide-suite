/**
 * The AGENT — Custos acts on its own (brief §7, pulled forward by request):
 *   1) flips past-due work to `overdue` (system actor),
 *   2) re-reminds assignees no more than every 12 h (demo speed), bumping
 *      escalation_level each time,
 *   3) sends each opted-in person a daily summary — at most once per 24 h
 *      (gated on the append-only audit log, never on memory).
 * Runs from /api/cron/agent (Vercel Cron) or a manual call. Every action is
 * audited with actorKind "agent"; iterates ALL orgs — multi-tenant by design.
 */
import { and, eq, gt, lt } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { getDb } from "@/server/db/client";
import { auditEvents, persons, tasks } from "@/server/db/schema";
import { auditRepo } from "@/server/repos/audit";
import { orgsRepo } from "@/server/repos/base";
import { tasksService, dueLabel } from "@/server/services/tasks";
import { getProvider } from "@/server/messaging/provider";

const REMINDER_GAP_MS = 12 * 60 * 60 * 1000; // demo-speed: never nag faster than 12 h
const DIGEST_GAP_MS = 20 * 60 * 60 * 1000; // "daily" with tolerance for drift

export async function runAgentCycle(): Promise<{ overdue: number; reminders: number; digests: number }> {
  const db = (await getDb()) as AppDb;
  const now = new Date();
  const provider = getProvider();
  let overdues = 0;
  let reminders = 0;
  let digests = 0;

  // 1) pending + past due → overdue (system actor, audited per row)
  const late = await db.select().from(tasks).where(and(eq(tasks.status, "pending"), lt(tasks.dueAt, now)));
  for (const task of late) {
    await db.update(tasks).set({ status: "overdue" }).where(eq(tasks.id, task.id));
    await auditRepo.log(db, {
      organizationId: task.organizationId,
      actorKind: "system",
      action: "task.overdue",
      entity: "task",
      entityId: task.id,
      after: { status: "overdue", dueAt: task.dueAt.toISOString() },
    });
    overdues += 1;
  }

  // 2) reminders for overdue work whose assignee is reachable (opted-in)
  const waiting = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "overdue"), lt(tasks.dueAt, now)));
  for (const task of waiting) {
    if (task.lastNotifiedAt && now.getTime() - task.lastNotifiedAt.getTime() < REMINDER_GAP_MS) continue;
    if (!task.assigneeId) continue;
    const rows = await db.select().from(persons).where(eq(persons.id, task.assigneeId)).limit(1);
    const person = rows[0];
    if (!person || person.consentStatus !== "opted_in" || person.deactivatedAt) continue;

    await provider.sendTemplate(person.phoneE164, "task_reminder", {
      title: task.title ?? "A task",
      due: dueLabel(task.dueAt),
    });
    await db
      .update(tasks)
      .set({ lastNotifiedAt: now, escalationLevel: Math.min(task.escalationLevel + 1, 9) })
      .where(eq(tasks.id, task.id));
    await auditRepo.log(db, {
      organizationId: task.organizationId,
      actorKind: "agent",
      action: "agent.reminder",
      entity: "task",
      entityId: task.id,
      after: { to: person.name, level: Math.min(task.escalationLevel + 1, 9) },
    });
    reminders += 1;
  }

  // 3) daily digest — once per person per ~24 h, gated on the audit trail
  const optedIn = await db.select().from(persons).where(eq(persons.consentStatus, "opted_in"));
  for (const person of optedIn) {
    if (person.deactivatedAt) continue;
    const recent = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, person.organizationId),
          eq(auditEvents.actorPersonId, person.id),
          eq(auditEvents.action, "agent.digest"),
          gt(auditEvents.at, new Date(now.getTime() - DIGEST_GAP_MS)),
        ),
      )
      .limit(1);
    if (recent.length > 0) continue;

    const open = await tasksService.listOpen(person.id);
    const org = await orgsRepo.byId(db, person.organizationId);
    await provider.sendTemplate(person.phoneE164, "daily_task_summary", {
      name: person.name,
      count: String(open.length),
      business: org?.name ?? "your business",
    });
    await auditRepo.log(db, {
      organizationId: person.organizationId,
      actorKind: "agent",
      actorPersonId: person.id,
      action: "agent.digest",
      entity: "person",
      entityId: person.id,
      after: { openTasks: open.length },
    });
    digests += 1;
  }

  return { overdue: overdues, reminders, digests };
}
