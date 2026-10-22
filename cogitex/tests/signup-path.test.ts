import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, testId } from "./helpers/db";
import { auditLogs } from "@/server/db/schema";
import { loadSessionContext } from "@/server/ctx";
import { createAccount } from "@/server/services/accounts";
import { usersRepo } from "@/server/repos/users";
import { verifyPassword } from "@/server/auth/password";
import { orgsRepo } from "@/server/repos/orgs";

/**
 * Exercises the exact DB path the sign-up action uses (service layer),
 * across user + credential + organization + owner membership + audit.
 */
describe("signup service path", () => {
  it("creates account with owner membership, credential and audit trail", { timeout: 30_000 }, async () => {
    const db = await createTestDb();
    const email = `owner-${testId()}@x.io`;

    const result = await createAccount(db, {
      orgName: "Kaduna Mills",
      fullName: "Halima Bala",
      email,
      password: "strong-pass-1",
    });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;

    expect(result.organization.slug).toBe("kaduna-mills");

    // Session context resolves owner role for the right org
    const ctx = await loadSessionContext(db, result.user.id);
    expect(ctx.user?.email).toBe(email);
    expect(ctx.memberships).toHaveLength(1);
    expect(ctx.memberships[0]?.role).toBe("owner");
    expect(ctx.memberships[0]?.orgId).toBe(result.organization.id);

    // Credential verifies (raw password against stored identity hash)
    const identity = await usersRepo.getPasswordIdentity(db, email);
    expect(identity?.provider).toBe("password");
    expect(identity?.passwordHash).toBeTruthy();
    expect(identity?.passwordHash ? await verifyPassword("strong-pass-1", identity.passwordHash) : false).toBe(true);
    expect(identity?.passwordHash ? await verifyPassword("wrong", identity.passwordHash) : false).toBe(false);

    // Audit trail captured the lifecycle
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, result.organization.id));
    expect(logs.some((l) => l.action === "org.created")).toBe(true);
  });

  it("rejects duplicate email signups", { timeout: 30_000 }, async () => {
    const db = await createTestDb();
    const email = `dup-${testId()}@x.io`;
    const first = await createAccount(db, { orgName: "Alpha Plant", fullName: "A One", email, password: "password-1" });
    expect(first.kind).toBe("created");
    const second = await createAccount(db, { orgName: "Beta Plant", fullName: "A Two", email, password: "password-2" });
    expect(second.kind).toBe("email_conflict");
  });

  it("resolves slug collisions with a suffix, keeping history intact", { timeout: 30_000 }, async () => {
    const db = await createTestDb();
    await orgsRepo.create(db, { name: "Demo Plant Existing", slug: "demo-plant" });
    const result = await createAccount(db, {
      orgName: "Demo Plant",
      fullName: "S Ojo",
      email: `ojo-${testId()}@x.io`,
      password: "password-3",
    });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    const slug = result.organization.slug;
    expect(slug).toMatch(/^demo-plant-/);
    expect(slug).not.toBe("demo-plant");
  });
});
