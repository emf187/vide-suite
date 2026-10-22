/**
 * THE SIM FLEET (M10) — one deterministic generator powering three consumers:
 *   1. the console's mock API (browser, via ../index.ts)
 *   2. the Next API routes (/api/machines, /api/readings/... — what Cogitex's real
 *      adapter pulls, so both apps show the SAME numbers)
 *   3. the SIM pusher (/api/sim → Cogitex webhook upserts)
 *
 * 30 machines across 3 sites. Some good, some bad: Ota Plant is the healthy flagship,
 * Agege Works is mixed, Ikorodu Yard is the neglected site with three machines in
 * active breach. Readings are a pure function of time, so polling looks "live" and
 * every page sees consistent numbers without any shared state.
 *
 * Degrading machines drift linearly from MOCK_START (60 days ago) plus deterministic
 * noise — by "now" the criticals are breaching TEMP_CRIT_C / VIB_CRIT_MM_S, which gives
 * Predictions a real regression trend and Diagnostics real faults to explain.
 */
import { TEMP_CRIT_C, TEMP_FAIL_C, TEMP_WARN_C, VIB_CRIT_MM_S, VIB_FAIL_MM_S, VIB_WARN_MM_S } from "@/lib/constants";
import type { HealthStatus, Reading } from "@/lib/types";

interface Signal {
  base: number;
  perDay: number; // linear drift
  noise: number; // amplitude
}

export interface MockMachine {
  name: string;
  type: string;
  location: string;
  ratedKw: number;
  health: HealthStatus;
  deviceId: string | null;
  temp: Signal;
  vib: Signal;
  powerKw: number;
  loadPct: number;
  /** SIM-only: which of the three sites this machine belongs to. */
  siteCode?: "OTA" | "AGG" | "IKR";
  /** SIM-only: plant-criticality class Cogitex should adopt (A/B/C). */
  criticality?: "A" | "B" | "C";
}

export const SIM_SITES = [
  { name: "Ota Plant", code: "OTA" },
  { name: "Agege Works", code: "AGG" },
  { name: "Ikorodu Yard", code: "IKR" },
] as const;

const s = (base: number, perDay: number, noise: number): Signal => ({ base, perDay, noise });

