/**
 * VIDE main API — GET /readings/recent/{machine}?limit=N (M10 SIM).
 * One of the four VERIFIED endpoints Cogitex's RealVideClient consumes. Deterministic
 * pure-function-of-time readings from the SIM fleet, newest first.
 */
import { NextResponse } from "next/server";
import { MOCK_FLEET, mockReadings, simReadingView } from "@/lib/api/mock/fleet";
import { simEnabled } from "@/lib/sim/state";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ machine: string }> },
): Promise<Response> {
  if (!simEnabled()) return NextResponse.json([]); // SIM off → no telemetry anywhere
  const { machine } = await params;
  const name = decodeURIComponent(machine);
  const m = MOCK_FLEET.find((x) => x.name === name);
  if (!m) return NextResponse.json({ detail: "machine not found" }, { status: 404 });

  const limitRaw = new URL(_req.url).searchParams.get("limit");
  const limit = Math.min(1000, Math.max(1, Number(limitRaw) || 120));
  const readings = mockReadings(m, limit).map((r) => simReadingView(m, Date.parse(r.timestamp)));
  return NextResponse.json(readings);
}
