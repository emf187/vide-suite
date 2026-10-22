/**
 * VIDE main API — GET /diagnostics/critical-events?limit=N (M10 SIM).
 * One of the four VERIFIED endpoints Cogitex's RealVideClient consumes. Feeds from
 * the SIM fleet: warning + critical machines with data-driven fault types.
 */
import { NextResponse } from "next/server";
import { simCriticalEvents } from "@/lib/api/mock/fleet";
import { simEnabled } from "@/lib/sim/state";

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  if (!simEnabled()) return NextResponse.json([]); // SIM off → no anomalies
  const limitRaw = new URL(req.url).searchParams.get("limit");
  const limit = Math.min(50, Math.max(1, Number(limitRaw) || 20));
  return NextResponse.json(simCriticalEvents(Date.now(), limit));
}
