/**
 * Seed a demo tenant: 1 organization, 4 users (owner/manager/technician/viewer),
 * 2 sites + areas, 12 machines with VIDE device links, BOM components, lifecycle log.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npm run seed
 * Requires a real database URL (seeding an in-memory dev DB is pointless).
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local" });

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/server/db/schema";
import { hashPassword } from "../src/server/auth/password";
import { auditRepo } from "../src/server/repos/audit";
import { membershipsRepo } from "../src/server/repos/memberships";
import { orgsRepo } from "../src/server/repos/orgs";
import { usersRepo } from "../src/server/repos/users";

const DEMO_PASSWORD = "demo1234";

type SeedMachine = {
  tag: string; name: string; category: string; siteCode: string; areaCode: string | null;
  make?: string; model?: string; serial?: string; criticality: "A" | "B" | "C";
  installDate?: string; runtimeHours: string; lifecycle: "commissioned" | "active" | "standby";
  vide?: string; locationNote?: string; specs?: Record<string, number | string>;
  components?: { name: string; tag?: string; kind: string }[];
};

const SITES = [
  { code: "PLT1", name: "Anyanwu Plant 1 — weaving & finishing", address: "Plot 14, Industrial Layout, Aba" },
  { code: "PLT2", name: "Anyanwu Plant 2 — dye house & warehouse", address: "Km 6, Aba–Owerri Road" },
];
const AREAS = [
  { siteCode: "PLT1", code: "LINE-A", name: "Weaving line A", kind: "line" as const },
  { siteCode: "PLT1", code: "LINE-B", name: "Weaving line B", kind: "line" as const },
  { siteCode: "PLT1", code: "UTILITY", name: "Utilities yard", kind: "area" as const },
  { siteCode: "PLT2", code: "DYEHOUSE", name: "Dye house", kind: "area" as const },
  { siteCode: "PLT2", code: "WAREHOUSE", name: "Yarn & fabric warehouse", kind: "area" as const },
];

const MACHINES: SeedMachine[] = [
  {
    tag: "PUMP-1", name: "Overhead lines water pump", category: "pump", siteCode: "PLT1", areaCode: "LINE-A",
    make: "Grundfos", model: "NB 65-200", serial: "SN-88213", criticality: "B", installDate: "2024-03-14",
    runtimeHours: "11240.5", lifecycle: "active", vide: "PUMP-1", locationNote: "Bay 2 pump skid",
    specs: { power_kw: 7.5, rpm: 2900, head_m: 42 }, components: [{ name: "Drive-end bearing", kind: "bearing_housing" }, { name: "Mechanical seal", kind: "seal" }],
  },
  {
    tag: "PUMP-3", name: "Cooling tower makeup pump", category: "pump", siteCode: "PLT1", areaCode: "UTILITY",
    make: "Grundfos", model: "NB 50-160", serial: "SN-88302", criticality: "A", installDate: "2022-08-19",
    runtimeHours: "22160.0", lifecycle: "active", vide: "PUMP-3", locationNote: "Cooling tower east",
    specs: { power_kw: 5.5, rpm: 2900 }, components: [{ name: "Suction strainer", kind: "assembly" }],
  },
  {
    tag: "PUMP-4", name: "Dewatering standby pump", category: "pump", siteCode: "PLT2", areaCode: "WAREHOUSE",
    criticality: "C", installDate: "2021-01-09", runtimeHours: "980.2", lifecycle: "standby", locationNote: "Behind loading bay",
  } as SeedMachine,
  {
    tag: "MOTOR-1", name: "Packet line drive motor", category: "motor", siteCode: "PLT1", areaCode: "LINE-A",
    make: "Brook Crompton", model: "W22 15kW", serial: "SN-41007", criticality: "B", installDate: "2023-11-02",
    runtimeHours: "18420.9", lifecycle: "active", vide: "MOTOR-1",
    specs: { power_kw: 15, rpm: 1460, voltage_v: 415 }, components: [{ name: "Coupling insert", kind: "assembly" }],
  },
  {
    tag: "MOTOR-2", name: "Weaving line B main drive", category: "motor", siteCode: "PLT1", areaCode: "LINE-B",
    make: "Brook Crompton", model: "W22 22kW", serial: "SN-41008", criticality: "A", installDate: "2023-11-02",
    runtimeHours: "17980.4", lifecycle: "active", vide: "MOTOR-2",
    specs: { power_kw: 22, rpm: 1450, voltage_v: 415 },
  },
  {
    tag: "MOTOR-3", name: "Humidity extractor fan motor", category: "motor", siteCode: "PLT2", areaCode: "DYEHOUSE",
    make: "Teco", model: "AEH 7.5kW", criticality: "C", installDate: "2020-05-11", runtimeHours: "30590.1", lifecycle: "active",
  },
  {
    tag: "GEN-1", name: "Standby diesel generator 500 kVA", category: "generator", siteCode: "PLT1", areaCode: "UTILITY",
    make: "Perkins", model: "1106A-70TAG3", serial: "SN-7734", criticality: "A", installDate: "2019-06-30",
    runtimeHours: "12430.6", lifecycle: "active", vide: "GEN-1", locationNote: "Canopy behind utilities yard",
    specs: { power_kva: 500, rpm: 1500 }, components: [{ name: "Battery bank", kind: "assembly" }, { name: "Coolant pump", kind: "pump" }],
  },
  {
    tag: "COMP-1", name: "Screw air compressor 90 kW", category: "compressor", siteCode: "PLT1", areaCode: "UTILITY",
    make: "Atlas Copco", model: "GA-90", serial: "SN-53261", criticality: "A", installDate: "2018-12-01",
    runtimeHours: "40110.7", lifecycle: "active", vide: "COMP-1",
    specs: { power_kw: 90, pressure_bar: 8 },
    components: [{ name: "Air/oil separator element", kind: "assembly" }, { name: "Screw element A-end bearing", kind: "bearing_housing" }],
  },
  {
    tag: "COMP-2", name: "Backup air compressor 55 kW", category: "compressor", siteCode: "PLT1", areaCode: "UTILITY",
    make: "Atlas Copco", model: "GA-55", criticality: "B", installDate: "2020-02-17", runtimeHours: "18040.3", lifecycle: "active",
  },
  {
    tag: "CONV-1", name: "Fabric trolley conveyor belt", category: "conveyor", siteCode: "PLT2", areaCode: "WAREHOUSE",
    make: "Interroll", criticality: "B", installDate: "2019-09-08", runtimeHours: "26770.0", lifecycle: "active",
    components: [{ name: "Head drum bearing", kind: "bearing_housing" }, { name: "Belt PU-1200", kind: "assembly" }],
  },
  {
    tag: "HVAC-1", name: "Dye house chiller", category: "chiller", siteCode: "PLT2", areaCode: "DYEHOUSE",
    make: "Daikin", model: "EWAT-90", criticality: "A", installDate: "2021-04-23", runtimeHours: "23980.8", lifecycle: "active",
  },
  {
    tag: "BOILER-1", name: "Steam boiler 6 t/h", category: "boiler", siteCode: "PLT2", areaCode: "DYEHOUSE",
    make: "Cochran", model: "ST-36", criticality: "A", installDate: "2017-10-15", runtimeHours: "51290.2", lifecycle: "active",
    components: [{ name: "Gas burner", kind: "assembly" }, { name: "Feedwater pump", kind: "pump" }],
  } as SeedMachine,
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required to seed (e.g. your Neon connection string).");
    process.exit(1);
  }
  const sql = postgres(url, { prepare: false, ssl: url.includes("neon.tech") ? "require" : undefined });
  const db = drizzle(sql, { schema });

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const org = await orgsRepo.create(db, {
    name: "Anyanwu Fabrics (Demo)",
    slug: process.env.DEMO_SLUG ?? "anyanwu-demo",
  });

  const people = [
    { name: "Adaeze Anyanwu", email: "owner@demo.cogitex", role: "owner" as const },
    { name: "Emeka Obi", email: "manager@demo.cogitex", role: "maintenance_manager" as const },
    { name: "Ngozi Ibe", email: "tech@demo.cogitex", role: "technician" as const },
    { name: "Auditor Obi", email: "viewer@demo.cogitex", role: "viewer" as const },
  ];

  const users: { id: string; email: string; role: (typeof people)[number]["role"] }[] = [];
  for (const person of people) {
    const user = await usersRepo.create(db, { name: person.name, email: person.email, passwordHash });
    await membershipsRepo.create(db, { organizationId: org.id, userId: user.id, role: person.role });
    users.push({ id: user.id, email: person.email, role: person.role });
    await auditRepo.log(db, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "user.seeded",
      entityType: "user",
      entityId: user.id,
    });
  }
  const owner = users[0];
  if (!owner) throw new Error("seed user missing");

  await auditRepo.log(db, {
    organizationId: org.id,
    action: "org.seeded",
    entityType: "organization",
    entityId: org.id,
    actorKind: "system",
  });

  /* ---------------- sites + areas ---------------- */
  const siteIds = new Map<string, string>();
  for (const s of SITES) {
    const rows = await db.insert(schema.sites).values({ organizationId: org.id, name: s.name, code: s.code, address: s.address }).returning();
    const site = rows[0];
    if (site) siteIds.set(s.code, site.id);
  }
  const areaIds = new Map<string, string>();
  for (const a of AREAS) {
    const siteId = siteIds.get(a.siteCode);
    if (!siteId) continue;
    const rows = await db.insert(schema.areas).values({ organizationId: org.id, siteId, name: a.name, code: a.code, kind: a.kind }).returning();
    const area = rows[0];
    if (area) areaIds.set(a.code, area.id);
  }

  /* ---------------- machines + links + BOM ---------------- */
  const machineTagMap = new Map<string, string>();
  for (const m of MACHINES) {
    const rows = await db.insert(schema.machines).values({
      organizationId: org.id,
      siteId: siteIds.get(m.siteCode) ?? null,
      areaId: m.areaCode ? areaIds.get(m.areaCode) ?? null : null,
      name: m.name,
      tag: m.tag,
      category: m.category,
      make: m.make ?? null,
      model: m.model ?? null,
      serialNumber: m.serial ?? null,
      ratedSpecs: (m.specs ?? {}) as Record<string, unknown>,
      installDate: m.installDate ?? null,
      criticality: m.criticality,
      locationNote: m.locationNote ?? null,
      lifecycleStatus: m.lifecycle,
      runtimeHours: m.runtimeHours,
      profileSnapshot: { name: m.name, tag: m.tag, category: m.category, criticality: m.criticality },
      createdBy: owner.id,
    }).returning();
    const machine = rows[0];
    if (!machine) throw new Error("machine seed insert failed");
    machineTagMap.set(m.tag, machine.id);
    if (m.vide) {
      await db.insert(schema.machineDevices).values({
        organizationId: org.id,
        machineId: machine.id,
        videMachineName: m.vide,
        kind: "machine",
      });
    }
    for (const c of m.components ?? []) {
      await db.insert(schema.machineComponents).values({
        organizationId: org.id,
        machineId: machine.id,
        name: c.name,
        tag: c.tag ?? null,
        kind: c.kind,
      });
    }
    await auditRepo.log(db, {
      organizationId: org.id,
      actorUserId: owner.id,
      action: "machine.created",
      entityType: "machine",
      entityId: machine.id,
      diff: { tag: m.tag, name: m.name, seeded: true },
    });
  }

  /* ---------------- templates + schedules + work orders ---------------- */
  const tplRows = await db.insert(schema.maintenanceTemplates).values([
    { organizationId: org.id, name: "Quarterly pump service", description: "Standard 90-day service on line pumps", machineCategory: "pump", defaultIntervalDays: 90, createdBy: owner.id },
    { organizationId: org.id, name: "Monthly generator check", description: "Fluids, battery, load test", machineCategory: "generator", defaultIntervalDays: 30, createdBy: owner.id },
    { organizationId: org.id, name: "Compressor 250h service", description: "Separator, filters, belts", machineCategory: "compressor", defaultIntervalDays: 30, createdBy: owner.id },
  ]).returning();
  const tplIds = tplRows.map((t) => ({ id: t.id, name: t.name }));
  const tplByName = (n: string) => tplIds.find((t) => t.name === n)?.id;

  const stepSets: Record<string, { seq: number; title: string; kind: string; requireValue: boolean }[]> = {
    "Quarterly pump service": [
      { seq: 1, title: "Isolate and lock out the pump", kind: "check", requireValue: false },
      { seq: 2, title: "Record discharge pressure (bar)", kind: "value", requireValue: true },
      { seq: 3, title: "Check mechanical seal for weeping", kind: "check", requireValue: false },
      { seq: 4, title: "Grease drive-end bearing", kind: "check", requireValue: false },
      { seq: 5, title: "Restore power and confirm flow", kind: "check", requireValue: false },
    ],
    "Monthly generator check": [
      { seq: 1, title: "Check engine oil level", kind: "value", requireValue: true },
      { seq: 2, title: "Check coolant level and hoses", kind: "check", requireValue: false },
      { seq: 3, title: "Battery voltage under load (V)", kind: "value", requireValue: true },
      { seq: 4, title: "10-minute load test run", kind: "check", requireValue: false },
    ],
    "Compressor 250h service": [
      { seq: 1, title: "Replace air/oil separator element", kind: "check", requireValue: false },
      { seq: 2, title: "Record final discharge temp (°C)", kind: "value", requireValue: true },
      { seq: 3, title: "Drain condensate trap", kind: "check", requireValue: false },
    ],
  };
  for (const [tplName, steps] of Object.entries(stepSets)) {
    const tplId = tplByName(tplName);
    if (!tplId) continue;
    for (const s of steps) {
      await db.insert(schema.templateSteps).values({ organizationId: org.id, templateId: tplId, seq: s.seq, title: s.title, kind: s.kind, requireValue: s.requireValue });
    }
  }

  const tech = users.find((u) => u.role === "technician");
  const techUserId = tech?.id ?? owner.id;

  await db.insert(schema.schedules).values([
    { organizationId: org.id, machineId: null, templateId: tplByName("Quarterly pump service"), title: "Quarterly line pump service", kind: "calendar", intervalDays: 90, nextDueAt: new Date(Date.now() + 12 * 86_400_000), notes: "Rotate across PUMP units; log pressure readings.", createdBy: owner.id },
    { organizationId: org.id, machineId: null, templateId: tplByName("Monthly generator check"), title: "Monthly generator checks", kind: "calendar", intervalDays: 30, nextDueAt: new Date(Date.now() + 3 * 86_400_000), createdBy: owner.id },
    { organizationId: org.id, machineId: null, title: "Standby pump exercise run", kind: "calendar", intervalDays: 14, nextDueAt: new Date(Date.now() - 86_400_000), notes: "Exercise standby pumps to keep seals wet.", createdBy: owner.id },
    { organizationId: org.id, machineId: null, title: "Bearer watch — vibration over 5 mm/s", kind: "condition", conditionMetric: "vibration_mm_s", conditionOp: ">", conditionThreshold: "5", createdBy: owner.id },
  ]);

  let woCounter = 0;
  const nextWoNumber = () => `WO-${String(++woCounter).padStart(6, "0")}`;
  let comp1Wo: typeof schema.workOrders.$inferSelect | undefined;

  type SeedWo = {
    machines: string[]; title: string; description?: string; type: string; priority: string;
    status: string; assignedTo?: string; verifiedBy?: string; plannedDaysOffset?: number;
    stepsDone?: number; labor?: { minutes: number; userId: string; note?: string }[];
    summary?: string; rootCause?: string; downtime?: string; cancelledReason?: string; source?: string;
  };
  const woSeeds: SeedWo[] = [
    { machines: ["COMP-1"], title: "Compressor shutdown — separator blocked", description: "COMP-1 tripped on high discharge temp; separator element suspected saturated.", type: "corrective", priority: "critical", status: "verified", assignedTo: techUserId, verifiedBy: owner.id, plannedDaysOffset: -9, stepsDone: 3, labor: [{ minutes: 180, userId: techUserId, note: "element swap + restart" }, { minutes: 45, userId: owner.id, note: "verifier assisted" }], summary: "Separator element replaced, temps normal after 2h run.", rootCause: "Element overdue by 400h — schedule tightened", downtime: "3.5", },
    { machines: ["PUMP-3"], title: "Cooling tower makeup pump vibration inspection", description: "VIDE flagged rising vibration on PUMP-3; inspect drive-end bearing.", type: "preventive", priority: "high", status: "in_progress", assignedTo: techUserId, plannedDaysOffset: 0, stepsDone: 1, labor: [{ minutes: 60, userId: techUserId, note: "isolation done, awaiting bearing stock" }] },
    { machines: ["GEN-1"], title: "500 kVA generator monthly check", type: "preventive", priority: "normal", status: "assigned", assignedTo: techUserId, plannedDaysOffset: 2 },
    { machines: ["MOTOR-2"], title: "Line B drive— unusual noise report", description: "Operators report grinding at high speed; inspect coupling and bearings.", type: "corrective", priority: "high", status: "planned", plannedDaysOffset: 4 },
    { machines: ["HVAC-1"], title: "Dye house chiller condenser clean", type: "preventive", priority: "low", status: "planned", plannedDaysOffset: 11 },
    { machines: ["BOILER-1"], title: "Boiler annual statutory inspection", description: "External + internal inspection with the certified inspector.", type: "inspection", priority: "critical", status: "planned", plannedDaysOffset: 21 },
    { machines: ["CONV-1"], title: "Warehouse conveyor belt tracking", type: "corrective", priority: "low", status: "completed", assignedTo: techUserId, plannedDaysOffset: -4, stepsDone: 0, labor: [{ minutes: 90, userId: techUserId }], summary: "Belt re-tracked, tension set." },
    { machines: ["PUMP-1"], title: "Replace drive-end bearing (spare available)", type: "corrective", priority: "normal", status: "cancelled", cancelledReason: "Superseded by vibration-based PM plan", plannedDaysOffset: -2 },
    { machines: ["MOTOR-1"], title: "Packet line motor insulation test", type: "preventive", priority: "normal", status: "closed", assignedTo: techUserId, verifiedBy: owner.id, plannedDaysOffset: -20, stepsDone: 0, labor: [{ minutes: 120, userId: techUserId, note: "megger + log" }], summary: "Motor Shop — Planned and closed within the month." },
    { machines: ["MOTOR-2"], title: "Line B drive coupling replacement", description: "Operators reported grinding; coupling replaced and laser-aligned.", type: "corrective", priority: "normal", status: "completed", assignedTo: techUserId, plannedDaysOffset: -50, labor: [{ minutes: 240, userId: techUserId, note: "pull coupling, align, trial run" }], summary: "Coupling replaced, alignment 0.05 mm TIR.", downtime: "2" },
    { machines: ["PUMP-4"], title: "Standby pump exercise run", description: "Fortnightly exercise run to keep the standby seals wet.", type: "preventive", priority: "low", status: "completed", assignedTo: techUserId, plannedDaysOffset: -35, labor: [{ minutes: 60, userId: techUserId, note: "15 min no-load run + seal check" }], summary: "Ran under no-load for 15 minutes; seal dry-run check ok.", downtime: "0" },
  ];

  for (const seed of woSeeds) {
    const machineTag = seed.machines[0];
    const machineId = machineTag ? machineTagMap.get(machineTag) ?? null : null;
    const machineRow = machineId ? (await db.select().from(schema.machines).where(eq(schema.machines.id, machineId)).limit(1))[0] : null;
    const tplForCategory: Record<string, string | undefined> = { pump: tplByName("Quarterly pump service"), generator: tplByName("Monthly generator check"), compressor: tplByName("Compressor 250h service") };
    const tplId = machineRow ? tplForCategory[machineRow.category] : undefined;
    const plannedStart = seed.plannedDaysOffset !== undefined ? new Date(Date.now() + seed.plannedDaysOffset * 86_400_000) : null;

    const rows = await db.insert(schema.workOrders).values({
      organizationId: org.id,
      number: nextWoNumber(),
      title: seed.title,
      description: seed.description ?? null,
      machineId,
      type: seed.type,
      priority: seed.priority,
      status: seed.status as "draft" | "planned" | "assigned" | "in_progress" | "on_hold" | "completed" | "verified" | "closed" | "cancelled",
      assignedTo: seed.assignedTo ?? null,
      verifiedBy: seed.verifiedBy ?? null,
      source: seed.source ?? "manual",
      plannedStart,
      plannedEnd: plannedStart ? new Date(plannedStart.getTime() + 3 * 3600_000) : null,
      actualStart: (seed.status === "in_progress" || seed.status === "completed" || seed.status === "verified" || seed.status === "closed")
        ? new Date((plannedStart ?? new Date()).getTime() - 2 * 3600_000)
        : null,
      actualEnd: seed.status === "completed" || seed.status === "verified" || seed.status === "closed" ? new Date((plannedStart ?? new Date()).getTime() + 2 * 3600_000) : null,
      completedSummary: seed.summary ?? null,
      foundRootCause: seed.rootCause ?? null,
      downtimeHours: seed.downtime ?? null,
      cancelledReason: seed.cancelledReason ?? null,
      closedAt: seed.status === "closed" ? new Date() : null,
      createdBy: owner.id,
      templateId: tplId ?? null,
    }).returning();
    const wo = rows[0];
    if (!wo) continue;
    if (machineTag === "COMP-1") comp1Wo = wo;

    // checklist steps borrowed from the matching template (if any)
    if (tplId) {
      const stepRows = await db.select().from(schema.templateSteps).where(eq(schema.templateSteps.templateId, tplId));
      const done = seed.stepsDone ?? 0;
      for (const s of stepRows) {
        const isDone = stepRows.findIndex((x) => x.seq === s.seq) < done;
        await db.insert(schema.workOrderSteps).values({
          organizationId: org.id,
          workOrderId: wo.id,
          seq: s.seq,
          title: s.title,
          kind: s.kind,
          requireValue: s.requireValue,
          completedAt: isDone ? new Date(Date.now() - 3600_000) : null,
          completedBy: isDone ? techUserId : null,
          value: isDone && s.requireValue ? "recorded" : null,
        });
      }
    }
    for (const l of seed.labor ?? []) {
      await db.insert(schema.workOrderLabor).values({ organizationId: org.id, workOrderId: wo.id, userId: l.userId, minutes: l.minutes, note: l.note ?? null });
    }
    await auditRepo.log(db, {
      organizationId: org.id,
      actorUserId: owner.id,
      action: "work_order.created",
      entityType: "work_order",
      entityId: wo.id,
      diff: { number: wo.number, title: wo.title, seeded: true },
    });
  }

  /* ---------------- inventory demo store ---------------- */
  const supplierRows = await db.insert(schema.suppliers).values([
    { organizationId: org.id, name: "Aba Industrial Spares Ltd", email: "sales@abaindustrial.ng", phone: "0803 555 0110", leadTimeDays: 3, notes: "Bearings, seals, couplings. Trade counter on Faulks Rd." },
    { organizationId: org.id, name: "Lubetech Nigeria", email: "orders@lubetech.ng", phone: "0809 555 0142", leadTimeDays: 5, notes: "Oils, greases, coolants." },
    { organizationId: org.id, name: "AirFlow Filtration", email: "hello@airflow.ng", leadTimeDays: 7 },
  ]).returning();
  const supplierByName = (needle: string) => supplierRows.find((s) => s.name.includes(needle))?.id ?? null;

  type SeedItem = {
    sku: string; name: string; category: string; unit: string; qty: string; reorder: string; naira: number;
    loc: string; supplier?: string | null; linkTo?: string[];
  };
  const itemSeeds: SeedItem[] = [
    { sku: "BRG-6205-2RS", name: "Deep-groove bearing 6205 2RS", category: "bearings", unit: "pcs", qty: "18", reorder: "6", naira: 4200, loc: "Bay 2, shelf A3", supplier: "Aba", linkTo: ["PUMP-1", "MOTOR-1"] },
    { sku: "SEAL-MECH-42", name: "Mechanical seal assembly 42 mm", category: "seals", unit: "pcs", qty: "2", reorder: "3", naira: 18500, loc: "Bay 1, drawer 7", supplier: "Aba", linkTo: ["PUMP-1", "PUMP-3"] },
    { sku: "SEP-ELEM-GA90", name: "Air/oil separator element GA-90", category: "filters", unit: "pcs", qty: "1", reorder: "1", naira: 96000, loc: "Bay 3", supplier: "AirFlow", linkTo: ["COMP-1"] },
    { sku: "OIL-SHELL-GO220", name: "Gear oil Shell Omala S2 G 220", category: "oil", unit: "20L pail", qty: "9", reorder: "3", naira: 62000, loc: "Bundle store", supplier: "Lubetech" },
    { sku: "FLT-AIR-55", name: "Backup compressor intake filter", category: "filters", unit: "pcs", qty: "4", reorder: "5", naira: 11500, loc: "Bay 3", supplier: "AirFlow", linkTo: ["COMP-2"] },
    { sku: "BLT-PU-1200", name: "Conveyor belt PU-1200 segment", category: "spares", unit: "m", qty: "12", reorder: "10", naira: 24000, loc: "Rack B", supplier: "Aba", linkTo: ["CONV-1"] },
    { sku: "COOL-FW-40", name: "Boiler feedwater treatment 40 kg", category: "consumables", unit: "bag", qty: "6", reorder: "2", naira: 33000, loc: "Chem store", supplier: "Lubetech", linkTo: ["BOILER-1"] },
    { sku: "TAPE-INS-3M", name: "Insulation tape 33 kV", category: "consumables", unit: "roll", qty: "0", reorder: "4", naira: 1200, loc: "Bay 2, shelf C1", supplier: "Aba" },
    { sku: "GRS-EP2-400", name: "Lithium EP2 grease 400 g", category: "oil", unit: "tub", qty: "14", reorder: "4", naira: 2800, loc: "Bundle store", supplier: "Lubetech", linkTo: ["PUMP-1", "CONV-1"] },
  ];
  const itemIdBySku = new Map<string, string>();
  const itemsNow = Date.now();

  for (const s of itemSeeds) {
    const rows = await db.insert(schema.inventoryItems).values({
      organizationId: org.id,
      sku: s.sku,
      name: s.name,
      category: s.category,
      unit: s.unit,
      qtyOnHand: s.qty,
      reorderPoint: s.reorder,
      unitCostKobo: s.naira,
      locationNote: s.loc,
      supplierId: s.supplier ? supplierByName(s.supplier) : null,
    }).returning();
    const row = rows[0];
    if (!row) continue;
    itemIdBySku.set(s.sku, row.id);

    // opening delivery receipt (a few weeks ago) explains the on-hand figure
    await db.insert(schema.stockLedger).values({
      organizationId: org.id,
      itemId: row.id,
      kind: "receipt",
      qty: s.qty,
      unitCostKobo: s.naira,
      balanceAfter: s.qty,
      reference: "opening delivery — GRN-1004",
      createdBy: owner.id,
      createdAt: new Date(itemsNow - 14 * 86_400_000),
    });

    for (const tag of s.linkTo ?? []) {
      const machineId = machineTagMap.get(tag);
      if (machineId) await db.insert(schema.machineParts).values({ organizationId: org.id, machineId, inventoryItemId: row.id });
    }
  }

  const sealSku = "SEAL-MECH-42";
  const sealId = itemIdBySku.get(sealSku);
  const pump3Id = machineTagMap.get("PUMP-3");
  // The in-progress PUMP-3 card awaited "seal + bearing stock" in the narrative —
  // reserved and half-issued: seal issued (stock down), bearing reserved (open promise).
  const pump3Wo = pump3Id
    ? (await db.select().from(schema.workOrders).where(eq(schema.workOrders.machineId, pump3Id)).limit(1))[0]
    : undefined;
  if (pump3Wo && sealId) {
    const sealRow = (await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, sealId)).limit(1))[0];
    if (sealRow) {
      await db.update(schema.inventoryItems).set({ qtyOnHand: "1" }).where(eq(schema.inventoryItems.id, sealId)); // was 2 → issued 1
      await db.insert(schema.workOrderParts).values({
        organizationId: org.id,
        workOrderId: pump3Wo.id,
        inventoryItemId: sealId,
        name: `${sealRow.sku} — ${sealRow.name}`,
        qty: "1",
        unitCostKobo: sealRow.unitCostKobo,
        issuedAt: new Date(itemsNow - 3600_000),
        issuedBy: techUserId,
        note: "old seal was weeping",
      });
      await db.insert(schema.stockLedger).values({
        organizationId: org.id,
        itemId: sealId,
        kind: "issue",
        qty: "-1",
        unitCostKobo: sealRow.unitCostKobo,
        balanceAfter: "1",
        workOrderId: pump3Wo.id,
        createdBy: techUserId,
        createdAt: new Date(itemsNow - 3600_000),
      });
      const brgId = itemIdBySku.get("BRG-6205-2RS");
      if (brgId) {
        await db.insert(schema.inventoryReservations).values({
          organizationId: org.id,
          itemId: brgId,
          workOrderId: pump3Wo.id,
          qty: "2",
          createdBy: owner.id,
        });
      }
    }
  }
  void sealSku;

  /* ---------------- VIDE fault history (M4 webhook intake replay) ---------------- */
  const faultSeeds = [
    { device: "PUMP-1", faultType: "rising_vibration", severity: "warning", daysAgo: 2, status: "open", description: "Velocity RMS trending up on the drive end (4.8 -> 6.1 mm/s over 3 h)." },
    { device: "PUMP-3", faultType: "overheating", severity: "critical", daysAgo: 1, status: "open", description: "Bearing temperature above the alarm limit; discharge flow reduced." },
    { device: "MOTOR-2", faultType: "voltage_sag", severity: "watch", daysAgo: 4, status: "open", description: "Recurrent sags during extruder start-up draws." },
    { device: "GEN-1", faultType: "battery_undercharge", severity: "warning", daysAgo: 6, status: "acknowledged", description: "Battery held below float setpoint after a long grid outage.", ack: true },
    { device: "COMP-1", faultType: "discharge_temp_high", severity: "critical", daysAgo: 9, status: "converted", description: "High discharge temperature trip; separator element saturated.", convertToComp1: true },
    { device: "HVAC-1", faultType: "communication_lost", severity: "warning", daysAgo: 8, status: "dismissed", description: "Gateway dropout during the maintenance window; telemetry normal after restore." },
  ];
  let faultCounter = 0;
  for (const f of faultSeeds) {
    await db.insert(schema.faultEvents).values({
      organizationId: org.id,
      machineId: machineTagMap.get(f.device) ?? null,
      videMachineName: f.device,
      faultType: f.faultType,
      severity: f.severity,
      description: f.description,
      flaggedAt: new Date(Date.now() - Math.round(f.daysAgo * 86_400_000)),
      status: f.status,
      ...(f.ack ? { acknowledgedBy: techUserId, acknowledgedAt: new Date(Date.now() - Math.round((f.daysAgo - 0.5) * 86_400_000)) } : {}),
      ...(f.convertToComp1 && comp1Wo ? { woId: comp1Wo.id } : {}),
      payload: { seeded: true },
    });
    faultCounter++;
  }
  await auditRepo.log(db, {
    organizationId: org.id,
    action: "faults.seeded",
    entityType: "fault_event",
    entityId: org.id,
    actorKind: "system",
    diff: { count: faultCounter },
  });

  // keep the per-org counter in sync
  await db
    .insert(schema.orgCounters)
    .values({ organizationId: org.id, kind: "work_order", lastValue: woCounter })
    .onConflictDoUpdate({ target: [schema.orgCounters.organizationId, schema.orgCounters.kind], set: { lastValue: woCounter } });

  console.log("Seeded organization:", org.name, `(${org.slug})`);
  for (const person of people) {
    console.log(`  ${person.role.padEnd(20)} ${person.email} / ${DEMO_PASSWORD}`);
  }
  console.log(`  sites ${SITES.length} · areas ${AREAS.length} · machines ${MACHINES.length} · templates ${tplIds.length} · work orders ${woCounter} · fault events ${faultCounter}`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
