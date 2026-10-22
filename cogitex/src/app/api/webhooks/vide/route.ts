import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { organizations } from "@/server/db/schema";
import { faultsWriteService, videCacheService } from "@/server/services/faults";
import { machinesWriteService } from "@/server/services/machines";

/**
 * VIDE â†’ app webhook (M4). Machine-to-machine, shared-secret auth:
 *   - production: requires WEBHOOK_SECRET set and `x-webhook-secret` header equal.
 *   - dev/no secret: allowed (mock integration profile ships without a real VIDE).
 * Machine references resolve STRICTLY by vide machine name inside the claimed org â€”
 * payload-supplied ids, org uuids or urls are never trusted.
 *
 * Expected body:
 * {
 *   "org": "anyanwu-demo",               // org slug (trusted as the tenant claim key)
 *   "events": [
 *     { "kind": "fault", "machine": "PUMP-3", "faultType": "rising_vibration",
 *       "severity": "warning", "description": "...", "at": "2026-10-20T09:00:00Z" },
 *     { "kind": "readings", "machine": "PUMP-3", "snapshot": { ...payload jsonb } }
 *   ]
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
  const parsed = body as { org?: unknown; events?: unknown } | null;
  const orgSlug = typeof parsed?.org === "string" ? parsed.org.trim() : "";
  const events = Array.isArray(parsed?.events) ? (parsed?.events as unknown[]) : [];
  if (!orgSlug || events.length === 0) {
    return NextResponse.json({ error: "org_and_events_required" }, { status: 400 });
  }

  const db = await getDb();
  const orgs = await db.select({ id: organizations.id, slug: organizations.slug }).from(organizations).where(eq(organizations.slug, orgSlug)).limit(1);
  let org = orgs[0];
  if (!org && orgSlug === "*") {
    // Demo convention (M10): "*" resolves to the SINGLE org of a small deployment, so
    // the VIDE SIM button is zero-config. Multi-org deployments must send the real slug.
    const single = (await db.select({ id: organizations.id }).from(organizations))[0];
    if (single) {
      org = { id: single.id, slug: "*" };
    }
  }
  if (!org) return NextResponse.json({ error: "org_not_found" }, { status: 404 });

  const report: { machine: string; kind: string; result: string }[] = [];
  for (const raw of events.slice(0, 100)) {
    const ev = (raw ?? {}) as Record<string, unknown>;
    const kind = typeof ev.kind === "string" ? ev.kind : "";
    const machine = typeof ev.machine === "string" ? ev.machine.trim() : "";
    if (kind === "machine") {
      // M10: provision/link a machine from a VIDE push (name is the identity key).
      const name = typeof ev.name === "string" ? ev.name.trim() : machine;
      if (!name) {
        report.push({ machine: "", kind, result: "invalid_event" });
        continue;
      }
      try {
        const res = await machinesWriteService.upsertFromWebhook(db, org.id, {
          name,
          tag: typeof ev.tag === "string" ? ev.tag : null,
          category: typeof ev.category === "string" ? ev.category : null,
          siteName: typeof ev.site === "string" ? ev.site : null,
          siteCode: typeof ev.siteCode === "string" ? ev.siteCode : null,
          make: typeof ev.make === "string" ? ev.make : null,
          model: typeof ev.model === "string" ? ev.model : null,
          criticality: typeof ev.criticality === "string" ? ev.criticality : null,
          locationNote: typeof ev.location === "string" ? ev.location : null,
        });
        report.push({ machine: name, kind, result: res.machineId ? res.status : "failed" });
      } catch (err) {
        report.push({ machine: name, kind, result: `error:${String(err).slice(0, 60)}` });
      }
      continue;
    }
    if (!machine || !kind) {
      report.push({ machine: String(machine), kind: String(kind), result: "invalid_event" });
      continue;
    }
    if (kind === "fault") {
      const res = await faultsWriteService.ingestFromWebhook(db, org.id, machine, {        faultType: String(ev.faultType ?? "unclassified"),
        severity: typeof ev.severity === "string" ? ev.severity : undefined,
        description: typeof ev.description === "string" ? ev.description : null,
        flaggedAt: typeof ev.at === "string" && !Number.isNaN(Date.parse(ev.at)) ? new Date(ev.at) : null,
        payload: ev,
      });
      report.push({ machine, kind, result: res.inserted ? "inserted" : res.reason ?? "skipped" });
    } else if (kind === "readings") {
      // snapshot pre-warms the telemetry cache for that device
      const grabbed = await videCacheService.getThrough(
        { orgId: org.id },
        `readings:${machine}`,
        60_000,
        async () => (typeof ev.snapshot === "object" && ev.snapshot !== null ? ev.snapshot : { note: "empty snapshot" }),
      );
      report.push({ machine, kind, result: grabbed.cached ? "cached" : "stored" });
    } else {
      report.push({ machine, kind, result: "unsupported_kind" });
    }
  }

  return NextResponse.json({ ok: true, received: events.length, results: report });
}
