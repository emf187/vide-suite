import { and, asc, eq, isNull } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { memberships, organizations, users, userAuthIdentities, type Membership, type Organization, type User } from "@/server/db/base";

export const usersRepo = {
  async findByEmail(db: AppDb, email: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    return rows[0] ?? null;
  },

  async findById(db: AppDb, id: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  },

  /** INSERT-only creation: a signup NEVER updates an existing account (M0). */
  async create(db: AppDb, input: { name: string; email: string; phone?: string; passwordHash: string }): Promise<User> {
    const rows = await db
      .insert(users)
      .values({ name: input.name, email: input.email.toLowerCase(), phone: input.phone })
      .returning();
    const user = rows[0];
    if (!user) throw new Error("user insert returned no rows");
    await db.insert(userAuthIdentities).values({
      userId: user.id,
      provider: "password",
      subject: user.email,
      passwordHash: input.passwordHash,
    });
    return user;
  },

  async setPasswordHash(db: AppDb, userId: string, passwordHash: string): Promise<void> {
    const rows = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    const email = rows[0]?.email;
    if (!email) throw new Error("user_not_found");
    await db
      .update(userAuthIdentities)
      .set({ passwordHash })
      .where(and(eq(userAuthIdentities.provider, "password"), eq(userAuthIdentities.subject, email)));
  },

  async getPasswordIdentity(db: AppDb, email: string) {
    const rows = await db
      .select()
      .from(userAuthIdentities)
      .where(and(eq(userAuthIdentities.provider, "password"), eq(userAuthIdentities.subject, email.toLowerCase())))
      .limit(1);
    return rows[0] ?? null;
  },

  /** Tenant safety net: a deactivated user must never build a Ctx. */
  async isDeactivated(db: AppDb, userId: string): Promise<boolean> {
    const rows = await db.select({ deactivatedAt: users.deactivatedAt }).from(users).where(eq(users.id, userId)).limit(1);
    return rows[0]?.deactivatedAt != null;
  },
};

export const orgsRepo = {
  async create(db: AppDb, input: { name: string; slug: string }): Promise<Organization> {
    const rows = await db.insert(organizations).values({ name: input.name, slug: input.slug }).returning();
    const org = rows[0];
    if (!org) throw new Error("org insert returned no rows");
    return org;
  },
  async findBySlug(db: AppDb, slug: string): Promise<Organization | null> {
    const rows = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
    return rows[0] ?? null;
  },
};

export const membershipsRepo = {
  async create(db: AppDb, input: { organizationId: string; userId: string; role: string }): Promise<Membership> {
    const rows = await db.insert(memberships).values(input).returning();
    const m = rows[0];
    if (!m) throw new Error("membership insert returned no rows");
    return m;
  },

  async listForUser(db: AppDb, userId: string): Promise<(Membership & { org: Organization })[]> {
    const rows = await db
      .select({ membership: memberships, org: organizations })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(memberships.createdAt));
    return rows.map((r) => ({ ...r.membership, org: r.org }));
  },

  /** The org a user belongs to (Custos workspaces are one business each). */
  async firstActiveOrg(db: AppDb, userId: string): Promise<{ membership: Membership; org: Organization } | null> {
    const rows = await db
      .select({ membership: memberships, org: organizations })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.userId, userId), isNull(users.deactivatedAt)))
      .orderBy(asc(memberships.createdAt))
      .limit(1);
    const row = rows[0];
    return row ? { membership: row.membership, org: row.org } : null;
  },
};
