import { and, eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { userAuthIdentities, users, type User } from "@/server/db/schema";

export const usersRepo = {
  async findByEmail(db: AppDb, email: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    return rows[0] ?? null;
  },

  async findById(db: AppDb, id: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  },

  /**
   * Create a user plus its 'password' auth identity (scrypt hash stored on the identity).
   * Runs inline with the caller-transaction when `db` is a transaction handle.
   */
  async create(
    db: AppDb,
    input: { name: string; email: string; phone?: string; passwordHash: string },
  ): Promise<User> {
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
    const rows = await db
      .select({ deactivatedAt: users.deactivatedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const row = rows[0];
    return row !== undefined && row.deactivatedAt !== null;
  },
};
