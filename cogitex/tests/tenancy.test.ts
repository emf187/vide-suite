import { describe, expect, it } from "vitest";
import { createTestDb, testId } from "./helpers/db";
import { loadSessionContext } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import type { Role } from "@/lib/shared/types";

/**
 * Tenancy-isolation suite (brief §7): a user from one organization must never
 * receive another organization's context, and deactivated users get nothing.
 */
describe("tenancy: session context isolation", () => {
  it("returns only the user's own organization and roles", async () => {
    const db = await createTestDb();

    const passwordHashPlaceholder =
      "$scrypt-mock$"; // not used for sign-in in this suite; creation requires a hash string

    // Org A with owner Alice
    const orgA = await orgsRepo.create(db, { name: "Plant A", slug: `plant-a-${testId()}` });
    const alice = await usersRepo.create(db, { name: "Alice Okoro", email: `alice-${testId()}@x.io`, passwordHash: passwordHashPlaceholder });
    await membershipsRepo.create(db, { organizationId: orgA.id, userId: alice.id, role: "owner" });

    // Org B with member Bob
    const orgB = await orgsRepo.create(db, { name: "Plant B", slug: `plant-b-${testId()}` });
    const bob = await usersRepo.create(db, { name: "Bob Danjuma", email: `bob-${testId()}@x.io`, passwordHash: passwordHashPlaceholder });
    await membershipsRepo.create(db, { organizationId: orgB.id, userId: bob.id, role: "technician" });

    const ctxA = await loadSessionContext(db, alice.id);
    expect(ctxA.user).not.toBeNull();
    expect(ctxA.memberships).toHaveLength(1);
    expect(ctxA.memberships[0]?.orgId).toBe(orgA.id);
    expect(ctxA.memberships[0]?.role).toBe("owner");

    const ctxB = await loadSessionContext(db, bob.id);
    expect(ctxB.memberships[0]?.orgId).toBe(orgB.id);
    // The org ids must never cross-contaminate:
    expect(ctxB.memberships.some((m) => m.orgId === orgA.id)).toBe(false);
    expect(ctxA.memberships.some((m) => m.orgId === orgB.id)).toBe(false);
  });

  it("deactivated users resolve to no session", async () => {
    const db = await createTestDb();
    const org = await orgsRepo.create(db, { name: "Plant C", slug: `plant-c-${testId()}` });
    const user = await usersRepo.create(db, { name: "T Chai", email: `chai-${testId()}@x.io`, passwordHash: "x" });
    await membershipsRepo.create(db, { organizationId: org.id, userId: user.id, role: "technician" });

    // Simulate deactivation
    const { eq } = await import("drizzle-orm");
    await db.update((await import("@/server/db/schema")).users)
      .set({ deactivatedAt: new Date() })
      .where(eq((await import("@/server/db/schema")).users.id, user.id));

    const ctx = await loadSessionContext(db, user.id);
    expect(ctx.user).toBeNull();
    expect(ctx.memberships).toHaveLength(0);
  });

  it("inactive membership excludes the org from the session", async () => {
    const db = await createTestDb();
    const org = await orgsRepo.create(db, { name: "Plant D", slug: `plant-d-${testId()}` });
    const user = await usersRepo.create(db, { name: "D Uche", email: `uche-${testId()}@x.io`, passwordHash: "x" });
    const membership = await membershipsRepo.create(db, { organizationId: org.id, userId: user.id, role: "viewer" });

    const { eq } = await import("drizzle-orm");
    const { memberships } = await import("@/server/db/schema");
    await db.update(memberships).set({ isActive: false }).where(eq(memberships.id, membership.id));

    const ctx = await loadSessionContext(db, user.id);
    expect(ctx.memberships).toHaveLength(0);
  });
});
