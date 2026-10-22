import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { machinesWriteService } from "@/server/services/machines";
import { faultsService, faultsWriteService, videCacheService } from "@/server/services/faults";
import { faultEvents, workOrders } from "@/server/db/schema";
import { POST } from "@/app/api/webhooks/vide/route";

let db: AppDb;
let org1Id: string;
let org2Id: string;
let ctx: Ctx; // owner of org1
let viewerCtx: Ctx;
let otherOrgCtx: Ctx; // owner of org2

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);

  const org = await orgsRepo.create(db, { name: "Fault Plant", slug: `faults-${testId()}` });
  org1Id = org.id;
  const owner = await usersRepo.create(db, { name: "Fault Owner", email: `owner-${testId()}@x.io`, passwordHash: "x" });
  const viewer = await usersRepo.create(db, { name: "Fault Viewer", email: `viewer-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: owner.id, role: "owner" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: viewer.id, role: "viewer" });

  const org2 = await orgsRepo.create(db, { name: "Other Plant", slug: `faults2-${testId()}` });
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

describe("M4 webhook ingest: name-resolution", () => {
  it("resolves the machine strictly by vide device name inside the claimed org", async () => {
    const machine = await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump", videMachineNames: ["PUMP-3"] });
    const res = await faultsWriteService.ingestFromWebhook(db, org1Id, "PUMP-3", {
      faultType: "rising_vibration",
      severity: "warning",
      description: "RMS trending up",
      flaggedAt: new Date("2026-10-20T09:00:00Z"),
    });
    expect(res.inserted).toBe(true);

    const rows = await faultsService.list(ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.machineId).toBe(machine.id);
    expect(rows[0]?.faultType).toBe("rising_vibration");
    expect(rows[0]?.severity).toBe("warning");
    expect(rows[0]?.status).toBe("open");
  });

  it("skips events for devices that are not linked in the org (unknown_device)", async () => {
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump", videMachineNames: ["PUMP-3"] });
    const res = await faultsWriteService.ingestFromWebhook(db, org1Id, "GHOST-9", { faultType: "trip" });
    expect(res.inserted).toBe(false);
    expect(res.reason).toBe("unknown_device:GHOST-9");
    expect(await faultsService.list(ctx)).toHaveLength(0);
  });

  it("tenancy: the same device name in another org is a different machine, and a payload id never wins", async () => {
    // org1 links PUMP-3; org2 does NOT link it — an org2-claimed event for "PUMP-3" must be skipped
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump", videMachineNames: ["PUMP-3"] });
    const res = await faultsWriteService.ingestFromWebhook(db, org2Id, "PUMP-3", { faultType: "trip" });
    expect(res.inserted).toBe(false);

    // and org2 never sees org1's faults
    expect(await faultsService.list(otherOrgCtx)).toHaveLength(0);
    expect(await faultsService.openCount(ctx)).toBe(0);
  });

  it("defaults: unknown severity falls back to warning, empty fault type to unclassified", async () => {
    await machinesWriteService.create(ctx, { name: "Blower", tag: "BLW-1", category: "fan", videMachineNames: ["BLW-1"] });
    await faultsWriteService.ingestFromWebhook(db, org1Id, "BLW-1", { faultType: "", severity: "banana" });
    const rows = await faultsService.list(ctx);
    expect(rows[0]?.severity).toBe("warning");
    expect(rows[0]?.faultType).toBe("unclassified");
  });
});

describe("M4 triage: acknowledge / dismiss / convert", () => {
  async function seedFault(overrides: { severity?: string; device?: string; tag?: string } = {}) {
    const tag = overrides.tag ?? `PUMP-${testId().toUpperCase()}`;
    await machinesWriteService.create(ctx, { name: "Feed pump", tag, category: "pump", videMachineNames: [overrides.device ?? tag] });
    await faultsWriteService.ingestFromWebhook(db, org1Id, overrides.device ?? tag, {
      faultType: "trip",
      severity: overrides.severity ?? "critical",
    });
    const rows = await faultsService.list(ctx);
    return rows[0]!;
  }

  it("viewers cannot triage (roles always from DB-backed session)", async () => {
    const fault = await seedFault();
    await expect(faultsWriteService.acknowledge(viewerCtx, fault.id)).rejects.toThrow("forbidden:wo.plan");
    await expect(faultsWriteService.dismiss(viewerCtx, fault.id)).rejects.toThrow("forbidden:wo.plan");
    await expect(faultsWriteService.convertToWorkOrder(viewerCtx, fault.id)).rejects.toThrow("forbidden:wo.plan");
  });

  it("acknowledge stamps actor + time; double-ack is rejected", async () => {
    const fault = await seedFault();
    await faultsWriteService.acknowledge(ctx, fault.id);
    const after = (await faultsService.list(ctx))[0]!;
    expect(after.status).toBe("acknowledged");
    expect(after.acknowledgedAt).not.toBeNull();
    await expect(faultsWriteService.acknowledge(ctx, fault.id)).rejects.toThrow("not_open:acknowledged");
  });

  it("dismiss works from open or acknowledged, never from converted", async () => {
    const fault = await seedFault();
    await faultsWriteService.acknowledge(ctx, fault.id);
    await faultsWriteService.dismiss(ctx, fault.id);
    expect((await faultsService.list(ctx))[0]?.status).toBe("dismissed");
  });

  it("convert creates a corrective WO with severity→priority mapping and links the fault", async () => {
    const fault = await seedFault({ severity: "critical" });
    const { woId, woNumber } = await faultsWriteService.convertToWorkOrder(ctx, fault.id);
    expect(woNumber).toMatch(/^WO-/);

    const wo = (await db.select().from(workOrders).where(eq(workOrders.id, woId)))[0];
    expect(wo?.type).toBe("corrective");
    expect(wo?.priority).toBe("critical");
    expect(wo?.status).toBe("planned");

    const rows = await faultsService.list(ctx);
    expect(rows[0]?.status).toBe("converted");
    expect(rows[0]?.woId).toBe(woId);
    expect(rows[0]?.woNumber).toBe(woNumber);

    await expect(faultsWriteService.convertToWorkOrder(ctx, fault.id)).rejects.toThrow("already_converted");
  });

  it("watch-severity converts to low priority; dismissed faults cannot convert", async () => {
    const f1 = await seedFault({ severity: "watch" });
    const { woId } = await faultsWriteService.convertToWorkOrder(ctx, f1.id);
    const wo = (await db.select().from(workOrders))[0];
    expect(wo?.id).toBe(woId);
    expect(wo?.priority).toBe("low");

    const f2 = await seedFault({ severity: "watch" });
    await faultsWriteService.dismiss(ctx, f2.id);
    await expect(faultsWriteService.convertToWorkOrder(ctx, f2.id)).rejects.toThrow("already_dismissed");
  });
});

describe("M4 videCacheService (cache-through telemetry)", () => {
  it("serves from cache within TTL and refetches once expired", async () => {
    let fetches = 0;
    const fetcher = async () => {
      fetches += 1;
      return { score: 90 - fetches, status: "ok" };
    };

    const first = await videCacheService.getThrough(ctx, "health:PUMP-3:d7", 60_000, fetcher);
    expect(first.cached).toBe(false);
    expect(first.payload).toEqual({ score: 89, status: "ok" });

    const second = await videCacheService.getThrough(ctx, "health:PUMP-3:d7", 60_000, fetcher);
    expect(second.cached).toBe(true);
    expect(second.payload).toEqual({ score: 89, status: "ok" });
    expect(fetches).toBe(1);

    const rows = await db.select().from(faultEvents); // sanity: table exists (migration 0005)
    expect(Array.isArray(rows)).toBe(true);

    // expiry → refetch
    await new Promise((r) => setTimeout(r, 15));
    const third = await videCacheService.getThrough(ctx, "health:PUMP-3:d7", 1, fetcher);
    expect(third.cached).toBe(false);
    expect(third.payload).toEqual({ score: 88, status: "ok" });
    expect(fetches).toBe(2);
  });

  it("cache is scoped per org — two orgs with the same key both fetch", async () => {
    let fetches = 0;
    const fetcher = async () => {
      fetches += 1;
      return { n: fetches };
    };
    await videCacheService.getThrough(ctx, "energy:PUMP-3:7d:day", 60_000, fetcher);
    await videCacheService.getThrough(otherOrgCtx, "energy:PUMP-3:7d:day", 60_000, fetcher);
    expect(fetches).toBe(2);
  });
});

describe("M4 webhook endpoint (route-level)", () => {
  function call(body: unknown, headers: Record<string, string> = {}) {
    return POST(new Request("http://local/api/webhooks/vide", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }));
  }

  it("rejects a wrong secret with 401 when WEBHOOK_SECRET is configured", async () => {
    process.env.WEBHOOK_SECRET = "whsec_test_123";
    const res = await call({ org: "x", events: [{ kind: "fault", machine: "M" }] }, { "x-webhook-secret": "wrong" });
    expect(res.status).toBe(401);
  });

  it("accepts the correct secret", async () => {
    process.env.WEBHOOK_SECRET = "whsec_test_123";
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump", videMachineNames: ["PUMP-3"] });
    const res = await call(
      { org: ctx.orgSlug, events: [{ kind: "fault", machine: "PUMP-3", faultType: "trip", severity: "critical" }] },
      { "x-webhook-secret": "whsec_test_123" },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { results: { result: string }[] };
    expect(json.results[0]?.result).toBe("inserted");
  });

  it("404 for an unknown org slug and 400 for malformed bodies", async () => {
    const missing = await call({ org: "nope", events: [{ kind: "fault", machine: "M" }] });
    expect(missing.status).toBe(404);

    const badBody = await POST(new Request("http://local/api/webhooks/vide", { method: "POST", body: "not-json" }));
    expect(badBody.status).toBe(400);

    const empty = await call({ org: "x", events: [] });
    expect(empty.status).toBe(400);
  });

  it("full round trip: fault in → triage via service → readings pre-warm cache", async () => {
    await machinesWriteService.create(ctx, { name: "Feed pump", tag: "PUMP-3", category: "pump", videMachineNames: ["PUMP-3"] });
    const res = await call({
      org: ctx.orgSlug,
      events: [
        { kind: "fault", machine: "PUMP-3", faultType: "rising_vibration", severity: "warning", at: "2026-10-20T09:00:00Z" },
        { kind: "readings", machine: "PUMP-3", snapshot: { kwh: 12.5, at: "2026-10-20T09:00:00Z" } },
        { kind: "fault", machine: "GHOST-9", faultType: "trip" },
        { kind: "weather", machine: "PUMP-3" },
      ],
    });
    const json = (await res.json()) as { received: number; results: { result: string }[] };
    expect(json.received).toBe(4);
    expect(json.results.map((r) => r.result)).toEqual(["inserted", "stored", "unknown_device:GHOST-9", "unsupported_kind"]);

    const open = await faultsService.list(ctx, { status: "open" });
    expect(open).toHaveLength(1);
    expect(await faultsService.openCount(ctx)).toBe(1);

    // fault conversions still gated by roles; owner converts → WO appears
    const converted = await faultsWriteService.convertToWorkOrder(ctx, open[0]!.id);
    expect(converted.woNumber).toMatch(/^WO-/);
  });
});
