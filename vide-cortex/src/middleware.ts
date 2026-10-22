import { NextResponse, type NextRequest } from "next/server";
// Edge-safe: the cookie NAME only — session signing (node:crypto) stays out of middleware.
import { VIDE_SESSION_COOKIE } from "@/lib/auth/constants";

/**
 * Cookie-PRESENCE gate for PAGES only (the Cogitex middleware M0 pattern):
 * the console itself serves simulation data, and its real API stays open to
 * the suite bridge, so middleware must never touch /api/* or static assets.
 * Cryptographic verification happens where it matters — the login action
 * (issuing) and the planner's SSO exchange (verifying) — both HMAC-signed.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(VIDE_SESSION_COOKIE)?.value);

  const isPublicPath =
    pathname === "/login" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/img/") ||
    pathname.startsWith("/_next/");

  if (!hasSession && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // /api/* stays open: it is the suite's machine-to-machine bridge (SIM push,
  // health feeds, lifecycle) authenticated by its own design, not browser cookies.
  matcher: ["/((?!api/|_next/|img/|icon.png|favicon.ico|manifest.webmanifest|sw.js).*)"],
};
