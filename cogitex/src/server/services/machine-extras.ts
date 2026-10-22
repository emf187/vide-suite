import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb, type AppDb } from "@/server/db/client";
import {
  auditLogs,
  documents,
  machineComponents,
  machineDevices,
  machineLifecycleLog,
  type MachineComponent,
} from "@/server/db/schema";
import { auditRepo } from "@/server/repos/audit";

/** Machine BOM components ("Parts" tab). Compatible inventory items attach in M3. */
export const componentsService = {
  async listForMachine(ctx: Ctx, machineId: string): Promise<MachineComponent[]> {
    const db = await getDb();
    return db
      .select()
      .from(machineComponents)
      .where(and(eq(machineComponents.organizationId, ctx.orgId), eq(machineComponents.machineId, machineId)))
      .orderBy(machineComponents.name);
  },

  async add(
    ctx: Ctx,
    machineId: string,
    input: { name: string; tag?: string; kind?: string; note?: string },
  ): Promise<MachineComponent> {
    const db = await getDb();
    const rows = await db
      .insert(machineComponents)
      .values({
        organizationId: ctx.orgId,
        machineId,
        name: input.name,
        tag: input.tag || null,
        kind: input.kind || "assembly",
        note: input.note || null,
      })
      .returning();
    const comp = rows[0];
    if (!comp) throw new Error("component insert returned no rows");
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "machine.component_added",
      entityType: "machine",
      entityId: machineId,
      diff: { component: comp.name, kind: comp.kind },
    });
    return comp;
  },
};

/** Linked VIDE devices incl. unlinked history (Overview + Health tabs). */
export async function listLinkedDevices(ctx: Ctx, machineId: string) {
  const db = await getDb();
  return db
    .select()
    .from(machineDevices)
    .where(and(eq(machineDevices.organizationId, ctx.orgId), eq(machineDevices.machineId, machineId)))
    .orderBy(desc(machineDevices.linkedAt));
}

/** Timeline tab: lifecycle transitions + audit entries merged on wall-clock desc. */
export type TimelineEntry = {
  at: Date;
  kind: "lifecycle" | "audit";
  label: string;
  detail?: string;
  videStatus?: string;
};

export const timelineService = {
  async forMachine(ctx: Ctx, machineId: string): Promise<TimelineEntry[]> {
    const db = await getDb();
    const [lifecycle, audits] = await Promise.all([
      db
        .select()
        .from(machineLifecycleLog)
        .where(and(eq(machineLifecycleLog.organizationId, ctx.orgId), eq(machineLifecycleLog.machineId, machineId))),
      db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.organizationId, ctx.orgId), eq(auditLogs.entityId, machineId), or(eq(auditLogs.entityType, "machine"), eq(auditLogs.entityType, "document")))),
    ]);

    const entries: TimelineEntry[] = [];
    for (const l of lifecycle) {
      entries.push({
        at: l.createdAt,
        kind: "lifecycle",
        label: `lifecycle → ${l.toStatus}`,
        detail: [l.fromStatus ? `from ${l.fromStatus}` : null, l.reason ?? null].filter(Boolean).join(" · ") || undefined,
        videStatus: l.videCallStatus,
      });
    }
    for (const a of audits) {
      entries.push({ at: a.occurredAt, kind: "audit", label: a.action, detail: undefined });
    }
    entries.sort((a, b) => b.at.getTime() - a.at.getTime());
    return entries;
  },

  /** Documents tab count etc. */
  async docCount(ctx: Ctx, machineId: string): Promise<number> {
    const db = await getDb();
    const rows = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.organizationId, ctx.orgId), eq(documents.machineId, machineId), isNull(documents.deletedAt)));
    return rows.length;
  },
};

export type { AppDb };
