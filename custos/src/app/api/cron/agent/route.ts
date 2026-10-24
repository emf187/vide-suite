/**
 * The agent's heartbeat (brief §7): Vercel Cron hits this route on a schedule
 * (see vercel.json). Auth: when CRON_SECRET is set, Vercel supplies
 * "Authorization: Bearer <CRON_SECRET>" — manual callers can use the same
 * value as "x-cron-secret". Local dev (no CRON_SECRET) runs unauthenticated.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { runAgentCycle } from "@/server/services/agent";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}` || req.headers.get("x-cron-secret") === secret;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await runAgentCycle();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
