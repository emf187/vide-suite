import { and, desc, eq, inArray } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb, type AppDb } from "@/server/db/client";
import { faultEvents, machineDevices, videCache, workOrders } from "@/server/db/schema";
import { can } from "@/server/policies";
import { auditRepo } from "@/server/repos/audit";
import { workOrderWriteService } from "@/server/services/work-orders";

const SEVERITIES = ["critical", "warning", "watch"] as const;
export type FaultSeverity = (typeof SEVERITIES)[number];
const STATUSES = ["open", "acknowledged", "converted", "dismissed"] as const;
export type FaultStatus = (typeof STATUSES)[number];

export const faultsService = {
  async list(ctx: Ctx, opts: { status?: FaultStatus | "all"; machineId?: string } = {}) {
    const db = await getDb();
    const conds = [eq(faultEvents.organizationId, ctx.orgId)];
    if (opts.status && opts.status !== "all") conds.push(eq(faultEvents.status, opts.status));
    if (opts.machineId) conds.push(eq(faultEvents.machineId, opts.machineId));
    return db
      .select({
        id: faultEvents.id,
        machineId: faultEvents.machineId,
        videMachineName: faultEvents.videMachineName,
        faultType: faultEvents.faultType,
        severity: faultEvents.severity,
        description: faultEvents.description,
        flaggedAt: faultEvents.flaggedAt,
        status: faultEvents.status,
        woId: faultEvents.woId,
        woNumber: workOrders.number,
        acknowledgedAt: faultEvents.acknowledgedAt,
        createdAt: faultEvents.createdAt,
      })
      .from(faultEvents)
      .leftJoin(workOrders, eq(workOrders.id, faultEvents.woId))
      .where(and(...conds))
      .orderBy(desc(faultEvents.flaggedAt))
      .limit(200);
  },

  async openCount(ctx: Ctx): Promise<number> {
    const db = await getDb();
    const rows = await db
      .select({ n: faultEvents.id })
      .from(faultEvents)
      .where(and(eq(faultEvents.organizationId, ctx.orgId), inArray(faultEvents.status, ["open"])));
    return rows.length;
  },

  async byId(ctx: Ctx, id: string) {
    const db = await getDb();
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const rows = await db
      .select()
      .from(faultEvents)
      .where(and(eq(faultEvents.organizationId, ctx.orgId), eq(faultEvents.id, id)))
      .limit(1);
    return rows[0] ?? null;
  },
};

