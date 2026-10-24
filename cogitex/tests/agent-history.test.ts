import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { machinesWriteService } from "@/server/services/machines";
import { workOrderWriteService } from "@/server/services/work-orders";
import { expensesService } from "@/server/services/machine-history";
import { notesService } from "@/server/services/machine-notes";
import { agentService, agentTools, matchIntentLocal } from "@/server/services/agent";
import { agentToolLogs, workOrderParts } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";

let db: AppDb;
let ctx: Ctx;
let techCtx: Ctx;
let stalenessCtx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);

  const org = await orgsRepo.create(db, { name: "Pitch Plant", slug: `pitch-${testId()}` });
  const mkUser = async (name: string, role: "owner" | "maintenance_manager" | "technician") => {
    const u = await usersRepo.create(db, { name, email: `${name}-${testId()}@x.io`, passwordHash: "x" });
    await membershipsRepo.create(db, { organizationId: org.id, userId: u.id, role });
    return u;
  };
  const owner = await mkUser("Owner P", "owner");
  const tech = await mkUser("Tech P", "technician");
  const mgr = await mkUser("Mgr P", "maintenance_manager");

  const base = { userId: owner.id, email: owner.email, name: owner.name, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos" };
  ctx = { ...base, roles: ["owner"] };
  techCtx = { ...base, userId: tech.id, email: tech.email, name: tech.name, roles: ["technician"] };
  stalenessCtx = { ...base, userId: mgr.id, email: mgr.email, name: mgr.name, roles: ["maintenance_manager"] };
});

afterEach(() => {
  __resetDbForTests();
});

/** the pitch machine exactly as the doc names it */
async function ukrChillerFor() {
  return machinesWriteService.create(ctx, {
    name: "UKR Chiller 01",
    tag: "UKR-CH-01",
    category: "chiller",
    criticality: "A",
  });
}

const PITCH = "show UKRs' chiller's last service and spend";

describe("deterministic matcher — the pitch phrase routes to machine_history", () => {
  it("resolves UKRs' chiller from a partial NAME (no tag, no full name in the message)", () => {
    const intent = matchIntentLocal(PITCH, [{ tag: "UKR-CH-01", name: "UKR Chiller 01" }]);
    expect(intent.tool).toBe("machine_history");
    expect(intent.args).toEqual({ tag: "UKR-CH-01" });
    expect(intent.via).toBe("local");
  });

  it("works with just the register's distinctive token: 'what is the UKR's history?'", () => {
    const intent = matchIntentLocal("what is the UKR's history?", [{ tag: "UKR-CH-01", name: "UKR Chiller 01" }]);
    expect(intent.tool).toBe("machine_history");
    expect(intent.args).toEqual({ tag: "UKR-CH-01" });
  });

  it("does not misroute generic cost/fault/create phrasings that came before this tool", () => {
    const list = [{ tag: "UKR-CH-01", name: "UKR Chiller 01" }];
    expect(matchIntentLocal("cost last 30 days", []).tool).toBe("cost_summary");
    expect(matchIntentLocal("open faults", list).tool).toBe("open_faults");
    expect(matchIntentLocal("create a work order for UKR-CH-01 replace bearing", list).tool).toBe("create_work_order");
    // fault words never hijack the history tool ("fault history on the chiller" is faults/short-brief territory)
    expect(matchIntentLocal("show me chiller fault history", list).tool).not.toBe("machine_history");
  });

  it("unambiguous generic nouns stay out: two machines sharing 'chiller' never collide on it", () => {
    const list = [
      { tag: "UKR-CH-01", name: "UKR Chiller 01" },
      { tag: "IKR-CH-02", name: "IKR Chiller 02" },
    ];
    // no distinctive token, no adjacency → falls through to the follow-up noun rule resolution
    const intent = matchIntentLocal("history of the chiller?", list);
    expect(intent.tool).not.toBe("machine_history");
  });
});

