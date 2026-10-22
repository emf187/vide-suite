/** Cross-runtime auth constants (no next/headers imports here - middleware needs this too). */
export const SESSION_COOKIE = "cogitex_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export const DEV_FALLBACK_JWT_SECRET = "dev-only-insecure-secret-change-me-please";
