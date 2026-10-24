import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { machinesWriteService } from "@/server/services/machines";
import { workOrderWriteService, workOrderService } from "@/server/services/work-orders";
import { reportsWriteService, reportsService, reportToCsv } from "@/server/services/reports";
import {
  CALC_VERSION,
  computeMetrics,
  validateNarrative,
  woTotalCostKobo,
  type FaultCore,
  type LaborCore,
  type MachineCore,
  type MetricsBundle,
  type PartsCore,
  type WorkOrderCore,
} from "@/server/metrics/reports";
import { reports } from "@/server/db/schema";

let db: AppDb;
let ctx: Ctx;
let viewerCtx: Ctx;
let otherOrgCtx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);

  const org = await orgsRepo.create(db, { name: "Metric Plant", slug: `met-${testId()}` });
  const owner = await usersRepo.create(db, { name: "Metric Owner", email: `owner-${testId()}@x.io`, passwordHash: "x" });
  const viewer = await usersRepo.create(db, { name: "Metric Viewer", email: `viewer-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: owner.id, role: "owner" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: viewer.id, role: "viewer" });

  const org2 = await orgsRepo.create(db, { name: "Other Plant", slug: `met2-${testId()}` });
  const outsider = await usersRepo.create(db, { name: "Outsider", email: `out-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org2.id, userId: outsider.id, role: "owner" });

  const base = { userId: owner.id, email: owner.email, name: owner.name, endDate: undefined, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos" } as unknown as Ctx;
  ctx = { ...base, roles: ["owner"] };
  viewerCtx = { ...base, userId: viewer.id, roles: ["viewer"] } as Ctx;
  otherOrgCtx = { ...base, userId: outsider.id, orgId: org2.id, orgSlug: org2.slug, orgName: org2.name, roles: ["owner"] } as Ctx;
});

afterEach(() => {
  __resetDbForTests();
});

/* ------------------------------------------------------------------ */
/* pure metric functions — hand-built rows, exact assertions           */
/* ------------------------------------------------------------------ */

const NOW = new Date("2026-10-20T12:00:00Z");
const from = new Date(NOW.getTime() - 30 * 86_400_000);
const to = NOW;

function wo(over: Partial<WorkOrderCore> & Pick<WorkOrderCore, "id" | "type" | "status">): WorkOrderCore {
  return {
    number: over.id, title: "t", machineId: null, priority: "normal",
    plannedStart: null, plannedEnd: null, actualStart: null, actualEnd: null,
    downtimeHours: null, completedAt: null, createdAt: from, ...over,
  };
}

const MACHINES: MachineCore[] = [{ id: "m1", tag: "PUMP-1", name: "p", category: "pump" }];
const done = wo({ id: "1", type: "corrective", status: "closed", machineId: "m1", createdAt: from, completedAt: to, downtimeHours: "12.0" });
const donePm = wo({ id: "2", type: "preventive", status: "verified", machineId: "m1", createdAt: from, completedAt: to });
const open = wo({ id: "3", type: "corrective", status: "in_progress", machineId: "m1", priority: "high", createdAt: from });
const oldDone = wo({ id: "4", type: "corrective", status: "closed", machineId: "m1", createdAt: new Date("2020-01-01T00:00:00Z"), completedAt: new Date("2020-01-02T00:00:00Z") });

const LABOR: LaborCore[] = [
  { workOrderId: "1", minutes: 90, rateKobo: 250_000 },
  { workOrderId: "1", minutes: 30, rateKobo: 250_000 },
  { workOrderId: "2", minutes: 60, rateKobo: 250_000 },
];
const PARTS: PartsCore[] = [
  { workOrderId: "1", qty: "2", unitCostKobo: 100_000 },
  { workOrderId: "4", qty: "1", unitCostKobo: 999_999_999 }, // out of period — must not count
];
const FAULTS: FaultCore[] = [
  { machineId: "m1", severity: "critical", faultType: "trip", flaggedAt: new Date(NOW.getTime() - 5 * 86_400_000) },
  { machineId: "m1", severity: "warning", faultType: "sag", flaggedAt: from },
  { machineId: "m1", severity: "warning", faultType: "old", flaggedAt: new Date("2020-01-01T00:00:00Z") }, // out of period
];

