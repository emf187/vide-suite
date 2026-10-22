import type {
  EnergySummary,
  EnergySummaryParams,
  HealthSummary,
  LifecycleNoticeAck,
  LifecycleNoticeInput,
  VideClient,
  VideCriticalEvent,
  VideMachineRecord,
  VideReading,
} from "@/lib/integrations/interfaces";

/**
 * Real VideClient over the OBSERVED (VERIFIED) REST API of VIDE main.
 * Only VERIFIED endpoints are implemented; proposed ones raise until VIDE ships them —
 * per the brief: never invent silent contract assumptions.
 */
export class RealVideClient implements VideClient {
  private base: string;

  constructor(base: string) {
    this.base = base.replace(/\/$/, "");
  }

  private async get(pathname: string): Promise<unknown> {
    const res = await fetch(`${this.base}${pathname}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`VIDE ${pathname} -> ${res.status}`);
    return res.json();
  }

  async getDetailedHealth(): Promise<{ status: string; factory?: { name: string | null } }> {
    return (await this.get("/health/detailed")) as never;
  }

  async listMachines(): Promise<VideMachineRecord[]> {
    return (await this.get("/machines")) as never;
  }

  async getRecentReadings(machineName: string, limit: number): Promise<VideReading[]> {
    return (await this.get(`/readings/recent/${encodeURIComponent(machineName)}?limit=${limit}`)) as never;
  }

  async listCriticalEvents(limit: number): Promise<VideCriticalEvent[]> {
    return (await this.get(`/diagnostics/critical-events?limit=${limit}`)) as never;
  }

  /** PROPOSED endpoint — shipped by the VIDE CORTEX SIM API (M10). */
  async getMachineHealthSummary(machineName: string, window: "h24" | "d7" | "d30"): Promise<HealthSummary> {
    return (await this.get(`/machines/${encodeURIComponent(machineName)}/health-summary?window=${window}`)) as never;
  }

  /** PROPOSED endpoint — shipped by the VIDE CORTEX SIM API (M10). */
  async getEnergySummary(params: EnergySummaryParams): Promise<EnergySummary> {
    const q = new URLSearchParams({ from: params.from, to: params.to, bucket: params.bucket ?? "day" });
    return (await this.get(`/machines/${encodeURIComponent(params.machineName)}/energy-summary?${q.toString()}`)) as never;
  }

  async getRuntimeHours(): Promise<never> {
    throw new Error("VIDE integration: runtime hours endpoint is PROPOSED (INTEGRATION_CONTRACTS.md §2).");
  }

  async listFaultHistory(): Promise<never> {
    throw new Error("VIDE integration: fault history endpoint is PROPOSED (INTEGRATION_CONTRACTS.md §2).");
  }

  async getDevicesStatus(): Promise<never> {
    throw new Error("VIDE integration: device status endpoint is PROPOSED (INTEGRATION_CONTRACTS.md §2).");
  }

  /** PROPOSED endpoint — shipped by the VIDE CORTEX SIM API (M10). */
  async postLifecycleNotice(input: LifecycleNoticeInput): Promise<LifecycleNoticeAck> {
    const res = await fetch(`${this.base}/lifecycle/notices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`VIDE /lifecycle/notices -> ${res.status}`);
    return (await res.json()) as LifecycleNoticeAck;
  }
}

export type { VideCriticalEvent } from "@/lib/integrations/interfaces";
