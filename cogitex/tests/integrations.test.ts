import { describe, expect, it } from "vitest";
import { getIntegrations, __resetIntegrations } from "@/lib/integrations/factory";
import { HEALTH_SCORE } from "@/lib/integrations/interfaces";
import { MockMarketplaceClient } from "@/lib/integrations/adapters/mock/marketplace";
import { MockNotificationClient } from "@/lib/integrations/adapters/mock/notification";

describe("mock VideClient (contract fixtures)", () => {
  it("exposes the VERIFIED machines list with the four health statuses", async () => {
    __resetIntegrations();
    const integrations = getIntegrations();
    const machines = await integrations.vide.listMachines();
    expect(machines.length).toBeGreaterThanOrEqual(5);
    const statuses = new Set(machines.map((m) => m.healthStatus));
    expect(statuses.has("healthy")).toBe(true);
    expect(statuses.has("watch")).toBe(true);
    expect(statuses.has("warning")).toBe(true);
    expect(statuses.has("critical")).toBe(true);
    expect(HEALTH_SCORE["watch"]).toBe(75);
  });

  it("tells the rising-vibration story for PUMP-3", async () => {
    __resetIntegrations();
    const integrations = getIntegrations();
    const readings = await integrations.vide.getRecentReadings("PUMP-3", 12);
    expect(readings).toHaveLength(12);
    const first = readings[0];
    const last = readings[11];
    expect(first).toBeTruthy();
    expect(last).toBeTruthy();
    expect(first!.vibrationMmS).toBeLessThan(last!.vibrationMmS ?? 0);

    const summary = await integrations.vide.getMachineHealthSummary("PUMP-3", "d7");
    expect(summary.status).toBe("watch");
    expect(summary.rul?.estimateHours).toBeGreaterThan(0);
    expect(summary.samples?.length).toBeGreaterThan(0);

    const events = await integrations.vide.listCriticalEvents(5);
    expect(events.some((e) => e.machineName === "PUMP-3" && e.faultType === "bearing_degradation")).toBe(true);
  });

  it("returns voltage-sag story for MOTOR-1 energy", async () => {
    __resetIntegrations();
    const integrations = getIntegrations();
    const energy = await integrations.vide.getEnergySummary({
      machineName: "MOTOR-1",
      from: "2026-02-02T00:00:00.000Z",
      to: "2026-02-16T00:00:00.000Z",
      bucket: "day",
    });
    expect(energy.buckets.length).toBeGreaterThan(3);
    expect(energy.powerQuality?.some((pq) => pq.eventType === "voltage_sag")).toBe(true);
    expect((await integrations.vide.getRecentReadings("NOT-A-MACHINE", 3)).length).toBe(0);
  });

  it("notes lifecycle write-outs (decommission)", async () => {
    __resetIntegrations();
    const integrations = getIntegrations();
    const vide = integrations.vide as unknown as { lifecycleCalls: unknown[] };
    const ack = await integrations.vide.postLifecycleNotice({
      machineName: "PUMP-9",
      action: "decommission",
      reason: "retired",
      requestedBy: { userId: "u1", name: "Owner" },
      orgRef: "org_demo",
    });
    expect(ack.accepted).toBe(true);
    expect(vide.lifecycleCalls).toHaveLength(1);
  });
});

describe("mock CortexClient", () => {
  it("provides RUL and records root-cause feedback", async () => {
    __resetIntegrations();
    const integrations = getIntegrations();
    const rul = await integrations.cortex.getRulEstimate("PUMP-3");
    expect(rul?.estimateHours).toBe(64);
    expect(await integrations.cortex.getRulEstimate("MOTOR-2")).toBeNull();

    await integrations.cortex.sendConfirmedRootCause({
      eventId: "evt_1",
      rootCauseCode: "bearing_wear",
      rootCauseText: "DE bearing spalled; replaced and realigned.",
      workOrderNumber: "WO-2026-000001",
      confirmedBy: { userId: "u1", name: "Manager" },
      completedAt: "2026-02-16T10:00:00.000Z",
    });
    const cortex = integrations.cortex as unknown as { confirmedRootCauses: unknown[] };
    expect(cortex.confirmedRootCauses).toHaveLength(1);
  });
});

describe("mock MarketplaceClient", () => {
  it("walks the subscription-based status flow with no commission logic", async () => {
    const marketplace = new MockMarketplaceClient();
    const created = await marketplace.createRepairRequest({
      localRequestId: "local-1",
      orgRef: "org_demo",
      brief: {
        machineSnapshot: { tag: "PUMP-3" },
        fault: { type: "bearing_degradation", severity: "high", confidence: 0.86 },
        suggestedParts: [{ sku: "BRG-6205", qty: 2 }],
        tools: ["Bearing puller"],
        skill: "intermediate",
        urgency: "high",
      },
    });
    expect(created.marketplaceRequestId).toMatch(/^mockrq_/);

    const path = [
      "matched",
      "quoted",
      "accepted",
      "en_route",
      "on_site",
      "completed",
    ] as const;
    for (const step of path) {
      marketplace.advance(created.marketplaceRequestId, step);
    }
    const status = await marketplace.getRequestStatus(created.marketplaceRequestId);
    expect(status.status).toBe("completed");
    expect(status.technician?.name).toBe("Ife Balogun");
    expect(status.quoteKobo).toBe(4_500_000);

    await marketplace.submitRating({ marketplaceRequestId: created.marketplaceRequestId, rating: 5, note: "tidy work" });
    expect((await marketplace.getRequestStatus(created.marketplaceRequestId)).status).toBe("completed");
  });

  it("supports withdrawal", async () => {
    const marketplace = new MockMarketplaceClient();
    const created = await marketplace.createRepairRequest({
      localRequestId: "local-2",
      orgRef: "org_demo",
      brief: { machineSnapshot: {}, suggestedParts: [], tools: [], skill: "basic", urgency: "low" },
    });
    await marketplace.cancelRepairRequest(created.marketplaceRequestId, "found in-house cover", "user-1");
    expect((await marketplace.getRequestStatus(created.marketplaceRequestId)).status).toBe("withdrawn");
  });

  it("lists skills-filtered technicians", async () => {
    const marketplace = new MockMarketplaceClient();
    const all = await marketplace.listTechnicians({});
    const electrical = await marketplace.listTechnicians({ skills: ["electrical"] });
    expect(all.length).toBe(3);
    expect(electrical.map((t) => t.displayName)).toEqual(["Chidi Okafor"]);
  });
});

describe("mock NotificationClient", () => {
  it("records in-app sends and dedupes by key", async () => {
    const notifications = new MockNotificationClient();
    const base = { orgId: "org1", userId: "u1", channel: "in_app" as const, kind: "fault_raised", title: "Fault", body: "PUMP-3 vibration" };
    expect(await notifications.send({ ...base, dedupeKey: "evt-77" })).toBe("sent");
    expect(await notifications.send({ ...base, dedupeKey: "evt-77" })).toBe("skipped");
    expect(await notifications.send({ ...base, userId: "u2", dedupeKey: "evt-77" })).toBe("sent");
    expect(notifications.sent).toHaveLength(2);
    expect((await notifications.health()).provider).toBe("mock");
  });
});

describe("factory", () => {
  it("defaults to the mock profile and caches the bundle", async () => {
    __resetIntegrations();
    const a = getIntegrations();
    const b = getIntegrations();
    expect(a).toBe(b);
    expect(a.profile).toBe("mock");
  });
});
