import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/constants";

/**
 * M0 middleware — cookie-presence redirect only (no secret verify here; the server Ctx
 * re-verifies the token signature and reloads org/roles from the DB on every request).
 * Kept off-edge DB access by design.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  const isPublicPath =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/signup" ||
    // Suite SSO exchange: the visitor carries a VIDE-signed token INSTEAD of a
    // session — by definition they are not "logged in" yet.
    pathname.startsWith("/api/auth/sso") ||
    // Machine-to-machine endpoints authenticate via their own shared secrets,
    // not the browser session cookie (cron: CRON_SECRET; webhooks: WEBHOOK_SECRET;
    // suite password verification: shared AUTH_SECRET bearer).
    pathname.startsWith("/api/healthz") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/auth/");

  if (!hasSession && !isPublicPath) {
    // SUITE mode: VIDE_LOGIN_URL is set → stranded visitors log in at VIDE, and
    // ?sso carries this app's exchange URL so the login page can hand them back
    // already-signed-in. Standalone mode (no env): the local /login as always.
    const videLoginUrl = process.env.VIDE_LOGIN_URL;
    if (videLoginUrl) {
      const origin = process.env.COGITEX_PUBLIC_URL ?? request.nextUrl.origin;
      const ssoEntry = new URL("/api/auth/sso", origin);
      const carry = `${pathname}${request.nextUrl.search}`;
      ssoEntry.searchParams.set("next", carry.startsWith("/") ? carry : "/today");
      const target = new URL(videLoginUrl);
      target.searchParams.set("sso", ssoEntry.toString());
      return NextResponse.redirect(target);
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // NOTE (M13.3): the middleware must NOT bounce signed-away-from sessions off
  // /login based on cookie PRESENCE alone. A stale cookie (DB row gone after a
  // dev restart or sign-out elsewhere) would make /login → /today → /login loop
  // forever — the exact "page doesn't work" carousel. The auth PAGES do the
  // "already signed in?" redirect via getCtx, which verifies against the DB.

  const res = NextResponse.next();
  // Dev only: one visit to the auth page force-clears a poisoned browser origin
  // (legacy service worker + cached chunks that kill hydration). Honoured by
  // Chromium browsers without any JS; the session cookie is NOT touched.
  if (
    process.env.NODE_ENV !== "production" &&
    (pathname === "/login" || pathname === "/signup")
  ) {
    res.headers.set("Clear-Site-Data", '"cache", "storage"');
  }
  return res;
}

export const config = {
  // Static assets must NEVER be session-gated: the login page itself loads the
  // brand logo, icons, manifest and the service worker before any session
  // exists. (This matcher is what made the logo "not display" on /login for
  // every logged-out visit since M1 — /img/* was being redirected to /login.)
  matcher: [
    "/((?!_next/static|_next/image|img/|icon.png|favicon.ico|manifest.webmanifest|sw.js).*)",
  ],
};
