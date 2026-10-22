import { and, asc, desc, eq, or } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb, type AppDb } from "@/server/db/client";
import {
  maintenanceTemplates,
  scheduleRuns,
  schedules,
  workOrders,
  type Schedule,
} from "@/server/db/schema";
import { auditRepo } from "@/server/repos/audit";
import { can } from "@/server/policies";
import { getIntegrations } from "@/lib/integrations/factory";
import { machinesService } from "./machines";
import { workOrderWriteService } from "./work-orders";

/* ------------------------------ queries ------------------------------ */

export const schedulesService = {
  async list(ctx: Ctx, opts: { activeOnly?: boolean } = {}): Promise<Schedule[]> {
    const db = await getDb();
    const conditions = [eq(schedules.organizationId, ctx.orgId)];
    if (opts.activeOnly) conditions.push(eq(schedules.active, true));
    return db
      .select()
      .from(schedules)
      .where(and(...conditions))
      .orderBy(asc(schedules.title));
  },

  async recentRuns(ctx: Ctx, limit = 20) {
    const db = await getDb();
    return db
      .select()
      .from(scheduleRuns)
      .where(eq(scheduleRuns.organizationId, ctx.orgId))
      .orderBy(desc(scheduleRuns.triggeredAt))
      .limit(limit);
  },

  async templates(ctx: Ctx) {
    const db = await getDb();
    return db
      .select()
      .from(maintenanceTemplates)
      .where(and(eq(maintenanceTemplates.organizationId, ctx.orgId), eq(maintenanceTemplates.active, true)))
      .orderBy(asc(maintenanceTemplates.name));
  },
};

/* ---------------------------- PM generation --------------------------- */

type Candidate = {
  schedule: Schedule;
  basis: string;
  observed?: number;
  reason?: string;
  dueAt: Date;
};

async function evaluateCondition(ctx: Ctx, schedule: Schedule): Promise<{ observed?: number; triggered: boolean; reason?: string }> {
  if (!schedule.conditionMetric || !schedule.conditionOp || schedule.conditionThreshold === null) {
    return { triggered: false, reason: "condition incomplete" };
  }
  if (!schedule.machineId) return { triggered: false, reason: "condition needs a machine" };
  const machine = await machinesService.byId(ctx, schedule.machineId);
  if (!machine) return { triggered: false, reason: "machine missing" };
  const names = await (await import("./machine-extras")).listLinkedDevices(ctx, machine.id);
  const device = names.filter((d) => d.unlinkedAt === null).map((d) => d.videMachineName)[0];
  if (!device) return { triggered: false, reason: "no VIDE device linked" };

  const readings = await getIntegrations().vide.getRecentReadings(device, 5);
  const metric = schedule.conditionMetric; // 'vibration_mm_s' | 'temperature_c'
  const values = readings.map((r) => (metric === "vibration_mm_s" ? r.vibrationMmS : metric === "temperature_c" ? r.temperatureC : null));
  const seen = values.filter((v): v is number => v !== null);
  if (seen.length === 0) return { triggered: false, reason: "no metric values" };
  const latest = seen[seen.length - 1];
  if (latest === undefined) return { triggered: false, reason: "no metric values" };
  const triggered = schedule.conditionOp === "<" ? latest < Number(schedule.conditionThreshold) : latest > Number(schedule.conditionThreshold);
  return { observed: latest, triggered, reason: `${metric} latest ${latest} ${schedule.conditionOp} ${Number(schedule.conditionThreshold)}` };
}

async function findCandidates(ctx: Ctx, horizon: Date): Promise<Candidate[]> {
  const db = await getDb();
  const out: Candidate[] = [];

  const rows = await db
    .select()
    .from(schedules)
    .where(
      and(
        eq(schedules.organizationId, ctx.orgId),
        eq(schedules.active, true),
      ),
    );

  for (const schedule of rows) {
    if (schedule.kind === "calendar") {
      // Due when nextDueAt <= horizon (null nextDueAt → first run at plan time).
      const dueAt = schedule.nextDueAt ?? new Date(Date.now() - 86_400_000);
      if (schedule.intervalDays === null) continue;
      if (!schedule.nextDueAt || schedule.nextDueAt <= horizon) {
        out.push({ schedule, basis: `calendar every ${schedule.intervalDays}d`, dueAt });
      }
    } else if (schedule.kind === "runtime") {
      if (!schedule.machineId || schedule.runtimeTriggerHours === null) continue;
      const machine = await machinesService.byId(ctx, schedule.machineId);
      if (!machine) continue;
      const baseline = schedule.runtimeBaselineHours === null ? 0 : Number(schedule.runtimeBaselineHours);
      const since = Number(machine.runtimeHours) - baseline;
      if (since >= Number(schedule.runtimeTriggerHours)) {
        out.push({ schedule, basis: `runtime +${since.toFixed(1)}h ≥ ${schedule.runtimeTriggerHours}h since last run`, dueAt: horizon });
      }
    } else if (schedule.kind === "condition") {
      const check = await evaluateCondition(ctx, schedule);
      if (check.triggered) {
        out.push({ schedule, basis: check.reason ?? "condition met", observed: check.observed, dueAt: horizon });
      }
    }
  }
  return out;
}

