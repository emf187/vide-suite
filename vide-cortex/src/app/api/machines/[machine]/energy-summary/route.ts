/**
 * VIDE main API — GET /machines/{machine}/energy-summary?from&to&bucket (M10 SIM).
 * PROPOSED endpoint — implemented by the SIM API: deterministic daily kWh buckets
 * from rated draw × duty cycle, plus power-quality events for critical machines.
 */
import { NextResponse } from "next/server";
import { MOCK_FLEET, simEnergySummary } from "@/lib/api/mock/fleet";
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

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const bucketRaw = url.searchParams.get("bucket");
  if (!Number.isNaN(Date.parse(from)) && !Number.isNaN(Date.parse(to))) {
    return NextResponse.json(simEnergySummary(m, from, to, bucketRaw === "week" ? "week" : "day"));
  }
  // No valid range → 30-day default ending now.
  const now = new Date();
  const toDef = now.toISOString();
  const fromDef = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  return NextResponse.json(simEnergySummary(m, fromDef, toDef, "day"));
}
