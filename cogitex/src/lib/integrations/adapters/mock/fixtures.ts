/**
 * Mock fixtures per docs/INTEGRATION_CONTRACTS.md §9:
 *  - a pump with a rising vibration trend (bearing wear story)
 *  - a motor with a voltage-sag pattern
 *  - baseline-healthy machines so empty/happy demos work
 * All data is deterministic (fixed MOCK_NOW, fixed patterns) so tests and screenshots are stable.
 */

import type {
  VideCriticalEvent,
  VideHealthStatus,
  VideMachineRecord,
  VideReading,
} from "@/lib/integrations/interfaces";

/** Fixed "now" for the mock world. */
export const MOCK_NOW = "2026-02-16T08:00:00.000Z";

export const MOCK_FACTORY_NAME = "Anyanwu Fabrics — Plant A (mock)";

export const MOCK_MACHINES: VideMachineRecord[] = [
  { machineName: "PUMP-1", healthStatus: "healthy" },
  { machineName: "PUMP-3", healthStatus: "watch" },
  { machineName: "MOTOR-1", healthStatus: "warning" },
  { machineName: "MOTOR-2", healthStatus: "healthy" },
  { machineName: "GEN-1", healthStatus: "healthy" },
  { machineName: "COMP-1", healthStatus: "critical" },
];

/** Distinct reading profiles per machine personality. */
type ReadingProfile = {
  status: VideHealthStatus;
  powerKw: number;
  loadFactorPct: number;
  temperatureC: number;
  vibrationBaseMmS: number;
  vibrationStepMmS: number;
  voltageV: number;
  currentAmps: number;
  powerFactor: number;
  frequencyHz: number;
};

const PROFILES: Record<string, ReadingProfile> = {
  "PUMP-1": { status: "healthy", powerKw: 3.9, loadFactorPct: 64, temperatureC: 58, vibrationBaseMmS: 2.1, vibrationStepMmS: 0.02, voltageV: 415, currentAmps: 9.1, powerFactor: 0.91, frequencyHz: 50 },
  "PUMP-3": { status: "watch", powerKw: 4.8, loadFactorPct: 72, temperatureC: 63, vibrationBaseMmS: 5.4, vibrationStepMmS: 0.35, voltageV: 415, currentAmps: 11.2, powerFactor: 0.88, frequencyHz: 50 },
  "MOTOR-1": { status: "warning", powerKw: 7.6, loadFactorPct: 78, temperatureC: 71, vibrationBaseMmS: 3.0, vibrationStepMmS: 0.05, voltageV: 372, currentAmps: 18.4, powerFactor: 0.79, frequencyHz: 49.7 },
  "MOTOR-2": { status: "healthy", powerKw: 7.1, loadFactorPct: 70, temperatureC: 62, vibrationBaseMmS: 2.4, vibrationStepMmS: 0.03, voltageV: 415, currentAmps: 16.9, powerFactor: 0.9, frequencyHz: 50 },
  "GEN-1": { status: "healthy", powerKw: 28.4, loadFactorPct: 66, temperatureC: 76, vibrationBaseMmS: 3.2, vibrationStepMmS: 0.04, voltageV: 415, currentAmps: 43.5, powerFactor: 0.87, frequencyHz: 50 },
  "COMP-1": { status: "critical", powerKw: 11.2, loadFactorPct: 88, temperatureC: 92, vibrationBaseMmS: 7.8, vibrationStepMmS: 0.4, voltageV: 415, currentAmps: 26.1, powerFactor: 0.82, frequencyHz: 50 },
};

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Deterministic readings: i counts backwards from "now" in 60s steps. */
export function buildMockReadings(machineName: string, limit: number): VideReading[] {
  const profile = PROFILES[machineName];
  if (!profile) return [];
  const nowMs = Date.parse(MOCK_NOW);
  const out: VideReading[] = [];
  for (let i = 0; i < limit; i++) {
    out.push({
      timestamp: new Date(nowMs - i * 60_000).toISOString(),
      powerKw: round(profile.powerKw + (i % 3) * 0.05, 2),
      loadFactorPct: round(profile.loadFactorPct + (i % 5) * 0.1, 1),
      temperatureC: round(profile.temperatureC - i * 0.08, 1),
      vibrationMmS: round(profile.vibrationBaseMmS + i * profile.vibrationStepMmS, 2),
      voltageV: round(profile.voltageV + (i % 4) * 0.4 - 0.6, 1),
      currentAmps: round(profile.currentAmps + (i % 3) * 0.08, 2),
      powerFactor: round(profile.powerFactor + (i % 2) * 0.004, 3),
      frequencyHz: round(profile.frequencyHz + (i % 2) * 0.01, 2),
    });
  }
  return out;
}

export const MOCK_CRITICAL_EVENTS: VideCriticalEvent[] = [
  {
    faultType: "bearing_degradation",
    machineName: "PUMP-3",
    flaggedAt: "2026-02-14T06:40:00.000Z",
    description: "Vibration at 2x running frequency trending past 6.5 mm/s — early bearing wear signature",
  },
  {
    faultType: "voltage_sag_pattern",
    machineName: "MOTOR-1",
    flaggedAt: "2026-02-13T11:05:00.000Z",
    description: "Recurring voltage sags during load steps — check supply side contactor",
  },
  {
    faultType: "overtemperature",
    machineName: "COMP-1",
    flaggedAt: "2026-02-15T17:20:00.000Z",
    description: "Discharge temperature above critical limit for 40+ minutes",
  },
];

/** Daily kWh baselines (kW × ~24h scaled lightly per machine). */
const KWH_BASE: Record<string, number> = {
  "PUMP-1": 96,
  "PUMP-3": 118,
  "MOTOR-1": 186,
  "MOTOR-2": 172,
  "GEN-1": 640,
  "COMP-1": 288,
};

export function buildMockEnergyBuckets(machineName: string, days: number) {
  const base = KWH_BASE[machineName] ?? 80;
  const out = [];
  for (let i = 0; i < days; i++) {
    const at = new Date(Date.parse(MOCK_NOW) - (days - i) * 86_400_000).toISOString();
    const kwh = round(base + Math.sin(i * 0.9) * base * 0.12 + (machineName === "MOTOR-1" ? -i * 1.2 : 0), 1);
    out.push({ at, kwh, avgPowerKw: round(kwh / 24, 2) });
  }
  return out;
}

export const MOCK_POWER_QUALITY = [
  { at: "2026-02-13T11:05:00.000Z", eventType: "voltage_sag" as const, detail: "3 sags during load step, residual 388 V" },
  { at: "2026-02-12T15:45:00.000Z", eventType: "voltage_sag" as const, detail: "2 sags, residual 391 V" },
];

export const MOCK_TECHNICIANS = [
  { id: "tech_ife_b", displayName: "Ife Balogun", skills: ["bearings", "pumps", "alignment"], ratingAvg: 4.8, jobsCompleted: 132, verifiedAt: "2025-06-01T00:00:00.000Z" },
  { id: "tech_chidi_o", displayName: "Chidi Okafor", skills: ["electrical", "motors", "vfd"], ratingAvg: 4.6, jobsCompleted: 98, verifiedAt: "2025-07-12T00:00:00.000Z" },
  { id: "tech_amaka_e", displayName: "Amaka Eze", skills: ["general", "hydraulics", "seals"], ratingAvg: 4.9, jobsCompleted: 210, verifiedAt: "2025-03-02T00:00:00.000Z" },
];
