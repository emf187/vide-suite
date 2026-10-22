import { and, desc, eq, isNull } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb, type AppDb } from "@/server/db/client";
import {
  faultEvents,
  inventoryItems,
  machineDevices,
  machineParts,
  machines,
  repairRequestEvents,
  repairRequests,
  technicianProfiles,
  workOrders,
} from "@/server/db/schema";
import { can } from "@/server/policies";
import { auditRepo } from "@/server/repos/audit";
import { getIntegrations } from "@/lib/integrations/factory";
import { videCacheService } from "@/server/services/faults";
import type { Urgency } from "@/lib/shared/types";
import type { MarketplaceRequestStatus, RepairBrief, SkillLevel } from "@/lib/integrations/interfaces";

/** Machine stat storing how "compiled" requests are kept separate from sent ones. */
export type RepairRequestStatus =
  | "compiled" | "sent" | "matched" | "quoted" | "accepted" | "en_route"
  | "on_site" | "completed" | "confirmed" | "declined" | "withdrawn" | "failed";

export type CompiledBrief = RepairBrief & { compiledFrom: { faultEventId?: string; workOrderId?: string } };

/* deterministic compile knowledge — no LLM in M5; the agent (M7) may PROPOSE edits later */
const SKILL_BY_CATEGORY: Record<string, { skill: SkillLevel; tools: string[] }> = {
  pump: { skill: "specialist", tools: ["alignment kit", "bearing puller", "torque wrench"] },
  motor: { skill: "specialist", tools: ["megger", "vibration analyzer", "wrench set"] },
  fan: { skill: "intermediate", tools: ["balancing weights", "wrench set"] },
  generator: { skill: "specialist", tools: ["load bank tester", "fuel system kit"] },
  compressor: { skill: "specialist", tools: ["pressure gauge kit", "seal kit", "torque wrench"] },
  conveyor: { skill: "intermediate", tools: ["belt tension gauge", "wrench set"] },
};

function skillFor(category: string | null): { skill: SkillLevel; tools: string[] } {
  return SKILL_BY_CATEGORY[(category ?? "").toLowerCase()] ?? { skill: "intermediate", tools: ["general toolkit"] };
}

function defaultUrgency(faultSeverity?: string | null, criticality?: string | null): Urgency {
  if (faultSeverity === "critical") return "critical";
  if (faultSeverity === "warning") return "high";
  if (faultSeverity === "watch") return "medium";
  if (criticality === "A") return "high";
  if (criticality === "B") return "medium";
  return "low";
}

export const repairRequestsService = {
  async list(ctx: Ctx, opts: { status?: RepairRequestStatus | "all" } = {}) {
    const db = await getDb();
    const conds = [eq(repairRequests.organizationId, ctx.orgId)];
    if (opts.status && opts.status !== "all") conds.push(eq(repairRequests.status, opts.status));
    return db
      .select({
        id: repairRequests.id,
        status: repairRequests.status,
        urgency: repairRequests.urgency,
        machineId: repairRequests.machineId,
        machineTag: machines.tag,
        faultType: faultEvents.faultType,
        techName: technicianProfiles.displayName,
        techRating: technicianProfiles.ratingAvg,
        quoteKobo: repairRequests.quoteKobo,
        etaAt: repairRequests.etaAt,
        rating: repairRequests.rating,
        createdAt: repairRequests.createdAt,
        completedAt: repairRequests.completedAt,
      })
      .from(repairRequests)
      .leftJoin(machines, eq(machines.id, repairRequests.machineId))
      .leftJoin(faultEvents, eq(faultEvents.id, repairRequests.faultEventId))
      .leftJoin(technicianProfiles, eq(technicianProfiles.id, repairRequests.technicianId))
      .where(and(...conds))
      .orderBy(desc(repairRequests.createdAt))
      .limit(200);
  },

  async byId(ctx: Ctx, id: string) {
    const db = await getDb();
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const rows = await db.select().from(repairRequests).where(and(eq(repairRequests.organizationId, ctx.orgId), eq(repairRequests.id, id))).limit(1);
    return rows[0] ?? null;
  },

  async events(ctx: Ctx, requestId: string) {
    const db = await getDb();
    return db
      .select()
      .from(repairRequestEvents)
      .where(and(eq(repairRequestEvents.organizationId, ctx.orgId), eq(repairRequestEvents.repairRequestId, requestId)))
      .orderBy(desc(repairRequestEvents.at))
      .limit(100);
  },
};

