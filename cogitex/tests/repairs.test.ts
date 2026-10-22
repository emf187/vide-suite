import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { machinesWriteService } from "@/server/services/machines";
import { faultsWriteService, faultsService } from "@/server/services/faults";
import {
  MARKETPLACE_WEBHOOK_STATUSES,
  applyMarketplaceWebhookEvent,
  repairRequestsService,
  repairRequestsWriteService,
} from "@/server/services/repair-requests";
import { repairRequests, repairRequestEvents } from "@/server/db/schema";
import { POST } from "@/app/api/webhooks/marketplace/route";

let db: AppDb;
let org2Id: string;
let ctx: Ctx; // owner (can send)
let viewerCtx: Ctx;
let otherOrgCtx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);

  const org = await orgsRepo.create(db, { name: "Repair Plant", slug: `rep-${testId()}` });
  const owner = await usersRepo.create(db, { name: "Repair Owner", email: `owner-${testId()}@x.io`, passwordHash: "x" });
  const viewer = await usersRepo.create(db, { name: "Repair Viewer", email: `viewer-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: owner.id, role: "owner" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: viewer.id, role: "viewer" });

  const org2 = await orgsRepo.create(db, { name: "Other Plant", slug: `rep2-${testId()}` });
  org2Id = org2.id;
  const outsider = await usersRepo.create(db, { name: "Outsider", email: `out-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org2.id, userId: outsider.id, role: "owner" });

  const base = { userId: owner.id, email: owner.email, name: owner.name, endDate: undefined, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos" } as unknown as Ctx;
  ctx = { ...base, roles: ["owner"] };
  viewerCtx = { ...base, userId: viewer.id, roles: ["viewer"] } as Ctx;
  otherOrgCtx = { ...base, userId: outsider.id, orgId: org2.id, orgSlug: org2.slug, orgName: org2.name, roles: ["owner"] } as Ctx;
});

afterEach(() => {
  __resetDbForTests();
  delete process.env.WEBHOOK_SECRET;
});

async function seededMachineAndFault(deviceName = "PUMP-3") {
  const machine = await machinesWriteService.create(ctx, {
    name: "Feed pump", tag: deviceName, category: "pump", criticality: "A",
    videMachineNames: [deviceName],
  });
  await faultsWriteService.ingestFromWebhook(db, ctx.orgId, deviceName, {
    faultType: "rising_vibration", severity: "warning", description: "RMS trending up",
  });
  const open = await faultsService.list(ctx, { status: "open" });
  return { machine, fault: open[0]! };
}

describe("M5 compile: the brief is deterministic and stays local", () => {
  it("compiles machine snapshot + fault + skill/tools/urgency into a compiled draft", async () => {
    const { machine } = await seededMachineAndFault();
    const { requestId } = await repairRequestsWriteService.compile(ctx, { machineId: machine.id });

    const row = await repairRequestsService.byId(ctx, requestId);
    expect(row?.status).toBe("compiled");
    const brief = row?.brief as { machineSnapshot: { tag?: string }; fault?: { type: string }; skill: string; urgency: string };
    expect(brief.machineSnapshot.tag).toBe("PUMP-3");
    expect(brief.skill).toBe("specialist"); // pump → specialist + tools
    expect(brief.urgency).toBe("high"); // machine criticality high → high
  });

  it("compile from a linked fault picks up fault type and severity-driven urgency", async () => {
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump", videMachineNames: ["PUMP-3"] });
    await faultsWriteService.ingestFromWebhook(db, ctx.orgId, "PUMP-3", { faultType: "trip", severity: "critical" });
    const fault = (await faultsService.list(ctx, { status: "open" }))[0]!;

    const { requestId } = await repairRequestsWriteService.compile(ctx, { faultEventId: fault.id });
    const row = await repairRequestsService.byId(ctx, requestId);
    const brief = row?.brief as { fault?: { type: string; severity: string }; urgency: string };
    expect(brief.fault?.type).toBe("trip");
    expect(brief.urgency).toBe("critical");
    expect(row?.urgency).toBe("critical");
  });

  it("viewers cannot compile", async () => {
    const { machine } = await seededMachineAndFault();
    await expect(repairRequestsWriteService.compile(viewerCtx, { machineId: machine.id })).rejects.toThrow("forbidden:repairRequests.send");
  });

  it("tenancy: another org cannot compile from a machine it does not own", async () => {
    const m = await machinesWriteService.create(ctx, { name: "Feed pump", tag: "MY-1", category: "pump" });
    await expect(repairRequestsWriteService.compile(otherOrgCtx, { machineId: m.id })).rejects.toThrow("machine_not_found");
  });
});

