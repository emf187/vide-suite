import { cache } from "react";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { type Role } from "@/lib/shared/types";
import { getDb, type AppDb } from "@/server/db/client";
import { memberships, organizations, users } from "@/server/db/base";
import { verifySessionToken } from "@/server/auth/session";

/**
 * The per-request context for Custos: organization + role from the DB-verified
 * session, never from client payloads. Workspaces are one business, so the
 * first live membership IS the org (single-org semantics, same as accounts
 * being one-owner-at-signup).
 */
export type Ctx = {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgSlug: string;
  orgName: string;
  role: Role;
  roles: Role[];
  /** Display + scheduler timezone (brief §7). Fixed Africa/Lagos for the demo. */
  timezone: string;
};

export const getCtx = cache(async (): Promise<Ctx | null> => {
  const jar = await cookies();
  const token = jar.get("custos_session")?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const db = (await getDb()) as AppDb;
  const userRows = await db
    .select({ id: users.id, email: users.email, name: users.name, deactivatedAt: users.deactivatedAt })
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1);
  const user = userRows[0];
  if (!user || user.deactivatedAt) return null;

  const rows = await db
    .select({
      orgId: organizations.id,
      orgSlug: organizations.slug,
      orgName: organizations.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(eq(memberships.userId, user.id)))
    .limit(1);
  const m = rows[0];
  if (!m) return null;

  const role = m.role as Role;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    orgId: m.orgId,
    orgSlug: m.orgSlug,
    orgName: m.orgName,
    role,
    roles: [role],
    timezone: "Africa/Lagos",
  };
});