export const repairRequestsWriteService = {
  /**
   * STEP 1 (compile): build the repair brief from app data — machine snapshot,
   * linked fault, health trend (cache-through), suggested spares (machine_parts ∩
   * inventory), deterministic tools/skill/urgency. Nothing leaves the org yet; the
   * row is created with status `compiled` and waits for the confirmation screen.
   */
  async compile(
    ctx: Ctx,
    input: { machineId?: string; faultEventId?: string; workOrderId?: string },
  ): Promise<{ requestId: string }> {
    if (!can(ctx.roles, "repairRequests.send")) throw new Error("forbidden:repairRequests.send");
    const db = await getDb();

    let fault: typeof faultEvents.$inferSelect | null = null;
    if (input.faultEventId) {
      if (!/^[0-9a-f-]{36}$/.test(input.faultEventId)) throw new Error("bad_reference");
      const rows = await db.select().from(faultEvents)
        .where(and(eq(faultEvents.organizationId, ctx.orgId), eq(faultEvents.id, input.faultEventId))).limit(1);
      fault = rows[0] ?? null;
      if (!fault) throw new Error("fault_not_found");
    }

    let workOrder: typeof workOrders.$inferSelect | null = null;
    if (input.workOrderId) {
      if (!/^[0-9a-f-]{36}$/.test(input.workOrderId)) throw new Error("bad_reference");
      const rows = await db.select().from(workOrders)
        .where(and(eq(workOrders.organizationId, ctx.orgId), eq(workOrders.id, input.workOrderId))).limit(1);
      workOrder = rows[0] ?? null;
      if (!workOrder) throw new Error("work_order_not_found");
    }

    const machineId = input.machineId ?? fault?.machineId ?? workOrder?.machineId ?? null;
    if (!machineId) throw new Error("machine_required");
    const machineRows = await db.select().from(machines)
      .where(and(eq(machines.organizationId, ctx.orgId), eq(machines.id, machineId))).limit(1);
    const machine = machineRows[0];
    if (!machine) throw new Error("machine_not_found");

    // linked VIDE device name for the health trend (own join — never payload-supplied)
    const devices = await db.select({ n: machineDevices.videMachineName }).from(machineDevices)
      .where(and(eq(machineDevices.organizationId, ctx.orgId), eq(machineDevices.machineId, machine.id), isNull(machineDevices.unlinkedAt))).limit(1);
    const videName = devices[0]?.n ?? null;

    let healthTrend: { at: string; score: number }[] | undefined;
    if (videName) {
      try {
        const res = await videCacheService.getThrough(ctx, `health:${videName}:d7`, 10 * 60_000, async () => {
          const s = await getIntegrations().vide.getMachineHealthSummary(videName, "d7");
          return { score: s.score, status: s.status, asOf: s.asOf, samples: s.samples ?? [] } as Record<string, unknown>;
        });
        const p = res.payload as { samples?: { at: string; score: number }[] };
        healthTrend = p.samples;
      } catch {
        /* trend is best-effort — brief compiles without it */
      }
    }

    // suggested spares: machine-linked SKUs present in inventory (BOM ∩ stock room)
    const spares = await db
      .select({ sku: inventoryItems.sku, name: inventoryItems.name, unit: inventoryItems.unit })
      .from(machineParts)
      .innerJoin(inventoryItems, eq(inventoryItems.id, machineParts.inventoryItemId))
      .where(and(eq(machineParts.organizationId, ctx.orgId), eq(machineParts.machineId, machine.id)))
      .limit(8);

    const { skill, tools } = skillFor(machine.category);
    const brief: CompiledBrief = {
      compiledFrom: { faultEventId: fault?.id, workOrderId: workOrder?.id },
      machineSnapshot: {
        id: machine.id, tag: machine.tag, name: machine.name, category: machine.category,
        criticality: machine.criticality, lifecycleStatus: machine.lifecycleStatus,
        videDevice: videName,
      },
      fault: fault
        ? {
            type: fault.faultType,
            severity: (fault.severity === "critical" ? "critical" : fault.severity === "watch" ? "info" : "warning") as "critical" | "info" | "warning",
            description: fault.description ?? undefined,
            flaggedAt: fault.flaggedAt.toISOString(),
          }
        : undefined,
      healthTrend,
      suggestedParts: spares.map((s) => ({ sku: s.sku, name: s.name, qty: 1 })),
      tools,
      skill,
      urgency: defaultUrgency(fault?.severity, machine.criticality),
      notes: "",
    };

    const inserted = await db.insert(repairRequests).values({
      organizationId: ctx.orgId,
      machineId: machine.id,
      machineSnapshot: brief.machineSnapshot as Record<string, unknown>,
      faultEventId: fault?.id ?? null,
      workOrderId: workOrder?.id ?? null,
      brief: brief as unknown as Record<string, unknown>,
      urgency: brief.urgency,
      compiledBy: ctx.userId,
      status: "compiled",
    }).returning();
    const row = inserted[0];
    if (!row) throw new Error("compile_failed");

    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "repair_request.compiled",
      entityType: "repair_request",
      entityId: row.id,
      diff: { machineTag: machine.tag, source: fault ? "fault" : workOrder ? "work_order" : "machine" },
    });
    return { requestId: row.id };
  },

  /**
   * STEP 2 (send) — the human-confirm gate: this is the ONLY path that leaves the
   * org. The (possibly edited) brief is snapshotted as confirmed_brief before the
   * MarketplaceClient call; status goes compiled → sent, marketplace id recorded.
   */
  async send(
    ctx: Ctx,
    id: string,
    input: { urgency?: Urgency; notes?: string },
  ): Promise<{ marketplaceRequestId: string }> {
    if (!can(ctx.roles, "repairRequests.send")) throw new Error("forbidden:repairRequests.send");
    const db = await getDb();
    const row = await repairRequestsService.byId(ctx, id);
    if (!row) throw new Error("not_found");
    if (row.status !== "compiled") throw new Error(`not_sendable:${row.status}`);

    const base = row.brief as unknown as CompiledBrief;
    const confirmed: CompiledBrief = {
      ...base,
      urgency: input.urgency ?? (row.urgency as Urgency),
      notes: input.notes?.trim() || base.notes || "",
    };

    const marketplace = getIntegrations().marketplace;
    const sent = await marketplace.createRepairRequest({
      localRequestId: row.id,
      orgRef: ctx.orgSlug,
      brief: confirmed,
    });

    await db.update(repairRequests).set({
      status: "sent",
      confirmedBrief: confirmed as unknown as Record<string, unknown>,
      urgency: confirmed.urgency,
      marketplaceRequestId: sent.marketplaceRequestId,
      sentAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(repairRequests.id, row.id));

    await db.insert(repairRequestEvents).values({
      organizationId: ctx.orgId,
      repairRequestId: row.id,
      fromStatus: "compiled",
      toStatus: "sent",
      payload: { marketplaceRequestId: sent.marketplaceRequestId },
      actor: "user",
    });
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "repair_request.sent",
      entityType: "repair_request",
      entityId: row.id,
      diff: { marketplaceRequestId: sent.marketplaceRequestId, urgency: confirmed.urgency },
    });
    return { marketplaceRequestId: sent.marketplaceRequestId };
  },

  /** Pull-based status sync (webhooks are the primary driver; this is reconciliation). */
  async refreshStatus(ctx: Ctx, id: string): Promise<RepairRequestStatus | null> {
    if (!can(ctx.roles, "repairRequests.send")) throw new Error("forbidden:repairRequests.send");
    const row = await repairRequestsService.byId(ctx, id);
    if (!row) throw new Error("not_found");
    if (!row.marketplaceRequestId) throw new Error("not_sent_yet");
    const info = await getIntegrations().marketplace.getRequestStatus(row.marketplaceRequestId);
    return applyMarketplaceUpdate(info);
  },

  /** Discard a compiled (never-sent) draft — nothing left the org, so deletion is allowed. */
  async discard(ctx: Ctx, id: string): Promise<void> {
    if (!can(ctx.roles, "repairRequests.send")) throw new Error("forbidden:repairRequests.send");
    const db = await getDb();
    const row = await repairRequestsService.byId(ctx, id);
    if (!row) throw new Error("not_found");
    if (row.status !== "compiled") throw new Error("only_drafts_can_be_discarded");
    await db.delete(repairRequests).where(eq(repairRequests.id, row.id));
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "repair_request.discarded",
      entityType: "repair_request",
      entityId: row.id,
      diff: {},
    });
  },

  /** Manager withdraw — pre-acceptance only (sent/matched/quoted). */
  async withdraw(ctx: Ctx, id: string, reason: string): Promise<void> {    if (!can(ctx.roles, "repairRequests.send")) throw new Error("forbidden:repairRequests.send");
    const db = await getDb();
    const row = await repairRequestsService.byId(ctx, id);
    if (!row) throw new Error("not_found");
    if (!["sent", "matched", "quoted"].includes(row.status)) throw new Error("not_withdrawable:" + row.status);
    const clean = reason.trim() || "No longer needed";
    if (row.marketplaceRequestId) {
      await getIntegrations().marketplace.cancelRepairRequest(row.marketplaceRequestId, clean, ctx.userId);
    }
    await db.update(repairRequests).set({
      status: "withdrawn",
      cancelledReason: clean,
      updatedAt: new Date(),
    }).where(eq(repairRequests.id, row.id));
    await db.insert(repairRequestEvents).values({
      organizationId: ctx.orgId,
      repairRequestId: row.id,
      fromStatus: row.status,
      toStatus: "withdrawn",
      payload: { reason: clean },
      actor: "user",
    });
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "repair_request.withdrawn",
      entityType: "repair_request",
      entityId: row.id,
      diff: { reason: clean },
    });
  },

  /** Manager confirm+rate — the human-in-the-loop close: completed → confirmed. */
  async confirmAndRate(
    ctx: Ctx,
    id: string,
    input: { rating: 1 | 2 | 3 | 4 | 5; note?: string },
  ): Promise<void> {
    if (!can(ctx.roles, "repairRequests.send")) throw new Error("forbidden:repairRequests.send");
    const db = await getDb();
    const row = await repairRequestsService.byId(ctx, id);
    if (!row) throw new Error("not_found");
    if (row.status !== "completed") throw new Error(`not_confirmable:${row.status}`);
    if (!row.marketplaceRequestId) throw new Error("marketplace_id_missing");

    await getIntegrations().marketplace.submitRating({
      marketplaceRequestId: row.marketplaceRequestId,
      rating: input.rating,
      note: input.note,
    });

    await db.update(repairRequests).set({
      status: "confirmed",
      confirmedAt: new Date(),
      rating: input.rating,
      ratingNote: input.note ?? null,
      updatedAt: new Date(),
    }).where(eq(repairRequests.id, row.id));
    await db.insert(repairRequestEvents).values({
      organizationId: ctx.orgId,
      repairRequestId: row.id,
      fromStatus: "completed",
      toStatus: "confirmed",
      payload: { rating: input.rating },
      actor: "user",
    });
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "repair_request.confirmed",
      entityType: "repair_request",
      entityId: row.id,
      diff: { rating: input.rating },
    });

    // feedback loop: confirmed outcome pushed back to VIDE (Cortex) — best-effort
    try {
      await getIntegrations().cortex.sendConfirmedRootCause({
        eventId: row.faultEventId ?? row.id,
        rootCauseCode: null,
        rootCauseText: input.note ?? row.outcomeSummary ?? "Completed by verified technician",
        workOrderNumber: row.workOrderId ?? row.marketplaceRequestId,
        completedAt: (row.completedAt ?? new Date()).toISOString(),
        confirmedBy: { userId: ctx.userId, name: ctx.name },
      });
    } catch {
      /* contract is already PROPOSED — ignore until VIDE ships it */
    }
  },

  /**
   * DEMO/TEST-ONLY: drive the marketplace lifecycle like webhooks would. Refuses
   * outright when the integration profile is not the mock — a real marketplace is
   * driven only by webhooks and refresh, never by the UI.
   */
  async demoAdvance(ctx: Ctx, id: string, toStatus: MarketplaceRequestStatus): Promise<RepairRequestStatus | null> {
    if (!can(ctx.roles, "repairRequests.send")) throw new Error("forbidden:repairRequests.send");
    const integrations = getIntegrations();
    if (integrations.profile !== "mock") throw new Error("demo_advance_mock_only");
    const dtor = integrations.marketplace as { advance?: (reqId: string, status: MarketplaceRequestStatus) => void };
    if (typeof dtor.advance !== "function") throw new Error("demo_advance_unavailable");
    const db = await getDb();
    const row = await repairRequestsService.byId(ctx, id);
    if (!row) throw new Error("not_found");
    if (!row.marketplaceRequestId) throw new Error("not_sent_yet");
    dtor.advance(row.marketplaceRequestId, toStatus);
    const info = await integrations.marketplace.getRequestStatus(row.marketplaceRequestId);
    return applyMarketplaceUpdate(info);
  },
};