describe("M5 send: confirm-before-send", () => {
  it("compiled → sent stores confirmed_brief + marketplace id; send twice is refused", async () => {
    const m = await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump", videMachineNames: ["PUMP-3"] });
    const { requestId } = await repairRequestsWriteService.compile(ctx, { machineId: m.id });

    await repairRequestsWriteService.send(ctx, requestId, { urgency: "critical", notes: "Night window only" });
    const row = await repairRequestsService.byId(ctx, requestId);
    expect(row?.status).toBe("sent");
    expect(row?.marketplaceRequestId).toMatch(/^mockrq_/);
    expect(row?.sentAt).not.toBeNull();
    const confirmed = row?.confirmedBrief as { urgency: string; notes: string };
    expect(confirmed.urgency).toBe("critical");
    expect(confirmed.notes).toBe("Night window only");

    await expect(repairRequestsWriteService.send(ctx, requestId, {})).rejects.toThrow("not_sendable:sent");
  });

  it("events trail records compiled → sent by the user", async () => {
    const m = await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump", videMachineNames: ["PUMP-3"] });
    const { requestId } = await repairRequestsWriteService.compile(ctx, { machineId: m.id });
    await repairRequestsWriteService.send(ctx, requestId, {});
    const events = await repairRequestsService.events(ctx, requestId);
    expect(events.map((e) => [e.fromStatus, e.toStatus, e.actor])).toContainEqual(["compiled", "sent", "user"]);
  });
});

describe("M5 status engine (webhook + reconciliation)", () => {
  async function sentRequest(deviceName = "PUMP-3") {
    const m = await machinesWriteService.create(ctx, { name: "Feed pump", tag: deviceName, category: "pump", videMachineNames: [deviceName] });
    const { requestId } = await repairRequestsWriteService.compile(ctx, { machineId: m.id });
    await repairRequestsWriteService.send(ctx, requestId, {});
    return { m, requestId, mrqId: (await repairRequestsService.byId(ctx, requestId))!.marketplaceRequestId! };
  }

  it("webhook transitions carry quote, ETA, and technician identity", async () => {
    const { requestId, mrqId } = await sentRequest();

    let to = await applyMarketplaceWebhookEvent({ requestId: mrqId, status: "quoted", quoteKobo: 4_500_000, technician: { id: "tech_ife_b", name: "Ife Balogun", rating: 4.8 } });
    expect(to).toBe("quoted");
    to = await applyMarketplaceWebhookEvent({ requestId: mrqId, status: "accepted", etaAt: "2026-10-22T09:00:00Z" });
    expect(to).toBe("accepted");

    const row = await repairRequestsService.byId(ctx, requestId);
    expect(row?.quoteKobo).toBe(4_500_000);
    expect(row?.technicianId).not.toBeNull();
    expect(row?.acceptedAt).not.toBeNull();
    expect(row?.etaAt?.getUTCFullYear()).toBe(2026);

    // idempotent replay is a no-op
    const again = await applyMarketplaceWebhookEvent({ requestId: mrqId, status: "accepted" });
    expect(again).toBe("accepted");
    const events = await repairRequestsService.events(ctx, requestId);
    expect(events.filter((e) => e.toStatus === "accepted")).toHaveLength(1);
  });

  it("unknown marketplace id → null (404 for sender)", async () => {
    expect(await applyMarketplaceWebhookEvent({ requestId: "mockrq_nope", status: "matched" })).toBeNull();
  });

  it("terminal rows are frozen — arrived_days_late events cannot resurrect them", async () => {
    const { requestId, mrqId } = await sentRequest();
    await applyMarketplaceWebhookEvent({ requestId: mrqId, status: "declined" });
    const frozen = await applyMarketplaceWebhookEvent({ requestId: mrqId, status: "completed" });
    expect(frozen).toBe("declined");
    const row = await repairRequestsService.byId(ctx, requestId);
    expect(row?.status).toBe("declined");
  });

  it("refreshStatus pulls the mock store's current status", async () => {
    const { requestId, mrqId } = await sentRequest();
    const integrations = (await import("@/lib/integrations/factory")).getIntegrations();
    (integrations.marketplace as unknown as { advance: (id: string, status: "matched") => void }).advance(mrqId, "matched");
    const refreshed = await repairRequestsWriteService.refreshStatus(ctx, requestId);
    expect(refreshed).toBe("matched");
  });

  it("tenancy: status payloads are matched by globally-unique marketplace id from the row's org", async () => {
    const { mrqId } = await sentRequest("PUMP-7");
    // the other org's owner gets nothing when listing anyway
    expect(await repairRequestsService.list(otherOrgCtx)).toHaveLength(0);
    // and webhook updates land on OUR row (org resolved from the matched row, never the payload)
    await applyMarketplaceWebhookEvent({ requestId: mrqId, status: "matched" });
    const row = await repairRequestsService.byId(ctx, (await repairRequestsService.list(ctx))[0]!.id);
    expect(row?.status).toBe("matched");
    void org2Id;
  });
});