describe("M6 metrics: pure functions", () => {
  const base = { from, to, labor: LABOR, parts: PARTS, faults: FAULTS, machines: MACHINES, machineIds: null };

  it("period membership: created-or-completed in window only", () => {
    const calc = computeMetrics({ ...base, workOrders: [done, donePm, open, oldDone] });
    expect(calc.workOrders.total).toBe(3); // oldDone excluded
    expect(calc.workOrders.completed).toBe(2);
    expect(calc.workOrders.open).toBe(1);
    expect(calc.calcVersion).toBe(CALC_VERSION);
  });

  it("MTTR = mean labor minutes of breakdown completions; MTBF = calendar ÷ completions", () => {
    const calc = computeMetrics({ ...base, workOrders: [done, donePm] });
    expect(calc.mttrMinutes).toBe(120); // WO1 labor 90+30
    expect(calc.mttrHours).toBe(2);
    expect(calc.mtbfHours).toBe(30 * 24 * 1 / 1); // 30 days × 24 h × 1 machine ÷ 1 breakdown completion
  });

  it("uptime reflects downtime hours of completed WOs; planned ratio counts planned-family", () => {
    const calc = computeMetrics({ ...base, workOrders: [done, donePm] });
    expect(calc.uptimePct).toBe(98.3); // fixed one-decimal rendering in the calc bundle
    expect(calc.plannedRatioPct).toBe(50); // 1 of 2 completions is preventive
  });

  it("cost rollups exclude out-of-period rows; per-machine attribution sorted desc", () => {
    const calc = computeMetrics({ ...base, workOrders: [done, donePm, oldDone] });
    // labor: WO1 (120m × 250k)/60 = 500,000  + WO2 60m → 250,000 = 750,000
    expect(calc.cost.laborKobo).toBe(750_000);
    // parts: WO1 only (2 × 100,000) — WO4 is out of period
    expect(calc.cost.partsKobo).toBe(200_000);
    expect(calc.cost.totalKobo).toBe(950_000);
    expect(calc.cost.byMachine).toEqual([{ machineId: "m1", tag: "PUMP-1", totalKobo: 950_000 }]);
  });

  it("faults slice to the period; machine scoping drops non-attributable rows", () => {
    const calc = computeMetrics({ ...base, workOrders: [done], machineIds: ["m1"] });
    expect(calc.faults.total).toBe(2);
    expect(calc.faults.bySeverity).toEqual({ critical: 1, warning: 1 });

    const scoped = computeMetrics({ ...base, workOrders: [wo({ id: "9", type: "corrective", status: "planned", machineId: "other", createdAt: from })], machineIds: ["m1"] });
    expect(scoped.workOrders.total).toBe(0); // machineId other — not in scope
  });

  it("narrative guard: every numeral in text must exist somewhere in calc", () => {
    const calc = { days: 30, cost: 950000 } as unknown as MetricsBundle;
    expect(validateNarrative("Completed work over the 30-day window cost 950000 kobo.", calc).ok).toBe(true);
    const bad = validateNarrative("We saw 41 faults this month.", calc);
    expect(bad.ok).toBe(false);
    expect(bad.offender).toBe("41");
  });

  it("per-WO cost helper: minutes×rate rounded to kobo + integer part costs", () => {
    expect(woTotalCostKobo("1", LABOR, PARTS)).toBe(500_000 + 200_000);
    expect(woTotalCostKobo("2", LABOR, PARTS)).toBe(250_000);
  });
});

/* ------------------------------------------------------------------ */
/* service: generate against a real seeded plant                       */
/* ------------------------------------------------------------------ */

async function seedPlant() {
  const m = await machinesWriteService.create(ctx, { name: "Line pump", tag: "PUMP-9", category: "pump" });
  const wo = await workOrderWriteService.create(ctx, { title: "Bearing swap", machineId: m.id, type: "corrective", priority: "high", source: "manual", status: "planned", plannedStart: null });
  await workOrderWriteService.transition(ctx, wo.id, "assigned", { assignedTo: ctx.userId });
  await workOrderWriteService.transition(ctx, wo.id, "in_progress");
  await workOrderWriteService.addLabor(ctx, wo.id, { minutes: 120, rateKobo: 250_000, note: "mech" });
  await workOrderWriteService.transition(ctx, wo.id, "completed", { completedSummary: "Swapped DE bearing", downtimeHours: 6 });
  return { m, wo };
}

