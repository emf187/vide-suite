/**
 * SSO handoff-target validation (shared by the login action and the login page).
 * Only absolute URLs on the planner exchange endpoint with allow-listed hosts pass.
 */
export function resolveSsoTarget(raw: unknown): string | null {
  const sso = typeof raw === "string" ? raw.trim() : "";
  if (!sso) return null;
  let url: URL;
  try {
    url = new URL(sso);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const allowed = (process.env.VIDE_SSO_ALLOWED_HOSTS ?? "localhost,127.0.0.1")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (!allowed.includes(url.hostname)) return null;
  if (!url.pathname.startsWith("/api/auth/sso")) return null;
  return url.toString();
}