export const MOCK_FLEET: MockMachine[] = [
  /* ---------------- Ota Plant — flagship, healthy ---------------- */
  { name: "ota-pump-01",       type: "pump",       location: "Ota Plant · Process Water", ratedKw: 11,  health: "healthy",  deviceId: "edge-01", temp: s(44, 0.02, 1.0), vib: s(1.0, 0.002, 0.08), powerKw: 6.8,  loadPct: 58, siteCode: "OTA", criticality: "C" },
  { name: "ota-pump-02",       type: "pump",       location: "Ota Plant · Cooling Loop",  ratedKw: 7.5, health: "healthy",  deviceId: "edge-02", temp: s(46, 0.02, 1.0), vib: s(1.1, 0.003, 0.09), powerKw: 4.3,  loadPct: 55, siteCode: "OTA", criticality: "B" },
  { name: "ota-pump-03",       type: "pump",       location: "Ota Plant · Booster Set",   ratedKw: 15,  health: "healthy",  deviceId: "edge-03", temp: s(48, 0.02, 1.1), vib: s(1.2, 0.003, 0.10), powerKw: 9.1,  loadPct: 60, siteCode: "OTA", criticality: "B" },
  { name: "ota-motor-01",      type: "motor",      location: "Ota Plant · Line 1",        ratedKw: 22,  health: "healthy",  deviceId: "edge-04", temp: s(49, 0.03, 1.2), vib: s(1.2, 0.004, 0.10), powerKw: 12.4, loadPct: 62, siteCode: "OTA", criticality: "A" },
  { name: "ota-motor-02",      type: "motor",      location: "Ota Plant · Line 2",        ratedKw: 22,  health: "watch",    deviceId: "edge-05", temp: s(56, 0.05, 1.4), vib: s(1.7, 0.012, 0.15), powerKw: 11.1, loadPct: 71, siteCode: "OTA", criticality: "A" },
  { name: "ota-compressor-01", type: "compressor", location: "Ota Plant · Utility Room",  ratedKw: 30,  health: "healthy",  deviceId: "edge-06", temp: s(50, 0.02, 1.2), vib: s(1.3, 0.003, 0.10), powerKw: 17.9, loadPct: 59, siteCode: "OTA", criticality: "B" },
  { name: "ota-conveyor-01",   type: "conveyor",   location: "Ota Plant · Packaging",     ratedKw: 5.5, health: "healthy",  deviceId: "edge-07", temp: s(45, 0.02, 1.0), vib: s(1.0, 0.002, 0.08), powerKw: 3.2,  loadPct: 57, siteCode: "OTA", criticality: "C" },
  { name: "ota-conveyor-02",   type: "conveyor",   location: "Ota Plant · Loading Bay",   ratedKw: 7.5, health: "healthy",  deviceId: "edge-08", temp: s(47, 0.02, 1.1), vib: s(1.1, 0.002, 0.09), powerKw: 4.4,  loadPct: 56, siteCode: "OTA", criticality: "C" },
  { name: "ota-fan-01",        type: "fan",        location: "Ota Plant · Roof AHU",      ratedKw: 4,   health: "healthy",  deviceId: "edge-09", temp: s(43, 0.01, 0.8), vib: s(0.9, 0.002, 0.07), powerKw: 2.1,  loadPct: 49, siteCode: "OTA", criticality: "C" },
  { name: "ota-chiller-01",    type: "chiller",    location: "Ota Plant · Utilities",     ratedKw: 30,  health: "watch",    deviceId: "edge-10", temp: s(59, 0.05, 1.5), vib: s(1.8, 0.010, 0.15), powerKw: 18.2, loadPct: 74, siteCode: "OTA", criticality: "B" },

  /* ---------------- Agege Works — mixed ---------------- */
  { name: "agege-pump-01",       type: "pump",       location: "Agege Works · Process Water",  ratedKw: 11,  health: "healthy",  deviceId: "edge-11", temp: s(45, 0.02, 1.0), vib: s(1.0, 0.003, 0.08), powerKw: 6.9,  loadPct: 59, siteCode: "AGG", criticality: "B" },
  { name: "agege-pump-02",       type: "pump",       location: "Agege Works · Transfer Bay",   ratedKw: 11,  health: "healthy",  deviceId: "edge-12", temp: s(47, 0.02, 1.1), vib: s(1.2, 0.003, 0.10), powerKw: 7.2,  loadPct: 61, siteCode: "AGG", criticality: "B" },
  { name: "agege-pump-03",       type: "pump",       location: "Agege Works · Cooling Loop",   ratedKw: 7.5, health: "healthy",  deviceId: "edge-13", temp: s(46, 0.02, 1.0), vib: s(1.1, 0.002, 0.09), powerKw: 4.2,  loadPct: 54, siteCode: "AGG", criticality: "C" },
  { name: "agege-motor-01",      type: "motor",      location: "Agege Works · Line 1",         ratedKw: 15,  health: "healthy",  deviceId: "edge-14", temp: s(48, 0.03, 1.1), vib: s(1.2, 0.004, 0.10), powerKw: 8.3,  loadPct: 60, siteCode: "AGG", criticality: "A" },
  { name: "agege-motor-02",      type: "motor",      location: "Agege Works · Line 2",         ratedKw: 15,  health: "healthy",  deviceId: "edge-15", temp: s(49, 0.03, 1.2), vib: s(1.3, 0.004, 0.10), powerKw: 8.9,  loadPct: 63, siteCode: "AGG", criticality: "A" },
  { name: "agege-fan-01",        type: "fan",        location: "Agege Works · Roof AHU",       ratedKw: 7.5, health: "healthy",  deviceId: "edge-16", temp: s(44, 0.01, 0.8), vib: s(0.9, 0.002, 0.07), powerKw: 4.1,  loadPct: 52, siteCode: "AGG", criticality: "C" },
  { name: "agege-chiller-01",    type: "chiller",    location: "Agege Works · Utilities",      ratedKw: 30,  health: "watch",    deviceId: "edge-17", temp: s(58, 0.05, 1.4), vib: s(1.8, 0.011, 0.15), powerKw: 17.6, loadPct: 73, siteCode: "AGG", criticality: "B" },
  { name: "agege-compressor-01", type: "compressor", location: "Agege Works · Utility Room",   ratedKw: 22,  health: "watch",    deviceId: "edge-18", temp: s(57, 0.05, 1.4), vib: s(1.9, 0.013, 0.16), powerKw: 12.8, loadPct: 76, siteCode: "AGG", criticality: "B" },
  { name: "agege-conveyor-01",   type: "conveyor",   location: "Agege Works · Bottling Hall",  ratedKw: 7.5, health: "warning",  deviceId: "edge-19", temp: s(58, 0.10, 1.8), vib: s(2.9, 0.020, 0.25), powerKw: 5.6,  loadPct: 83, siteCode: "AGG", criticality: "A" },
  { name: "agege-conveyor-02",   type: "conveyor",   location: "Agege Works · Palletiser",     ratedKw: 5.5, health: "warning",  deviceId: "edge-20", temp: s(60, 0.11, 1.9), vib: s(3.1, 0.022, 0.26), powerKw: 4.6,  loadPct: 86, siteCode: "AGG", criticality: "A" },

  /* ---------------- Ikorodu Yard — neglected, some in breach ---------------- */
  { name: "ikorodu-pump-01",       type: "pump",       location: "Ikorodu Yard · Intake Bay",    ratedKw: 11,  health: "healthy",  deviceId: "edge-21", temp: s(45, 0.02, 1.0), vib: s(1.0, 0.003, 0.08), powerKw: 6.5,  loadPct: 55, siteCode: "IKR", criticality: "B" },
  { name: "ikorodu-pump-02",       type: "pump",       location: "Ikorodu Yard · Fire Line",     ratedKw: 7.5, health: "healthy",  deviceId: "edge-22", temp: s(46, 0.02, 1.0), vib: s(1.1, 0.003, 0.09), powerKw: 4.4,  loadPct: 57, siteCode: "IKR", criticality: "A" },
  { name: "ikorodu-pump-03",       type: "pump",       location: "Ikorodu Yard · Transfer Bay",  ratedKw: 15,  health: "watch",    deviceId: "edge-23", temp: s(55, 0.05, 1.4), vib: s(1.8, 0.012, 0.15), powerKw: 9.6,  loadPct: 74, siteCode: "IKR", criticality: "B" },
  { name: "ikorodu-motor-01",      type: "motor",      location: "Ikorodu Yard · Line 1",        ratedKw: 22,  health: "watch",    deviceId: "edge-24", temp: s(56, 0.05, 1.5), vib: s(1.9, 0.013, 0.16), powerKw: 12.7, loadPct: 77, siteCode: "IKR", criticality: "A" },
  { name: "ikorodu-motor-02",      type: "motor",      location: "Ikorodu Yard · Line 2",        ratedKw: 15,  health: "watch",    deviceId: "edge-25", temp: s(54, 0.05, 1.4), vib: s(1.8, 0.011, 0.15), powerKw: 8.7,  loadPct: 72, siteCode: "IKR", criticality: "A" },
  { name: "ikorodu-compressor-01", type: "compressor", location: "Ikorodu Yard · Utility Room",  ratedKw: 30,  health: "warning",  deviceId: "edge-26", temp: s(61, 0.12, 2.0), vib: s(3.2, 0.025, 0.30), powerKw: 19.4, loadPct: 88, siteCode: "IKR", criticality: "A" },
  { name: "ikorodu-conveyor-01",   type: "conveyor",   location: "Ikorodu Yard · Loading Ramp",  ratedKw: 7.5, health: "warning",  deviceId: "edge-27", temp: s(62, 0.11, 1.9), vib: s(3.0, 0.024, 0.28), powerKw: 5.7,  loadPct: 84, siteCode: "IKR", criticality: "A" },
  { name: "ikorodu-conveyor-02",   type: "conveyor",   location: "Ikorodu Yard · Palletiser",    ratedKw: 7.5, health: "critical", deviceId: null,      temp: s(66, 0.30, 2.2), vib: s(4.6, 0.050, 0.40), powerKw: 6.3,  loadPct: 94, siteCode: "IKR", criticality: "A" },
  { name: "ikorodu-fan-01",        type: "fan",        location: "Ikorodu Yard · Roof Extraction", ratedKw: 4, health: "critical", deviceId: null,      temp: s(68, 0.32, 2.2), vib: s(4.2, 0.045, 0.38), powerKw: 3.1,  loadPct: 91, siteCode: "IKR", criticality: "B" },
  { name: "ikorodu-chiller-01",    type: "chiller",    location: "Ikorodu Yard · Utilities",     ratedKw: 22,  health: "critical", deviceId: null,      temp: s(74, 0.34, 2.4), vib: s(5.1, 0.060, 0.45), powerKw: 16.6, loadPct: 96, siteCode: "IKR", criticality: "A" },
];

