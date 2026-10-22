import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { machinesWriteService } from "@/server/services/machines";
import { inventoryWriteService } from "@/server/services/inventory";
import { faultsWriteService, faultsService } from "@/server/services/faults";
import { workOrderWriteService } from "@/server/services/work-orders";
import { agentService, matchIntentLocal } from "@/server/services/agent";
import { agentToolLogs, workOrders } from "@/server/db/schema";

let db: AppDb;
let ctx: Ctx; // owner
let viewerCtx: Ctx;
let otherOrgCtx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);

  const org = await orgsRepo.create(db, { name: "Agent Plant", slug: `ag-${testId()}` });
  const owner = await usersRepo.create(db, { name: "Agent Owner", email: `owner-${testId()}@x.io`, passwordHash: "x" });
  const viewer = await usersRepo.create(db, { name: "Agent Viewer", email: `viewer-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: owner.id, role: "owner" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: viewer.id, role: "viewer" });

  const org2 = await orgsRepo.create(db, { name: "Other Plant", slug: `ag2-${testId()}` });
  const outsider = await usersRepo.create(db, { name: "Outsider", email: `out-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org2.id, userId: outsider.id, role: "owner" });

  const base = { userId: owner.id, email: owner.email, name: owner.name, endDate: undefined, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos" } as unknown as Ctx;
  ctx = { ...base, roles: ["owner"] };
  viewerCtx = { ...base, userId: viewer.id, roles: ["viewer"] } as Ctx;
  otherOrgCtx = { ...base, userId: outsider.id, orgId: org2.id, orgSlug: org2.slug, orgName: org2.name, roles: ["owner"] } as Ctx;
});

afterEach(() => {
  __resetDbForTests();
  delete process.env.AGENT_LLM_API_KEY;
});

const MACHINE_LIST = [{ tag: "PUMP-3", name: "Feed pump" }, { tag: "MOTOR-2", name: "Drive motor" }];

describe("M7 intent matcher (deterministic, no key)", () => {
  it("routes the canonical phrasings", () => {
    expect(matchIntentLocal("what's wrong with PUMP-3?", MACHINE_LIST)).toMatchObject({ tool: "machine_brief", args: { tag: "PUMP-3" } });
    expect(matchIntentLocal("any critical alarms?", MACHINE_LIST)).toMatchObject({ tool: "open_faults", args: { severity: "critical" } });
    expect(matchIntentLocal("open faults", MACHINE_LIST)).toMatchObject({ tool: "open_faults" });
    expect(matchIntentLocal("do we have stock for BRG-6204?", MACHINE_LIST)).toMatchObject({ tool: "stock_lookup", args: { query: "BRG-6204" } });
    expect(matchIntentLocal("cost last 30 days", MACHINE_LIST)).toMatchObject({ tool: "cost_summary", args: { days: 30 } });
    expect(matchIntentLocal("cost last 90 days", MACHINE_LIST)).toMatchObject({ tool: "cost_summary", args: { days: 90 } });
    expect(matchIntentLocal("open work orders", MACHINE_LIST)).toMatchObject({ tool: "list_open_work_orders" });
    expect(matchIntentLocal("help", MACHINE_LIST)).toMatchObject({ tool: "help" });
  });

  it("fleet-size questions never fall into the stock rule; fault sizes stay faults", () => {
    expect(matchIntentLocal("how many machines do we have at the plant?", MACHINE_LIST)).toMatchObject({ tool: "fleet_summary" });
    expect(matchIntentLocal("how many units are connected?", MACHINE_LIST)).toMatchObject({ tool: "fleet_summary" });
    expect(matchIntentLocal("give me a fleet overview", MACHINE_LIST)).toMatchObject({ tool: "fleet_summary" });
    // "do we have" without a machine/equipment noun stays stock
    expect(matchIntentLocal("do we have spare bearings in stock?", MACHINE_LIST)).toMatchObject({ tool: "stock_lookup" });
    // "how many faults do we have?" stays a fault question
    expect(matchIntentLocal("how many faults do we have?", MACHINE_LIST)).toMatchObject({ tool: "open_faults" });
    // work-order counts reach the queue list
    expect(matchIntentLocal("how many work orders do we have?", MACHINE_LIST)).toMatchObject({ tool: "list_open_work_orders" });
  });

  it("create-intent extracts machine, type and priority; unknown gibberish maps to none", () => {
    const intent = matchIntentLocal("create a critical work order for PUMP-3: replace DE bearing", MACHINE_LIST);
    expect(intent.tool).toBe("create_work_order");
    expect(intent.args).toMatchObject({ machineTag: "PUMP-3", priority: "critical", type: "corrective" });
    expect(String(intent.args.title)).toContain("replace DE bearing");

    expect(matchIntentLocal("plan preventive service for MOTOR-2 (PM)", MACHINE_LIST).args).toMatchObject({ machineTag: "MOTOR-2", type: "preventive" });
    expect(matchIntentLocal("what is the moon made of", MACHINE_LIST).tool).toBe("none");

    // titles are kept <= 80 chars
    const long = matchIntentLocal(`create a work order for PUMP-3: ${"lorem ipsum dolor sit amet consectetur ".repeat(4)}`, MACHINE_LIST);
    expect(String(long.args.title).length).toBeLessThanOrEqual(80);
  });

  it("stays deterministic when no LLM key is configured (via=local always)", async () => {
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump" });
    const reply = await agentService.chat(ctx, "what's wrong with PUMP-3?");
    expect(reply.via).toBe("local");
    expect(reply.citations[0]?.kind).toBe("machine");
  });
});

