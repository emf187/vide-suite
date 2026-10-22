import type {
  MarketplaceClient,
  MarketplaceRequestStatus,
  MarketplaceRequestStatusInfo,
  RepairRequestDraft,
  TechnicianProfile,
} from "@/lib/integrations/interfaces";
import { MOCK_TECHNICIANS } from "./fixtures";

const NONE = {} as TechnicianProfile;

type StoredRequest = {
  status: MarketplaceRequestStatus;
  technician?: { id: string; name: string; rating?: number };
  quoteKobo?: number;
  etaAt?: string;
  outcomeSummary?: string;
  rating?: 1 | 2 | 3 | 4 | 5;
  ratingNote?: string;
  cancelReason?: string;
};

/**
 * Mock MarketplaceClient — in-memory store with a `advance()` helper that simulates
 * the marketplace's webhook transitions (matched → quoted → accepted → en_route → on_site → completed)
 * for demos and tests. Subscriptions are all-inclusive: no per-job commission, no pay-for-ranking, no ads.
 */
export class MockMarketplaceClient implements MarketplaceClient {
  store = new Map<string, StoredRequest>();

  async createRepairRequest(input: RepairRequestDraft): Promise<{ marketplaceRequestId: string; sentAt: string }> {
    const id = `mockrq_${String(this.store.size + 1).padStart(4, "0")}`;
    this.store.set(id, { status: "sent" });
    return { marketplaceRequestId: id, sentAt: new Date().toISOString() };
  }

  async cancelRepairRequest(requestId: string, reason: string, byUserId: string): Promise<void> {
    const rec = this.store.get(requestId);
    if (!rec) throw new Error(`unknown request ${requestId} (by ${byUserId})`);
    rec.status = "withdrawn";
    rec.cancelReason = reason;
  }

  async getRequestStatus(requestId: string): Promise<MarketplaceRequestStatusInfo> {
    const rec = this.store.get(requestId);
    if (!rec) throw new Error(`unknown request ${requestId}`);
    return {
      requestId,
      status: rec.status,
      technician: rec.technician,
      quoteKobo: rec.quoteKobo,
      etaAt: rec.etaAt,
      outcomeSummary: rec.outcomeSummary,
    };
  }

  async listTechnicians(params: { skills?: string[] }): Promise<TechnicianProfile[]> {
    if (!params.skills || params.skills.length === 0) return [...MOCK_TECHNICIANS];
    return MOCK_TECHNICIANS.filter((t) => t.skills.some((s) => params.skills?.includes(s)));
  }

  async submitRating(input: { marketplaceRequestId: string; rating: 1 | 2 | 3 | 4 | 5; note?: string }): Promise<void> {
    const rec = this.store.get(input.marketplaceRequestId);
    if (!rec) throw new Error(`unknown request ${input.marketplaceRequestId}`);
    rec.rating = input.rating;
    rec.ratingNote = input.note;
  }

  /** SIM-ONLY (demo/test): drive a request through marketplace statuses like webhooks would. */
  advance(requestId: string, status: MarketplaceRequestStatus): void {
    const rec = this.store.get(requestId);
    if (!rec) throw new Error(`unknown request ${requestId}`);
    rec.status = status;
    if (status !== "sent") {
      const tech = MOCK_TECHNICIANS[0] ?? NONE;
      rec.technician = { id: tech.id, name: tech.displayName, rating: tech.ratingAvg };
      if (status === "quoted") rec.quoteKobo = 4_500_000; // ₦45,000
      if (status === "accepted") rec.etaAt = new Date(Date.now() + 43_200_000).toISOString();
      if (status === "completed") rec.outcomeSummary = "Replaced DE bearing, realigned coupling, verified < 2.3 mm/s";
    }
  }
}
