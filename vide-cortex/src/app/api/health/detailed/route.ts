/**
 * VIDE main API — GET /health/detailed (M10 SIM).
 * One of the four VERIFIED endpoints Cogitex's RealVideClient consumes; backed by
 * the deterministic SIM fleet so the "real VIDE" is reachable in dev and on Vercel
 * (the old FastAPI backend could not be).
 */
import { NextResponse } from "next/server";
import { SIM_SITES } from "@/lib/api/mock/fleet";
import { simEnabled } from "@/lib/sim/state";

export const dynamic = "force-dynamic";

export function GET(): Response {
  if (!simEnabled()) {
    return NextResponse.json({
      status: "disabled",
      mode: "disabled",
      factory: { name: "SIM OFF — telemetry suspended" },
      sites: [],
    });
  }
  return NextResponse.json({
    status: "ok",
    factory: { name: "VIDE SIM Fleet · 30 machines / 3 sites" },
    mode: "sim",
    sites: SIM_SITES.map((site) => site.name),
  });
}