const DAY_MS = 86_400_000;
export const MOCK_START = Date.now() - 60 * DAY_MS;

/** Short windows tick every 3s (live graphs); long windows every 30min (≈2 months for 3000 points). */
export function stepFor(limit: number): number {
  return limit > 300 ? 30 * 60_000 : 3000;
}

function seedOf(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 9973;
  return h;
}

function wave(t: number, seed: number): number {
  return Math.sin(t / 7000 + seed) * 0.6 + Math.sin(t / 47000 + seed * 2) * 0.3 + Math.sin(t / 3.7e6 + seed * 3) * 0.4;
}

function signal(s: Signal, t: number, seed: number): number {
  const days = Math.max(0, (t - MOCK_START) / DAY_MS);
  return s.base + s.perDay * days + s.noise * wave(t, seed);
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function mockReading(m: MockMachine, t: number): Reading {
  const seed = seedOf(m.name);
  const load = Math.min(100, Math.max(0, m.loadPct + 6 * wave(t, seed + 5)));
  const power = Math.max(0, m.powerKw * (load / m.loadPct));
  const voltage = 230 + 3 * wave(t, seed + 9);
  const pf = 0.86 + 0.04 * wave(t, seed + 11);
  return {
    machine_name: m.name,
    device_id: m.deviceId,
    timestamp: new Date(t).toISOString(),
    voltage_v: round(voltage, 1),
    current_amps: round((power * 1000) / (voltage * pf), 2),
    power_kw: round(power, 2),
    power_factor: round(pf, 3),
    frequency_hz: round(50 + 0.05 * wave(t, seed + 13), 2),
    energy_kwh: null,
    temperature_c: round(signal(m.temp, t, seed), 2),
    vibration_mm_s: round(Math.max(0, signal(m.vib, t, seed + 1)), 3),
    acceleration_g: null,
    pressure_bar: null,
    flow_lpm: null,
    load_factor_pct: round(load, 1),
    rssi: m.deviceId ? Math.round(-58 + 6 * wave(t, seed + 17)) : null,
    battery_v: null,
    battery_pct: null,
  };
}

/** Newest-first, like the real endpoint. */
export function mockReadings(m: MockMachine, limit: number, now = Date.now()): Reading[] {
  const step = stepFor(limit);
  const latest = Math.floor(now / step) * step;
  return Array.from({ length: limit }, (_, i) => mockReading(m, latest - i * step));
}

/* -------- derived summaries (the PROPOSED endpoints, implemented SIM-side) -------- */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Breach ratio → 0..100 health score (data-driven, never authored). */
function simScoreAt(m: MockMachine, at: number): number {
  const { temp, vib } = simReadingLevels(m, at);
  const r = Math.max(temp / TEMP_FAIL_C, vib / VIB_FAIL_MM_S);
  const score = r >= 1 ? 18 - (r - 1) * 40 : 100 - Math.max(0, r - 0.45) * 165;
  return Math.round(clamp(score, 0, 100));
}

/**
 * HealthSummary for GET /api/machines/{name}/health-summary ("h24" | "d7" | "d30").
 * Samples are daily deterministic scores; RUL is current level ÷ drift slope to the
 * failure thresholds (rules basis — no LLM numbers anywhere).
 */
export function simHealthSummary(m: MockMachine, window: "h24" | "d7" | "d30" = "d7", t = Date.now()) {
  const score = simScoreAt(m, t);
  const status: HealthStatus = score >= 72 ? "healthy" : score >= 58 ? "watch" : score >= 32 ? "warning" : "critical";

  const stepMs = window === "h24" ? 3 * 3_600_000 : window === "d7" ? DAY_MS : 3 * DAY_MS;
  const count = window === "h24" ? 8 : window === "d7" ? 7 : 10;
  const samples = Array.from({ length: count }, (_, i) => {
    const at = t - i * stepMs;
    return { at: new Date(at).toISOString(), score: simScoreAt(m, at) };
  });

  const tempSlopePerHour = m.temp.perDay / 24;
  const vibSlopePerHour = m.vib.perDay / 24;
  const { temp, vib } = simReadingLevels(m, t);
  const tHours = tempSlopePerHour > 0 && temp < TEMP_FAIL_C ? (TEMP_FAIL_C - temp) / tempSlopePerHour : temp >= TEMP_FAIL_C ? 24 : Infinity;
  const vHours = vibSlopePerHour > 0 && vib < VIB_FAIL_MM_S ? (VIB_FAIL_MM_S - vib) / vibSlopePerHour : vib >= VIB_FAIL_MM_S ? 24 : Infinity;
  const hours = Math.min(tHours, vHours);
  const estimateHours = Number.isFinite(hours) ? Math.round(clamp(hours, 6, 8_760)) : 8_760;
  const uncertaintyHours = Math.round(estimateHours * 0.4);
  const affecting = tHours <= vHours ? ["temperature_c"] : ["vibration_mm_s"];

  return {
    score,
    status,
    statusLabel:
      status === "critical" ? (affecting[0] === "temperature_c" ? "Breaching temperature limit" : "Breaching vibration limit")
      : status === "warning" ? "Condition degrading"
      : status === "watch" ? "Inside bands, trending"
      : "All signals nominal",
    rul: {
      estimateHours,
      uncertaintyHours,
      basis: "rules" as const,
      affecting,
    },
    samples,
    asOf: new Date(t).toISOString(),
  };
}

/**
 * EnergySummary for GET /api/machines/{name}/energy-summary — deterministic daily
 * kWh from rated draw × duty cycle with small day-to-day variation.
 */
export function simEnergySummary(m: MockMachine, fromISO: string, toISO: string, bucket: "day" | "week" = "day", t = Date.now()) {
  const from = Math.max(0, Date.parse(fromISO) || t - 7 * DAY_MS);
  const to = Math.min(t, Date.parse(toISO) || t);
  const stepMs = bucket === "day" ? DAY_MS : 7 * DAY_MS;
  const buckets: { at: string; kwh: number; avgPowerKw: number }[] = [];
  const seed = seedOf(m.name);
  for (let at = from; at < to && buckets.length < 42; at += stepMs) {
    const w = 1 + 0.06 * wave(at, seed + 3);
    const avgPowerKw = round(m.powerKw * w, 2);
    const kwh = round((avgPowerKw * stepMs) / 3_600_000, 2);
    buckets.push({ at: new Date(bucket === "day" ? Math.floor(at / DAY_MS) * DAY_MS : at).toISOString(), kwh, avgPowerKw });
  }
  const powerQuality =
    m.health === "critical"
      ? [{ at: new Date(t - 26 * 3_600_000).toISOString(), eventType: "voltage_sag" as const, detail: "Sag 198V for 120ms at 17:40" }]
      : [];
  return { buckets, powerQuality };
}

/* ============================ SIM helpers (M10) ============================ */

/** Current per-machine breach state, computed from the live deterministic reading. */
export function simReadingLevels(m: MockMachine, t = Date.now()): { temp: number; vib: number } {
  const r = mockReading(m, t);
  return { temp: r.temperature_c ?? 0, vib: r.vibration_mm_s ?? 0 };
}

/**
 * Live health band for the Cogitex /machines pull: the authored `health` is the story
 * (how the fleet is set up), and the live reading can only makes it WORSE, never
 * masked better — a critical never reports healthy.
 */
export function simHealthStatus(m: MockMachine, t = Date.now()): HealthStatus {
  const { temp, vib } = simReadingLevels(m, t);
  const live: HealthStatus =
    temp >= TEMP_CRIT_C || vib >= VIB_CRIT_MM_S ? "critical"
    : temp >= TEMP_WARN_C || vib >= VIB_WARN_MM_S ? "warning"
    : "healthy";
  const bands: HealthStatus[] = ["healthy", "watch", "warning", "critical"];
  // Live reading can only make it WORSE, never mask it better.
  return bands[Math.max(bands.indexOf(m.health), bands.indexOf(live))] ?? m.health;
}

/** Site display name for a machine ("Ota Plant"). */
export function simSiteName(m: MockMachine): string {
  return SIM_SITES.find((site) => site.code === m.siteCode)?.name ?? m.location.split(" · ")[0] ?? "";
}

/** Site tag prefix → Cogitex machine tag, e.g. "OTA-PUMP-01". */
export function simTag(m: MockMachine): string {
  const nn = m.name.match(/(\d+)$/)?.[1] ?? "01";
  return `${m.siteCode ?? "SIM"}-${m.type.toUpperCase()}-${nn.padStart(2, "0")}`;
}

/**
 * Camel-case reading view for the Cogitex adapter (VideReading). Field mirrors
 * keep both snake_case (VIDE main API) and camelCase (Cogitex native) consumers happy.
 */
export function simReadingView(m: MockMachine, t: number) {
  const r = mockReading(m, t);
  return {
    ...r,
    timestamp: r.timestamp,
    powerKw: r.power_kw,
    loadFactorPct: r.load_factor_pct,
    temperatureC: r.temperature_c,
    vibrationMmS: r.vibration_mm_s,
    voltageV: r.voltage_v,
    currentAmps: r.current_amps,
    powerFactor: r.power_factor,
    frequencyHz: r.frequency_hz,
  };
}

/**
 * Critical events for the /diagnostics/critical-events pull — warning + critical
 * machines, data-driven fault types (worse signal wins), slowly rotating timestamps
 * so the feed churns like a real plant floor.
 */
export function simCriticalEvents(t = Date.now(), limit = 20) {
  const events = MOCK_FLEET.map((m) => {
    const status = m.health;
    if (status !== "warning" && status !== "critical") return null;
    const { temp, vib } = simReadingLevels(m, t);
    const vibIsWorse = vib / VIB_FAIL_MM_S >= temp / TEMP_FAIL_C;
    const faultType =
      status === "critical"
        ? vibIsWorse ? "vibration_degradation" : "overheating"
        : vibIsWorse ? "bearing_wear" : "rising_temperature";
    const severity = status;
    const description =
      status === "critical"
        ? vibIsWorse
          ? `Vibration ${vib.toFixed(2)}mm/s past ${VIB_CRIT_MM_S}mm/s failure limit (${temp.toFixed(1)}°C)`
          : `Temperature ${temp.toFixed(1)}°C past ${TEMP_CRIT_C}°C limit (vibration ${vib.toFixed(2)}mm/s)`
        : vibIsWorse && vib >= VIB_WARN_MM_S
          ? `Bearing wear signature — vibration ${vib.toFixed(2)}mm/s above ${VIB_WARN_MM_S}mm/s`
          : `Temperature ${temp.toFixed(1)}°C above ${TEMP_WARN_C}°C warning band`;
    // Rotating "minutes ago" so the feed changes over the demo day.
    const epochBlock = Math.floor(t / (37 * 60_000));
    const minutesAgo = ((epochBlock * (MOCK_FLEET.indexOf(m) + 2)) % 11) + 2;
    return {
      faultType,
      machineName: m.name,
      machine_name: m.name,
      severity,
      description,
      flaggedAt: new Date(t - minutesAgo * 60_000).toISOString(),
      flagged_at: new Date(t - minutesAgo * 60_000).toISOString(),
      temperatureC: round(temp, 1),
      temperature_c: round(temp, 1),
      vibrationMmS: round(vib, 2),
      vibration_mm_s: round(vib, 2),
    };
  }).filter((e): e is NonNullable<typeof e> => e !== null);
  return events.slice(0, limit);
}
