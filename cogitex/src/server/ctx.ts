import { and, eq } from "drizzle-orm";
import { type Role } from "@/lib/shared/types";
import { getDb, type AppDb } from "@/server/db/client";
import { memberships, organizations, users } from "@/server/db/schema";
import { verifySessionToken } from "@/server/auth/session";
import { SESSION_COOKIE } from "@/server/auth/constants";
import { cookies } from "next/headers";
import { cache } from "react";

/**
 * The per-request context. Organization/roles always come from the DB-verified session —
 * never from client payloads. Everything tenant-scoped downstream builds on this (docs/ARCHITECTURE.md §4).
 */
export type Ctx = {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgSlug: string;
  orgName: string;
  currency: string;
  timezone: string;
  roles: Role[];
};

type SessionRow = {
  user: { id: string; email: string; name: string } | null;
  memberships: { orgId: string; orgSlug: string; orgName: string; currency: string; timezone: string; role: Role }[];
};

/** Load user + active memberships from the DB by user id. Org-less users are valid (no org joined yet). */
export async function loadSessionContext(db: AppDb, userId: string): Promise<SessionRow> {
  const userRows = await db
    .select({ id: users.id, email: users.email, name: users.name, deactivatedAt: users.deactivatedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = userRows[0];
  if (!user || user.deactivatedAt) return { user: null, memberships: [] };

  const memberRows = await db
    .select({
      orgId: organizations.id,
      orgSlug: organizations.slug,
      orgName: organizations.name,
      currency: organizations.currency,
      timezone: organizations.timezone,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(and(eq(memberships.userId, userId), eq(memberships.isActive, true)));

  return {
    user: { id: user.id, email: user.email, name: user.name },
    memberships: memberRows,
  };
}

/**
 * Build the request Ctx from the session cookie.
 * Uses React cache() so multiple server components in one render share it.
 */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const db = await getDb();
  const row = await loadSessionContext(db, payload.sub);
  if (!row.user || row.memberships.length === 0) return null;
  const active = row.memberships[0];
  if (!active) return null;
  return {
    userId: row.user.id,
    email: row.user.email,
    name: row.user.name,
    orgId: active.orgId,
    orgSlug: active.orgSlug,
    orgName: active.orgName,
    currency: active.currency,
    timezone: active.timezone,
    roles: row.memberships.map((m) => m.role),
  };
});

/** Strict variant for pages/actions that require a session (redirect if missing). */
export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) throw new Error("UNAUTHENTICATED");
  return ctx;
}