/** Advance a calendar schedule's nextDueAt; runtime schedules re-baseline their meter. */
async function rearmSchedule(db: AppDb, ctx: Ctx, schedule: Schedule, runAt: Date): Promise<Date | null> {
  let next: Date | null = null;
  const patch: Partial<typeof schedules.$inferInsert> = {
    lastRunAt: runAt,
    updatedAt: new Date(),
  };
  if (schedule.kind === "calendar" && schedule.intervalDays) {
    next = new Date(runAt.getTime() + schedule.intervalDays * 86_400_000);
    patch.nextDueAt = next;
  }
  if (schedule.kind === "runtime" && schedule.machineId) {
    // Re-baseline the runtime meter so the trigger counts hours since this run.
    const machine = await machinesService.byId(ctx, schedule.machineId);
    if (machine) patch.runtimeBaselineHours = machine.runtimeHours;
  }
  await db
    .update(schedules)
    .set(patch)
    .where(and(eq(schedules.id, schedule.id), eq(schedules.organizationId, ctx.orgId)));
  return next;
}

export const pmService = {
  /** Dry-run/execute PM generation for everything due by `horizon`. */
  async generate(
    ctx: Ctx,
    opts: { dryRun?: boolean; horizon?: Date } = {},
  ): Promise<{ dryRun: boolean; candidates: { scheduleTitle: string; machineTag?: string; basis: string; created?: string; skipped?: string }[] }> {
    if (!can(ctx.roles, "wo.plan") && !opts.dryRun) throw new Error("forbidden:wo.plan");
    const horizon = opts.horizon ?? new Date();
    const db = await getDb();
    const candidates = await findCandidates(ctx, horizon);
    const out: { scheduleTitle: string; machineTag?: string; basis: string; created?: string; skipped?: string }[] = [];

    for (const cand of candidates) {
      const s = cand.schedule;
      let machineTag: string | undefined;
      if (s.machineId) {
        const machine = await machinesService.byId(ctx, s.machineId);
        machineTag = machine?.tag;
      }

      if (opts.dryRun) {
        out.push({ scheduleTitle: s.title, machineTag, basis: cand.basis });
        continue;
      }

      // WO dedupe: skip if an open WO already references this schedule
      const open = await db
        .select({ id: workOrders.id, number: workOrders.number })
        .from(workOrders)
        .where(
          and(
            eq(workOrders.organizationId, ctx.orgId),
            eq(workOrders.scheduleId, s.id),
            or(eq(workOrders.status, "planned"), eq(workOrders.status, "assigned"), eq(workOrders.status, "in_progress"), eq(workOrders.status, "draft")),
          ),
        )
        .limit(1);
      if (open[0]) {
        await db.insert(scheduleRuns).values({
          organizationId: ctx.orgId,
          scheduleId: s.id,
          machineId: s.machineId,
          triggerBasis: cand.basis,
          workOrderId: open[0].id,
          status: "skipped",
          reason: `open work order ${open[0].number} already references this schedule`,
        });
        out.push({ scheduleTitle: s.title, machineTag, basis: cand.basis, skipped: `open WO ${open[0].number} already references this schedule` });
        continue;
      }

      try {
        const wo = await workOrderWriteService.create(ctx, {
          title: s.title,
          description: s.notes ?? undefined,
          machineId: s.machineId ?? null,
          type: "preventive",
          priority: "normal",
          templateId: s.templateId ?? null,
          scheduleId: s.id,
          source: "schedule",
          status: "planned",
          plannedStart: cand.dueAt,
        });
        const nextDue = await rearmSchedule(db, ctx, s, new Date());
        await db.insert(scheduleRuns).values({
          organizationId: ctx.orgId,
          scheduleId: s.id,
          machineId: s.machineId,
          triggerBasis: cand.basis,
          workOrderId: wo.id,
          status: "generated",
          reason: nextDue ? `next due ${nextDue.toISOString().slice(0, 10)}` : undefined,
        });
        out.push({ scheduleTitle: s.title, machineTag, basis: cand.basis, created: wo.number });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db.insert(scheduleRuns).values({
          organizationId: ctx.orgId,
          scheduleId: s.id,
          machineId: s.machineId,
          triggerBasis: cand.basis,
          status: "failed",
          reason: message,
        });
        out.push({ scheduleTitle: s.title, machineTag, basis: cand.basis, skipped: message });
      }
    }

    if (!opts.dryRun && candidates.length > 0) {
      await auditRepo.log(db, {
        organizationId: ctx.orgId,
        actorUserId: ctx.userId,
        action: "pm.generated",
        entityType: "schedule_batch",
        entityId: ctx.orgId,
        diff: { candidates: candidates.length },
      });
    }
    return { dryRun: Boolean(opts.dryRun), candidates: out };
  },
};