/* ------------------------------------------------------------------ */
/* shared status engine (webhook route + refresh + demo advance)       */
/* ------------------------------------------------------------------ */

const TERMINAL_STATUSES = new Set<MarketplaceRequestStatus>(["declined", "withdrawn", "failed"]);

/** Valid webhook-selectable marketplace statuses (typed whitelist for the route). */
export const MARKETPLACE_WEBHOOK_STATUSES: readonly MarketplaceRequestStatus[] = [
  "sent", "matched", "quoted", "accepted", "en_route", "on_site", "completed", "declined", "withdrawn", "failed",
];

export type MarketplaceWebhookPayload = {
  requestId: string;
  status: MarketplaceRequestStatus;
  technician?: { id: string; name?: string; rating?: number };
  quoteKobo?: number;
  etaAt?: string;
  outcomeSummary?: string;
};

/**
 * Webhook entrypoint: returns null when the marketplace_request_id is unknown
 * (404 for the sender); otherwise applies the transition (idempotent replays
 * return the current status without touching the row).
 */
export async function applyMarketplaceWebhookEvent(payload: MarketplaceWebhookPayload): Promise<RepairRequestStatus | null> {
  const db = await getDb();
  const rows = await db.select({ id: repairRequests.id }).from(repairRequests).where(eq(repairRequests.marketplaceRequestId, payload.requestId)).limit(1);
  if (!rows[0]) return null;
  return applyMarketplaceUpdate(payload);
}

