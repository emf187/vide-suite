import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { machinesService, machinesWriteService } from "@/server/services/machines";
import { workOrderService, workOrderWriteService } from "@/server/services/work-orders";
import { pmService, schedulesService, schedulesWriteService } from "@/server/services/schedules";
import { schedules, workOrderLabor, workOrders } from "@/server/db/schema";
import type { AppDb } from "@/server/db/client";

let db: AppDb;
let ctx: Ctx;
let technicianCtx: Ctx;
let otherPlannerCtx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);

  const org = await orgsRepo.create(db, { name: "WO Plant", slug: `wo-${testId()}` });
  const mkUser = async (name: string, role: "owner" | "maintenance_manager" | "technician" | "viewer") => {
    const u = await usersRepo.create(db, { name, email: `${name}-${testId()}@x.io`, passwordHash: "x" });
    await membershipsRepo.create(db, { organizationId: org.id, userId: u.id, role });
    return u;
  };
  const owner = await mkUser("Owner P", "owner");
  const tech = await mkUser("Tech P", "technician");
  const manager2 = await mkUser("Manager Q", "maintenance_manager");

  const base = { userId: owner.id, email: owner.email, name: owner.name, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos" };
  ctx = { ...base, roles: ["owner"] };
  technicianCtx = { ...base, userId: tech.id, email: tech.email, name: tech.name, roles: ["technician"] };
  otherPlannerCtx = { ...base, userId: manager2.id, email: manager2.email, name: manager2.name, roles: ["maintenance_manager"] };
});

afterEach(() => {
  __resetDbForTests();
});

async function machineFor(ctxX: Ctx) {
  return machinesWriteService.create(ctxX, { name: "WO test pump", tag: `WO-${testId()}`, category: "pump" });
}

describe("M2 work orders: numbering + creation", () => {
  it("allocates monotonic human numbers (WO-000001, WO-000002)", async () => {
    const wo1 = await workOrderWriteService.create(ctx, { title: "First", type: "corrective", priority: "normal" });
    const wo2 = await workOrderWriteService.create(ctx, { title: "Second", type: "corrective", priority: "low" });
    expect(wo1.number).toBe("WO-000001");
    expect(wo2.number).toBe("WO-000002");
  });

  it("only planners create work orders manually", async () => {
    await expect(workOrderWriteService.create(technicianCtx, { title: "Nope", type: "corrective", priority: "low" })).rejects.toThrow("forbidden:wo.plan");
  });

  it("templates copy their steps onto the card", async () => {
    const dbX = db;
    const tplRows = await dbX.insert((await import("@/server/db/schema")).maintenanceTemplates).values({
      organizationId: ctx.orgId,
      name: "Pump quarterly",
      defaultIntervalDays: 90,
      createdBy: ctx.userId,
    }).returning();
    const tpl = tplRows[0];
    if (!tpl) throw new Error("template missing");
    await dbX.insert((await import("@/server/db/schema")).templateSteps).values([
      { organizationId: ctx.orgId, templateId: tpl.id, seq: 1, title: "Isolate pump", kind: "check" },
      { organizationId: ctx.orgId, templateId: tpl.id, seq: 2, title: "Record discharge pressure", kind: "value", requireValue: true },
    ]);

    const wo = await workOrderWriteService.create(ctx, { title: "Quarterly PM", type: "preventive", priority: "normal", templateId: tpl.id });
    const steps = await workOrderService.steps(ctx, wo.id);
    expect(steps).toHaveLength(2);
    expect(steps[1]?.requireValue).toBe(true);
  });
});

