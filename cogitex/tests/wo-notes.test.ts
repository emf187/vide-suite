import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { machinesWriteService } from "@/server/services/machines";
import { workOrderWriteService } from "@/server/services/work-orders";
import { faultsService, faultsWriteService } from "@/server/services/faults";
import { MAX_COMMENT_BODY, woNotesService } from "@/server/services/wo-notes";
import { auditLogs, woNotes } from "@/server/db/schema";

let db: AppDb;
let ctx: Ctx;
let otherCtx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);

  const org = await orgsRepo.create(db, { name: "Thread Plant", slug: `threads-${testId()}` });
  const owner = await usersRepo.create(db, { name: "Thread Owner", email: `t-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: owner.id, role: "owner" });
  ctx = { userId: owner.id, email: owner.email, name: owner.name, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos", roles: ["owner"] };

  const org2 = await orgsRepo.create(db, { name: "Rival Plant", slug: `rival-${testId()}` });
  const outsider = await usersRepo.create(db, { name: "Outsider", email: `o-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org2.id, userId: outsider.id, role: "owner" });
  otherCtx = { ...ctx, userId: outsider.id, orgId: org2.id, orgSlug: org2.slug, orgName: org2.name, roles: ["owner"] };
});

afterEach(() => {
  __resetDbForTests();
});

describe("wo notes: comment thread", () => {
  it("adds, lists and removes comments; writes are audited; removal is a soft delete", async () => {
    const wo = await workOrderWriteService.create(ctx, { title: "Change pump seal", type: "corrective", priority: "high" });
    expect(await woNotesService.list(ctx, wo.id)).toHaveLength(0);

    const n1 = await woNotesService.add(ctx, wo.id, { body: "Torque spec is **42 Nm** — see manual page 12." });
    expect(n1.kind).toBe("comment");
    expect(n1.body).toContain("42 Nm");
    const n2 = await woNotesService.add(ctx, wo.id, { body: "Bearing ordered from vendor." });

    const thread = await woNotesService.list(ctx, wo.id);
    expect(thread.map((t) => t.id)).toEqual([n1.id, n2.id]); // oldest first

    await woNotesService.remove(ctx, wo.id, n2.id);
    const after = await woNotesService.list(ctx, wo.id);
    expect(after.map((t) => t.id)).toEqual([n1.id]);
    const soft = await db.select().from(woNotes).where(eq(woNotes.id, n2.id));
    expect(soft[0]?.deletedAt).not.toBeNull(); // rows are never destroyed

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityType, "work_order"));
    expect(audits.some((a) => a.action === "wo.comment_added")).toBe(true);
    expect(audits.some((a) => a.action === "wo.comment_removed")).toBe(true);
  });

  it("validation: empty comment and oversized bodies are refused", async () => {
    const wo = await workOrderWriteService.create(ctx, { title: "Inspect panel", type: "inspection", priority: "normal" });
    await expect(woNotesService.add(ctx, wo.id, { body: "   " })).rejects.toThrow("body_required");
    await expect(woNotesService.add(ctx, wo.id, { body: "x".repeat(MAX_COMMENT_BODY + 1) })).rejects.toThrow("body_too_large");
  });

  it("system notes exist, show on the thread, and can never be removed", async () => {
    const wo = await workOrderWriteService.create(ctx, { title: "Install kit", type: "installation", priority: "low" });
    await woNotesService.system(db, ctx, wo.id, "Provenance: test origin.");
    await woNotesService.add(ctx, wo.id, { body: "Scheduled for Tuesday." });

    const thread = await woNotesService.list(ctx, wo.id);
    expect(thread).toHaveLength(2);
    const sys = thread.find((t) => t.kind === "system");
    expect(sys?.body).toBe("Provenance: test origin.");
    expect(sys?.authorId).toBeNull(); // system notes have no human author
    await expect(woNotesService.remove(ctx, wo.id, sys!.id)).rejects.toThrow("system_note_immutable");
  });

  it("tenancy: wrong-org writes read as wo_not_found; other orgs never see the thread", async () => {
    const wo = await workOrderWriteService.create(ctx, { title: "Private thread", type: "corrective", priority: "low" });
    expect(await woNotesService.list(otherCtx, wo.id)).toHaveLength(0);
    await expect(woNotesService.add(otherCtx, wo.id, { body: "sneaky" })).rejects.toThrow("wo_not_found");
    const n = await woNotesService.add(ctx, wo.id, { body: "note" });
    await expect(woNotesService.remove(otherCtx, wo.id, n.id)).rejects.toThrow("wo_not_found");
  });
});

describe("provenance rail (why does this card exist)", () => {
  it("schedule and agent sources stamp provenance; manual stamps nothing", async () => {
    const scheduled = await workOrderWriteService.create(ctx, { title: "PM pack", type: "preventive", priority: "normal", source: "schedule" });
    const agent = await workOrderWriteService.create(ctx, { title: "Agent proposal", type: "corrective", priority: "low", source: "agent" });
    const manual = await workOrderWriteService.create(ctx, { title: "Manual card", type: "corrective", priority: "normal" });

    const bodies = async (woId: string) => (await woNotesService.list(ctx, woId)).map((t) => t.body);
    expect(await bodies(scheduled.id)).toEqual(["Provenance: Generated by a preventive-maintenance schedule."]);
    expect(await bodies(agent.id)).toEqual(["Provenance: Proposed by the agent and confirmed by a human."]);
    expect(await bodies(manual.id)).toEqual([]);
  });

  it("an explicit provenance stamps even manual cards (VIDE fault conversion path)", async () => {
    const wo = await workOrderWriteService.create(ctx, {
      title: "Fault: trip on PUMP-3",
      type: "corrective",
      priority: "critical",
      provenance: "Converted from VIDE fault event: trip on PUMP-3 at 2026-10-20.",
    });
    const bodies = (await woNotesService.list(ctx, wo.id)).map((t) => t.body);
    expect(bodies[0]).toContain("Provenance: Converted from VIDE fault event: trip on PUMP-3");
  });

  it("VIDE fault → WO conversion stamps the provenance from the fault event", async () => {
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump", videMachineNames: ["PUMP-3"] });
    await faultsWriteService.ingestFromWebhook(db, ctx.orgId, "PUMP-3", {
      faultType: "rising_vibration",
      severity: "warning",
      description: "RMS trending up",
      flaggedAt: new Date("2026-10-20T09:00:00Z"),
    });
    const fault = (await faultsService.list(ctx))[0];
    if (!fault) throw new Error("fixture: fault not ingested");
    const { woId } = await faultsWriteService.convertToWorkOrder(ctx, fault.id);

    const thread = await woNotesService.list(ctx, woId);
    const sys = thread.find((t) => t.kind === "system");
    expect(sys?.body).toContain("Provenance: Converted from VIDE fault event: rising_vibration flagged on PUMP-3");
  });
});