describe("M6 reports: generate + tenancy", () => {
  it("generates a plant summary from real WOs — numbers match the ops-rollup math", async () => {
    await seedPlant();
    const { reportId } = await reportsWriteService.generate(ctx, { kind: "plant_summary", from: new Date(Date.now() - 7 * 86_400_000), to: new Date() });
    const r = await reportsService.byId(ctx, reportId);
    expect(r?.kind).toBe("plant_summary");
    expect(r?.status).toBe("done");
    const calc = r?.calc as MetricsBundle;
    expect(calc.workOrders.completed).toBe(1);
    expect(calc.cost.laborKobo).toBe(250_000 * 2); // 120 min × ₦2,500/h → 120×250000/60 = 500,000
    expect(calc.mttrHours).toBe(2);
    expect(calc.mtbfHours).toBe(7 * 24); // one breakdown in the 7-day window on 1 machine
  });

  it("machine_status requires and scopes a machine", async () => {
    const { m } = await seedPlant();
    await expect(reportsWriteService.generate(ctx, { kind: "machine_status", from: new Date(Date.now() - 7 * 86_400_000), to: new Date() })).rejects.toThrow("machine_required");
    const { reportId } = await reportsWriteService.generate(ctx, { kind: "machine_status", machineId: m.id, from: new Date(Date.now() - 7 * 86_400_000), to: new Date() });
    const calc = (await reportsService.byId(ctx, reportId))!.calc as MetricsBundle;
    expect(calc.cost.byMachine).toHaveLength(1);
    expect(calc.cost.byMachine[0]?.tag).toBe("PUMP-9");
  });

  it("tenancy: reports never cross orgs", async () => {
    await seedPlant();
    const { reportId } = await reportsWriteService.generate(ctx, { kind: "plant_summary", from: new Date(Date.now() - 7 * 86_400_000), to: new Date() });
    expect(await reportsService.byId(otherOrgCtx, reportId)).toBeNull();
    expect(await reportsService.list(otherOrgCtx)).toHaveLength(0);
    const foreignM = await machinesWriteService.create(otherOrgCtx, { name: "Foreign pump", tag: "F-1", category: "pump" });
    const { reportId: foreignReport } = await reportsWriteService.generate(otherOrgCtx, { kind: "machine_status", machineId: foreignM.id, from: new Date(Date.now() - 7 * 86_400_000), to: new Date() });
    expect(await reportsService.byId(ctx, foreignReport)).toBeNull();
  });

  it("viewer can generate (reads are harmless); the CSV render is deterministic", async () => {
    await seedPlant();
    const { reportId } = await reportsWriteService.generate(viewerCtx, { kind: "plant_summary", from: new Date(Date.now() - 7 * 86_400_000), to: new Date() });
    const r = await reportsService.byId(ctx, reportId);
    const csv = reportToCsv(r!);
    expect(csv).toContain("ORGO · MAINTENANCE MANAGER");
    expect(csv).toContain("cost_labor,500000,kobo");
    expect(csv).toContain("mttr,2,hours");
    expect(csv).toContain("WO TYPE MIX");
    expect(csv).toContain("type,corrective,1,1");
    // deterministic — same calc, same bytes
    expect(reportToCsv(r!)).toBe(csv);
  });

  it("the generated calc is stored verbatim in the report row", async () => {
    await seedPlant();
    const { reportId } = await reportsWriteService.generate(ctx, { kind: "plant_summary", from: new Date(Date.now() - 7 * 86_400_000), to: new Date() });
    const rows = await db.select().from(reports).where(eq(reports.organizationId, ctx.orgId));
    expect(rows).toHaveLength(1);
    expect((rows[0]!.calc as MetricsBundle).workOrders.completed).toBe(1);
  });

  it("PDF bytes render from the calc bundle (pdf-lib, valid header)", async () => {
    await seedPlant();
    const { reportId } = await reportsWriteService.generate(ctx, { kind: "plant_summary", from: new Date(Date.now() - 7 * 86_400_000), to: new Date() });
    const r = (await reportsService.byId(ctx, reportId))!;
    const { reportToPdfBytes } = await import("@/server/services/reports");
    const bytes = await reportToPdfBytes({ kind: r.kind, orgName: ctx.orgName, periodFrom: r.periodFrom, periodTo: r.periodTo, calc: r.calc });
    const head = String.fromCharCode(...bytes.slice(0, 5));
    expect(head).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
