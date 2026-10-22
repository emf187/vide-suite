/**
 * SIM control plane (M10/M11) — /api/sim
 *
 * GET                    → engine status incl. the suite-wide simulation switch
 * POST {action:"toggle"} → flips the SIM switch for the whole suite (persisted in
 *                          .sim-state.json via lib/sim/state). Every /api/* route gates
 *                          on it, so Cogitex's real adapter sees the change instantly.
 * POST (legacy / {action:"push"}) → composes the full SIM digest and pushes it to
 *                          Cogitex Maintenance's ingest webhook ({ org: "*", events: [...] }):
 *                            - kind "machine": upserts every SIM machine + device link (30)
 *                            - kind "fault":   current warning/critical breaches
 *                            - kind "readings": snapshots to pre-warm telemetry
 *
 * Config (env, gitignored — see .env.example):
 *   COGITEX_INGEST_URL    default http://localhost:3030/api/webhooks/vide
 *   COGITEX_INGEST_SECRET optional; sent as x-webhook-secret (Cogitex: WEBHOOK_SECRET)
 */
import { NextResponse } from "next/server";
import { MOCK_FLEET, SIM_SITES, simCriticalEvents, simHealthStatus, simSiteName, simTag } from "@/lib/api/mock/fleet";
import { VIB_FAIL_MM_S, TEMP_FAIL_C } from "@/lib/constants";
import { setSimEnabled, simEnabled } from "@/lib/sim/state";

export const dynamic = "force-dynamic";
/** Cogitex ingest + Neon wake from suspend can legitimately take ~30-45s on cold serverless. */
export const maxDuration = 60;

async function pushToCogitex(): Promise<Response> {
  const t = Date.now();
  const url = process.env.COGITEX_INGEST_URL ?? "http://localhost:3030/api/webhooks/vide";
  const secret = process.env.COGITEX_INGEST_SECRET;

  const machineEvents = MOCK_FLEET.map((m) => ({
    kind: "machine",
    name: m.name,
    tag: simTag(m),
    category: m.type,
    site: simSiteName(m),
    siteCode: m.siteCode ?? "SIM",
    make: "VIDE SIM",
    model: `${m.type}-${m.ratedKw}kW`,
    criticality: m.criticality ?? "B",
    location: m.location,
  }));

  const faultEvents = simCriticalEvents(t, 20).map((e) => ({
    kind: "fault",
    machine: e.machineName,
    faultType: e.faultType,
    severity: e.severity, // "warning" | "critical" — matches Cogitex SEVERITIES
    description: e.description,
    at: e.flaggedAt,
    payload: { temperatureC: e.temperatureC, vibrationMmS: e.vibrationMmS, source: "vide-sim" },
  }));

  // Pre-warm the telemetry cache for every breach machine so Cogitex shows fuel on first paint.
  const snapshotEvents = MOCK_FLEET.map((m) => {
    const status = simHealthStatus(m, t);
    if (status !== "warning" && status !== "critical") return null;
    const temp = m.temp.base + m.temp.perDay * 60;
    const vib = m.vib.base + m.vib.perDay * 60;
    return {
      kind: "readings",
      machine: m.name,
      snapshot: {
        machineName: m.name,
        at: new Date(t).toISOString(),
        temperatureC: Math.round(temp * 10) / 10,
        temperature_c: Math.round(temp * 10) / 10,
        vibrationMmS: Math.round(vib * 100) / 100,
        vibration_mm_s: Math.round(vib * 100) / 100,
        powerKw: m.powerKw,
        power_kw: m.powerKw,
        loadFactorPct: m.loadPct,
        load_factor_pct: m.loadPct,
        breachRatio: Math.max(temp / TEMP_FAIL_C, vib / VIB_FAIL_MM_S),
        source: "vide-sim",
      },
    };
  }).filter((e): e is NonNullable<typeof e> => e !== null);

  const body = { org: "*", events: [...machineEvents, ...faultEvents, ...snapshotEvents] };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { "x-webhook-secret": secret } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    const json = (await res.json().catch(() => null)) as { results?: { result: string }[] } | null;
    const results = json?.results ?? [];
    const upserted = results.filter((r) => r.result === "created" || r.result === "updated" || r.result === "link_only").length;
    const faults = results.filter((r) => r.result === "inserted").length;
    return NextResponse.json(
      {
        ok: res.ok,
        status: res.status,
        pushed: {
          machines: machineEvents.length,
          faults: faultEvents.length,
          snapshots: snapshotEvents.length,
          sites: SIM_SITES.length,
        },
        report: { created: upserted, faults },
        detail: json ?? null,
      },
      { status: res.ok ? 200 : 502 },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `cogitex unreachable at ${url}`, detail: String(err) },
      { status: 502 },
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: { action?: unknown; enabled?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // no body → legacy plain push (first-generation button behavior)
  }

  if (body.action === "toggle") {
    const next = typeof body.enabled === "boolean" ? body.enabled : !simEnabled();
    setSimEnabled(next);
    return NextResponse.json({ ok: true, enabled: next });
  }

  return pushToCogitex();
}

export function GET(): Response {
  const t = Date.now();
  const enabled = simEnabled();
  return NextResponse.json({
    engine: "vide-sim",
    enabled,
    machines: MOCK_FLEET.length,
    sites: SIM_SITES.map((s) => s.name),
    healthMix: enabled
      ? {
          healthy: MOCK_FLEET.filter((m) => simHealthStatus(m, t) === "healthy").length,
          watch: MOCK_FLEET.filter((m) => m.health === "watch").length,
          warning: MOCK_FLEET.filter((m) => simHealthStatus(m, t) === "warning").length,
          critical: MOCK_FLEET.filter((m) => simHealthStatus(m, t) === "critical").length,
        }
      : null,
    cogitex: {
      ingestUrl: process.env.COGITEX_INGEST_URL ?? "http://localhost:3030/api/webhooks/vide",
      secretConfigured: Boolean(process.env.COGITEX_INGEST_SECRET),
    },
  });
}
