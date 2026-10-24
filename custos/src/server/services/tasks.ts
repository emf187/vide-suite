/**
 * The task loop: a supervisor creates a task on the dashboard, the agent
 * IMMEDIATELY pushes it to the person's WhatsApp, the person supplies proof —
 * any media (photo/video/audio/PDF), then a typed full-name signature — and
 * everything lands back on the heads' dashboard as a proof trail.
 * Every business table stays org-scoped; every transition hits the audit.
 */
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { getDb } from "@/server/db/client";
import { evidence, persons, tasks, type Person, type Task } from "@/server/db/schema";
import type { Ctx } from "@/server/ctx";
import { auditRepo } from "@/server/repos/audit";
import { BOT_BUTTONS, BOT_MESSAGES } from "@/lib/bot/messages";
import { dispatchReply } from "@/server/messaging/dispatch";
import { getProvider } from "@/server/messaging/provider";
import type { BotReply } from "@/server/messaging/types";

export type CreateTaskInput = {
  personId: string;
  title: string;
  instructions?: string;
  withMedia: boolean;
  withSignature: boolean;
  dueAt?: Date;
};

/** Africa/Lagos = UTC+1, no DST (brief §7). */
export function dueLabel(due: Date): string {
  const lagos = new Date(due.getTime() + 60 * 60 * 1000);
  const nowLagos = new Date(Date.now() + 60 * 60 * 1000);
  const time = lagos.toISOString().slice(11, 16);
  return lagos.toISOString().slice(0, 10) === nowLagos.toISOString().slice(0, 10)
    ? `today ${time}`
    : `${lagos.toISOString().slice(0, 10)} ${time}`;
}

const OPEN_STATUSES = ["pending", "overdue"] as const;

