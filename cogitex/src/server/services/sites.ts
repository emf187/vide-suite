import { and, eq, isNull } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb } from "@/server/db/client";
import { areas, sites, type Area, type Site } from "@/server/db/schema";
import { auditRepo } from "@/server/repos/audit";

export const sitesService = {
  async list(ctx: Ctx): Promise<Site[]> {
    const db = await getDb();
    return db
      .select()
      .from(sites)
      .where(and(eq(sites.organizationId, ctx.orgId), isNull(sites.deletedAt)))
      .orderBy(sites.code);
  },

  async create(ctx: Ctx, input: { name: string; code: string; address?: string }): Promise<Site> {
    const db = await getDb();
    const rows = await db
      .insert(sites)
      .values({
        organizationId: ctx.orgId,
        name: input.name,
        code: input.code.trim().toUpperCase(),
        address: input.address,
      })
      .returning();
    const site = rows[0];
    if (!site) throw new Error("site insert returned no rows");
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "site.created",
      entityType: "site",
      entityId: site.id,
      diff: { name: site.name, code: site.code },
    });
    return site;
  },

  async softDelete(ctx: Ctx, id: string): Promise<void> {
    const db = await getDb();
    await db
      .update(sites)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(sites.id, id), eq(sites.organizationId, ctx.orgId)));
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "site.deleted",
      entityType: "site",
      entityId: id,
    });
  },
};

export const areasService = {
  async list(ctx: Ctx, siteId?: string): Promise<Area[]> {
    const db = await getDb();
    const conditions = [eq(areas.organizationId, ctx.orgId), isNull(areas.deletedAt)];
    if (siteId) conditions.push(eq(areas.siteId, siteId));
    return db
      .select()
      .from(areas)
      .where(and(...conditions))
      .orderBy(areas.code);
  },

  async create(ctx: Ctx, input: { siteId: string; name: string; code: string; kind?: "area" | "line" }): Promise<Area> {
    const db = await getDb();
    const rows = await db
      .insert(areas)
      .values({
        organizationId: ctx.orgId,
        siteId: input.siteId,
        name: input.name,
        code: input.code.trim().toUpperCase(),
        kind: input.kind ?? "area",
      })
      .returning();
    const area = rows[0];
    if (!area) throw new Error("area insert returned no rows");
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "area.created",
      entityType: "area",
      entityId: area.id,
      diff: { name: area.name, code: area.code, siteId: area.siteId },
    });
    return area;
  },
};
