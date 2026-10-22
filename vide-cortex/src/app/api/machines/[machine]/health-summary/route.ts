/**
 * VIDE main API — GET /machines/{machine}/health-summary?window=h24|d7|d30 (M10 SIM).
 * PROPOSED endpoint (INTEGRATION_CONTRACTS.md §2) — now implemented by the SIM API
 * so Cogitex's real adapter gets a live HealthSummary (score, status, RUL, samples).
 */
import { NextResponse } from "next/server";
import { MOCK_FLEET, simHealthSummary } from "@/lib/api/mock/fleet";
import { simEnabled } from "@/lib/sim/state";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ machine: string }> },
): Promise<Response> {
  if (!simEnabled()) return NextResponse.json({ detail: "sim_disabled" }, { status: 404 });
  const { machine } = await params;
  const name = decodeURIComponent(machine);
  const m = MOCK_FLEET.find((x) => x.name === name);
  if (!m) return NextResponse.json({ detail: "machine not found" }, { status: 404 });

  const raw = new URL(req.url).searchParams.get("window");
  const window: "h24" | "d7" | "d30" = raw === "h24" || raw === "d30" ? raw : "d7";
  return NextResponse.json(simHealthSummary(m, window));
}
