import { and, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb, type AppDb } from "@/server/db/client";
import {
  documents,
  machineDevices,
  machineLifecycleLog,
  machines,
  sites,
  type Machine,
} from "@/server/db/schema";
import { auditRepo } from "@/server/repos/audit";
import { getIntegrations } from "@/lib/integrations/factory";

type Lifecycle =
  | "commissioned"
  | "active"
  | "standby"
  | "under_maintenance"
  | "decommissioned";

export type MachineInput = {
  name: string;
  tag: string;
  category: string;
  siteId?: string | null;
  areaId?: string | null;
  make?: string;
  model?: string;
  serialNumber?: string;
  ratedSpecs?: Record<string, unknown>;
  installDate?: string | null;
  warrantyUntil?: string | null;
  criticality?: "A" | "B" | "C";
  locationNote?: string;
  videMachineNames?: string[];
};

export const MACHINE_CATEGORIES = [
  "pump", "motor", "generator", "compressor", "conveyor", "hvac",
  "chiller", "boiler", "cnc", "fan", "mixer", "other",
] as const;

/* ------------------------------ queries ------------------------------ */

export const machinesService = {
  async list(
    ctx: Ctx,
    filters: { q?: string; status?: string; siteId?: string; criticality?: string; category?: string } = {},
  ): Promise<Machine[]> {
    const db = await getDb();
    const conditions = [eq(machines.organizationId, ctx.orgId), isNull(machines.deletedAt)];
    if (filters.status) conditions.push(eq(machines.lifecycleStatus, filters.status as Lifecycle));
    if (filters.criticality) conditions.push(eq(machines.criticality, filters.criticality));
    if (filters.siteId) conditions.push(eq(machines.siteId, filters.siteId));
    if (filters.category) conditions.push(eq(machines.category, filters.category));
    if (filters.q) {
      const term = `%${filters.q}%`;
      const search = or(ilike(machines.name, term), ilike(machines.tag, term), ilike(machines.serialNumber, term));
      if (search) conditions.push(search);
    }
    return db
      .select()
      .from(machines)
      .where(and(...conditions))
      .orderBy(machines.tag);
  },

  async byId(ctx: Ctx, id: string): Promise<Machine | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(machines)
      .where(and(eq(machines.id, id), eq(machines.organizationId, ctx.orgId), isNull(machines.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  },

  /** Include soft-deleted (for archive views). */
  async byIdIncludingArchived(ctx: Ctx, id: string): Promise<Machine | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(machines)
      .where(and(eq(machines.id, id), eq(machines.organizationId, ctx.orgId)))
      .limit(1);
    return rows[0] ?? null;
  },
};

/* ------------------------------ mutations ----------------------------- */

async function assertTagFree(db: AppDb, orgId: string, tag: string, ignoreMachineId?: string) {
  const rows = await db
    .select({ id: machines.id })
    .from(machines)
    .where(and(eq(machines.organizationId, orgId), eq(machines.tag, tag.trim().toUpperCase())));
  const hit = rows[0];
  if (hit && hit.id !== ignoreMachineId) throw new Error(`tag_conflict:${tag}`);
}

export const machinesWriteService = {
  /** Guided setup: create machine (+optional VIDE device links, snapshot, audit). */
  async create(ctx: Ctx, input: MachineInput): Promise<Machine> {
    const db = await getDb();
    const tag = input.tag.trim().toUpperCase();
    await assertTagFree(db, ctx.orgId, tag);
    const rows = await db
      .insert(machines)
      .values({
        organizationId: ctx.orgId,
        siteId: input.siteId || null,
        areaId: input.areaId || null,
        name: input.name,
        tag,
        category: input.category,
        make: input.make,
        model: input.model,
        serialNumber: input.serialNumber,
        ratedSpecs: (input.ratedSpecs ?? {}) as Record<string, unknown>,
        installDate: input.installDate || null,
        warrantyUntil: input.warrantyUntil || null,
        criticality: input.criticality ?? "B",
        locationNote: input.locationNote,
        lifecycleStatus: "commissioned",
        profileSnapshot: {
          name: input.name, tag, category: input.category, criticality: input.criticality ?? "B",
        },
        createdBy: ctx.userId,
      })
      .returning();
    const machine = rows[0];
    if (!machine) throw new Error("machine insert returned no rows");

    await this.linkDevices(ctx, machine.id, input.videMachineNames ?? []);

    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "machine.created",
      entityType: "machine",
      entityId: machine.id,
      diff: { tag, name: machine.name, category: machine.category },
    });
    return machine;
  },

  /** Edit business fields; history-bearing snapshots are never rewritten. */
  async update(ctx: Ctx, id: string, input: Partial<MachineInput>): Promise<Machine> {
    const db = await getDb();
    const machine = await machinesService.byId(ctx, id);
    if (!machine) throw new Error("machine_not_found");
    if (input.tag && input.tag.trim().toUpperCase() !== machine.tag) {
      await assertTagFree(db, ctx.orgId, input.tag.trim().toUpperCase(), machine.id);
    }
    const rows = await db
      .update(machines)
      .set({
        name: input.name ?? machine.name,
        tag: input.tag ? input.tag.trim().toUpperCase() : machine.tag,
        category: input.category ?? machine.category,
        siteId: input.siteId !== undefined ? input.siteId || null : machine.siteId,
        areaId: input.areaId !== undefined ? input.areaId || null : machine.areaId,
        make: input.make ?? machine.make,
        model: input.model ?? machine.model,
        serialNumber: input.serialNumber ?? machine.serialNumber,
        installDate: input.installDate !== undefined ? input.installDate || null : machine.installDate,
        warrantyUntil: input.warrantyUntil !== undefined ? input.warrantyUntil || null : machine.warrantyUntil,
        criticality: input.criticality ?? machine.criticality,
        locationNote: input.locationNote ?? machine.locationNote,
        ratedSpecs: input.ratedSpecs !== undefined ? (input.ratedSpecs as Record<string, unknown>) : machine.ratedSpecs,
        updatedAt: new Date(),
      })
      .where(eq(machines.id, machine.id))
      .returning();
    const updated = rows[0];
    if (!updated) throw new Error("machine update returned no rows");

    if (input.videMachineNames) {
      await this.linkDevices(ctx, machine.id, input.videMachineNames);
    }
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "machine.updated",
      entityType: "machine",
      entityId: machine.id,
      diff: { name: updated.name, siteId: updated.siteId, areaId: updated.areaId },
    });
    return updated;
  },

  /**
   * Rated-specs matrix grid save (sprint item 3). The edit page renders EVERY
   * current spec key as an editable row, so a save is a full replacement of
   * rated_specs — removing a row (blank key/value) genuinely deletes the key.
   * Audit keeps the final key list so the timeline shows what a save produced.
   */
  async updateRatedSpecs(
    ctx: Ctx,
    id: string,
    specs: Record<string, string | number>,
  ): Promise<Machine> {
    const db = await getDb();
    const machine = await machinesService.byId(ctx, id);
    if (!machine) throw new Error("machine_not_found");
    const rows = await db
      .update(machines)
      .set({ ratedSpecs: specs, updatedAt: new Date() })
      .where(eq(machines.id, machine.id))
      .returning();
    const updated = rows[0];
    if (!updated) throw new Error("specs update returned no rows");
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "machine.specs_updated",
      entityType: "machine",
      entityId: machine.id,
      diff: { count: Object.keys(specs).length, keys: Object.keys(specs).sort() },
    });
    return updated;
  },

  /** (Re)link VIDE machines; previous links are kept with unlinked_at set. */
  async linkDevices(ctx: Ctx, machineId: string, videMachineNames: string[]): Promise<void> {
    const db = await getDb();
    const cleanNames = [...new Set(videMachineNames.map((n) => n.trim()).filter(Boolean))];
    const existing = await db
      .select()
      .from(machineDevices)
      .where(and(eq(machineDevices.machineId, machineId), eq(machineDevices.organizationId, ctx.orgId), isNull(machineDevices.unlinkedAt)));
    for (const link of existing) {
      if (!cleanNames.includes(link.videMachineName)) {
        await db
          .update(machineDevices)
          .set({ unlinkedAt: new Date() })
          .where(eq(machineDevices.id, link.id));
      }
    }
    const linkedNames = existing.filter((l) => l.unlinkedAt === null).map((l) => l.videMachineName);
    for (const name of cleanNames) {
      if (!linkedNames.includes(name)) {
        await db.insert(machineDevices).values({
          organizationId: ctx.orgId,
          machineId,
          videMachineName: name,
          kind: "machine",
        });
      }
    }
  },

  /**
   * Webhook ingest (M10 — VIDE SIM → Cogitex). Machine-to-machine pulse; resolves
   * STRICTLY inside the claimed org by name, never by payload-supplied ids.
   * Identity: `videMachineName` = machine name. Site is found-or-created by code/name.
   * A tag collision with a DIFFERENT existing machine links the VIDE pulse into that
   * machine instead of creating a twin (data flows; nothing is destroyed).
   */
  async upsertFromWebhook(
    db: AppDb,
    orgId: string,
    input: {
      name: string;
      tag?: string | null;
      category?: string | null;
      siteName?: string | null;
      siteCode?: string | null;
      make?: string | null;
      model?: string | null;
      criticality?: string | null;
      locationNote?: string | null;
    },
  ): Promise<{ status: "created" | "existed" | "tag_conflict"; machineId: string | null }> {
    const name = input.name.trim();
    if (!name) throw new Error("machine_name_required");

    const sanitizeTag = (raw: string): string =>
      raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    let tag = sanitizeTag(input.tag || name) || "VIDE-MACHINE";
    const category = (MACHINE_CATEGORIES as readonly string[]).includes((input.category ?? "").trim().toLowerCase())
      ? (input.category ?? "").trim().toLowerCase()
      : "other";
    const criticality = (["A", "B", "C"] as const).includes(input.criticality?.trim().toUpperCase() as "A" | "B" | "C")
      ? (input.criticality?.trim().toUpperCase() as "A" | "B" | "C")
      : "B";

    /* ---- site: find-or-create by code, else by name ---- */
    let siteId: string | null = null;
    const siteName = input.siteName?.trim() || null;
    const siteCode = (input.siteCode ?? "").trim().toUpperCase() || null;
    if (siteCode || siteName) {
      const siteRows =
        (siteCode
          ? await db
              .select({ id: sites.id })
              .from(sites)
              .where(and(eq(sites.organizationId, orgId), isNull(sites.deletedAt), sql`upper(${sites.code}) = ${siteCode}`))
              .limit(1)
          : []) as { id: string }[] | undefined;
      let hit = siteRows?.[0];
      if (!hit && siteName) {
        const byName = await db
          .select({ id: sites.id })
          .from(sites)
          .where(and(eq(sites.organizationId, orgId), isNull(sites.deletedAt), sql`lower(${sites.name}) = lower(${siteName})`))
          .limit(1);
        hit = byName[0];
      }
      if (!hit) {
        const code = siteCode || sanitizeTag(siteName ?? "").slice(0, 12) || "SITE";
        await db
          .insert(sites)
          .values({ organizationId: orgId, name: siteName ?? code, code })
          .onConflictDoNothing({ target: [sites.organizationId, sites.code] });
        const recreated = await db
          .select({ id: sites.id })
          .from(sites)
          .where(and(eq(sites.organizationId, orgId), sql`upper(${sites.code}) = upper(${code})`))
          .limit(1);
        hit = recreated[0];
      }
      siteId = hit?.id ?? null;
    }

    /* ---- machine: find by name, else create; adopt/tag-conflict link otherwise ---- */
    const byName = await db
      .select({ id: machines.id })
      .from(machines)
      .where(and(eq(machines.organizationId, orgId), isNull(machines.deletedAt), sql`lower(${machines.name}) = lower(${name})`))
      .limit(1);
    let machineId = byName[0]?.id ?? null;
    let status: "created" | "existed" | "tag_conflict" = byName[0] ? "existed" : "created";

    if (!machineId) {
      const inserted = await db
        .insert(machines)
        .values({
          organizationId: orgId,
          siteId,
          name,
          tag,
          category,
          make: input.make?.trim() || null,
          model: input.model?.trim() || null,
          criticality,
          locationNote: input.locationNote?.trim() || null,
          lifecycleStatus: "commissioned",
          profileSnapshot: { source: "vide-webhook", videName: name, tag, category, criticality },
        })
        .onConflictDoNothing({ target: [machines.organizationId, machines.tag] })
        .returning();
      if (inserted[0]) {
        machineId = inserted[0].id;
      } else {
        const byTag = await db
          .select({ id: machines.id })
          .from(machines)
          .where(and(eq(machines.organizationId, orgId), isNull(machines.deletedAt), eq(machines.tag, tag)))
          .limit(1);
        // Tag belongs to a different machine → link the pulse into it, never overwrite.
        machineId = byTag[0]?.id ?? null;
        status = byTag[0] ? "tag_conflict" : "created";
        if (!machineId) return { status, machineId: null };
      }
    }

    /* ---- device link: ensure one active (org, videMachineName) → machine row ---- */
    const linkRows = await db
      .select({ id: machineDevices.id, machineId: machineDevices.machineId })
      .from(machineDevices)
      .where(and(eq(machineDevices.organizationId, orgId), eq(machineDevices.videMachineName, name), isNull(machineDevices.unlinkedAt)))
      .limit(1);
    if (!linkRows[0]) {
      await db.insert(machineDevices).values({ organizationId: orgId, machineId, videMachineName: name, kind: "machine" });
    }

    await auditRepo.log(db, {
      organizationId: orgId,
      action: "machine.ingested",
      entityType: "machine",
      entityId: machineId,
      actorKind: "system",
      diff: { name, tag, result: status },
    });
    return { status, machineId };
  },

  async linkedMachineNames(ctx: Ctx, machineId: string): Promise<string[]> {    const db = await getDb();
    const rows = await db
      .select({ videMachineName: machineDevices.videMachineName })
      .from(machineDevices)
      .where(and(eq(machineDevices.machineId, machineId), eq(machineDevices.organizationId, ctx.orgId), isNull(machineDevices.unlinkedAt)));
    return rows.map((r) => r.videMachineName);
  },

  /** Lifecycle transition with DATA_MODEL §4.1 rules; decommission/reactivate call VIDE. */
  async transition(
    ctx: Ctx,
    id: string,
    to: Lifecycle,
    opts: {
      reason?: string;
      effectiveAt?: Date;
      partsDisposition?: string;
      openWoPolicy?: "cancel" | "close";
      /** internal: when the target is under_maintenance/active via WO flow */
      viaWorkOrder?: boolean;
    } = {},
  ): Promise<{ machine: Machine; videStatus: string }> {
    const db = await getDb();
    const machine = await machinesService.byId(ctx, id);
    if (!machine) throw new Error("machine_not_found");
    const from = machine.lifecycleStatus;
    if (from === to) throw new Error(`already_${to}`);

    const allowed: Record<Lifecycle, Lifecycle[]> = {
      commissioned: ["active", "decommissioned"],
      active: ["standby", "under_maintenance", "decommissioned"],
      standby: ["active", "decommissioned"],
      under_maintenance: ["active", "decommissioned"] ,
      decommissioned: ["active"],
    };
    if (!allowed[from]?.includes(to)) {
      throw new Error(`illegal_transition:${from}->${to}`);
    }

    let videStatus = "not_applicable";
    if (to === "decommissioned" || (from === "decommissioned" && to === "active")) {
      const action = to === "decommissioned" ? "decommission" : "reactivate";
      const integrations = getIntegrations();
      try {
        const ack = await integrations.vide.postLifecycleNotice({
          machineName: (await this.linkedMachineNames(ctx, id))[0] ?? machine.tag,
          action,
          effectiveAt: (opts.effectiveAt ?? new Date()).toISOString(),
          reason: opts.reason,
          requestedBy: { userId: ctx.userId, name: ctx.name },
          orgRef: ctx.orgId,
        });
        videStatus = ack.accepted ? "acknowledged" : "failed";
      } catch {
        videStatus = "failed";
      }
    }

    const nextStatus = to;
    const rows = await db
      .update(machines)
      .set({
        lifecycleStatus: nextStatus,
        decommission:
          to === "decommissioned"
            ? {
                reason: opts.reason ?? null,
                effectiveAt: (opts.effectiveAt ?? new Date()).toISOString(),
                partsDisposition: opts.partsDisposition ?? null,
                openWoPolicy: opts.openWoPolicy ?? "cancel",
              }
            : null,
        updatedAt: new Date(),
      })
      .where(eq(machines.id, machine.id))
      .returning();
    const updated = rows[0];
    if (!updated) throw new Error("lifecycle update returned no rows");

    await db.insert(machineLifecycleLog).values({
      organizationId: ctx.orgId,
      machineId: machine.id,
      fromStatus: from,
      toStatus: nextStatus,
      reason: opts.reason,
      effectiveAt: opts.effectiveAt,
      actorUserId: ctx.userId,
      videCallStatus: videStatus,
    });
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: `machine.lifecycle.${to}`,
      entityType: "machine",
      entityId: machine.id,
      diff: { from, to: nextStatus, reason: opts.reason },
    });
    return { machine: updated, videStatus };
  },

  /**
   * Remove: soft delete by default; hard delete only for machines with ZERO records,
   * admin only (brief §5.6). A hard-deleted machine has no history to lose.
   */
  async remove(
    ctx: Ctx,
    id: string,
    mode: "soft" | "hard",
  ): Promise<{ ok: true; mode: "soft" | "hard" }> {
    const db = await getDb();
    const machine = await machinesService.byIdIncludingArchived(ctx, id);
    if (!machine) throw new Error("machine_not_found");
    if (mode === "hard") {
      if (!ctx.roles.some((r) => r === "owner" || r === "admin")) throw new Error("forbidden_hard_delete");
      const { count } = await import("drizzle-orm");
      const probe = async (table: typeof machineDevices | typeof machineLifecycleLog | typeof documents) =>
        Number(
          (await db.select({ n: count() }).from(table).where(eq(table.machineId, id)))[0]?.n ?? 0,
        );
      const records = [await probe(machineDevices), await probe(machineLifecycleLog), await probe(documents)];
      if (records.some((n) => n > 0)) throw new Error("history_exists_cannot_hard_delete");
      await db.delete(machines).where(eq(machines.id, machine.id));
    } else {
      await db
        .update(machines)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(machines.id, machine.id));
    }
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: mode === "hard" ? "machine.hard_deleted" : "machine.soft_deleted",
      entityType: "machine",
      entityId: machine.id,
      diff: { tag: machine.tag, mode },
    });
    return { ok: true, mode };
  },
};
