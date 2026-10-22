import { and, eq } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb } from "@/server/db/client";
import { memberships, users } from "@/server/db/schema";

/** Org directory for assignees / logging labor for others (org/user always session-derived). */
export const orgMembersService = {
  async list(ctx: Ctx): Promise<{ userId: string; name: string; email: string; role: string }[]> {
    const db = await getDb();
    const rows = await db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.isActive, true)))
      .orderBy(users.name);
    return rows;
  },
};
