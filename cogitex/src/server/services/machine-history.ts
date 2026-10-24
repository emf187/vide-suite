/**
 * Machine profile v2 — maintenance history + expenditure log.
 *
 * ONE coherent data model for "what has this machine ever cost us / been through":
 * - Work-order history (with labor + issued-parts cost rolled up at READ time;
 *   work_order_labor / work_order_parts stay the single source of truth — this
 *   service never copies money into another table).
 * - Manual expenditure logbook (machine_expenses) for spend that never touches
 *   a work order: cash-bought service, fuel, hire, consumables, subcontractors.
 * Corrections delete (audited) and re-add; there is no edit path.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb } from "@/server/db/client";
import {
  machineExpenses,
  workOrderLabor,
  workOrderParts,
  workOrders,
  type MachineExpense,
  type WorkOrder,
} from "@/server/db/schema";
import { auditRepo } from "@/server/repos/audit";

/** status still inside the execution lifecycle (not concluded) */
export const OPEN_WO_STATUSES = ["draft", "planned", "assigned", "in_progress", "on_hold"] as const;

/** statuses that stamp a real service onto the machine's history */
export const SERVICE_WO_STATUSES = ["completed", "verified", "closed"] as const;

export const EXPENSE_KINDS = [
  "service", "contract", "parts_direct", "consumable", "fuel", "hire",
  "calibration", "training", "other",
] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

export type HistoryWorkOrder = {
  wo: WorkOrder;
  /** finished time: actualEnd → closedAt → whatever the lifecycle reached */
  finishedAt: Date | null;
  laborKobo: number;
  partsKobo: number;
  costKobo: number;
};

export type ExpenditureSummary = {
  /** labor cost across every work order of the machine (kobo) */
  laborKobo: number;
  /** issued-parts cost across every work order of the machine (kobo) */
  partsKobo: number;
  /** manual logbook entries (kobo) */
  manualKobo: number;
  /** labor + parts + manual (kobo) */
  totalKobo: number;
  /** spend inside the last 365 days, WO-derived + manual (kobo) */
  last365dKobo: number;
  /** last real service: latest concluded WO by finishedAt */
  lastServiceAt: Date | null;
  lastServiceWoNumber: string | null;
  openWorkOrders: number;
  concludedWorkOrders: number;
};

export type MachineHistory = {
  rows: HistoryWorkOrder[];
  expenses: MachineExpense[];
  summary: ExpenditureSummary;
};

export const maintenanceHistoryService = {
  /**
   * Full story for the profile's MAINTENANCE tab: WO list (each with its own
   * cost rollup) + the manual expense log + the machine-level summary.
   * 3 grouped queries + 1 expenses query; totals folded in JS so PGlite and
   * Neon behave identically.
   */
  async forMachine(ctx: Ctx, machineId: string): Promise<MachineHistory> {
    const db = await getDb();
    const [woRows, laborRows, partsRows, expenseRows] = await Promise.all([
      db
        .select()
        .from(workOrders)
        .where(and(eq(workOrders.organizationId, ctx.orgId), eq(workOrders.machineId, machineId)))
        .orderBy(desc(workOrders.createdAt)),
      db
        .select({
          workOrderId: workOrderLabor.workOrderId,
          minutes: workOrderLabor.minutes,
          rateKobo: workOrderLabor.rateKobo,
        })
        .from(workOrderLabor)
        .innerJoin(workOrders, eq(workOrders.id, workOrderLabor.workOrderId))
        .where(and(eq(workOrderLabor.organizationId, ctx.orgId), eq(workOrders.machineId, machineId))),
      db
        .select({
          workOrderId: workOrderParts.workOrderId,
          qty: workOrderParts.qty,
          unitCostKobo: workOrderParts.unitCostKobo,
        })
        .from(workOrderParts)
        .innerJoin(workOrders, eq(workOrders.id, workOrderParts.workOrderId))
        .where(and(eq(workOrderParts.organizationId, ctx.orgId), eq(workOrders.machineId, machineId))),
      expensesService.list(ctx, machineId),
    ]);

    const laborByWo = new Map<string, number>();
    for (const l of laborRows) {
      // kobo = Σ(minutes × hourly rate)/60 — sum raw first, divide once, round at the end
      laborByWo.set(l.workOrderId, (laborByWo.get(l.workOrderId) ?? 0) + l.minutes * l.rateKobo);
    }
    const partsByWo = new Map<string, number>();
    for (const p of partsRows) {
      partsByWo.set(p.workOrderId, (partsByWo.get(p.workOrderId) ?? 0) + Math.round(Number(p.qty) * p.unitCostKobo));
    }

    const rows: HistoryWorkOrder[] = woRows.map((wo) => {
      const laborKobo = Math.round((laborByWo.get(wo.id) ?? 0) / 60);
      const partsKobo = partsByWo.get(wo.id) ?? 0;
      return {
        wo,
        finishedAt: wo.actualEnd ?? wo.closedAt ?? null,
        laborKobo,
        partsKobo,
        costKobo: laborKobo + partsKobo,
      };
    });

    /* -------- summary -------- */
    const now = Date.now();
    let totalLabor = 0;
    let totalParts = 0;
    let last365 = 0;
    for (const r of rows) {
      totalLabor += r.laborKobo;
      totalParts += r.partsKobo;
      const spentAt = r.finishedAt ?? r.wo.createdAt;
      if (now - spentAt.getTime() <= 365 * 86_400_000) last365 += r.costKobo;
    }
    let manualTotal = 0;
    for (const e of expenseRows) {
      manualTotal += e.amountKobo;
      if (now - e.occurredAt.getTime() <= 365 * 86_400_000) last365 += e.amountKobo;
    }

    let lastServiceAt: Date | null = null;
    let lastServiceWoNumber: string | null = null;
    for (const r of rows) {
      if (!SERVICE_WO_STATUSES.includes(r.wo.status as (typeof SERVICE_WO_STATUSES)[number])) continue;
      const at = r.finishedAt ?? r.wo.updatedAt;
      if (at && (!lastServiceAt || at.getTime() > lastServiceAt.getTime())) {
        lastServiceAt = at;
        lastServiceWoNumber = r.wo.number;
      }
    }

    const summary: ExpenditureSummary = {
      laborKobo: totalLabor,
      partsKobo: totalParts,
      manualKobo: manualTotal,
      totalKobo: totalLabor + totalParts + manualTotal,
      last365dKobo: last365,
      lastServiceAt,
      lastServiceWoNumber,
      openWorkOrders: rows.filter((r) => (OPEN_WO_STATUSES as readonly string[]).includes(r.wo.status)).length,
      concludedWorkOrders: rows.filter((r) => (SERVICE_WO_STATUSES as readonly string[]).includes(r.wo.status)).length,
    };

    return { rows, expenses: expenseRows, summary };
  },
};

