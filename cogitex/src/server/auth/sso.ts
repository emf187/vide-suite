/**
 * Suite handoff URL builder — pure string work, import-safe from the Edge
 * middleware AND server components. Returns null in standalone mode.
 *
 * The exchange URL always points at the caller's own /api/auth/sso entry
 * (next=<where to land after sign-in is complete>).
 */
export function buildSuiteLoginRedirect(videLoginUrl: string | undefined, origin: string, next: string): string | null {
  if (!videLoginUrl) return null;
  const ssoEntry = new URL("/api/auth/sso", origin);
  ssoEntry.searchParams.set("next", next.startsWith("/") && !next.startsWith("//") ? next : "/today");
  const target = new URL(videLoginUrl);
  target.searchParams.set("sso", ssoEntry.toString());
  return target.toString();
}
