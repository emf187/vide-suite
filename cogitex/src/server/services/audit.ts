import { and, desc, eq, sql } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb } from "@/server/db/client";
import { auditLogs, users } from "@/server/db/schema";

/**
 * Org-wide audit trail (docs/DATA_MODEL.md §3.10). Reads are read-only and
 * org-scoped; the writer side lives in repos/audit (auditRepo.log). Techs and
 * viewers are walled out by the `audit.view` ability — this log exists for
 * governance: who did what, to what, when.
 */
export const auditService = {
  /**
   * Newest-first log with actor names resolved (system/webhook rows have no
   * user — actorKind carries them). Optional entityType filter, clamped limit.
   */
  async list(
    ctx: Ctx,
    opts: { entityType?: string; limit?: number } = {},
  ): Promise<AuditEntry[]> {
    const db = await getDb();
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const conds = [eq(auditLogs.organizationId, ctx.orgId)];
    if (opts.entityType) conds.push(eq(auditLogs.entityType, opts.entityType));

    return db
      .select({
        id: auditLogs.id,
        occurredAt: auditLogs.occurredAt,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        actorKind: auditLogs.actorKind,
        diff: auditLogs.diff,
        actorName: users.name,
        actorEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(and(...conds))
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(limit);
  },

  /** Events per entityType across the whole org — powers the filter chips. */
  async countsByType(ctx: Ctx): Promise<{ type: string; n: number }[]> {
    const db = await getDb();
    return db
      .select({
        type: auditLogs.entityType,
        n: sql<number>`count(*)::int`,
      })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, ctx.orgId))
      .groupBy(auditLogs.entityType)
      .orderBy(desc(sql`count(*)`));
  },

  /** Total events in the org (the header line). */
  async total(ctx: Ctx): Promise<number> {
    const db = await getDb();
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, ctx.orgId));
    return row?.n ?? 0;
  },
};

export type AuditEntry = {
  id: string;
  occurredAt: Date;
  action: string;
  entityType: string;
  entityId: string;
  actorKind: string;
  diff: unknown;
  actorName: string | null;
  actorEmail: string | null;
};
