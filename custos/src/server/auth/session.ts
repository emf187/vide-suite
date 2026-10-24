import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { DEV_FALLBACK_JWT_SECRET, SESSION_COOKIE, SESSION_TTL_SECONDS } from "./constants";

let warned = false;

export function secretKey(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[custos] AUTH_SECRET must be set in production (generate: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\").",
      );
    }
    if (!warned) {
      warned = true;
      console.warn("[custos] AUTH_SECRET not set — using the dev fallback secret (dev only).");
    }
    return new TextEncoder().encode(DEV_FALLBACK_JWT_SECRET);
  }
  return new TextEncoder().encode(raw);
}

export type SessionTokenPayload = { sub: string };

export async function createSessionToken(userId: string, ttlSeconds = SESSION_TTL_SECONDS): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

/** Only call from server actions / route handlers (not RSC render). */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
