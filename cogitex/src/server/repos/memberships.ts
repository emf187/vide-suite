import { and, count, eq } from "drizzle-orm";
import type { Role } from "@/lib/shared/types";
import type { AppDb } from "@/server/db/client";
import { memberships, type Membership } from "@/server/db/schema";

export const membershipsRepo = {
  async listForUser(db: AppDb, userId: string): Promise<Membership[]> {
    return db.select().from(memberships).where(eq(memberships.userId, userId));
  },

  async listForOrg(db: AppDb, orgId: string): Promise<Membership[]> {
    return db.select().from(memberships).where(eq(memberships.organizationId, orgId));
  },

  async create(db: AppDb, input: { organizationId: string; userId: string; role: Role; invitedBy?: string }): Promise<Membership> {
    const rows = await db
      .insert(memberships)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        invitedBy: input.invitedBy,
      })
      .returning();
    const m = rows[0];
    if (!m) throw new Error("membership insert returned no rows");
    return m;
  },

  async countActive(db: AppDb, orgId: string): Promise<number> {
    const rows = await db
      .select({ n: count() })
      .from(memberships)
      .where(and(eq(memberships.organizationId, orgId), eq(memberships.isActive, true)));
    const row = rows[0];
    return row ? Number(row.n) : 0;
  },
};