export const tasksService = {
  async byId(taskId: string): Promise<Task | null> {
    const db = (await getDb()) as AppDb;
    const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    return rows[0] ?? null;
  },

  /** Dashboard creation → agent push. One call, fully automatic. */
  async create(ctx: Ctx, input: CreateTaskInput): Promise<Task> {
    const db = (await getDb()) as AppDb;
    const { personsService } = await import("@/server/services/persons");
    const person = await personsService.byId(input.personId);
    if (!person || person.organizationId !== ctx.orgId) throw new Error("person_not_found");

    const spec: string[] = [
      ...(input.withMedia ? ["media"] : []),
      ...(input.withSignature ? ["signature"] : []),
    ];
    const [task] = await db
      .insert(tasks)
      .values({
        organizationId: ctx.orgId,
        assigneeId: person.id,
        title: input.title.trim(),
        instructions: input.instructions?.trim() || null,
        evidenceSpec: spec,
        taskType: spec.includes("media") ? "photo_proof" : "simple_done",
        dueAt: input.dueAt ?? new Date(Date.now() + 8 * 60 * 60 * 1000),
      })
      .returning();
    if (!task) throw new Error("task insert returned no rows");
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "task.created",
      entity: "task",
      entityId: task.id,
      after: { title: task.title, assignee: person.name, evidenceSpec: spec, dueAt: task.dueAt.toISOString() },
    });
    await this.push(task, person);
    return task;
  },

  /** The agent's automatic response to dashboard events: deliver the task card. */
  async push(task: Task, person: Person): Promise<void> {
    if (person.consentStatus !== "opted_in" || person.deactivatedAt) return; // silent until they opt in (§4.1)
    const db = (await getDb()) as AppDb;
    const replies: BotReply[] = [
      {
        kind: "buttons",
        text: BOT_MESSAGES.taskPushed(task.title ?? "Task", task.instructions ?? undefined, dueLabel(task.dueAt)),
        buttons: [BOT_BUTTONS.startProof(task.id), BOT_BUTTONS.help],
      },
    ];
    const provider = getProvider();
    await dispatchReply(provider, person.phoneE164, replies);
    await auditRepo.log(db, {
      organizationId: task.organizationId,
      actorKind: "agent",
      action: "agent.task_dispatch",
      entity: "task",
      entityId: task.id,
      after: { to: person.name, channel: provider.mode },
    });
  },

  /** Open work for one person (person-scoped ⇒ tenant-safe). */
  async listOpen(personId: string): Promise<Task[]> {
    const db = (await getDb()) as AppDb;
    return db
      .select()
      .from(tasks)
      .where(and(eq(tasks.assigneeId, personId), inArray(tasks.status, [...OPEN_STATUSES])))
      .orderBy(asc(tasks.dueAt))
      .limit(20);
  },

  /** The heads' board: every open task in this org, with names. */
  async openBoard(ctx: Ctx): Promise<{ task: Task; person: Person | null }[]> {
    const db = (await getDb()) as AppDb;
    const rows = await db
      .select({ task: tasks, person: persons })
      .from(tasks)
      .leftJoin(persons, eq(persons.id, tasks.assigneeId))
      .where(and(eq(tasks.organizationId, ctx.orgId), inArray(tasks.status, [...OPEN_STATUSES])))
      .orderBy(asc(tasks.dueAt))
      .limit(50);
    return rows;
  },

  /** The proof trail: recent completed tasks + their evidence + who did it. */
  async proofFeed(ctx: Ctx, limit = 12): Promise<{ task: Task; person: Person | null; evidence: (typeof evidence.$inferSelect)[] }[]> {
    const db = (await getDb()) as AppDb;
    const done = await db
      .select({ task: tasks, person: persons })
      .from(tasks)
      .leftJoin(persons, eq(persons.id, tasks.assigneeId))
      .where(and(eq(tasks.organizationId, ctx.orgId), eq(tasks.status, "done")))
      .orderBy(desc(tasks.completedAt))
      .limit(limit);
    if (done.length === 0) return [];
    const ids = done.map((d) => d.task.id);
    const allEvidence = await db.select().from(evidence).where(inArray(evidence.taskId, ids)).orderBy(asc(evidence.capturedAt));
    return done.map((row) => ({
      task: row.task,
      person: row.person,
      evidence: allEvidence.filter((e) => e.taskId === row.task.id),
    }));
  },

  /** 24-hour team pulse for the heads' proof summary reply. Accepts anything
   *  org-shaped (a full dashboard Ctx or a bare {orgId} from the bot). */
  async countsLast24h(scoped: { orgId: string }): Promise<{ done: number; waiting: number }> {
    const orgId = scoped.orgId;
    const db = (await getDb()) as AppDb;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const doneRows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.organizationId, orgId), eq(tasks.status, "done"), gte(tasks.completedAt, since)));
    const waitingRows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.organizationId, orgId), inArray(tasks.status, [...OPEN_STATUSES])));
    return { done: doneRows.length, waiting: waitingRows.length };
  },

  async recordMediaEvidence(person: Person, taskId: string, mediaId: string, kind: "photo" | "video" | "audio" | "document"): Promise<void> {
    const db = (await getDb()) as AppDb;
    await db.insert(evidence).values({
      organizationId: person.organizationId,
      taskId,
      kind,
      value: null,
      mediaUrl: mediaId, // our storage key — stable, unlike Meta's expiring ids
    });
    await auditRepo.log(db, {
      organizationId: person.organizationId,
      actorKind: "person",
      actorPersonId: person.id,
      action: "evidence.recorded",
      entity: "evidence",
      entityId: taskId,
      after: { kind, mediaUrl: mediaId },
    });
  },

  async recordSignatureEvidence(person: Person, taskId: string, signedBy: string): Promise<void> {
    const db = (await getDb()) as AppDb;
    await db.insert(evidence).values({
      organizationId: person.organizationId,
      taskId,
      kind: "signature",
      value: signedBy, // the typed full-name sign-off
      mediaUrl: null,
    });
    await auditRepo.log(db, {
      organizationId: person.organizationId,
      actorKind: "person",
      actorPersonId: person.id,
      action: "evidence.signed",
      entity: "evidence",
      entityId: taskId,
      after: { signedBy },
    });
  },

  async markDone(task: Task, person: Person): Promise<Task> {
    const db = (await getDb()) as AppDb;
    const [done] = await db
      .update(tasks)
      .set({ status: "done", completedAt: new Date() })
      .where(eq(tasks.id, task.id))
      .returning();
    if (!done) throw new Error("task update returned no rows");
    await auditRepo.log(db, {
      organizationId: task.organizationId,
      actorKind: "person",
      actorPersonId: person.id,
      action: "task.completed",
      entity: "task",
      entityId: task.id,
      after: { status: "done", title: task.title },
    });
    return done;
  },
};
