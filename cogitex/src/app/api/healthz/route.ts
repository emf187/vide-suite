import { NextResponse } from "next/server";
import { getIntegrations } from "@/lib/integrations/factory";

export const dynamic = "force-dynamic";

/** Liveness probe (no DB dependency so it works even when the database is misconfigured). */
export async function GET() {
  const integrations = getIntegrations();
  return NextResponse.json({
    ok: true,
    service: "orgo-maintenance-manager",
    integrationProfile: integrations.profile,
    time: new Date().toISOString(),
  });
}
