import { and, asc, desc, eq, gte, isNotNull, lt } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb } from "@/server/db/client";
import { faultEvents, machines, reports, workOrderLabor, workOrderParts, workOrders } from "@/server/db/schema";
import { can } from "@/server/policies";
import { auditRepo } from "@/server/repos/audit";
import { computeMetrics, type MetricsBundle } from "@/server/metrics/reports";

export const reportsService = {
  async list(ctx: Ctx, limit = 100) {
    const db = await getDb();
    return db
      .select({
        id: reports.id,
        kind: reports.kind,
        scope: reports.scope,
        periodFrom: reports.periodFrom,
        periodTo: reports.periodTo,
        periodDays: reports.periodDays,
        status: reports.status,
        calcVersion: reports.calcVersion,
        generatedAt: reports.generatedAt,
      })
      .from(reports)
      .where(eq(reports.organizationId, ctx.orgId))
      .orderBy(desc(reports.generatedAt))
      .limit(limit);
  },

  async byId(ctx: Ctx, id: string) {
    const db = await getDb();
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const rows = await db.select().from(reports).where(and(eq(reports.organizationId, ctx.orgId), eq(reports.id, id))).limit(1);
    return rows[0] ?? null;
  },
};

/**
 * Period WO set: created within [from, to) OR completed within it — the same
 * membership the metrics module slices again. Scoped strictly by org; machines
 * filtered when the scope is a single machine.
 */
export const reportsWriteService = {
  async generate(
    ctx: Ctx,
    input: { kind: "plant_summary" | "machine_status"; machineId?: string | null; from: Date; to: Date },
  ): Promise<{ reportId: string }> {
    if (!can(ctx.roles, "report.view")) throw new Error("forbidden:report.view");
    const db = await getDb();
    const { kind, from, to } = input;
    const machineId = input.machineId ?? null;

    const machineRows = await db
      .select({ id: machines.id, tag: machines.tag, name: machines.name, category: machines.category })
      .from(machines)
      .where(eq(machines.organizationId, ctx.orgId));

    const scopeMachineId = kind === "machine_status" ? machineId : null;
    if (kind === "machine_status" && !machineId) throw new Error("machine_required");

    // WOs: org rows joined to scope (machine or all); keep status-relevant rows only
    const woRows = await db
      .select()
      .from(workOrders)
      .where(and(eq(workOrders.organizationId, ctx.orgId), scopeMachineId ? eq(workOrders.machineId, scopeMachineId) : undefined));
    const woCore = woRows.map((w) => ({
      id: w.id, number: w.number, title: w.title, machineId: w.machineId,
      type: w.type, status: w.status, priority: w.priority,
      plannedStart: w.plannedStart, plannedEnd: w.plannedEnd, actualStart: w.actualStart, actualEnd: w.actualEnd,
      downtimeHours: w.downtimeHours, completedAt: w.actualEnd, createdAt: w.createdAt,
    }));

    const woIds = new Set(woRows.map((w) => w.id));
    const laborRows = woIds.size
      ? (await db.select().from(workOrderLabor).orderBy(asc(workOrderLabor.loggedAt))).filter((l) => woIds.has(l.workOrderId)).map((l) => ({ workOrderId: l.workOrderId, minutes: l.minutes, rateKobo: l.rateKobo }))
      : [];
    const partRows = woIds.size
      ? (await db.select().from(workOrderParts)).filter((p) => woIds.has(p.workOrderId)).map((p) => ({ workOrderId: p.workOrderId, qty: p.qty, unitCostKobo: p.unitCostKobo }))
      : [];

    // faults: period window handled inside computeMetrics; scope by machine when given
    const faultRows = await db
      .select({ faultType: faultEvents.faultType, severity: faultEvents.severity, flaggedAt: faultEvents.flaggedAt, machineId: faultEvents.machineId })
      .from(faultEvents)
      .where(and(eq(faultEvents.organizationId, ctx.orgId), gte(faultEvents.flaggedAt, new Date(from.getTime() - 90 * 86_400_000)), lt(faultEvents.flaggedAt, to)));

    const calc: MetricsBundle = computeMetrics({
      from,
      to,
      workOrders: woCore,
      labor: laborRows,
      parts: partRows,
      faults: faultRows,
      machines: machineRows,
      machineIds: scopeMachineId ? [scopeMachineId] : null,
    });

    const days = calc.period.days;
    const inserted = await db.insert(reports).values({
      organizationId: ctx.orgId,
      kind,
      scope: scopeMachineId ? { machineId: scopeMachineId } : { all: true },
      periodFrom: from,
      periodTo: to,
      periodDays: days,
      params: null,
      calc,
      calcVersion: calc.calcVersion,
      status: "done",
      requestedBy: ctx.userId,
    }).returning();
    const row = inserted[0];
    if (!row) throw new Error("report_insert_failed");

    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "report.generated",
      entityType: "report",
      entityId: row.id,
      diff: { kind, days, machineId: scopeMachineId },
    });
    return { reportId: row.id };
  },
};

