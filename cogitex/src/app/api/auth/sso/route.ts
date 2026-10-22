import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { usersRepo } from "@/server/repos/users";
import {
  createSessionToken,
  secretKey,
  setSessionCookie,
} from "@/server/auth/session";

/**
 * Suite SSO exchange (the Cogitex half).
 *
 * The VIDE console issues a 5-minute HMAC token (aud "cogitex-sso", subject =
 * email) signed with the SHARED AUTH_SECRET. This endpoint verifies it, maps the
 * email onto a real Cogitex account, and starts a normal planner session. No
 * page JS anywhere — two redirects — proven interaction model for the user's
 * browser.
 *
 * next: path-only redirect target (validated below; no open redirects).
 */
export async function GET(request: NextRequest): Promise<Response> {
  const sp = request.nextUrl.searchParams;
  const token = sp.get("token") ?? "";
  let next = sp.get("next") ?? "/today";
  if (!next.startsWith("/") || next.startsWith("//")) next = "/today";
  const login = (error: string) =>
    NextResponse.redirect(new URL(`/login?error=${error}`, request.nextUrl.origin));

  let email: string | null = null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"], audience: "cogitex-sso" });
    if (typeof payload.sub === "string" && payload.sub.includes("@")) email = payload.sub.toLowerCase();
  } catch {
    email = null; // bad signature, expired, wrong audience
  }
  if (!email) return login("sso_invalid");

  const db = await getDb();
  const identity = await usersRepo.getPasswordIdentity(db, email);
  if (!identity) return login("sso_unknown"); // VIDE users must also exist as planner users
  if (await usersRepo.isDeactivated(db, identity.userId)) return login("deactivated");

  await setSessionCookie(await createSessionToken(identity.userId));
  return NextResponse.redirect(new URL(next, request.nextUrl.origin));
}
