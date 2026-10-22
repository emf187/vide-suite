/**
 * VIDE main API — POST /lifecycle/notices (M10 SIM).
 * PROPOSED endpoint (INTEGRATION_CONTRACTS.md §5) — implemented by the SIM API so
 * Cogitex decommission/reactivate flows get a real acknowledgement from VIDE.
 * Stateless: the SIM accepts any known machine and releases ingestion immediately.
 */
import { NextResponse } from "next/server";
import { MOCK_FLEET } from "@/lib/api/mock/fleet";
import { simEnabled } from "@/lib/sim/state";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!simEnabled()) return NextResponse.json({ accepted: false, error: "sim_disabled" });
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const machineName = typeof body.machineName === "string" ? body.machineName : "";
  const m = MOCK_FLEET.find((x) => x.name === machineName);
  if (!m) return NextResponse.json({ accepted: false, error: "unknown_machine" });

  return NextResponse.json({
    accepted: true,
    ingestionReleasedFrom: m.name,
    deviceReleaseAt:
      typeof body.effectiveAt === "string" && !Number.isNaN(Date.parse(body.effectiveAt))
        ? body.effectiveAt
        : new Date().toISOString(),
  });
}
