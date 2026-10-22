import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { usersRepo } from "@/server/repos/users";
import { verifyPassword } from "@/server/auth/password";

/**
 * SUITE password verification (server-to-server, called by the VIDE console's
 * login). VIDE is the suite's login surface but this planner's database owns
 * the real accounts — so one password opens the whole suite: whatever works at
 * the planner login works at the VIDE console too.
 *
 * Auth: the SAME shared AUTH_SECRET both apps set (Bearer). Unconfigured or
 * unauthorized → refuse. Unknown email and wrong password are indistinguishable
 * (401 both) — no account enumeration.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    console.error("[cogitex] suite-verify called but AUTH_SECRET is not set (this is required for suite SSO).");
    return NextResponse.json({ ok: false, error: "unconfigured" }, { status: 503 });
  }
  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""), "utf8");
  const expected = Buffer.from(secret, "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email.includes("@") || !password) {
    return NextResponse.json({ ok: false, error: "fields" }, { status: 400 });
  }

  const db = await getDb();
  const identity = await usersRepo.getPasswordIdentity(db, email);
  if (!identity?.passwordHash) return NextResponse.json({ ok: false }, { status: 401 });
  if (!(await verifyPassword(password, identity.passwordHash))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (await usersRepo.isDeactivated(db, identity.userId)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
