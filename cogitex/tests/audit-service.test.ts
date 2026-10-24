import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { auditRepo } from "@/server/repos/audit";
import { auditService } from "@/server/services/audit";

let db: AppDb;
let ctx: Ctx;
let otherCtx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);

  const org = await orgsRepo.create(db, { name: "Governance Plant", slug: `gov-${testId()}` });
  const owner = await usersRepo.create(db, { name: "Ada Owner", email: `a-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: owner.id, role: "owner" });
  ctx = { userId: owner.id, email: owner.email, name: owner.name, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos", roles: ["owner"] };

  const org2 = await orgsRepo.create(db, { name: "Rival Plant", slug: `rival-${testId()}` });
  const outsider = await usersRepo.create(db, { name: "Busy Body", email: `b-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org2.id, userId: outsider.id, role: "owner" });
  otherCtx = { ...ctx, userId: outsider.id, orgId: org2.id, orgSlug: org2.slug, orgName: org2.name, roles: ["owner"] };
});

afterEach(() => {
  __resetDbForTests();
});

describe("audit trail service (governance reader over the append-only log)", () => {
  it("is org-scoped: another org's events are invisible", async () => {
    await auditRepo.log(db, { organizationId: ctx.orgId, actorUserId: ctx.userId, action: "machine.created", entityType: "machine", entityId: "m1" });
    await auditRepo.log(db, { organizationId: ctx.orgId, action: "machine.updated", entityType: "machine", entityId: "m1" });
    await auditRepo.log(db, { organizationId: otherCtx.orgId, actorUserId: otherCtx.userId, action: "machine.created", entityType: "machine", entityId: "r1" });

    const mine = await auditService.list(ctx);
    expect(mine).toHaveLength(2);
    expect(mine.every((e) => e.entityId !== "r1")).toBe(true);

    const theirs = await auditService.list(otherCtx);
    expect(theirs).toHaveLength(1);
  });

  it("resolves actor names, keeps actorKind for system/webhook rows, newest first", async () => {
    const tick = () => new Promise((r) => setTimeout(r, 6)); // distinct occurred_at milliseconds
    await auditRepo.log(db, { organizationId: ctx.orgId, actorUserId: ctx.userId, action: "note.added", entityType: "machine", entityId: "m1" });
    await tick();
    await auditRepo.log(db, { organizationId: ctx.orgId, actorKind: "system", action: "provenance.recorded", entityType: "work_order", entityId: "w1" });
    await tick();
    await auditRepo.log(db, { organizationId: ctx.orgId, actorKind: "webhook", action: "fault.converted", entityType: "machine", entityId: "m1" });

    const entries = await auditService.list(ctx);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.action).toBe("fault.converted"); // most recent wins
    const named = entries.find((e) => e.action === "note.added");
    expect(named?.actorName).toBe("Ada Owner");
    const system = entries.find((e) => e.action === "provenance.recorded");
    expect(system?.actorName).toBeNull();
    expect(system?.actorKind).toBe("system");
  });

  it("filters by entity type and counts per type", async () => {
    await auditRepo.log(db, { organizationId: ctx.orgId, action: "machine.created", entityType: "machine", entityId: "m1" });
    await auditRepo.log(db, { organizationId: ctx.orgId, action: "machine.updated", entityType: "machine", entityId: "m1" });
    await auditRepo.log(db, { organizationId: ctx.orgId, action: "purchase.created", entityType: "purchase", entityId: "p1" });

    const machines = await auditService.list(ctx, { entityType: "machine" });
    expect(machines).toHaveLength(2);
    expect(machines.every((e) => e.entityType === "machine")).toBe(true);

    const filteredOut = await auditService.list(ctx, { entityType: "fault_event" });
    expect(filteredOut).toHaveLength(0);

    const counts = await auditService.countsByType(ctx);
    expect(counts.find((c) => c.type === "machine")?.n).toBe(2);
    expect(counts.find((c) => c.type === "purchase")?.n).toBe(1);
    expect(await auditService.total(ctx)).toBe(3);
  });

  it("honors an explicit small limit, newest wins", async () => {
    for (let i = 0; i < 5; i++) {
      await auditRepo.log(db, { organizationId: ctx.orgId, action: `step.${i}`, entityType: "machine", entityId: `m${i}` });
      await new Promise((r) => setTimeout(r, 6)); // distinct timestamps — uuid ids are random, not ordered
    }
    const page = await auditService.list(ctx, { limit: 2 });
    expect(page).toHaveLength(2);
    expect(page[0]?.action).toBe("step.4");
    expect(page[1]?.action).toBe("step.3");
  });
});
