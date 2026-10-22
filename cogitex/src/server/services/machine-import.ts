import { and, eq } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb } from "@/server/db/client";
import { importStaging } from "@/server/db/schema";
import { parseCsv, rowToRecord } from "@/lib/csv/parse";
import { machinesWriteService, MACHINE_CATEGORIES, type MachineInput } from "./machines";
import { sitesService } from "./sites";
import { auditRepo } from "@/server/repos/audit";

/**
 * CSV import for machines (brief 5.1): factories already have spreadsheets.
 * Two-step: (1) parse + validate → dry-run preview staged in DB,
 * (2) confirm → rows created with per-row outcomes (tag conflicts skip with reason).
 *
 * Header (order-free; required marked): name*, tag*, category*, site_code, area_code,
 * make, model, serial, install_date, warranty_until, criticality, location_note,
 * vide_machine_name (semicolon-separated for several links)
 */
export type StagedMachineRow = { rowNo: number; values: MachineInput; error?: string };

export const machineImportService = {
  async stageCsv(ctx: Ctx, csvText: string): Promise<{
    stagingId: string;
    total: number;
    ok: number;
    failed: number;
    rows: StagedMachineRow[];
  }> {
    const db = await getDb();
    const { header, rows: raw } = parseCsv(csvText);
    for (const col of ["name", "tag", "category"]) {
      if (!header.includes(col)) throw new Error(`missing_column:${col}`);
    }

    const siteIdByCode = new Map((await sitesService.list(ctx)).map((s) => [s.code.toUpperCase(), s.id]));
    const validCategories = MACHINE_CATEGORIES as readonly string[];

    const staged: StagedMachineRow[] = [];
    raw.forEach((csvRow, idx) => {
      const r = rowToRecord(header, csvRow);
      if (Object.values(r).every((v) => v === "")) return;
      const siteCode = (r.site_code ?? "").trim();
      const input: MachineInput = {
        name: r.name ?? "",
        tag: (r.tag ?? "").toUpperCase(),
        category: (r.category ?? "").toLowerCase(),
        siteId: siteCode ? siteIdByCode.get(siteCode.toUpperCase()) ?? null : null,
        make: r.make || undefined,
        model: r.model || undefined,
        serialNumber: r.serial || undefined,
        installDate: r.install_date || undefined,
        warrantyUntil: r.warranty_until || undefined,
        criticality: (["A", "B", "C"].includes(r.criticality ?? "") ? r.criticality : "B") as "A" | "B" | "C",
        locationNote: r.location_note || undefined,
        videMachineNames: r.vide_machine_name
          ? r.vide_machine_name.split(";").map((s) => s.trim()).filter(Boolean)
          : [],
      };

      let error: string | undefined;
      if (!input.name || !input.tag) error = "name and tag are required";
      else if (!validCategories.includes(input.category)) error = `category must be one of: ${MACHINE_CATEGORIES.join("|")}`;
      else if (siteCode && !siteIdByCode.has(siteCode.toUpperCase())) error = `unknown site_code ${siteCode}`;
      else if (input.installDate && Number.isNaN(Date.parse(input.installDate))) error = "install_date is not a date";
      else if (input.warrantyUntil && Number.isNaN(Date.parse(input.warrantyUntil))) error = "warranty_until is not a date";

      staged.push({ rowNo: idx + 2, values: input, error });
    });

    const ok = staged.filter((s) => !s.error).length;
    const inserted = await db
      .insert(importStaging)
      .values({
        organizationId: ctx.orgId,
        kind: "machines",
        rows: staged as unknown as Record<string, unknown>[],
        validCount: ok,
        errorCount: staged.length - ok,
        uploadedBy: ctx.userId,
      })
      .returning();
    const staging = inserted[0];
    if (!staging) throw new Error("staging insert returned no rows");
    return { stagingId: staging.id, total: staged.length, ok, failed: staged.length - ok, rows: staged };
  },

  async commit(ctx: Ctx, stagingId: string): Promise<{ created: string[]; skipped: { rowNo: number; reason: string }[] }> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(importStaging)
      .where(and(eq(importStaging.id, stagingId), eq(importStaging.organizationId, ctx.orgId)))
      .limit(1);
    const staging = rows[0];
    if (!staging) throw new Error("staging_not_found");
    if (staging.status !== "pending") throw new Error(`staging_${staging.status}`);

    const created: string[] = [];
    const skipped: { rowNo: number; reason: string }[] = [];
    for (const stagedRow of staging.rows as unknown as StagedMachineRow[]) {
      if (stagedRow.error) {
        skipped.push({ rowNo: stagedRow.rowNo, reason: stagedRow.error });
        continue;
      }
      try {
        const machine = await machinesWriteService.create(ctx, stagedRow.values);
        created.push(machine.tag);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        skipped.push({ rowNo: stagedRow.rowNo, reason: message.startsWith("tag_conflict:") ? "tag already exists" : message });
      }
    }

    await db.update(importStaging).set({ status: "committed" }).where(eq(importStaging.id, stagingId));
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "machines.csv_imported",
      entityType: "import_staging",
      entityId: stagingId,
      diff: { created: created.length, skipped: skipped.length },
    });
    return { created, skipped };
  },

  async stagingById(ctx: Ctx, stagingId: string) {
    const db = await getDb();
    const rows = await db
      .select()
      .from(importStaging)
      .where(and(eq(importStaging.id, stagingId), eq(importStaging.organizationId, ctx.orgId)))
      .limit(1);
    return rows[0] ?? null;
  },
};
