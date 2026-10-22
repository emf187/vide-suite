/**
 * VIDE suite auth — dependency-free HS256 (node:crypto).
 *
 * Two token kinds:
 *  - SESSION  (aud "vide-session"): the console's own login cookie.
 *  - SSO      (aud "cogitex-sso"): 5-minute token handed to the Cogitex Planner
 *    app, which verifies it with the SHARED AUTH_SECRET and exchanges it for a
 *    real planner session. One suite, one login.
 *
 * Cross-app trust is REAL (HMAC over a shared secret) even though the console
 * middleware itself is presence-only (the console serves sim data only).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { VIDE_SESSION_COOKIE } from "./constants";

export { VIDE_SESSION_COOKIE };
const SESSION_TTL_S = 30 * 24 * 3600;
const SSO_TTL_S = 300;

function b64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJson(value: object): string {
  return b64url(Buffer.from(JSON.stringify(value), "utf8"));
}
function fromB64url(part: string): Buffer {
  return Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function secretKey(): string {
  const raw = process.env.AUTH_SECRET;
  if (!raw) console.warn("[vide] AUTH_SECRET not set — using the dev fallback secret (dev only).");
  return raw ?? "vide-suite-dev-fallback-secret-change-me";
}

function sign(payload: Record<string, unknown>): string {
  const head = b64urlJson({ alg: "HS256", typ: "JWT" });
  const body = b64urlJson(payload);
  const sig = b64url(createHmac("sha256", secretKey()).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

function verifyPayload(token: string, expectedAud: string): { sub: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts as [string, string, string];
  const expected = createHmac("sha256", secretKey()).update(`${head}.${body}`).digest();
  const given = fromB64url(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof decoded !== "object" || decoded === null) return null;
  const payload = decoded as { sub?: unknown; aud?: unknown; exp?: unknown };
  if (payload.aud !== expectedAud) return null;
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
  return { sub: payload.sub };
}

type SessionPayload = { sub: string };

export async function createSessionToken(email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: email, aud: "vide-session", iat: now, exp: now + SESSION_TTL_S });
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  return verifyPayload(token, "vide-session");
}

export async function verifySsoToken(token: string): Promise<SessionPayload | null> {
  return verifyPayload(token, "cogitex-sso");
}

/** Suite handoff: the planner app turns this email into one of its real accounts. */
export async function createSsoToken(email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: email, aud: "cogitex-sso", iat: now, exp: now + SSO_TTL_S });
}

/** Only call from server actions / route handlers (not RSC render). */
export async function getVideSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const raw = store.get(VIDE_SESSION_COOKIE)?.value;
  if (!raw) return null;
  return verifySessionToken(raw);
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(VIDE_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(VIDE_SESSION_COOKIE);
}