export const faultsWriteService = {
  /**
   * Webhook intake (M4): Resolve machine strictly by vide machine name inside the
   * claimed org — a payload cannot move an event to another tenant or a wrong machine.
   */
  async ingestFromWebhook(db: AppDb, orgId: string, deviceName: string, input: { faultType: string; severity?: string; description?: string | null; flaggedAt?: Date | null; payload?: unknown }): Promise<{ inserted: boolean; reason?: string }> {
    const device = await db
      .select({ machineId: machineDevices.machineId })
      .from(machineDevices)
      .where(and(eq(machineDevices.organizationId, orgId), eq(machineDevices.videMachineName, deviceName)))
      .limit(1);
    if (!device[0]) return { inserted: false, reason: `unknown_device:${deviceName}` };
    const severity = (SEVERITIES as readonly string[]).includes(input.severity ?? "") ? (input.severity as FaultSeverity) : "warning";
    const rows = await db.insert(faultEvents).values({
      organizationId: orgId,
      machineId: device[0].machineId,
      videMachineName: deviceName,
      faultType: input.faultType?.trim() || "unclassified",
      severity,
      description: input.description?.trim() || null,
      flaggedAt: input.flaggedAt ?? new Date(),
      payload: (typeof input.payload === "object" && input.payload !== null ? input.payload : {}) as Record<string, unknown>,
    }).returning();
    const row = rows[0];
    if (!row) return { inserted: false, reason: "insert_failed" };
    await auditRepo.log(db, {
      organizationId: orgId,
      action: "fault.ingested",
      entityType: "fault_event",
      entityId: row.id,
      actorKind: "system",
      diff: { device: deviceName, faultType: row.faultType, severity },
    });
    return { inserted: true };
  },

  async acknowledge(ctx: Ctx, id: string) {
    const db = await getDb();
    if (!can(ctx.roles, "wo.plan")) throw new Error("forbidden:wo.plan");
    const fault = await faultsService.byId(ctx, id);
    if (!fault) throw new Error("fault_not_found");
    if (fault.status !== "open") throw new Error(`not_open:${fault.status}`);
    await db.update(faultEvents).set({
      status: "acknowledged",
      acknowledgedBy: ctx.userId,
      acknowledgedAt: new Date(),
    }).where(eq(faultEvents.id, fault.id));
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "fault.acknowledged",
      entityType: "fault_event",
      entityId: fault.id,
      diff: { device: fault.videMachineName },
    });
  },

  async dismiss(ctx: Ctx, id: string) {
    const db = await getDb();
    if (!can(ctx.roles, "wo.plan")) throw new Error("forbidden:wo.plan");
    const fault = await faultsService.byId(ctx, id);
    if (!fault) throw new Error("fault_not_found");
    if (fault.status === "converted") throw new Error("already_converted");
    await db.update(faultEvents).set({ status: "dismissed" }).where(eq(faultEvents.id, fault.id));
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "fault.dismissed",
      entityType: "fault_event",
      entityId: fault.id,
      diff: { device: fault.videMachineName },
    });
  },

  /** Convert an open/acknowledged fault into a corrective work order (deterministic — no LLM). */
  async convertToWorkOrder(ctx: Ctx, id: string): Promise<{ woId: string; woNumber: string }> {
    const db = await getDb();
    if (!can(ctx.roles, "wo.plan")) throw new Error("forbidden:wo.plan");
    const fault = await faultsService.byId(ctx, id);
    if (!fault) throw new Error("fault_not_found");
    if (fault.status === "converted") throw new Error("already_converted");
    if (fault.status === "dismissed") throw new Error("already_dismissed");
    if (!fault.machineId) throw new Error("fault_has_no_machine");
    const wo = await workOrderWriteService.create(ctx, {
      title: `Fault: ${fault.faultType} on ${fault.videMachineName}`,
      description: fault.description ?? undefined,
      machineId: fault.machineId,
      type: "corrective",
      priority: fault.severity === "critical" ? "critical" : fault.severity === "watch" ? "low" : "normal",
      source: "manual",
      status: "planned",
      plannedStart: null,
    });
    await db.update(faultEvents).set({ status: "converted", woId: wo.id }).where(eq(faultEvents.id, fault.id));
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "fault.converted_to_wo",
      entityType: "fault_event",
      entityId: fault.id,
      diff: { woNumber: wo.number, device: fault.videMachineName },
    });
    return { woId: wo.id, woNumber: wo.number };
  },
};

/* ------------------------------------------------------------------ */
/* cache-through telemetry                                             */
/* ------------------------------------------------------------------ */

export const videCacheService = {
  /** Cache-through: serve stored JSON when fresh, else refetch via `fetcher` and store. */
  async getThrough(
    ctx: Pick<Ctx, "orgId">,
    key: string,
    ttlMs: number,
    fetcher: () => Promise<unknown>,
  ): Promise<{ payload: Record<string, unknown> | unknown[]; fetchedAt: Date; cached: boolean }> {
    const db = await getDb();
    const fresh = await db
      .select()
      .from(videCache)
      .where(and(eq(videCache.organizationId, ctx.orgId), eq(videCache.key, key)))
      .limit(1);
    const row = fresh[0];
    if (row && Date.now() - row.fetchedAt.getTime() < ttlMs) {
      return { payload: (row.payload ?? {}) as Record<string, unknown>, fetchedAt: row.fetchedAt, cached: true };
    }
    const payload = (await fetcher()) as Record<string, unknown> | unknown[];
    if (row) {
      await db.update(videCache).set({ payload: payload as Record<string, unknown>, fetchedAt: new Date() }).where(eq(videCache.id, row.id));
      return { payload, fetchedAt: new Date(), cached: false };
    }
    await db.insert(videCache).values({ organizationId: ctx.orgId, key, payload: payload as Record<string, unknown> }).onConflictDoUpdate({
      target: [videCache.organizationId, videCache.key],
      set: { payload: payload as Record<string, unknown>, fetchedAt: new Date() },
    });
    return { payload, fetchedAt: new Date(), cached: false };
  },
};
