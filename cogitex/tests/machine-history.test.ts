import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { machinesWriteService } from "@/server/services/machines";
import { workOrderWriteService } from "@/server/services/work-orders";
import { expensesService, maintenanceHistoryService } from "@/server/services/machine-history";
import { auditLogs, workOrderLabor, workOrderParts, workOrders } from "@/server/db/schema";
import { eq } from "drizzle-orm";

let db: AppDb;
let ctx: Ctx;
let technicianCtx: Ctx;
let otherPlannerCtx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);

  const org = await orgsRepo.create(db, { name: "History Plant", slug: `hist-${testId()}` });
  const mkUser = async (name: string, role: "owner" | "maintenance_manager" | "technician") => {
    const u = await usersRepo.create(db, { name, email: `${name}-${testId()}@x.io`, passwordHash: "x" });
    await membershipsRepo.create(db, { organizationId: org.id, userId: u.id, role });
    return u;
  };
  const owner = await mkUser("Owner H", "owner");
  const tech = await mkUser("Tech H", "technician");
  const manager2 = await mkUser("Manager H2", "maintenance_manager");

  const base = { userId: owner.id, email: owner.email, name: owner.name, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos" };
  ctx = { ...base, roles: ["owner"] };
  technicianCtx = { ...base, userId: tech.id, email: tech.email, name: tech.name, roles: ["technician"] };
  otherPlannerCtx = { ...base, userId: manager2.id, email: manager2.email, name: manager2.name, roles: ["maintenance_manager"] };
});

afterEach(() => {
  __resetDbForTests();
});

async function machineFor(ctxX: Ctx) {
  return machinesWriteService.create(ctxX, { name: "History test pump", tag: `H-${testId().toUpperCase()}`, category: "pump" });
}