/* ------------------------------------------------------------------ */
/* CSV + PDF builders (server-side, deterministic from calc)           */
/* ------------------------------------------------------------------ */

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCsv(r: { kind: string; periodFrom: Date; periodTo: Date; calc: unknown }): string {
  const calc = r.calc as MetricsBundle;
  const lines: string[] = [];
  const push = (...cols: unknown[]) => lines.push(cols.map(csvEscape).join(","));

  push(`section`, `ORGO · MAINTENANCE MANAGER`);
  push(`report`, r.kind);
  push(`period`, calc.period.from, calc.period.to, `days=${calc.period.days}`);
  push(`calc_version`, calc.calcVersion);
  push(`generated_at`, calc.computedAt);

  push(``);
  push(`METRICS`, `value`, `unit`);
  push(`work_orders_total`, calc.workOrders.total, `count`);
  push(`work_orders_completed`, calc.workOrders.completed, `count`);
  push(`work_orders_open`, calc.workOrders.open, `count`);
  push(`work_orders_cancelled`, calc.workOrders.cancelled, `count`);
  push(`mttr`, calc.mttrHours ?? "", `hours`);
  push(`mtbf`, calc.mtbfHours ?? "", `hours`);
  push(`uptime_pct`, calc.uptimePct ?? "", `pct`);
  push(`planned_ratio`, calc.plannedRatioPct ?? "", `pct`);
  push(`faults_total`, calc.faults.total, `count`);
  push(`cost_labor`, calc.cost.laborKobo, `kobo`);
  push(`cost_parts`, calc.cost.partsKobo, `kobo`);
  push(`cost_total`, calc.cost.totalKobo, `kobo`);
  push(`backlog_open`, calc.openBacklog.count, `count`);

  for (const [k, v] of Object.entries(calc.faults.bySeverity)) push(`faults_${k}`, v, `count`);

  push(``);
  push(`COST BY MACHINE`, `tag`, `kobo`);
  for (const m of calc.cost.byMachine) push(`cost`, m.tag ?? "?", m.totalKobo);

  push(``);
  push(`COST BY MONTH`, `month`, `kobo`);
  for (const m of calc.cost.byMonth) push(`cost`, m.month, m.totalKobo);

  push(``);
  push(`WO TYPE MIX`, `type`, `count`, `completed`);
  const types = new Set([...Object.keys(calc.workOrders.byType), ...Object.keys(calc.workOrders.completedByType)]);
  for (const t of [...types].sort()) push(`type`, t, calc.workOrders.byType[t] ?? 0, calc.workOrders.completedByType[t] ?? 0);

  return `${lines.join("\n")}\n`;
}

export function csvFilename(r: { kind: string; generatedAt: Date }): string {
  const stamp = r.generatedAt.toISOString().slice(0, 10);
  return `orgo-${r.kind}-${stamp}.csv`;
}

/* ---------- PDF (pdf-lib, A4, deterministic — no runtime fetches) ---------- */