describe("THE pitch moment — agentService.chat answers UKR chiller's last service and spend", () => {
  it("routes from chat (no LLM key), cites machine + last-service WO, and reports verbatim kobo", async () => {
    const machine = await ukrChillerFor();

    const done = await workOrderWriteService.create(ctx, { title: "Bearing swap", type: "corrective", priority: "high", machineId: machine.id });
    await workOrderWriteService.transition(ctx, done.id, "assigned", { assignedTo: techCtx.userId });
    await workOrderWriteService.transition(techCtx, done.id, "in_progress");
    await workOrderWriteService.addLabor(techCtx, done.id, { minutes: 120 }); // 500_000 kobo
    await db.insert(workOrderParts).values({
      organizationId: ctx.orgId,
      workOrderId: done.id,
      inventoryItemId: null,
      name: "DE bearing",
      qty: "1",
      unitCostKobo: 150_000,
      issuedAt: new Date(),
    });
    await workOrderWriteService.transition(techCtx, done.id, "completed", { completedSummary: "Bearing swapped", downtimeHours: 1 });
    await workOrderWriteService.transition(stalenessCtx, done.id, "verified");
    await workOrderWriteService.transition(ctx, done.id, "closed");

    await expensesService.add(ctx, machine.id, { kind: "fuel", description: "Diesel swap", amountKobo: 40_000, occurredAt: new Date(Date.now() - 10 * 86_400_000) });
    await expensesService.add(ctx, machine.id, { kind: "contract", description: "Old alignment", amountKobo: 90_000, occurredAt: new Date(Date.now() - 400 * 86_400_000) });

    const reply = await agentService.chat(ctx, PITCH);
    expect(reply.via).toBe("local");
    // last service from the concluded card
    expect(reply.text).toContain(`Last service: ${new Date().toISOString().slice(0, 10)}`);
    expect(reply.text).toContain(done.number);
    // spend math: 500_000 lab + 150_000 parts + 130_000 manual = 780_000; 365d window drops the old contract
    expect(reply.text).toContain("Lifetime spend: 780000 kobo");
    expect(reply.text).toContain("last 365 days: 690000 kobo");
    expect(reply.text).toContain("fuel — Diesel swap: 40000 kobo");
    expect(reply.text).toContain("Cards: 0 open, 1 concluded");
    expect(reply.text).toContain("Biggest card: " + done.number + " at 650000 kobo");
    // citations: the machine and its last-service card
    const kinds = reply.citations.map((c) => c.kind);
    expect(kinds).toContain("machine");
    expect(kinds).toContain("wo");
    // the tool run is logged as a read
    const logs = await db
      .select({ tool: agentToolLogs.tool, status: agentToolLogs.status, args: agentToolLogs.args })
      .from(agentToolLogs)
      .where(and(eq(agentToolLogs.organizationId, ctx.orgId), eq(agentToolLogs.tool, "machine_history")));
    const entry = logs[0];
    expect(entry?.status).toBe("read");
    expect(entry?.args).toEqual({ tag: "UKR-CH-01" });
  });

  it("threads the NOTES surface through the answer (item 2 wired in)", async () => {
    const machine = await ukrChillerFor();
    await notesService.add(ctx, machine.id, { title: "Freon leak history", body: "Module B leaked after the 2026 rainy season." });

    const reply = await agentService.chat(ctx, PITCH);
    expect(reply.text).toContain("1 note on file — latest: “Freon leak history”");
  });

  it("a never-serviced machine answers honestly (no service, spend still real)", async () => {
    const machine = await ukrChillerFor();
    await expensesService.add(ctx, machine.id, { kind: "service", description: "Precommission check", amountKobo: 25_000 });

    const reply = await agentService.chat(ctx, PITCH);
    expect(reply.text).toContain("No concluded service on record yet.");
    expect(reply.text).toContain("Lifetime spend: 25000 kobo");
    expect(reply.text).not.toContain("Last service:");
  });

  it("the tool alone (not via chat) also answers, with contains-match for partial names", async () => {
    await ukrChillerFor();
    const reply = await agentTools.machine_history(ctx, { tag: "ukr chiller" });
    expect(reply.text).toContain("UKR-CH-01");
    expect(reply.text).toContain("No concluded service on record yet.");
  });

  it("tenancy: another org's ctx cannot get this machine's story", async () => {
    const machine = await ukrChillerFor();
    const foreignOrg = await orgsRepo.create(db, { name: "Other Plant", slug: `other-${testId()}` });
    const other = await usersRepo.create(db, { name: "Oo", email: `oo-${testId()}@x.io`, passwordHash: "x" });
    await membershipsRepo.create(db, { organizationId: foreignOrg.id, userId: other.id, role: "owner" });
    const otherCtx: Ctx = { ...ctx, userId: other.id, email: other.email, name: other.name, orgId: foreignOrg.id, orgSlug: foreignOrg.slug, orgName: foreignOrg.name };

    const direct = await agentTools.machine_history(otherCtx, { tag: "UKR-CH-01" });
    expect(direct.text).toBe(`No machine matching "UKR-CH-01" in this workspace.`);
  });
});
