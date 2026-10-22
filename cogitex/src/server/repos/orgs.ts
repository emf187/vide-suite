import { eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { organizations, type Organization } from "@/server/db/schema";

export const orgsRepo = {
  async findBySlug(db: AppDb, slug: string): Promise<Organization | null> {
    const rows = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
    return rows[0] ?? null;
  },

  async findById(db: AppDb, id: string): Promise<Organization | null> {
    const rows = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async create(
    db: AppDb,
    input: { name: string; slug: string; currency?: string; timezone?: string },
  ): Promise<Organization> {
    const rows = await db
      .insert(organizations)
      .values({
        name: input.name,
        slug: input.slug,
        currency: input.currency ?? "NGN",
        timezone: input.timezone ?? "Africa/Lagos",
      })
      .returning();
    const org = rows[0];
    if (!org) throw new Error("organization insert returned no rows");
    return org;
  },
};
