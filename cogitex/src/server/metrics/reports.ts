/**
 * M6 metrics — deterministic, versioned (CALC_VERSION), pure functions over
 * org-scoped rows. `calc` bundles are produced ONLY here (docs/DATA_MODEL.md §5);
 * reports may never be numerically altered by models or chat output. All money is
 * integer kobo; unknowns are null ("no data"), never fake zeros.
 *
 * Rounding: fixed at render time where a human reads it; the stored calc keeps
 * full precision so future calc_versions can reinterpret raw numbers.
 */

import { formatKobo } from "@/lib/money";

export const CALC_VERSION = 1;

export type WorkOrderCore = {
  id: string;
  number: string;
  title: string;
  machineId: string | null;
  type: string; // corrective | preventive | inspection | installation
  status: string;
  priority: string;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  downtimeHours: string | null; // numeric comes back as text
  completedAt: Date | null; // actualEnd of completion; null for open cards
  createdAt: Date;
};

export type LaborCore = { workOrderId: string; minutes: number; rateKobo: number };
export type PartsCore = { workOrderId: string; qty: string; unitCostKobo: number };
export type FaultCore = { machineId: string | null; severity: string; faultType: string; flaggedAt: Date };
export type MachineCore = { id: string; tag: string; name: string; category: string | null };

export type MetricsBundle = {
  period: { from: string; to: string; days: number };
  workOrders: {
    total: number;
    completed: number;
    open: number;
    cancelled: number;
    byType: Record<string, number>;
    completedByType: Record<string, number>;
  };
  mttrMinutes: number | null; // mean repair minutes of completed breakdown-type WOs
  mttrHours: number | null;
  mtbfHours: number | null; // calendar run hours available ÷ breakdown completions
  uptimePct: number | null; // 100 − downtime share of period (downtime_hours of completed WOs)
  plannedRatioPct: number | null; // planned-family completions ÷ all completions
  faults: { total: number; bySeverity: Record<string, number> };
  cost: {
    laborKobo: number;
    partsKobo: number;
    totalKobo: number;
    byMachine: { machineId: string; tag: string | null; totalKobo: number }[];
    byType: Record<string, number>;
    byMonth: { month: string; totalKobo: number }[];
  };
  openBacklog: { count: number; byPriority: Record<string, number> };
  daysSinceLastCompleted: number | null;
  computedAt: string;
  calcVersion: number;
};

const OPENISH = new Set(["draft", "planned", "assigned", "in_progress", "on_hold", "awaiting_parts"]);
const DONEISH = new Set(["completed", "verified", "closed"]);
/** breakdown family for MTTR/MTBF per docs §5 ("corrective + emergency") */
const BREAKDOWN = new Set(["corrective"]);
/** planned family for planned_ratio */
const PLANNED = new Set(["preventive", "inspection"]);

