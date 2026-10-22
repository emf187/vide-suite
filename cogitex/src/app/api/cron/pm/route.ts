import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { memberships, organizations } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { pmService } from "@/server/services/schedules";
import type { Ctx } from "@/server/ctx";

/**
 * PM generation cron (Vercel Cron hits this daily). Protected by the CRON_SECRET
 * header when set. Generates due work orders from schedules for every org with
 * active schedules — the same audited path as the manual button.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.headers.get("authorization") ?? req.headers.get("x-cron-secret");
    if (provided !== secret && provided !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const db = await getDb();
  const orgs = await db.select({ id: organizations.id, slug: organizations.slug, currency: organizations.currency, timezone: organizations.timezone }).from(organizations);
  const report: { org: string; created: number; skipped: number }[] = [];

  for (const org of orgs) {
    const members = await db
      .select({ userId: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.organizationId, org.id));
    const planner = members.find((m) => m.role === "owner" || m.role === "admin" || m.role === "maintenance_manager");
    if (!planner) continue;

    const ctx: Ctx = {
      userId: planner.userId,
      email: "",
      name: "PM cron",
      orgId: org.id,
      orgSlug: org.slug,
      orgName: org.slug,
      currency: org.currency,
      timezone: org.timezone,
      roles: [planner.role as Ctx["roles"][number]],
    };
    try {
      const result = await pmService.generate(ctx, { dryRun: false });
      report.push({
        org: org.slug,
        created: result.candidates.filter((c) => c.created).length,
        skipped: result.candidates.filter((c) => c.skipped).length,
      });
    } catch {
      report.push({ org: org.slug, created: 0, skipped: 0 });
    }
  }

  return NextResponse.json({ ok: true, report });
}
