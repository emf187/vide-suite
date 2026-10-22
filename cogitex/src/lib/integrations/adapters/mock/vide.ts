import {
  HEALTH_SCORE,
  type EnergySummary,
  type EnergySummaryParams,
  type FaultHistoryParams,
  type HealthSummary,
  type LifecycleNoticeAck,
  type LifecycleNoticeInput,
  type RuntimeHours,
  type VideClient,
  type VideCriticalEvent,
  type VideMachineRecord,
  type VideReading,
} from "@/lib/integrations/interfaces";
import {
  MOCK_CRITICAL_EVENTS,
  MOCK_FACTORY_NAME,
  MOCK_MACHINES,
  MOCK_NOW,
  MOCK_POWER_QUALITY,
  buildMockEnergyBuckets,
  buildMockReadings,
} from "./fixtures";

/**
 * Mock VideClient — implements VERIFIED shapes faithfully (per docs/INTEGRATION_CONTRACTS.md)
 * plus deterministic PROPOSED summaries so the app is fully demoable before VIDE is reachable.
 */
export class MockVideClient implements VideClient {
  /** Records lifecycle write-outs for tests. */
  lifecycleCalls: LifecycleNoticeInput[] = [];

  async getDetailedHealth(): Promise<{ status: string; factory?: { name: string | null } }> {
    return { status: "ok", factory: { name: MOCK_FACTORY_NAME } };
  }

  async listMachines(): Promise<VideMachineRecord[]> {
    return [...MOCK_MACHINES];
  }

  async getRecentReadings(machineName: string, limit: number): Promise<VideReading[]> {
    return buildMockReadings(machineName, limit);
  }

  async listCriticalEvents(limit: number): Promise<VideCriticalEvent[]> {
    return MOCK_CRITICAL_EVENTS.slice(0, limit);
  }

  async getMachineHealthSummary(machineName: string, window: "h24" | "d7" | "d30"): Promise<HealthSummary> {
    const machine = MOCK_MACHINES.find((m) => m.machineName === machineName);
    if (!machine) {
      return { score: 0, status: "unknown", statusLabel: "Not linked to a VIDE device", asOf: MOCK_NOW };
    }
    const score = HEALTH_SCORE[machine.healthStatus];
    // PUMP-3 tells the rising-vibration story: declining scores over the window.
    let samples: { at: string; score: number }[] | undefined;
    if (machineName === "PUMP-3") {
      const points = window === "h24" ? 8 : window === "d7" ? 7 : 10;
      const step = (100 - score) / points;
      samples = Array.from({ length: points }, (_, i) => ({
        at: new Date(Date.parse(MOCK_NOW) - (points - i) * (window === "h24" ? 3 * 3_600_000 : 86_400_000)).toISOString(),
        score: Math.round(100 - step * (points - i)),
      }));
    }
    return {
      score,
      status: machine.healthStatus,
      statusLabel: machine.healthStatus,
      rul:
        machineName === "PUMP-3"
          ? { estimateHours: 64, uncertaintyHours: 20, basis: "model", affecting: ["Vibration 2x rising", "Bearing temperature drift"] }
          : undefined,
      samples,
      asOf: MOCK_NOW,
    };
  }

  async getEnergySummary(params: EnergySummaryParams): Promise<EnergySummary> {
    const from = Date.parse(params.from || MOCK_NOW);
    const to = Date.parse(params.to || MOCK_NOW);
    const days = Math.max(1, Math.min(60, Math.round((to - from) / 86_400_000) || 14));
    return {
      buckets: buildMockEnergyBuckets(params.machineName, days),
      powerQuality: params.machineName === "MOTOR-1" ? [...MOCK_POWER_QUALITY] : [],
    };
  }

  async getRuntimeHours(machineName: string): Promise<RuntimeHours> {
    const known = MOCK_MACHINES.some((m) => m.machineName === machineName);
    return {
      totalHours: known ? 41_800 + (machineName.length % 7) * 137 : 0,
      since: "2025-01-01T00:00:00.000Z",
      confidence: "metered",
    };
  }

  async listFaultHistory(params: FaultHistoryParams): Promise<VideCriticalEvent[]> {
    const matching = MOCK_CRITICAL_EVENTS.filter((e) => {
      if (params.machineName && e.machineName !== params.machineName) return false;
      if (Date.parse(e.flaggedAt) < Date.parse(params.from ?? "0")) return false;
      if (params.to && Date.parse(e.flaggedAt) > Date.parse(params.to)) return false;
      return true;
    });
    return matching;
  }

  async getDevicesStatus(deviceIds: string[]): Promise<
    { deviceId: string; machineName?: string; online: boolean; lastSeen?: string; batteryPct?: number; firmware?: string }[]
  > {
    return deviceIds.map((deviceId, i) => ({
      deviceId,
      machineName: MOCK_MACHINES[i]?.machineName,
      online: deviceId !== "dev_comp_1",
      lastSeen: deviceId === "dev_comp_1" ? "2026-02-15T21:00:00.000Z" : MOCK_NOW,
      batteryPct: deviceId === "dev_comp_1" ? 0 : 87 + (i % 10),
      firmware: "vid-fw-2.4.1",
    }));
  }

  async postLifecycleNotice(input: LifecycleNoticeInput): Promise<LifecycleNoticeAck> {
    this.lifecycleCalls.push(input);
    return {
      accepted: true,
      ingestionReleasedFrom: input.action === "decommission" ? new Date().toISOString() : undefined,
      deviceReleaseAt: input.action === "decommission" ? new Date(Date.now() + 3_600_000).toISOString() : undefined,
    };
  }
}