describe("machine history: WO rollup + expenditure summary", () => {
  it("rolls labor and issued-parts costs up per work order (never duplicated anywhere)", async () => {
    const machine = await machineFor(ctx);
    const wo = await workOrderWriteService.create(ctx, { title: "Replace seal kit", type: "corrective", priority: "high", machineId: machine.id });
    await workOrderWriteService.transition(ctx, wo.id, "assigned", { assignedTo: technicianCtx.userId });
    await workOrderWriteService.addLabor(technicianCtx, wo.id, { minutes: 120 }); // 2h × ₦2,500 = ₦5,000 = 500_000 kobo
    await workOrderWriteService.addLabor(technicianCtx, wo.id, { minutes: 30, rateKobo: 120000 });

    // parts line issued straight against the card (inventory issue path writes the same shape)
    await db.insert(workOrderParts).values({
      organizationId: ctx.orgId,
      workOrderId: wo.id,
      inventoryItemId: null,
      name: "Seal kit 2in",
      qty: "2",
      unitCostKobo: 10_000, // ×2 = 20_000 kobo
      issuedAt: new Date(),
    });

    const h = await maintenanceHistoryService.forMachine(ctx, machine.id);
    expect(h.rows).toHaveLength(1);
    const row = h.rows[0];
    if (!row) throw new Error("row missing");
    // (120×250000 + 30×120000)/60 = (30_000_000 + 3_600_000)/60 = 560_000
    expect(row.laborKobo).toBe(560_000);
    expect(row.partsKobo).toBe(20_000);
    expect(row.costKobo).toBe(580_000);

    expect(h.summary.laborKobo).toBe(560_000);
    expect(h.summary.partsKobo).toBe(20_000);
    expect(h.summary.manualKobo).toBe(0);
    expect(h.summary.totalKobo).toBe(580_000);
    expect(h.summary.openWorkOrders).toBe(1); // wip → still open
    expect(h.summary.concludedWorkOrders).toBe(0);
    expect(h.summary.lastServiceAt).toBeNull();
  });

  it("stamps LAST SERVICE from the latest concluded WO and splits open vs concluded", async () => {
    const machine = await machineFor(ctx);
    const open = await workOrderWriteService.create(ctx, { title: "Still planned", type: "preventive", priority: "low", machineId: machine.id });

    const done = await workOrderWriteService.create(ctx, { title: "Bearing swap", type: "corrective", priority: "normal", machineId: machine.id });
    await workOrderWriteService.transition(ctx, done.id, "assigned", { assignedTo: technicianCtx.userId });
    await workOrderWriteService.transition(technicianCtx, done.id, "in_progress");
    await workOrderWriteService.transition(technicianCtx, done.id, "completed", { completedSummary: "Done", downtimeHours: 1.5 });
    await workOrderWriteService.transition(otherPlannerCtx, done.id, "verified");
    await workOrderWriteService.transition(ctx, done.id, "closed");

    const h = await maintenanceHistoryService.forMachine(ctx, machine.id);
    expect(h.summary.openWorkOrders).toBe(1);
    expect(h.summary.concludedWorkOrders).toBe(1);
    expect(h.summary.lastServiceAt).not.toBeNull();
    expect(h.summary.lastServiceWoNumber).toBe(done.number);
    expect(h.summary.lastServiceWoNumber).not.toBe(open.number);

    // finishedAt picks actualEnd when present
    const row = h.rows.find((r) => r.wo.id === done.id);
    expect(row?.finishedAt).not.toBeNull();
  });

  it("concluded WO costs count into the 12-month window; year-old manual spend does not", async () => {
    const machine = await machineFor(ctx);
    const wo = await workOrderWriteService.create(ctx, { title: "Recent service", type: "corrective", priority: "normal", machineId: machine.id });
    await workOrderWriteService.transition(ctx, wo.id, "assigned", { assignedTo: technicianCtx.userId });
    await workOrderWriteService.addLabor(technicianCtx, wo.id, { minutes: 60 }); // 250_000 kobo

    const recent = await expensesService.add(ctx, machine.id, {
      kind: "fuel",
      description: "Diesel for standby gen swap",
      amountKobo: 40_000,
      occurredAt: new Date(Date.now() - 10 * 86_400_000),
    });
    expect(recent.source).toBe("manual");

    const old = await expensesService.add(ctx, machine.id, {
      kind: "contract",
      description: "Old alignment service",
      amountKobo: 90_000,
      vendor: "Naija Alignment Ltd",
      occurredAt: new Date(Date.now() - 400 * 86_400_000),
    });

    const h = await maintenanceHistoryService.forMachine(ctx, machine.id);
    expect(h.summary.manualKobo).toBe(130_000);
    expect(h.summary.laborKobo).toBe(250_000);
    expect(h.summary.totalKobo).toBe(380_000);
    // recent fuel + WO cost inside 365d; 400-day-old contract outside
    expect(h.summary.last365dKobo).toBe(290_000);
    expect(h.expenses.map((e) => e.id)).toContain(recent.id);

    // audit trail for both additions
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.organizationId, ctx.orgId));
    const actions = audits.filter((a) => a.action === "machine.expense_added").map((a) => a.entityId);
    expect(actions).toContain(machine.id);
  });

  it("remove is soft-delete + audited; corrections leave the lifetime total clean", async () => {
    const machine = await machineFor(ctx);
    const e = await expensesService.add(ctx, machine.id, { kind: "consumable", description: "Grease", amountKobo: 15_000 });
    await expensesService.add(ctx, machine.id, { kind: "service", description: "Pump service", amountKobo: 60_000 });
    await expect(h_total(ctx, machine.id)).resolves.toBe(75_000);

    await expensesService.remove(ctx, machine.id, e.id);
    const h = await maintenanceHistoryService.forMachine(ctx, machine.id);
    expect(h.expenses).toHaveLength(1);
    expect(h.summary.manualKobo).toBe(60_000);

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityType, "machine"));
    expect(audits.some((a) => a.action === "machine.expense_removed")).toBe(true);

    // double-remove is refused
    await expect(expensesService.remove(ctx, machine.id, e.id)).rejects.toThrow("expense_not_found");
  });

  it("validation: amount must be a positive integer kobo, kind whitelisted, machine in-org", async () => {
    const machine = await machineFor(ctx);
    await expect(
      expensesService.add(ctx, machine.id, { kind: "fuel", description: "x", amountKobo: 0 }),
    ).rejects.toThrow("amount_kobo_must_be_positive_integer");
    await expect(
      expensesService.add(ctx, machine.id, { kind: "crypto" as never, description: "x", amountKobo: 100 }),
    ).rejects.toThrow("unknown_expense_kind");
    await expect(
      expensesService.add(ctx, machine.id, { kind: "fuel", description: "   ", amountKobo: 100 }),
    ).rejects.toThrow("description_required");

    // cross-tenant machine id must never accept an expense claim
    const foreignOrg = await orgsRepo.create(db, { name: "Foreign", slug: `fx-${testId()}` });
    const foreignUser = (await usersRepo.create(db, { name: "F", email: `f-${testId()}@x.io`, passwordHash: "x" })).id;
    await membershipsRepo.create(db, { organizationId: foreignOrg.id, userId: foreignUser, role: "owner" });
    const foreignMachine = await machinesWriteService.create({ ...ctx, orgId: foreignOrg.id, userId: foreignUser, roles: ["owner"] }, { name: "Foreign pump", tag: "F-X1", category: "pump" });
    await expect(
      expensesService.add(ctx, foreignMachine.id, { kind: "fuel", description: "sneaky", amountKobo: 100 }),
    ).rejects.toThrow("machine_not_found");
  });

  it("tenancy: another org's machine reads as an empty story, never leaks rows", async () => {
    const machine = await machineFor(ctx);
    await workOrderWriteService.create(ctx, { title: "Org A WO", type: "corrective", priority: "normal", machineId: machine.id });
    await expensesService.add(ctx, machine.id, { kind: "fuel", description: "Org A fuel", amountKobo: 10_000 });

    const org2 = await orgsRepo.create(db, { name: "Org B", slug: `b-${testId()}` });
    const userB = (await usersRepo.create(db, { name: "B", email: `b-${testId()}@x.io`, passwordHash: "x" })).id;
    await membershipsRepo.create(db, { organizationId: org2.id, userId: userB, role: "owner" });
    const ctxB = { ...ctx, orgId: org2.id, userId: userB, orgSlug: org2.slug, orgName: org2.name, roles: ["owner"] as Ctx["roles"] };

    const h = await maintenanceHistoryService.forMachine(ctxB, machine.id);
    expect(h.rows).toHaveLength(0);
    expect(h.expenses).toHaveLength(0);
    expect(h.summary.totalKobo).toBe(0);
  });
});

describe("machine history: agent-facing summary shape", () => {
  it("summary is complete and typed for later LLM tooling (item 5 of the sprint)", async () => {
    const machine = await machineFor(ctx);
    const wo = await workOrderWriteService.create(ctx, { title: "Check", type: "inspection", priority: "low", machineId: machine.id });
    await db.update(workOrders).set({ status: "in_progress", actualStart: new Date() }).where(eq(workOrders.id, wo.id));
    await workOrderWriteService.addLabor(ctx, wo.id, { minutes: 45 });

    const h = await maintenanceHistoryService.forMachine(ctx, machine.id);
    const keys = Object.keys(h.summary).sort();
    expect(keys).toEqual([
      "concludedWorkOrders", "laborKobo", "last365dKobo", "lastServiceAt",
      "lastServiceWoNumber", "manualKobo", "openWorkOrders", "partsKobo", "totalKobo",
    ]);
    expect(h.summary.laborKobo).toBe(Math.round(45 * 250000 / 60));
  });
});

async function h_total(ctxX: Ctx, machineId: string): Promise<number> {
  const h = await maintenanceHistoryService.forMachine(ctxX, machineId);
  return h.summary.manualKobo;
}
