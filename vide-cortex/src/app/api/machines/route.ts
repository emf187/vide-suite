/**
 * VIDE main API — GET /machines (M10 SIM).
 * One of the four VERIFIED endpoints Cogitex's RealVideClient consumes. Returns the
 * SIM fleet with camelCase (`machineName`, `healthStatus`) AND snake_case mirrors
 * so both Cogitex and this console normalize it without surprises.
 */
import { NextResponse } from "next/server";
import { MOCK_FLEET, simHealthStatus, simReadingLevels, simSiteName } from "@/lib/api/mock/fleet";
import { simEnabled } from "@/lib/sim/state";

export const dynamic = "force-dynamic";

export function GET(): Response {
  if (!simEnabled()) return NextResponse.json([]); // SIM off → the fleet is invisible to consumers
  const t = Date.now();
  const machines = MOCK_FLEET.map((m) => {
    const { temp, vib } = simReadingLevels(m, t);
    const healthStatus = simHealthStatus(m, t);
    return {
      machineName: m.name,
      machine_name: m.name,
      type: m.type,
      machine_type: m.type,
      site: simSiteName(m),
      location: m.location,
      ratedKw: m.ratedKw,
      rated_load_kw: m.ratedKw,
      healthStatus,
      health_status: healthStatus,
      isLocal: false,
      // live levels (camelCase + snake_case mirrors)
      temperatureC: temp,
      temperature_c: temp,
      vibrationMmS: vib,
      vibration_mm_s: vib,
      deviceId: m.deviceId,
    };
  });
  return NextResponse.json(machines);
}
