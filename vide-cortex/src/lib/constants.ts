/**
 * Load-bearing constants. Several are part of the product's status language —
 * change them deliberately, not casually.
 */

/** Overview fleet refresh. */
export const POLL_MS = 3000;
/** Global backend health check (drives the LIVE / OFFLINE badges on every page). */
export const HEALTH_POLL_MS = 15000;
/** Devices page health re-check. */
export const DEVICE_POLL_MS = 15000;
/** Diagnostics live-graph interval choices. */
export const LIVE_INTERVALS_MS = [2000, 3000, 5000, 10000] as const;
/** Abort any single backend request after this long. */
export const REQUEST_TIMEOUT_MS = 10000;
/** LLM calls are slower. */
export const LLM_TIMEOUT_MS = 60000;

/** A machine/device is ONLINE when its latest reading is younger than this. */
export const ONLINE_MS = 60_000;
/** …and STALE (Devices) when younger than this. */
export const STALE_MS = 5 * 60_000;

/** Failure thresholds used by the Predictions math layer. */
export const TEMP_FAIL_C = 90;
export const VIB_FAIL_MM_S = 7.1;

/** Diagnostics tile colouring. */
export const TEMP_WARN_C = 70;
export const TEMP_CRIT_C = 85;
export const VIB_WARN_MM_S = 4;
export const VIB_CRIT_MM_S = 7;

/**
 * Fixed chart scales — deliberate. Auto-scaling made sensor noise look like disasters.
 */
export const SCALE = {
  temperature_c: 100,
  vibration_mm_s: 10,
  power_kw: 15,
  load_factor_pct: 100,
} as const;

/** Defaults sent to /diagnostics/analyze when the reading or profile lacks a value. */
export const ANALYZE_DEFAULTS = {
  machine_type: "motor",
  rated_load_kw: 10,
  voltage_v: 230,
  power_factor: 0.9,
  frequency_hz: 50,
} as const;

export const DEFAULT_API_URL = process.env.NEXT_PUBLIC_DEFAULT_API_URL || "http://127.0.0.1:8000/api";
export const MOCKS_BY_DEFAULT = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

export const MAINTENANCE_TYPES = [
  "Inspection",
  "Bearing replacement",
  "Lubrication",
  "Rewind",
  "Alignment",
  "Cleaning",
  "Other",
] as const;

export const NAV_ITEMS = [
  { href: "/", label: "Overview", section: "FLEET OVERVIEW", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>' },
  { href: "/machines", label: "Machines", section: "MACHINES", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><circle cx="12" cy="13" r="4"/></svg>' },
  { href: "/devices", label: "Devices", section: "DEVICES", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' },
  { href: "/diagnostics", label: "Diagnostics", section: "DIAGNOSTICS", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 16.2l-1.3-1.3"/></svg>' },
  { href: "/predictions", label: "Predictions", section: "PREDICTIONS", icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/><polyline points="9 18 9 12 15 12"/></svg>' },
] as const;