describe("M5 withdraw + confirm", () => {
  it("withdraw from sent stores reason; withdraw after acceptance is refused", async () => {
    const m = await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump", videMachineNames: ["PUMP-3"] });
    const { requestId, mrqId } = (await (async () => {
      const { requestId } = await repairRequestsWriteService.compile(ctx, { machineId: m.id });
      await repairRequestsWriteService.send(ctx, requestId, {});
      const row = await repairRequestsService.byId(ctx, requestId);
      return { requestId, mrqId: row!.marketplaceRequestId! };
    })());

    await repairRequestsWriteService.withdraw(ctx, requestId, "Fixed in-house");
    const row = await repairRequestsService.byId(ctx, requestId);
    expect(row?.status).toBe("withdrawn");
    expect(row?.cancelledReason).toBe("Fixed in-house");
    expect(mrqId).toMatch(/^mockrq_/);

    // another request: acceptance locks withdrawal
    const { requestId: r2, mrqId: mrq2 } = await (async () => {
      const { requestId } = await repairRequestsWriteService.compile(ctx, { machineId: m.id });
      await repairRequestsWriteService.send(ctx, requestId, {});
      const row = await repairRequestsService.byId(ctx, requestId);
      return { requestId, mrqId: row!.marketplaceRequestId! };
    })();
    await applyMarketplaceWebhookEvent({ requestId: mrq2, status: "matched" });
    await applyMarketplaceWebhookEvent({ requestId: mrq2, status: "accepted" });
    await expect(repairRequestsWriteService.withdraw(ctx, r2, "too late")).rejects.toThrow("not_withdrawable:accepted");
    void r2;
  });

  it("completed + rating → confirmed; confirmation before completion is refused", async () => {
    const m = await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump", videMachineNames: ["PUMP-3"] });
    const { requestId } = await repairRequestsWriteService.compile(ctx, { machineId: m.id });
    await repairRequestsWriteService.send(ctx, requestId, {});
    await expect(repairRequestsWriteService.confirmAndRate(ctx, requestId, { rating: 5 })).rejects.toThrow("not_confirmable:sent");

    const mrqId = (await repairRequestsService.byId(ctx, requestId))!.marketplaceRequestId!;
    await applyMarketplaceWebhookEvent({ requestId: mrqId, status: "completed", outcomeSummary: "Bearing replaced" });
    await repairRequestsWriteService.confirmAndRate(ctx, requestId, { rating: 4, note: "Late but thorough — seal also replaced" });

    const row = await repairRequestsService.byId(ctx, requestId);
    expect(row?.status).toBe("confirmed");
    expect(row?.rating).toBe(4);
    expect(row?.ratingNote).toContain("seal");
    expect(row?.confirmedAt).not.toBeNull();
  });
});

describe("M5 demo advance (mock-only teleport)", () => {
  it("walks sent → matched → quoted → accepted → en_route → on_site → completed", async () => {
    const m = await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump", videMachineNames: ["PUMP-3"] });
    const { requestId } = await repairRequestsWriteService.compile(ctx, { machineId: m.id });
    await repairRequestsWriteService.send(ctx, requestId, {});

    for (const step of ["matched", "quoted", "accepted", "en_route", "on_site", "completed"] as const) {
      const to = await repairRequestsWriteService.demoAdvance(ctx, requestId, step);
      expect(to).toBe(step);
    }
    const row = await repairRequestsService.byId(ctx, requestId);
    expect(row?.status).toBe("completed");
    expect(row?.quoteKobo).toBe(4_500_000); // mock quoted price
    expect(row?.outcomeSummary).toContain("bearing");
  });
});

describe("M5 marketplace webhook route", () => {
  function call(body: unknown, headers: Record<string, string> = {}) {
    return POST(new Request("http://local/api/webhooks/marketplace", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }));
  }

  it("rejects a wrong secret with 401 when configured", async () => {
    process.env.WEBHOOK_SECRET = "whsec_test_123";
    const res = await call({ requestId: "mockrq_0001", status: "matched" }, { "x-webhook-secret": "wrong" });
    expect(res.status).toBe(401);
  });

  it("400 on malformed body or unknown status; 404 on unknown request id", async () => {
    expect((await call({ requestId: "x", status: "banana" })).status).toBe(400);
    expect((await POST(new Request("http://local/api/webhooks/marketplace", { method: "POST", body: "nope" }))).status).toBe(400);
    expect((await call({ requestId: "mockrq_missing", status: "matched" })).status).toBe(404);
    expect(MARKETPLACE_WEBHOOK_STATUSES.length).toBe(10);
  });

  it("happy path end-to-end: compile → send → webhook quoted → completed → confirmed row", async () => {
    const m = await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump", videMachineNames: ["PUMP-3"] });
    const { requestId } = await repairRequestsWriteService.compile(ctx, { machineId: m.id });
    await repairRequestsWriteService.send(ctx, requestId, {});
    const mrqId = (await repairRequestsService.byId(ctx, requestId))!.marketplaceRequestId!;

    expect((await call({ requestId: mrqId, status: "quoted", quoteKobo: 3_000_00, technician: { id: "tech_amaka_e", name: "Amaka Eze", rating: 4.9 } })).status).toBe(200);
    const row = (await db.select().from(repairRequests).where(eq(repairRequests.id, requestId)))[0];
    expect(row?.status).toBe("quoted");
    expect(Number(row?.quoteKobo)).toBe(3_000_00);
    const trail = (await db.select().from(repairRequestEvents).where(eq(repairRequestEvents.repairRequestId, requestId)));
    expect(trail.map((e) => e.toStatus)).toContain("quoted");
  });
});