export function woTotalCostKobo(woId: string, labor: LaborCore[], parts: PartsCore[]): number {
  const laborKobo = Math.round(
    labor.filter((l) => l.workOrderId === woId).reduce((s, l) => s + l.minutes * l.rateKobo, 0) / 60,
  );
  const partsKobo = parts
    .filter((p) => p.workOrderId === woId)
    .reduce((s, p) => s + Math.round(Number(p.qty) * p.unitCostKobo), 0);
  return laborKobo + partsKobo;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Shared reducer across both report kinds. `machineIds` scopes; null = plant-wide.
 * Rows that cannot be attributed to a scoped machine are dropped — tenancy/scope
 * guarantees live in the query layer, this is just the safe final filter.
 */
export function computeMetrics(input: {
  from: Date; // inclusive
  to: Date; // exclusive
  workOrders: WorkOrderCore[]; // pre-scoped rows; the period slice happens here
  labor: LaborCore[];
  parts: PartsCore[];
  faults: FaultCore[];
  machines: MachineCore[]; // full org machine list for tag resolution + MTBF hours
  machineIds?: string[] | null; // null = plant-wide
}): MetricsBundle {
  const { from, to, labor, parts, faults, machines } = input;
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  const machineIds = input.machineIds ?? null;

  const scoped = <T extends { machineId: string | null }>(rows: T[]): T[] =>
    machineIds === null ? rows : rows.filter((r) => r.machineId !== null && machineIds.includes(r.machineId));

  // WOs relevant to the period: created in period, or completed in period
  const allWo = scoped(input.workOrders);
  const wo = allWo.filter((w) => {
    const createdIn = w.createdAt >= from && w.createdAt < to;
    const completedIn = w.completedAt !== null && w.completedAt >= from && w.completedAt < to;
    return createdIn || completedIn;
  });

  const byType: Record<string, number> = {};
  for (const w of wo) byType[w.type] = (byType[w.type] ?? 0) + 1;
  const completedByType: Record<string, number> = {};
  for (const w of wo) if (w.completedAt && DONEISH.has(w.status)) completedByType[w.type] = (completedByType[w.type] ?? 0) + 1;

  const completed = wo.filter((w) => w.completedAt !== null && DONEISH.has(w.status)).length;
  const open = wo.filter((w) => OPENISH.has(w.status)).length;
  const cancelled = wo.filter((w) => w.status === "cancelled").length;

  const breakdownCompletions = wo.filter((w) => w.completedAt !== null && DONEISH.has(w.status) && BREAKDOWN.has(w.type));

  // MTTR: mean labor minutes of completed breakdown WOs (labor time of the repair)
  const mttrList = breakdownCompletions
    .map((w) => labor.filter((l) => l.workOrderId === w.id).reduce((s, l) => s + l.minutes, 0))
    .filter((m) => m > 0);
  const mttrMinutes = mttrList.length ? mttrList.reduce((s, m) => s + m, 0) / mttrList.length : null;

  // MTBF: calendar hours available on the scoped machines ÷ breakdown completions
  const scopeCount = machineIds === null ? Math.max(1, machines.length) : machineIds.length;
  const calendarHours = days * 24 * scopeCount;
  const mtbfHours = breakdownCompletions.length > 0 ? calendarHours / breakdownCompletions.length : null;

  // uptime: 100 − Σ downtime hours of completed WOs ÷ calendar availability × 100
  const downtimeSum = breakdownCompletions.reduce((s, w) => s + Number(w.downtimeHours ?? 0), 0);
  const totalCalendarHours = days * 24 * Math.max(1, scopeCount);
  const uptimePct = totalCalendarHours > 0 ? Math.max(0, 100 - (downtimeSum / totalCalendarHours) * 100) : null;

  // planned ratio over completions
  const plannedDone = wo.filter((w) => w.completedAt !== null && DONEISH.has(w.status) && PLANNED.has(w.type)).length;
  const plannedRatioPct = completed > 0 ? (plannedDone / completed) * 100 : null;

  // faults flagged in period (scoped)
  const periodFaults = scoped(faults).filter((f) => f.flaggedAt >= from && f.flaggedAt < to);
  const bySeverity: Record<string, number> = {};
  for (const f of periodFaults) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

  // cost rollups over the period's WOs (labor + parts captured at issue)
  let laborKobo = 0;
  let partsKobo = 0;
  const byWoTypeCost: Record<string, number> = {};
  const perMachine: Record<string, number> = {};
  const perMonth: Record<string, number> = {};
  for (const w of wo) {
    const c = woTotalCostKobo(w.id, labor, parts);
    laborKobo += Math.round(labor.filter((l) => l.workOrderId === w.id).reduce((s, l) => s + l.minutes * l.rateKobo, 0) / 60);
    partsKobo += parts.filter((p) => p.workOrderId === w.id).reduce((s, p) => s + Math.round(Number(p.qty) * p.unitCostKobo), 0);
    byWoTypeCost[w.type] = (byWoTypeCost[w.type] ?? 0) + c;
    if (w.machineId) perMachine[w.machineId] = (perMachine[w.machineId] ?? 0) + c;
    const anchor = w.completedAt ?? w.createdAt;
    perMonth[monthKey(anchor)] = (perMonth[monthKey(anchor)] ?? 0) + c;
  }

  const byMachine = Object.entries(perMachine)
    .map(([mid, kobo]) => ({ machineId: mid, tag: machines.find((m) => m.id === mid)?.tag ?? null, totalKobo: kobo }))
    .sort((a, b) => b.totalKobo - a.totalKobo)
    .slice(0, 12);

  const byMonth = Object.entries(perMonth)
    .map(([month, kobo]) => ({ month, totalKobo: kobo }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // dirty open backlog of the scoped set beyond the period (still-open cards created any time)
  const openAll = allWo.filter((w) => OPENISH.has(w.status));
  const byPriority: Record<string, number> = {};
  for (const w of openAll) byPriority[w.priority] = (byPriority[w.priority] ?? 0) + 1;

  const lastCompleted = [...wo].filter((w) => w.completedAt && DONEISH.has(w.status)).sort((a, b) => (b.completedAt!.getTime() - a.completedAt!.getTime()))[0];
  const daysSinceLastCompleted = lastCompleted ? Math.max(0, Math.round((Date.now() - lastCompleted.completedAt!.getTime()) / 86_400_000)) : null;

  return {
    period: { from: from.toISOString(), to: to.toISOString(), days },
    workOrders: { total: wo.length, completed, open, cancelled, byType, completedByType },
    mttrMinutes: mttrMinutes === null ? null : Math.round(mttrMinutes),
    mttrHours: mttrMinutes === null ? null : Math.round((mttrMinutes / 60) * 10) / 10,
    mtbfHours: mtbfHours === null ? null : Math.round(mtbfHours),
    uptimePct: uptimePct === null ? null : Math.round(uptimePct * 10) / 10,
    plannedRatioPct: plannedRatioPct === null ? null : Math.round(plannedRatioPct * 10) / 10,
    faults: { total: periodFaults.length, bySeverity },
    cost: { laborKobo, partsKobo, totalKobo: laborKobo + partsKobo, byMachine, byType: byWoTypeCost, byMonth },
    openBacklog: { count: open, byPriority },
    daysSinceLastCompleted,
    computedAt: new Date().toISOString(),
    calcVersion: CALC_VERSION,
  };
}

/* ---------- narrative guard (brief §5.7): text may only DESCRIBE calc ---------- */

/** Every numeral in `narrative` must also appear somewhere in the calc JSON. */
export function validateNarrative(narrative: string, calc: unknown): { ok: boolean; offender?: string } {
  const calcNumbers = new Set(String(JSON.stringify(calc ?? {})).match(/-?\d+(\.\d+)?/g) ?? []);
  const numerals = narrative.match(/-?\d+(\.\d+)?/g) ?? [];
  for (const n of numerals) {
    if (!calcNumbers.has(n)) return { ok: false, offender: n };
  }
  return { ok: true };
}

/* ---------- human formatting (display-time rounding only) ---------- */

export function moneyShort(kobo: number | null): string {
  if (kobo === null) return "no data";
  return formatKobo(kobo, "NGN");
}

export function hrs(v: number | null): string {
  return v === null ? "no data" : `${v.toFixed(v < 10 ? 1 : 0)} h`;
}

export function pct(v: number | null): string {
  return v === null ? "no data" : `${v.toFixed(1)}%`;
}
