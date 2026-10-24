import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { membershipsRepo, orgsRepo, usersRepo } from "@/server/repos/base";
import { personsService } from "@/server/services/persons";

let db: AppDb;
let ctx: Ctx;
let otherCtx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);

  const org = await orgsRepo.create(db, { name: "Demo Kitchen", slug: `demo-kitchen-${testId()}` });
  const owner = await usersRepo.create(db, { name: "Ada Owner", email: `o-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: owner.id, role: "owner" });
  ctx = { userId: owner.id, email: owner.email, name: owner.name, orgId: org.id, orgSlug: org.slug, orgName: org.name, role: "owner", roles: ["owner"] };

  const org2 = await orgsRepo.create(db, { name: "Rival Kitchen", slug: `rival-${testId()}` });
  const outsider = await usersRepo.create(db, { name: "Rival Owner", email: `r-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org2.id, userId: outsider.id, role: "owner" });
  otherCtx = { ...ctx, userId: outsider.id, orgId: org2.id, orgSlug: org2.slug, orgName: org2.name };
});

afterEach(() => {
  __resetDbForTests();
});

describe("persons: registration with consent (§4.1) + the tenant wall (§10)", () => {
  it("registers a person pending consent; START then STOP flip consent; phone stays unique per org", async () => {
    const phone = `+234803000${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const person = await personsService.register(ctx, { name: "Ada Cook", role: "staff", phone });
    expect(person.consentStatus).toBe("pending");

    const optedIn = await personsService.setConsent(ctx, phone, "opted_in");
    expect(optedIn.consentStatus).toBe("opted_in");
    expect(await personsService.setConsent(ctx, phone, "stopped")).toMatchObject({ consentStatus: "stopped" });

    await expect(personsService.register(ctx, { name: "Duplicate Ada", role: "staff", phone })).rejects.toThrow("phone_conflict");
  });

  it("tenants are walled: a rival org's list never contains Demo Kitchen's people, and it can register the same phone", async () => {
    const phone = `+234803${String(Math.floor(Math.random() * 9000000) + 1000000)}`;
    const mine = await personsService.register(ctx, { name: "Ada Cook", role: "staff", phone });
    expect(mine.organizationId).toBe(ctx.orgId);

    const rivalList = await personsService.list(otherCtx);
    expect(rivalList).toHaveLength(0);

    const rivalCopy = await personsService.register(otherCtx, { name: "Other Ada", role: "staff", phone });
    expect(rivalCopy.organizationId).toBe(otherCtx.orgId); // same phone is fine across orgs

    const mineList = await personsService.list(ctx);
    expect(mineList).toHaveLength(1);
    expect(mineList[0]?.name).toBe("Ada Cook");
  });

  it("STOPped numbers are silent: the inbound resolver ignores them for messaging", async () => {
    await personsService.register(ctx, { name: "Bimbo Staff", role: "staff", phone: "+2348031111111" });
    await personsService.setConsent(ctx, "+2348031111111", "opted_in");
    await personsService.setConsent(ctx, "+2348031111111", "stopped");

    expect(await personsService.resolveByPhone(ctx.orgId, "+2348031111111")).toBeNull();
    await personsService.setConsent(ctx, "+2348031111111", "opted_in");
    expect(await personsService.resolveByPhone(ctx.orgId, "+2348031111111")).toMatchObject({ name: "Bimbo Staff" });
  });
});