/* --------------------------- schedule CRUD --------------------------- */

export const schedulesWriteService = {
  async create(
    ctx: Ctx,
    input: {
      title: string;
      machineId?: string | null;
      templateId?: string | null;
      kind: Schedule["kind"];
      intervalDays?: number | null;
      runtimeTriggerHours?: number | null;
      conditionMetric?: string | null;
      conditionOp?: string | null;
      conditionThreshold?: number | null;
      notes?: string;
      firstDueAt?: Date | null;
    },
  ): Promise<Schedule> {
    if (!can(ctx.roles, "wo.plan")) throw new Error("forbidden:wo.plan");
    if (input.kind === "calendar" && !input.intervalDays) throw new Error("interval_days_required");
    if (input.kind === "runtime" && !input.runtimeTriggerHours) throw new Error("runtime_hours_required");
    if (input.kind === "condition" && (!input.conditionMetric || !input.conditionOp || input.conditionThreshold === null || input.conditionThreshold === undefined)) {
      throw new Error("condition_params_required");
    }
    const db = await getDb();
    const rows = await db
      .insert(schedules)
      .values({
        organizationId: ctx.orgId,
        machineId: input.machineId ?? null,
        templateId: input.templateId ?? null,
        title: input.title,
        kind: input.kind,
        intervalDays: input.kind === "calendar" ? Math.max(1, Math.round(input.intervalDays ?? 0)) || null : null,
        runtimeTriggerHours: input.kind === "runtime" ? String(input.runtimeTriggerHours ?? 0) : null,
        runtimeBaselineHours:
          input.kind === "runtime" && input.machineId
            ? (await machinesService.byId(ctx, input.machineId))?.runtimeHours ?? "0"
            : null,
        conditionMetric: input.kind === "condition" ? input.conditionMetric : null,
        conditionOp: input.kind === "condition" ? input.conditionOp : null,
        conditionThreshold: input.kind === "condition" && input.conditionThreshold !== null && input.conditionThreshold !== undefined ? String(input.conditionThreshold) : null,
        notes: input.notes ?? null,
        nextDueAt: input.firstDueAt ?? null,
        createdBy: ctx.userId,
      })
      .returning();
    const schedule = rows[0];
    if (!schedule) throw new Error("schedule insert returned no rows");
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "schedule.created",
      entityType: "schedule",
      entityId: schedule.id,
      diff: { title: schedule.title, kind: schedule.kind },
    });
    return schedule;
  },

  async deactivate(ctx: Ctx, id: string): Promise<void> {
    if (!can(ctx.roles, "wo.plan")) throw new Error("forbidden:wo.plan");
    const db = await getDb();
    const rows = await db
      .select({ id: schedules.id, title: schedules.title })
      .from(schedules)
      .where(and(eq(schedules.id, id), eq(schedules.organizationId, ctx.orgId)))
      .limit(1);
    if (!rows[0]) throw new Error("schedule_not_found");
    await db
      .update(schedules)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(schedules.id, id));
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "schedule.deactivated",
      entityType: "schedule",
      entityId: id,
      diff: { title: rows[0].title },
    });
  },

  async reactivate(ctx: Ctx, id: string): Promise<void> {
    if (!can(ctx.roles, "wo.plan")) throw new Error("forbidden:wo.plan");
    const db = await getDb();
    await db
      .update(schedules)
      .set({ active: true, updatedAt: new Date() })
      .where(and(eq(schedules.id, id), eq(schedules.organizationId, ctx.orgId)));
  },
};
