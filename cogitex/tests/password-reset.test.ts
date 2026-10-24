import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { createAccount, confirmPasswordReset, requestPasswordReset } from "@/server/services/accounts";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { passwordResetTokens } from "@/server/db/schema";

let db: AppDb;
let ctx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);
  const org = await orgsRepo.create(db, { name: "M0 Plant", slug: `m0-${testId()}` });
  const owner = await usersRepo.create(db, { name: "M0 Owner", email: `m0-${testId()}@x.io`, passwordHash: await hashPassword("original-secret-99") });
  await membershipsRepo.create(db, { organizationId: org.id, userId: owner.id, role: "owner" });
  ctx = { userId: owner.id, email: owner.email, name: owner.name, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos", roles: ["owner"] };
});

afterEach(() => {
  __resetDbForTests();
});

describe("M0 security: account creation can never overwrite an existing account", () => {
  it("a signup with an existing email is refused and leaves the original credential untouched", async () => {
    const before = await usersRepo.getPasswordIdentity(db, ctx.email);
    expect(before?.passwordHash).toBeTruthy();

    const attempt = await createAccount(db, {
      orgName: "Intruder Industries",
      fullName: "Intruder",
      email: ctx.email, // existing email!
      password: "hijack-attempt-1",
    });
    expect(attempt.kind).toBe("email_conflict");

    const after = await usersRepo.getPasswordIdentity(db, ctx.email);
    expect(after?.passwordHash).toBe(before?.passwordHash); // hash byte-identical — no overwrite
    if (after?.passwordHash) {
      expect(await verifyPassword("original-secret-99", after.passwordHash)).toBe(true);
      expect(await verifyPassword("hijack-attempt-1", after.passwordHash)).toBe(false);
    }
  });

  it("the token request burns previous unused tokens for the user", async () => {
    const first = await requestPasswordReset(db, ctx.email);
    expect(first).not.toBeNull();
    const second = await requestPasswordReset(db, ctx.email);
    expect(second).not.toBeNull();

    const unused = await db
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.userId, ctx.userId), isNull(passwordResetTokens.usedAt)));
    expect(unused).toHaveLength(1); // the newest one lives; the older token is burned

    if (first && second) {
      expect(await confirmPasswordReset(db, first.token, "attacker-password")).toBe(false);
      expect(await confirmPasswordReset(db, second.token, "fresh-secret-77")).toBe(true);
    }

    const after = await usersRepo.getPasswordIdentity(db, ctx.email);
    if (after?.passwordHash) {
      expect(await verifyPassword("fresh-secret-77", after.passwordHash)).toBe(true);
      expect(await verifyPassword("original-secret-99", after.passwordHash)).toBe(false);
    }
  });

  it("tokens are single-use and expire on schedule", async () => {
    const reset = await requestPasswordReset(db, ctx.email);
    expect(reset).not.toBeNull();
    if (!reset) return;
    expect(reset.expiresAt.getTime()).toBeGreaterThan(Date.now());

    expect(await confirmPasswordReset(db, reset.token, "once-only-88")).toBe(true);
    expect(await confirmPasswordReset(db, reset.token, "reuse-attempt")).toBe(false); // consumed
  });

  it("an expired token is refused", async () => {
    const reset = await requestPasswordReset(db, ctx.email);
    expect(reset).not.toBeNull();
    if (!reset) return;
    await db.update(passwordResetTokens).set({ expiresAt: new Date(Date.now() - 1_000) });
    expect(await confirmPasswordReset(db, reset.token, "late-attempt")).toBe(false);
  });

  it("unknown emails get silence — no token, no row, no reveal", async () => {
    const result = await requestPasswordReset(db, `nope-${testId()}@nowhere.example`);
    expect(result).toBeNull();
    const rows = await db.select().from(passwordResetTokens);
    expect(rows).toHaveLength(0);
  });
});
