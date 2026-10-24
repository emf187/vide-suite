import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { signUpSchema } from "@/lib/shared/validators";
import { createAccount } from "@/server/services/accounts";

/**
 * SUITE provisioning (server-to-server, called by the VIDE console's
 * "create new account" form). The planner's database owns identities, so the
 * console hands account creation here. Bearer: the SAME shared AUTH_SECRET.
 *
 * - fresh email → creates the org + owner user with the given password
 * - existing email → REFUSED. Account creation must never overwrite an
 *   existing account: re-provisioning an email can NEVER change that
 *   account's password. The response does not reveal whether the account is
 *   deactivated or which auth identities it has. Password changes go through
 *   the expiring, single-use token flow (accounts service — the email
 *   delivery step is stubbed until a mailer is configured).
 */
export async function POST(request: NextRequest): Promise<Response> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    console.error("[cogitex] suite-provision called but AUTH_SECRET is not set (required for suite SSO).");
    return NextResponse.json({ ok: false, error: "unconfigured" }, { status: 503 });
  }
  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""), "utf8");
  const expected = Buffer.from(secret, "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  const parsed = signUpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "fields" }, { status: 400 });
  }

  const db = await getDb();
  const result = await createAccount(db, parsed.data);
  if (result.kind === "created") {
    return NextResponse.json({ ok: true, mode: "created" }, { status: 201 });
  }

  // email_conflict → hard refusal, zero credential writes. An existing
  // account is NEVER overwritten by provisioning; password changes go
  // through the expiring single-use token flow only.
  console.info("[cogitex] suite-provision refused: email already exists (no overwrite)");
  return NextResponse.json({ ok: false, error: "email_exists" }, { status: 409 });
}