describe("M7 read tools", () => {
  it("machine_brief cites the machine and reports open cards/faults", async () => {
    const m = await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump", videMachineNames: ["PUMP-3"] });
    await faultsWriteService.ingestFromWebhook(db, ctx.orgId, "PUMP-3", { faultType: "trip", severity: "critical" });
    await faultsWriteService.ingestFromWebhook(db, ctx.orgId, "PUMP-3", { faultType: "sag", severity: "watch" });
    await workOrderWriteServiceSeed(m.id);

    const reply = await agentService.chat(ctx, "open faults on PUMP-3?");
    expect(reply.text).toContain("trip (critical)");
    expect(reply.citations.length).toBeGreaterThan(0);

    const brief = await agentService.chat(ctx, "what's wrong with PUMP-3?");
    expect(brief.text).toContain("Open faults: 2");
    expect(brief.text).toContain("WO-000001");
  });

  it("stock_lookup reports on-hand vs reserved availability", async () => {
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump" });
    const item = await inventoryWriteService.createItem(ctx, { sku: "BRG-6204", name: "Deep-groove bearing 6204", unit: "pcs" });
    await inventoryWriteService.receive(ctx, item.id, { qty: 10, unitCostKobo: 150_000, reference: "PO-1" });

    // seed an open WO to reserve against
    const wo = await workOrderWriteServiceSeed(null);
    await inventoryWriteService.reserve(ctx, item.id, wo.woId, { qty: 4 });

    const reply = await agentService.chat(ctx, "stock for BRG-6204?");
    expect(reply.text).toContain("BRG-6204");
    expect(reply.text).toContain("6 pcs available");
    expect(reply.text).toContain("4 reserved");
    expect(reply.citations.some((c) => c.label === "BRG-6204")).toBe(true);
  });

  it("cost_summary keeps every numeral traceable to the calc bundle", async () => {
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump" });
    const wo = await workOrderWriteServiceSeed((await machinesWriteService.create(ctx, { name: "Pump B", tag: "PUMP-9", category: "pump" })).id);
    await workOrderWriteService.transition(ctx, wo.woId, "assigned", { assignedTo: ctx.userId });
    await workOrderWriteService.transition(ctx, wo.woId, "in_progress");

    const reply = await agentService.chat(ctx, "cost last 7 days");
    expect(reply.text).toMatch(/Maintenance cost over the last 7 days/);
    expect(reply.text).toContain("kobo");
    // the fallback (guard-failed) text would NOT contain these counts
    expect(reply.text).toMatch(/work orders? completed/);
  });

  it("tenancy: other org's machines never resolve", async () => {
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump", videMachineNames: ["PUMP-3"] });
    const reply = await agentService.chat(otherOrgCtx, "what's wrong with PUMP-3?"); // routes to machine_brief, answered org-scoped
    expect(reply.text).toContain("No machine matching");
    expect(reply.citations).toHaveLength(0);
  });
});

