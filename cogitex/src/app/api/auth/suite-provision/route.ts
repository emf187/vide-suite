import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { userAuthIdentities, users } from "@/server/db/schema";
import { signUpSchema } from "@/lib/shared/validators";
import { createAccount } from "@/server/services/accounts";
import { hashPassword } from "@/server/auth/password";
import { usersRepo } from "@/server/repos/users";

/**
 * SUITE provisioning (server-to-server, called by the VIDE console's
 * "create new account" form). The planner's database owns identities, so the
 * console hands account creation here. Bearer: the SAME shared AUTH_SECRET.
 *
 * - fresh email → creates the org + owner user with the given password
 * - existing email → sets a new password on that account (suite-demo semantics:
 *   the console is the trusted local operator; a production deploy would demand
 *   email proof instead).
 *   A deactivated account is never touched.
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

  // email_conflict → RESET flow: set a new password on the existing account.
  const email = parsed.data.email.toLowerCase();
  const identity = await usersRepo.getPasswordIdentity(db, email);
  if (!identity) {
    // exists but without a password identity (SSO-provided only) — do not touch
    return NextResponse.json({ ok: false, error: "no_password_identity" }, { status: 409 });
  }
  if (await usersRepo.isDeactivated(db, identity.userId)) {
    return NextResponse.json({ ok: false, error: "deactivated" }, { status: 403 });
  }
  const hash = await hashPassword(parsed.data.password);
  await db
    .update(userAuthIdentities)
    .set({ passwordHash: hash })
    .where(and(eq(userAuthIdentities.provider, "password"), eq(userAuthIdentities.subject, email)));
  return NextResponse.json({ ok: true, mode: "password_reset" }, { status: 200 });
}