/* ------------------------ manual expenditure logbook ----------------------- */

export const expensesService = {
  async list(ctx: Ctx, machineId: string): Promise<MachineExpense[]> {
    const db = await getDb();
    return db
      .select()
      .from(machineExpenses)
      .where(
        and(
          eq(machineExpenses.organizationId, ctx.orgId),
          eq(machineExpenses.machineId, machineId),
          isNull(machineExpenses.deletedAt),
        ),
      )
      .orderBy(desc(machineExpenses.occurredAt), desc(machineExpenses.createdAt));
  },

  async add(
    ctx: Ctx,
    machineId: string,
    input: {
      kind: ExpenseKind;
      description: string;
      amountKobo: number;
      vendor?: string | null;
      reference?: string | null;
      occurredAt?: Date | null;
      workOrderId?: string | null;
    },
  ): Promise<MachineExpense> {
    // tenant guard: the expense is claimed by THIS org and must sit on a THIS-org machine
    const { machinesService } = await import("./machines");
    const machine = await machinesService.byId(ctx, machineId);
    if (!machine) throw new Error("machine_not_found");
    if (!Number.isInteger(input.amountKobo) || input.amountKobo <= 0) {
      throw new Error("amount_kobo_must_be_positive_integer");
    }
    if (!(EXPENSE_KINDS as readonly string[]).includes(input.kind)) throw new Error("unknown_expense_kind");
    const description = input.description.trim();
    if (!description) throw new Error("description_required");
    const db = await getDb();
    const inserted = await db
      .insert(machineExpenses)
      .values({
        organizationId: ctx.orgId,
        machineId,
        workOrderId: input.workOrderId ?? null,
        kind: input.kind,
        description,
        amountKobo: input.amountKobo,
        vendor: input.vendor?.trim() || null,
        reference: input.reference?.trim() || null,
        occurredAt: input.occurredAt ?? new Date(),
        source: "manual",
        createdBy: ctx.userId,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("expense insert returned no rows");
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "machine.expense_added",
      entityType: "machine",
      entityId: machineId,
      diff: { expenseId: row.id, kind: row.kind, amountKobo: row.amountKobo, description },
    });
    return row;
  },

  /** soft delete (audited) — spend history is corrected by delete + re-add, never edited */
  async remove(ctx: Ctx, machineId: string, expenseId: string): Promise<void> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(machineExpenses)
      .where(
        and(
          eq(machineExpenses.organizationId, ctx.orgId),
          eq(machineExpenses.machineId, machineId),
          eq(machineExpenses.id, expenseId),
          isNull(machineExpenses.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error("expense_not_found");
    await db
      .update(machineExpenses)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(machineExpenses.id, row.id));
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "machine.expense_removed",
      entityType: "machine",
      entityId: machineId,
      diff: { expenseId, kind: row.kind, amountKobo: row.amountKobo },
    });
  },
};
