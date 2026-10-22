import { NextResponse } from "next/server";
import { MARKETPLACE_WEBHOOK_STATUSES, applyMarketplaceWebhookEvent, type MarketplaceWebhookPayload } from "@/server/services/repair-requests";

/**
 * Marketplace → app webhook (M5). Same machine-to-machine secret scheme as the VIDE
 * receiver: production requires WEBHOOK_SECRET + x-webhook-secret; dev-only open.
 * The tenant is derived from the repair_request row matched by the globally unique
 * marketplace_request_id — the payload carries no org claim to trust.
 *
 * Expected body:
 * {
 *   "requestId": "mockrq_0001",          // marketplace request id
 *   "status": "quoted",                  // MarketplaceRequestStatus
 *   "technician": { "id": "tech_ife_b", "name": "Ife Balogun", "rating": 4.8 },
 *   "quoteKobo": 4500000,
 *   "etaAt": "2026-10-22T09:00:00Z",     // optional
 *   "outcomeSummary": "..."              // optional, on completed
 * }
 */
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const provided = req.headers.get("x-webhook-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "webhook_secret_not_configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const ev = (body ?? {}) as Record<string, unknown>;
  const requestId = typeof ev.requestId === "string" ? ev.requestId.trim() : "";
  const rawStatus = typeof ev.status === "string" ? ev.status : "";
  if (!requestId || !rawStatus) {
    return NextResponse.json({ error: "requestId_and_status_required" }, { status: 400 });
  }
  const status = MARKETPLACE_WEBHOOK_STATUSES.find((s) => s === rawStatus);
  if (!status) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const technician = (ev.technician ?? undefined) as { id?: unknown; name?: unknown; rating?: unknown } | undefined;
  const tech =
    technician && typeof technician.id === "string"
      ? {
          id: technician.id,
          name: typeof technician.name === "string" ? technician.name : undefined,
          rating: typeof technician.rating === "number" ? technician.rating : undefined,
        }
      : undefined;

  const payload: MarketplaceWebhookPayload = {
    requestId,
    status,
    technician: tech,
    quoteKobo: typeof ev.quoteKobo === "number" ? ev.quoteKobo : undefined,
    etaAt: typeof ev.etaAt === "string" ? ev.etaAt : undefined,
    outcomeSummary: typeof ev.outcomeSummary === "string" ? ev.outcomeSummary : undefined,
  };

  const to = await applyMarketplaceWebhookEvent(payload);

  if (to === null) {
    return NextResponse.json({ error: "request_not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, status: to });
}
