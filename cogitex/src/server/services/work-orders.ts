import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb, type AppDb } from "@/server/db/client";
import {
  orgCounters,
  templateSteps,
  workOrderLabor,
  workOrderParts,
  workOrderSteps,
  workOrders,
  type WorkOrder,
} from "@/server/db/schema";
import { auditRepo } from "@/server/repos/audit";
import { memberships } from "@/server/db/schema";
import { inventoryWriteService, partsCostKobo } from "@/server/services/inventory";
import { can, type Ability } from "@/server/policies";
import { machinesService, machinesWriteService } from "./machines";

export type WoStatus =
  | "draft" | "planned" | "assigned" | "in_progress" | "on_hold"
  | "completed" | "verified" | "closed" | "cancelled";

export type WoPriority = "low" | "normal" | "high" | "critical";
export type WoType = "corrective" | "preventive" | "inspection" | "installation";

/* --------------------------- state machine ---------------------------- */

/** Legal transitions (DATA_MODEL §4.2, evolution draft→planned→assigned→in_progress→…→closed). */
export const WO_TRANSITIONS: Record<WoStatus, WoStatus[]> = {
  draft: ["planned", "cancelled"],
  planned: ["assigned", "on_hold", "cancelled"],
  assigned: ["in_progress", "on_hold", "cancelled"],
  in_progress: ["on_hold", "completed", "cancelled"],
  on_hold: ["in_progress"],
  completed: ["verified"],
  verified: ["closed"],
  closed: [],
  cancelled: [],
};

/** Ability gate per target status; work must be verified by someone other than the assignee. */
const WHO: Record<WoStatus, { ability: Ability; note?: string }> = {
  draft: { ability: "wo.plan" },
  planned: { ability: "wo.plan" },
  assigned: { ability: "wo.plan" },
  in_progress: { ability: "wo.execute" },
  on_hold: { ability: "wo.execute", note: "reason required" },
  completed: { ability: "wo.execute" },
  verified: { ability: "wo.plan", note: "verifier must differ from assignee" },
  closed: { ability: "wo.plan" },
  cancelled: { ability: "wo.plan", note: "reason required" },
};

function assertTransition(from: WoStatus, to: WoStatus, ctx: Ctx, wo: WorkOrder): void {
  if (!WO_TRANSITIONS[from]?.includes(to)) throw new Error(`illegal_wo_transition:${from}->${to}`);
  const gate = WHO[to];
  if (Object.values(gate).length === 0) throw new Error(`terminal_status:${from}`);
  if (to === "verified" && ctx.userId === wo.assignedTo) throw new Error("verify_requires_other_user");
  if (!can(ctx.roles, gate.ability)) throw new Error(`forbidden:${gate.ability}`);
}

/* ------------------------------ queries ------------------------------ */

export const workOrderService = {
  async list(
    ctx: Ctx,
    filters: { status?: string; machineId?: string; mine?: string; priority?: string; q?: string } = {},
  ): Promise<WorkOrder[]> {
    const db = await getDb();
    const conditions = [eq(workOrders.organizationId, ctx.orgId)];
    if (filters.status) conditions.push(eq(workOrders.status, filters.status as WoStatus));
    if (filters.machineId) conditions.push(eq(workOrders.machineId, filters.machineId));
    if (filters.priority) conditions.push(eq(workOrders.priority, filters.priority));
    if (filters.mine === "1") conditions.push(eq(workOrders.assignedTo, ctx.userId));
    if (filters.q) {
      const term = `%${filters.q}%`;
      const search = or(ilike(workOrders.title, term), ilike(workOrders.number, term));
      if (search) conditions.push(search);
    }
    return db
      .select()
      .from(workOrders)
      .where(and(...conditions))
      .orderBy(desc(workOrders.createdAt));
  },

  async byId(ctx: Ctx, id: string): Promise<WorkOrder | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(workOrders)
      .where(and(eq(workOrders.id, id), eq(workOrders.organizationId, ctx.orgId)))
      .limit(1);
    return rows[0] ?? null;
  },

  async steps(ctx: Ctx, woId: string) {
    const db = await getDb();
    return db
      .select()
      .from(workOrderSteps)
      .where(and(eq(workOrderSteps.organizationId, ctx.orgId), eq(workOrderSteps.workOrderId, woId)))
      .orderBy(asc(workOrderSteps.seq));
  },

  async labor(ctx: Ctx, woId: string) {
    const db = await getDb();
    return db
      .select()
      .from(workOrderLabor)
      .where(and(eq(workOrderLabor.organizationId, ctx.orgId), eq(workOrderLabor.workOrderId, woId)))
      .orderBy(desc(workOrderLabor.loggedAt));
  },

  async parts(ctx: Ctx, woId: string) {
    const db = await getDb();
    return db
      .select()
      .from(workOrderParts)
      .where(and(eq(workOrderParts.organizationId, ctx.orgId), eq(workOrderParts.workOrderId, woId)))
      .orderBy(asc(workOrderParts.id));
  },

  /** Cost rollup for the header (labor + issued parts). Integer kobo, per-hour rate. */
  async costRollup(ctx: Ctx, woId: string): Promise<{ laborMinutes: number; laborKobo: number; partsKobo: number }> {
    const db = await getDb();
    const rows = await db
      .select({ minutes: workOrderLabor.minutes, rate: workOrderLabor.rateKobo })
      .from(workOrderLabor)
      .where(and(eq(workOrderLabor.organizationId, ctx.orgId), eq(workOrderLabor.workOrderId, woId)));
    const laborMinutes = rows.reduce((s, r) => s + r.minutes, 0);
    // kobo = minutes/60 × hourly rate (kept integer: sum first, divide once)
    const laborKobo = Math.round(rows.reduce((s, r) => s + r.minutes * r.rate, 0) / 60);
    const partsKobo = await partsCostKobo(ctx, woId);
    return { laborMinutes, laborKobo, partsKobo };
  },
};