export async function reportToPdfBytes(r: {
  kind: string;
  orgName: string;
  periodFrom: Date;
  periodTo: Date;
  calc: unknown;
}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const calc = r.calc as MetricsBundle;

  const doc = await PDFDocument.create();
  doc.setTitle(`ORGO ${r.kind} — ${r.periodFrom.toISOString().slice(0, 10)} → ${r.periodTo.toISOString().slice(0, 10)}`);
  doc.setProducer("ORGO Maintenance Manager (deterministic build)");
  const page = doc.addPage([595.28, 841.89]); // A4 portrait
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.05, 0.05, 0.09);
  const dim = rgb(0.35, 0.36, 0.42);
  const accent = rgb(0.9, 0.18, 0.08);

  let y = 800;
  /** Standard PDF fonts are WinAnsi — forward-map the UI's typographic glyphs. */
  const ascii = (s: string): string =>
    s.replace(/→/g, "->").replace(/[·★☆✓]/g, "*").replace(/[–—]/g, "-").replace(/[^\x00-\xFF]/g, "?");
  const line = (text: string, size = 10, f = font, color = ink, x = 48) => {
    page.drawText(ascii(text), { x, y, size, font: f, color });
    y -= size + 6;
  };
  const section = (title: string) => {
    y -= 8;
    line(title, 13, bold, accent);
  };

  line("ORGO · MAINTENANCE MANAGER", 18, bold, accent);
  y -= 2;
  line(`${r.orgName} · ${r.kind === "machine_status" ? "Machine status report" : "Plant summary"}`, 10, font, dim);
  line(`Period ${r.periodFrom.toISOString().slice(0, 10)} → ${r.periodTo.toISOString().slice(0, 10)} (${calc.period.days} days)`, 10, font, dim);
  line(`calc_version ${calc.calcVersion} · generated ${calc.computedAt}`, 8, font, dim);

  section("KEY METRICS");
  const put = (k: string, v: string) => {
    page.drawText(ascii(k), { x: 48, y, size: 10, font, color: dim });
    page.drawText(ascii(v), { x: 300, y, size: 10, font: bold, color: ink });
    y -= 16;
  };
  put("Work orders (period)", `${calc.workOrders.total} total · ${calc.workOrders.completed} completed · ${calc.workOrders.open} open`);
  put("MTTR (mean repair time)", calc.mttrHours === null ? "no data" : `${calc.mttrHours} h`);
  put("MTBF (mean time between failures)", calc.mtbfHours === null ? "no data" : `${calc.mtbfHours} h`);
  put("Uptime", calc.uptimePct === null ? "no data" : `${calc.uptimePct} %`);
  put("Planned ratio", calc.plannedRatioPct === null ? "no data" : `${calc.plannedRatioPct} %`);
  put("Faults flagged", `${calc.faults.total}${Object.keys(calc.faults.bySeverity).length ? ` (${Object.entries(calc.faults.bySeverity).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}`);
  put("Cost — labor", formatNairaSafe(calc.cost.laborKobo));
  put("Cost — parts", formatNairaSafe(calc.cost.partsKobo));
  put("Cost — total", formatNairaSafe(calc.cost.totalKobo));
  put("Open backlog", `${calc.openBacklog.count}`);

  section("COST BY MACHINE (top 12)");
  if (calc.cost.byMachine.length === 0) line("no data", 10, font, dim);
  for (const m of calc.cost.byMachine) put(m.tag ?? "?", formatNairaSafe(m.totalKobo));

  section("COST BY MONTH");
  if (calc.cost.byMonth.length === 0) line("no data", 10, font, dim);
  for (const m of calc.cost.byMonth) put(m.month, formatNairaSafe(m.totalKobo));

  section("NOTES");
  y -= 10;
  line("All numbers computed by deterministic code (calc bundle). No model-generated values.", 9, font, dim);

  return doc.save();
}

/** WinAnsi-safe naira label (the ₦ glyph is not encodable with standard PDF fonts). */
function formatNairaSafe(kobo: number): string {
  const naira = kobo / 100;
  return `NGN ${naira.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}
