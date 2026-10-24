import { and, asc, eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { getDb } from "@/server/db/client";
import { persons } from "@/server/db/schema";
import { auditRepo } from "@/server/repos/audit";
import type { Ctx } from "@/server/ctx";
import type { Role } from "@/lib/shared/types";

/**
 * Person registry (brief §4.1): the owner adds people in the dashboard; the
 * PERSON owns consent — START from their number flips opted_in, STOP flips
 * stopped. resolve() only ever returns opted-in, active persons: the inbound
 * pipeline silently ignores everyone else (unregistered = one polite reply).
 */
export const personsService = {
  async register(ctx: Ctx, input: { name: string; role: Role; phone: string }) {
    const db = (await getDb()) as AppDb;
    const phone = normalizePhone(input.phone);
    try {
      const [row] = await db
        .insert(persons)
        .values({ organizationId: ctx.orgId, name: input.name.trim(), role: input.role, phoneE164: phone })
        .returning();
      if (!row) throw new Error("person insert returned no rows");
      await auditRepo.log(db, {
        organizationId: ctx.orgId,
        actorUserId: ctx.userId,
        action: "person.added",
        entity: "person",
        entityId: row.id,
        after: { name: row.name, role: row.role, phoneE164: row.phoneE164 },
      });
      return row;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("persons_org_phone_key")) throw new Error("phone_conflict");
      if (message.includes("invalid input value for enum")) throw new Error("bad_role");
      throw err;
    }
  },

  async list(ctx: Ctx) {
    const db = (await getDb()) as AppDb;
    return db
      .select()
      .from(persons)
      .where(eq(persons.organizationId, ctx.orgId))
      .orderBy(asc(persons.createdAt));
  },

  /**
   * Inbound resolver: phone → person, ONLY for opted-in, active numbers.
   * Unused today (pipeline lands in M1/M2) but the tenant wall starts here.
   */
  async resolveByPhone(orgId: string, phone: string) {
    const db = (await getDb()) as AppDb;
    const rows = await db
      .select()
      .from(persons)
      .where(
        and(
          eq(persons.organizationId, orgId),
          eq(persons.phoneE164, normalizePhone(phone)),
          eq(persons.consentStatus, "opted_in"),
        ),
      )
      .limit(1);
    const alive = rows[0];
    if (!alive || alive.deactivatedAt) return null;
    return alive;
  },

  async setConsent(ctx: Ctx, phone: string, status: "opted_in" | "stopped") {
    const db = (await getDb()) as AppDb;
    const [row] = await db
      .update(persons)
      .set({ consentStatus: status, consentAt: new Date(), updatedAt: new Date() })
      .where(and(eq(persons.organizationId, ctx.orgId), eq(persons.phoneE164, normalizePhone(phone))))
      .returning();
    if (!row) throw new Error("person_not_found");
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      action: status === "opted_in" ? "consent.started" : "consent.stopped",
      entity: "person",
      entityId: row.id,
      after: { consentStatus: status },
    });
    return row;
  },
};

/** E.164 normalizer: strip everything but digits, restore the leading plus. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  return `+${digits}`;
}