/* ---------------------------- mutations ------------------------------ */

/** Row-locked counter allocation (single upsert guarantees unique monotonic numbers). */
async function allocateNumber(db: AppDb, orgId: string): Promise<string> {
  const result = await db.execute(
    sql`insert into org_counters (organization_id, kind, last_value) values (${orgId}, 'work_order', 1)
        on conflict (organization_id, kind)
        do update set last_value = org_counters.last_value + 1, updated_at = now()
        returning last_value as last_value`,
  );
  const rows = ((result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[])) as Array<Record<string, unknown>>;
  const value = Number(rows[0]?.last_value ?? 0);
  if (value < 1) throw new Error("counter_alloc_failed");
  return `WO-${String(value).padStart(6, "0")}`;
}

export const workOrderWriteService = {
  /** Create (blank or from a template that copies its checklist steps). */
  async create(
    ctx: Ctx,
    input: {
      title: string;
      description?: string;
      machineId?: string | null;
      type: WoType;
      priority: WoPriority;
      templateId?: string | null;
      scheduleId?: string | null;
      assignedTo?: string | null;
      plannedStart?: Date | null;
      plannedEnd?: Date | null;
      source?: "manual" | "schedule" | "agent" | "import";
      status?: WoStatus; // schedule/agent sources may create planned directly; manual always planned
      /** provenance text for the immutable system note on the comment thread */
      provenance?: string | null;
    },
  ): Promise<WorkOrder> {
    const db = await getDb();
    const fromScheduleOrAgent = input.source === "schedule" || input.source === "agent";
    if (!can(ctx.roles, "wo.plan") && !fromScheduleOrAgent) throw new Error("forbidden:wo.plan");

    const number = await allocateNumber(db, ctx.orgId);
    const rows = await db
      .insert(workOrders)
      .values({
        organizationId: ctx.orgId,
        number,
        title: input.title,
        description: input.description ?? null,
        machineId: input.machineId ?? null,
        type: input.type,
        priority: input.priority,
        status: input.status ?? "planned",
        assignedTo: input.assignedTo ?? null,
        templateId: input.templateId ?? null,
        scheduleId: input.scheduleId ?? null,
        source: input.source ?? "manual",
        plannedStart: input.plannedStart ?? null,
        plannedEnd: input.plannedEnd ?? null,
        createdBy: ctx.userId,
      })
      .returning();
    const wo = rows[0];
    if (!wo) throw new Error("wo insert returned no rows");

    if (input.templateId) {
      const steps = await db
        .select()
        .from(templateSteps)
        .where(and(eq(templateSteps.organizationId, ctx.orgId), eq(templateSteps.templateId, input.templateId)))
        .orderBy(asc(templateSteps.seq));
      if (steps.length > 0) {
        await db.insert(workOrderSteps).values(
          steps.map((s) => ({
            organizationId: ctx.orgId,
            workOrderId: wo.id,
            seq: s.seq,
            title: s.title,
            kind: s.kind,
            requireValue: s.requireValue,
            requirePhoto: s.requirePhoto,
          })),
        );
      }
    }

    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "work_order.created",
      entityType: "work_order",
      entityId: wo.id,
      diff: { number, title: wo.title, source: wo.source, machineId: wo.machineId },
    });

    // Provenance rail (docs & multimedia sprint): system note on the comment
    // thread states WHY this card exists — schedules, agent proposals and VIDE
    // fault conversions get an immutable first timeline entry.
    const provenance =
      input.provenance?.trim() ||
      (input.source === "schedule" ? "Generated by a preventive-maintenance schedule." : null) ||
      (input.source === "agent" ? "Proposed by the agent and confirmed by a human." : null);
    if (provenance) {
      const { woNotesService } = await import("./wo-notes");
      await woNotesService.system(db, ctx, wo.id, `Provenance: ${provenance}`);
    }
    return wo;
  },

  async updateBasic(
    ctx: Ctx,
    id: string,
    patch: Partial<Pick<WorkOrder, "title" | "description" | "priority" | "plannedStart" | "plannedEnd" | "machineId">>,
  ): Promise<WorkOrder> {
    if (!can(ctx.roles, "wo.plan")) throw new Error("forbidden:wo.plan");
    const db = await getDb();
    const wo = await workOrderService.byId(ctx, id);
    if (!wo) throw new Error("wo_not_found");
    const rows = await db
      .update(workOrders)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(workOrders.id, wo.id))
      .returning();
    const updated = rows[0];
    if (!updated) throw new Error("wo update returned no rows");
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "work_order.updated",
      entityType: "work_order",
      entityId: wo.id,
      diff: patch,
    });
    return updated;
  },

  /** Status transitions — the only path for state changes (ability gate + verify separation). */
  async transition(
    ctx: Ctx,
    id: string,
    to: WoStatus,
    opts: {
      reason?: string; // required for cancel
      assignedTo?: string; // required when arriving at 'assigned'
      completedSummary?: string;
      foundRootCause?: string;
      downtimeHours?: number;
    } = {},
  ): Promise<{ wo: WorkOrder; machineStatus?: string }> {
    const db = await getDb();
    const wo = await workOrderService.byId(ctx, id);
    if (!wo) throw new Error("wo_not_found");

    assertTransition(wo.status, to, ctx, wo);

    if (to === "cancelled" && !(opts.reason ?? "").trim()) throw new Error("reason_required:cancel");
    if (to === "assigned" && !opts.assignedTo) throw new Error("assignee_required");
    if (to === "assigned" && opts.assignedTo) {
      // the assignee must be a member of this org — friendlier than a raw FK error
      const member = await db
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.userId, opts.assignedTo)))
        .limit(1);
      if (!member[0]) throw new Error("assignee_not_org_member");
    }
    if (to === "completed") {
      const steps = await workOrderService.steps(ctx, wo.id);
      const undone = steps.filter((s) => !s.completedAt);
      if (undone.length > 0) throw new Error(`steps_incomplete:${undone.length}`);
    }

    const patch: Partial<
      Pick<
        WorkOrder,
        "status" | "updatedAt" | "actualStart" | "actualEnd" | "verifiedBy" | "assignedTo" | "closedAt" | "cancelledReason" | "completedSummary" | "foundRootCause" | "downtimeHours"
      >
    > = { status: to, updatedAt: new Date() };
    if (to === "in_progress") patch.actualStart = new Date();
    if (to === "completed") patch.actualEnd = new Date();
    if (to === "verified") patch.verifiedBy = ctx.userId;
    if (to === "closed") patch.closedAt = new Date();
    if (to === "cancelled") patch.cancelledReason = opts.reason;
    if (to === "completed") {
      patch.completedSummary = opts.completedSummary ?? null;
      patch.foundRootCause = opts.foundRootCause ?? null;
      patch.downtimeHours = opts.downtimeHours !== undefined ? String(opts.downtimeHours) : null;
    }
    if (to === "assigned") patch.assignedTo = opts.assignedTo;

    const rows = await db
      .update(workOrders)
      .set(patch)
      .where(eq(workOrders.id, wo.id))
      .returning();
    const updated = rows[0];
    if (!updated) throw new Error("wo transition returned no rows");

    // Machine lifecycle follows executing WOs (DATA_MODEL §4.3); never blocks the WO itself.
    let machineStatus: string | undefined;
    if (updated.machineId) {
      try {
        const machine = await machinesService.byId(ctx, updated.machineId);
        if (machine && to === "in_progress" && machine.lifecycleStatus === "active") {
          await machinesWriteService.transition(ctx, machine.id, "under_maintenance", { reason: `WO ${updated.number}` });
          machineStatus = "under_maintenance";
        } else if (machine && (to === "completed" || to === "cancelled") && machine.lifecycleStatus === "under_maintenance") {
          await machinesWriteService.transition(ctx, machine.id, "active", { reason: `WO ${updated.number} concluded` });
          machineStatus = "active";
        }
      } catch {
        // Machine state machine can refuse legally (e.g. standby); the WO proceeds.
      }
    }

    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: `work_order.status.${to}`,
      entityType: "work_order",
      entityId: wo.id,
      diff: { from: wo.status, to, number: wo.number, ...(opts.reason ? { reason: opts.reason } : {}) },
    });

    // Concluding the card voids outstanding reservations — parts never issued go back
    // to available. Best-effort: reservation release must not block the transition.
    if (to === "completed" || to === "verified" || to === "closed" || to === "cancelled") {
      try {
        await inventoryWriteService.releaseOpenReservationsForWorkOrder(db, ctx, wo.id);
      } catch {
        // non-fatal
      }
    }

    return { wo: updated, machineStatus };
  },

  /** Steps complete only while in_progress; value required when the step asks for one. */
  async completeStep(ctx: Ctx, woId: string, stepId: string, opts: { value?: string } = {}): Promise<void> {
    if (!can(ctx.roles, "wo.execute")) throw new Error("forbidden:wo.execute");
    const wo = await workOrderService.byId(ctx, woId);
    if (!wo) throw new Error("wo_not_found");
    if (wo.status !== "in_progress") throw new Error("wo_not_in_progress");
    const db = await getDb();
    const stepRows = await db
      .select()
      .from(workOrderSteps)
      .where(and(eq(workOrderSteps.id, stepId), eq(workOrderSteps.organizationId, ctx.orgId), eq(workOrderSteps.workOrderId, woId)))
      .limit(1);
    const step = stepRows[0];
    if (!step) throw new Error("step_not_found");
    if (step.requireValue && !(opts.value ?? "").trim()) throw new Error("value_required");
    if (step.completedAt) throw new Error("step_already_done");

    await db
      .update(workOrderSteps)
      .set({ completedAt: new Date(), completedBy: ctx.userId, value: (opts.value ?? "").trim() || null })
      .where(eq(workOrderSteps.id, step.id));

    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "work_order.step_completed",
      entityType: "work_order",
      entityId: woId,
      diff: { step: step.title, seq: step.seq },
    });
  },

  async reopenStep(ctx: Ctx, woId: string, stepId: string): Promise<void> {
    if (!can(ctx.roles, "wo.execute")) throw new Error("forbidden:wo.execute");
    const db = await getDb();
    await db
      .update(workOrderSteps)
      .set({ completedAt: null, completedBy: null, value: null })
      .where(and(eq(workOrderSteps.id, stepId), eq(workOrderSteps.organizationId, ctx.orgId), eq(workOrderSteps.workOrderId, woId)));
  },

  /** Labor logging: anyone executing can log own hours; plan role may log for others. */
  async addLabor(ctx: Ctx, woId: string, input: { minutes: number; rateKobo?: number; note?: string; userId?: string }): Promise<void> {
    const wo = await workOrderService.byId(ctx, woId);
    if (!wo) throw new Error("wo_not_found");
    const loggingForOther = input.userId !== undefined && input.userId !== ctx.userId;
    if (!can(ctx.roles, "wo.execute") || (loggingForOther && !can(ctx.roles, "wo.plan"))) {
      throw new Error("forbidden:wo.execute");
    }
    if (!Number.isFinite(input.minutes) || input.minutes <= 0 || input.minutes > 24 * 60) throw new Error("minutes_0_to_1440");
    const db = await getDb();
    await db.insert(workOrderLabor).values({
      organizationId: ctx.orgId,
      workOrderId: woId,
      userId: input.userId ?? ctx.userId,
      minutes: Math.round(input.minutes),
      rateKobo: input.rateKobo ?? 250000,
      note: input.note ?? null,
    });
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "work_order.labor_logged",
      entityType: "work_order",
      entityId: woId,
      diff: { minutes: input.minutes, forOther: loggingForOther },
    });
  },
};