describe("M7 write proposals: propose → CONFIRM", () => {
  it("create_work_order proposal does nothing until confirmed; then source=agent + planned", async () => {
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump" });

    const reply = await agentService.chat(ctx, "create a work order for PUMP-3: replace DE bearing");
    expect(reply.proposal).toBeDefined();
    expect(reply.proposal?.tool).toBe("create_work_order");
    let wos = await db.select().from(workOrders).where(eq(workOrders.organizationId, ctx.orgId));
    expect(wos).toHaveLength(0); // nothing ran yet

    const confirmed = await agentService.confirmProposal(ctx, reply.proposal!.logId);
    expect(confirmed.text).toMatch(/WO-\d{6}/);
    wos = await db.select().from(workOrders).where(eq(workOrders.organizationId, ctx.orgId));
    expect(wos).toHaveLength(1);
    expect(wos[0]?.source).toBe("agent");
    expect(wos[0]?.status).toBe("planned");
    expect(wos[0]?.machineId).not.toBeNull();

    await expect(agentService.confirmProposal(ctx, reply.proposal!.logId)).rejects.toThrow("not_pending:write-executed");
  });

  it("discard marks the proposal refused without executing", async () => {
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump" });
    const reply = await agentService.chat(ctx, "create a work order for PUMP-3: replace DE bearing");
    await agentService.discardProposal(ctx, reply.proposal!.logId);
    expect(await db.select().from(workOrders).where(eq(workOrders.organizationId, ctx.orgId))).toHaveLength(0);
    await expect(agentService.confirmProposal(ctx, reply.proposal!.logId)).rejects.toThrow("not_pending:write-refused");
  });

  it("fault flows: acknowledge and convert latest default-device faults", async () => {
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump", videMachineNames: ["PUMP-3"] });
    await machinesWriteService.create(ctx, { name: "Blower", tag: "BLW-1", category: "fan", videMachineNames: ["BLW-1"] });
    await faultsWriteService.ingestFromWebhook(db, ctx.orgId, "PUMP-3", { faultType: "trip", severity: "critical" });
    await faultsWriteService.ingestFromWebhook(db, ctx.orgId, "BLW-1", { faultType: "imbalance", severity: "warning" });

    // acknowledge scoped to device
    const ack = await agentService.chat(ctx, "acknowledge the latest fault on BLW-1");
    expect(ack.proposal?.tool).toBe("acknowledge_fault");
    const ackConf = await agentService.confirmProposal(ctx, ack.proposal!.logId);
    expect(ackConf.text).toContain("BLW-1");
    const afterAck = await faultsService.list(ctx, { status: "acknowledged" });
    expect(afterAck).toHaveLength(1);
    expect(afterAck[0]?.faultType).toBe("imbalance");

    // convert picks PUMP-3 (only remaining open fault)
    const conv = await agentService.chat(ctx, "convert the latest fault on PUMP-3 to a work order");
    const convConf = await agentService.confirmProposal(ctx, conv.proposal!.logId);
    expect(convConf.text).toMatch(/WO-\d{6}/);
    const [convertedFault] = await faultsService.list(ctx, { status: "converted" });
    expect(convertedFault?.faultType).toBe("trip");
  });

  it("compile_repair_request proposes; confirming only DRAFTS (human still sends)", async () => {
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump" });
    const reply = await agentService.chat(ctx, "compile a repair request for PUMP-3");
    expect(reply.proposal?.tool).toBe("compile_repair_request");

    const conf = await agentService.confirmProposal(ctx, reply.proposal!.logId);
    expect(conf.text).toMatch(/NOTHING was sent/i);
    expect(conf.citations[0]?.kind).toBe("repair");
  });
});

describe("M7 gates: roles + tenancy + logs", () => {
  it("viewer proposing a write gets refused and logged, never executed", async () => {
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump" });
    const reply = await agentService.chat(viewerCtx, "create a work order for PUMP-3: replace DE bearing");
    expect(reply.proposal).toBeUndefined();
    expect(reply.text).toContain("can't");
    const logs = await db.select().from(agentToolLogs).where(eq(agentToolLogs.organizationId, viewerCtx.orgId));
    expect(logs.some((l) => l.status === "write-refused" && l.error === "forbidden:wo.plan")).toBe(true);
    expect(await db.select().from(workOrders).where(eq(workOrders.organizationId, viewerCtx.orgId))).toHaveLength(0);
  });

  it("proposals are user- and org-scoped — a foreign confirm is not_found", async () => {
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump" });
    const reply = await agentService.chat(ctx, "create a work order for PUMP-3: replace DE bearing");
    await expect(agentService.confirmProposal(otherOrgCtx, reply.proposal!.logId)).rejects.toThrow("proposal_not_found");
    await expect(agentService.confirmProposal(viewerCtx, reply.proposal!.logId)).rejects.toThrow("proposal_not_found");
  });

  it("tool activity lands in agent_tool_logs with citations", async () => {
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump" });
    await agentService.chat(ctx, "what's wrong with PUMP-3?");
    const logs = await agentService.recentLogs(ctx, 20);
    const entry = logs.find((l) => l.tool === "machine_brief");
    expect(entry?.status).toBe("read");
    expect((entry?.citations ?? []).length).toBeGreaterThan(0);
    expect(entry?.via).toBe("local");
  });
});

/* seed helper: returns a planned WO (corrective) ready to transition */
async function workOrderWriteServiceSeed(machineId: string | null) {
  const { workOrderWriteService } = await import("@/server/services/work-orders");
  const wo = await workOrderWriteService.create(ctx, {
    title: "Seeded card", machineId, type: "corrective", priority: "normal", source: "manual",
  });
  return { woId: wo.id, woNumber: wo.number };
}