describe("M2 work orders: state machine + role separation", () => {
  it("full happy path planned → assigned → in_progress → completed → verified → closed", async () => {
    const machine = await machineFor(ctx);
    await machinesWriteService.transition(ctx, machine.id, "active"); // in service so the WO can drag it down
    const wo = await workOrderWriteService.create(ctx, { title: "Replace seal", type: "corrective", priority: "high", machineId: machine.id });

    await workOrderWriteService.transition(ctx, wo.id, "assigned", { assignedTo: technicianCtx.userId });
    const moved = await workOrderWriteService.transition(technicianCtx, wo.id, "in_progress");
    expect(moved.wo.status).toBe("in_progress");
    expect(moved.wo.actualStart).not.toBeNull();

    // machine follows: active → under_maintenance
    const machineNow = await machinesService.byId(ctx, machine.id);
    expect(machineNow?.lifecycleStatus).toBe("under_maintenance");

    await workOrderWriteService.transition(technicianCtx, wo.id, "completed", { completedSummary: "Seal replaced" });
    // verify must be someone other than the assignee
    await expect(workOrderWriteService.transition(technicianCtx, wo.id, "verified")).rejects.toThrow("verify_requires_other_user");
    await workOrderWriteService.transition(otherPlannerCtx, wo.id, "verified");
    await workOrderWriteService.transition(ctx, wo.id, "closed");

    // machine returns to active when the WO concludes
    const machineAfter = await machinesService.byId(ctx, machine.id);
    expect(machineAfter?.lifecycleStatus).toBe("active");
  });

  it("refuses illegal jumps and gates abilities", async () => {
    const wo = await workOrderWriteService.create(ctx, { title: "T", type: "corrective", priority: "low" });
    // planned → in_progress skips states
    await expect(workOrderWriteService.transition(technicianCtx, wo.id, "in_progress")).rejects.toThrow("illegal_wo_transition");
    // planned → closed is not a legal edge at all
    await expect(workOrderWriteService.transition(ctx, wo.id, "closed")).rejects.toThrow("illegal_wo_transition");
    // planned → assigned is legal but needs the planning ability (technician has none)
    await expect(workOrderWriteService.transition(technicianCtx, wo.id, "assigned", { assignedTo: technicianCtx.userId })).rejects.toThrow("forbidden:wo.plan");
  });

  it("cancel requires a reason; complete requires all steps done", async () => {
    const wo = await workOrderWriteService.create(ctx, { title: "Cancel me", type: "corrective", priority: "low" });
    await expect(workOrderWriteService.transition(ctx, wo.id, "cancelled")).rejects.toThrow("reason_required:cancel");
    await workOrderWriteService.transition(ctx, wo.id, "cancelled", { reason: "duplicate of WO-000002" });

    const tpl = await db.insert((await import("@/server/db/schema")).maintenanceTemplates).values({ organizationId: ctx.orgId, name: "steps tpl", createdBy: ctx.userId }).returning();
    const tplId = tpl[0]?.id;
    if (!tplId) throw new Error("no template");
    await db.insert((await import("@/server/db/schema")).templateSteps).values({ organizationId: ctx.orgId, templateId: tplId, seq: 1, title: "step one" });
    const wo2 = await workOrderWriteService.create(ctx, { title: "With steps", type: "preventive", priority: "low", templateId: tplId });
    await workOrderWriteService.transition(ctx, wo2.id, "assigned", { assignedTo: technicianCtx.userId });
    await workOrderWriteService.transition(technicianCtx, wo2.id, "in_progress");
    await expect(workOrderWriteService.transition(technicianCtx, wo2.id, "completed")).rejects.toThrow("steps_incomplete:1");
    await workOrderWriteService.completeStep(technicianCtx, wo2.id, (await workOrderService.steps(ctx, wo2.id))[0]?.id ?? "x");
    await workOrderWriteService.transition(technicianCtx, wo2.id, "completed");
  });
});

describe("M2 work orders: labor + cost rollup (integer kobo)", () => {
  it("logs labor and rolls up cost; techs log own hours only", async () => {
    const wo = await workOrderWriteService.create(ctx, { title: "Labor test", type: "corrective", priority: "normal" });
    await workOrderWriteService.addLabor(technicianCtx, wo.id, { minutes: 90 });
    await workOrderWriteService.addLabor(ctx, wo.id, { minutes: 30, userId: technicianCtx.userId, note: "helped" });
    // technician cannot log hours for someone else
    await expect(workOrderWriteService.addLabor(technicianCtx, wo.id, { minutes: 30, userId: ctx.userId })).rejects.toThrow("forbidden:wo.execute");
    await expect(workOrderWriteService.addLabor(technicianCtx, wo.id, { minutes: 99999 })).rejects.toThrow("minutes_0_to_1440");

    const cost = await workOrderService.costRollup(ctx, wo.id);
    expect(cost.laborMinutes).toBe(120);
    // 120min at ₦2,500/hr = ₦5,000 = 500,000 kobo
    expect(cost.laborKobo).toBe(500000);
  });
});