async function applyMarketplaceUpdate(info: {
  requestId: string;
  status: MarketplaceRequestStatus;
  technician?: { id: string; name?: string; rating?: number };
  quoteKobo?: number;
  etaAt?: string;
  outcomeSummary?: string;
}): Promise<RepairRequestStatus | null> {
  const db = await getDb();
  const rows = await db.select().from(repairRequests).where(eq(repairRequests.marketplaceRequestId, info.requestId)).limit(1);
  const row = rows[0];
  if (!row) return null;

  const from = row.status as RepairRequestStatus;
  const to = info.status as RepairRequestStatus;
  if (from === to) return from; // idempotent replays are a no-op
  if (TERMINAL_STATUSES.has(row.status as MarketplaceRequestStatus)) return from; // terminal rows stay put

  const patch: Partial<typeof repairRequests.$inferInsert> = {
    status: to,
    updatedAt: new Date(),
  };
  if (to === "accepted") patch.acceptedAt = new Date();
  if (to === "en_route") patch.enRouteAt = new Date();
  if (to === "on_site") patch.onSiteAt = new Date();
  if (to === "completed") patch.completedAt = new Date();
  if (typeof info.quoteKobo === "number") patch.quoteKobo = Math.round(info.quoteKobo);
  if (typeof info.etaAt === "string" && !Number.isNaN(Date.parse(info.etaAt))) patch.etaAt = new Date(info.etaAt);
  if (typeof info.outcomeSummary === "string") patch.outcomeSummary = info.outcomeSummary;
  if (info.technician?.id) {
    // snapshot the technician identity into the per-org directory (marketplace owns it)
    const existing = await db.select().from(technicianProfiles)
      .where(and(eq(technicianProfiles.organizationId, row.organizationId), eq(technicianProfiles.marketplaceTechnicianId, info.technician.id))).limit(1);
    let techId: string;
    if (existing[0]) {
      techId = existing[0].id;
      await db.update(technicianProfiles).set({
        displayName: info.technician.name ?? existing[0].displayName,
        ratingAvg: typeof info.technician.rating === "number" ? String(info.technician.rating) : existing[0].ratingAvg,
        lastSyncedAt: new Date(),
      }).where(eq(technicianProfiles.id, techId));
    } else {
      const ins = await db.insert(technicianProfiles).values({
        organizationId: row.organizationId,
        marketplaceTechnicianId: info.technician.id,
        displayName: info.technician.name ?? info.technician.id,
        ratingAvg: typeof info.technician.rating === "number" ? String(info.technician.rating) : null,
        lastSyncedAt: new Date(),
      }).returning();
      techId = ins[0]?.id ?? "";
    }
    if (techId) patch.technicianId = techId;
  }

  await db.update(repairRequests).set(patch).where(eq(repairRequests.id, row.id));
  await db.insert(repairRequestEvents).values({
    organizationId: row.organizationId,
    repairRequestId: row.id,
    fromStatus: from,
    toStatus: to,
    payload: info as unknown as Record<string, unknown>,
    actor: "webhook",
  });
  await auditRepo.log(db, {
    organizationId: row.organizationId,
    action: "repair_request.status",
    entityType: "repair_request",
    entityId: row.id,
    actorKind: "system",
    diff: { from, to, technician: info.technician?.id ?? null },
  });
  return to;
}