describe("M2 PM schedules + generation", () => {
  it("calendar schedule generates a WO, advances next due, and skips while a WO is open", async () => {
    const machine = await machineFor(ctx);
    const schedule = await schedulesWriteService.create(ctx, {
      title: "Monthly pump service",
      machineId: machine.id,
      kind: "calendar",
      intervalDays: 30,
    });
    expect(schedule.active).toBe(true);

    // force due now
    await db.update(schedules).set({ nextDueAt: new Date(Date.now() - 86_400_000) });

    const dry = await pmService.generate(ctx, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.candidates).toHaveLength(1);

    const run = await pmService.generate(ctx, {});
    expect(run.candidates[0]?.created).toBe("WO-000001");

    const rows = await db.select().from(workOrders);
    const generated = rows[0];
    expect(generated?.source).toBe("schedule");
    expect(generated?.status).toBe("planned");
    expect(generated?.machineId).toBe(machine.id);

    // next due advanced ~30d
    const schedRows = await db.select().from(schedules);
    expect(schedRows[0]?.nextDueAt).not.toBeNull();

    // second generation within the window skips (open WO already references schedule)
    const run2 = await pmService.generate(ctx, { horizon: new Date(Date.now() + 40 * 86_400_000) });
    expect(run2.candidates[0]?.skipped).toContain("already references this schedule");
  });

  it("runtime schedule triggers from metered hours and re-baselines", async () => {
    const machine = await machinesWriteService.create(ctx, { name: "Runtime gen", tag: "RT-1", category: "generator" });
    await schedulesWriteService.create(ctx, {
      title: "250h generator service",
      machineId: machine.id,
      kind: "runtime",
      runtimeTriggerHours: 250,
    });
    // machine has 0 runtime hours → nothing due
    const none = await pmService.generate(ctx, { dryRun: true });
    expect(none.candidates).toHaveLength(0);

    // bump runtime beyond baseline
    await db.update((await import("@/server/db/schema")).machines).set({ runtimeHours: "300" });
    const due = await pmService.generate(ctx, { dryRun: true });
    expect(due.candidates).toHaveLength(1);
    const run = await pmService.generate(ctx, {});
    expect(run.candidates[0]?.created).toBe("WO-000001");
    // after generation, the baseline moved to 300 → no longer due
    const after = await pmService.generate(ctx, { dryRun: true });
    expect(after.candidates).toHaveLength(0);
  });

  it("condition schedule reads VIDE readings through the adapter seam (mock vibration story)", async () => {
    const machine = await machinesWriteService.create(ctx, { name: "Cond pump", tag: "COND-1", category: "pump", videMachineNames: ["PUMP-3"] });
    await schedulesWriteService.create(ctx, {
      title: "Vibration watch — inspect bearings",
      machineId: machine.id,
      kind: "condition",
      conditionMetric: "vibration_mm_s",
      conditionOp: ">",
      conditionThreshold: 5,
    });
    // PUMP-3 mock has vibration ~5.4+ rising → over 5 → due
    const due = await pmService.generate(ctx, { dryRun: true });
    expect(due.candidates).toHaveLength(1);
    expect(due.candidates[0]?.basis).toContain("vibration");
  });

  it("schedules are org-scoped (cross-org generation never sees foreign schedules)", async () => {
    const org2 = await orgsRepo.create(db, { name: "Other plant", slug: `other-${testId()}` });
    const u2 = await usersRepo.create(db, { name: "O2", email: `o2-${testId()}@x.io`, passwordHash: "x" });
    await membershipsRepo.create(db, { organizationId: org2.id, userId: u2.id, role: "owner" });
    const ctx2: Ctx = { ...ctx, orgId: org2.id, userId: u2.id };

    await schedulesWriteService.create(ctx, { title: "Mine", kind: "calendar", intervalDays: 7 });
    const theirs = await schedulesService.list(ctx2);
    expect(theirs).toHaveLength(0);
  });
});
