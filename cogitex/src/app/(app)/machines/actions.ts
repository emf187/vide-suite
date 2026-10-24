"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Ctx } from "@/server/ctx";
import { requireCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { documentsService } from "@/server/services/documents";
import { machineImportService } from "@/server/services/machine-import";
import { machinesService, machinesWriteService } from "@/server/services/machines";
import { areasService, sitesService } from "@/server/services/sites";
import { nairaToKobo } from "@/lib/money";

function assertRole(ctx: Ctx): void {
  if (!can(ctx.roles, "plan.manage")) throw new Error("forbidden: requires owner/admin/maintenance_manager");
}

function tagOf(form: FormData): string {
  return String(form.get("machineId") ?? "");
}

function opt(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value;
}

export async function createMachineAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  assertRole(ctx);
  const name = String(form.get("name") ?? "").trim();
  const tag = String(form.get("tag") ?? "").trim();
  const category = String(form.get("category") ?? "other");
  if (!name || !tag) redirect("/machines/new?error=fields");

  const videoLinks = form.getAll("vide_link").map(String).filter(Boolean);
  const ratedSpecs: Record<string, string | number> = {};
  for (const [key, value] of form.entries()) {
    if (key.startsWith("rated_") && typeof value === "string" && value.trim() !== "") {
      const num = Number(value);
      ratedSpecs[key.replace("rated_", "")] = Number.isFinite(num) ? num : value.trim();
    }
  }
  let machineId: string;
  try {
    const machine = await machinesWriteService.create(ctx, {
      name,
      tag,
      category,
      siteId: opt(form, "siteId") ?? null,
      areaId: opt(form, "areaId") ?? null,
      make: opt(form, "make"),
      model: opt(form, "model"),
      serialNumber: opt(form, "serialNumber"),
      ratedSpecs,
      installDate: opt(form, "installDate") ?? null,
      warrantyUntil: opt(form, "warrantyUntil") ?? null,
      criticality: (opt(form, "criticality") as "A" | "B" | "C") ?? "B",
      locationNote: opt(form, "locationNote"),
      videMachineNames: videoLinks,
    });
    machineId = machine.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("tag_conflict:")) redirect(`/machines/new?error=tag_conflict&tag=${encodeURIComponent(message.slice("tag_conflict:".length))}`);
    redirect("/machines/new?error=server");
  }
  redirect(`/machines/${machineId}`);
}

export async function updateMachineAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  assertRole(ctx);
  const machineId = tagOf(form);
  const name = String(form.get("name") ?? "").trim();
  if (!machineId || !name) redirect(`/machines/${machineId}/edit?error=fields`);
  try {
    await machinesWriteService.update(ctx, machineId, {
      name,
      tag: opt(form, "tag"),
      category: opt(form, "category"),
      siteId: form.get("siteId") !== null ? opt(form, "siteId") ?? null : undefined,
      areaId: form.get("areaId") !== null ? opt(form, "areaId") ?? null : undefined,
      make: opt(form, "make"),
      model: opt(form, "model"),
      serialNumber: opt(form, "serialNumber"),
      installDate: opt(form, "installDate") ?? null,
      warrantyUntil: opt(form, "warrantyUntil") ?? null,
      criticality: opt(form, "criticality") as "A" | "B" | "C" | undefined,
      locationNote: opt(form, "locationNote"),
      videMachineNames: form.getAll("vide_link").map(String).filter(Boolean),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/machines/${machineId}/edit?error=${message.startsWith("tag_conflict:") ? "tag_conflict" : "server"}`);
  }
  redirect(`/machines/${machineId}?saved=1`);
}

export async function transitionLifecycleAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  assertRole(ctx);
  const machineId = tagOf(form);
  const to = String(form.get("to") ?? "");
  const map: Record<string, "active" | "standby"> = { active: "active", standby: "standby" };
  const target = map[to];
  if (!machineId || !target) redirect(`/machines/${machineId}?error=transition`);
  try {
    await machinesWriteService.transition(ctx, machineId, target, {
      reason: opt(form, "reason"),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/machines/${machineId}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/machines/${machineId}?lifecycle=${target}`);
}

export async function decommissionMachineAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  assertRole(ctx);
  const machineId = tagOf(form);
  const reason = String(form.get("reason") ?? "").trim();
  if (!machineId || !reason) redirect(`/machines/${machineId}/decommission?error=fields`);
  const effectiveAt = opt(form, "effectiveAt");
  try {
    await machinesWriteService.transition(ctx, machineId, "decommissioned", {
      reason,
      effectiveAt: effectiveAt ? new Date(effectiveAt) : undefined,
      partsDisposition: opt(form, "partsDisposition"),
      openWoPolicy: (opt(form, "openWoPolicy") as "cancel" | "close") ?? "cancel",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/machines/${machineId}/decommission?error=${encodeURIComponent(message)}`);
  }
  redirect(`/machines/${machineId}?lifecycle=decommissioned`);
}

export async function removeMachineAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const machineId = tagOf(form);
  const confirm = String(form.get("confirm") ?? "").trim().toUpperCase();
  const mode = String(form.get("mode") ?? "soft") as "soft" | "hard";
  const machine = await machinesService.byId(ctx, machineId);
  if (!machine) redirect("/machines?error=not_found");
  if (mode === "hard") {
    if (!can(ctx.roles, "hardDelete")) redirect(`/machines/${machineId}/edit?error=forbidden`);
    if (confirm !== machine.tag) redirect(`/machines/${machineId}/edit?error=confirm_mismatch`);
  } else if (confirm !== machine.tag) {
    // soft delete also asks the operator to type the tag — destructive action guard
    redirect(`/machines/${machineId}/edit?error=confirm_mismatch`);
  }
  try {
    await machinesWriteService.remove(ctx, machineId, mode);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/machines/${machineId}/edit?error=${encodeURIComponent(message)}`);
  }
  redirect("/machines?removed=1");
}

export async function uploadDocumentAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const machineId = tagOf(form);
  const machine = await machinesService.byId(ctx, machineId);
  if (!machine) redirect("/machines?error=not_found");
  const file = form.get("file");
  const allowedKinds = ["manual", "datasheet", "drawing", "photo", "procedure", "warranty", "calibration_cert", "report", "other"] as const;
  const kindRaw = String(form.get("kind") ?? "other");
  const kind = (allowedKinds as readonly string[]).includes(kindRaw) ? (kindRaw as (typeof allowedKinds)[number]) : "other";
  if (!(file instanceof File) || file.size === 0) redirect(`/machines/${machineId}?tab=documents&error=file`);
  const bytes = Buffer.from(await (file as File).arrayBuffer());
  try {
    await documentsService.upload(ctx, {
      machineId,
      kind,
      name: (file as File).name,
      mimeType: (file as File).type || "application/octet-stream",
      bytes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/machines/${machineId}?tab=documents&error=${encodeURIComponent(message)}`);
  }
  redirect(`/machines/${machineId}?tab=documents&uploaded=1`);
}

export async function deleteDocumentAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const machineId = tagOf(form);
  const documentId = String(form.get("documentId") ?? "");
  // Only planners or the original uploader may remove documents.
  const docRows = await documentsService.download(ctx, documentId);
  if (!docRows) redirect(`/machines/${machineId}?tab=documents&error=not_found`);
  const owns = docRows?.doc.uploadedBy === ctx.userId;
  if (!can(ctx.roles, "plan.manage") && !owns) {
    redirect(`/machines/${machineId}?tab=documents&error=forbidden`);
  }
  await documentsService.softDelete(ctx, documentId);
  redirect(`/machines/${machineId}?tab=documents&deleted=1`);
}

export async function addComponentAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const machineId = tagOf(form);
  const name = String(form.get("name") ?? "").trim();
  if (!name) redirect(`/machines/${machineId}?tab=parts&error=fields`);
  const { componentsService } = await import("@/server/services/machine-extras");
  await componentsService.add(ctx, machineId, {
    name,
    tag: opt(form, "tag"),
    kind: opt(form, "kind"),
    note: opt(form, "note"),
  });
  revalidatePath(`/machines/${machineId}`);
  redirect(`/machines/${machineId}?tab=parts&added=1`);
}

/* ---------------- expenditure log (machine profile v2) ---------------- */

const EXPENSE_KINDS_SERVER = [
  "service", "contract", "parts_direct", "consumable", "fuel", "hire",
  "calibration", "training", "other",
] as const;

export async function addMachineExpenseAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  assertRole(ctx);
  const machineId = tagOf(form);
  const description = String(form.get("description") ?? "").trim();
  const amountRaw = Number(String(form.get("amount") ?? "").replace(/,/g, ""));
  if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
    redirect(`/machines/${machineId}?tab=maintenance&expense_error=amount`);
  }
  const kindRaw = String(form.get("kind") ?? "other");
  const kind = (EXPENSE_KINDS_SERVER as readonly string[]).includes(kindRaw) ? (kindRaw as (typeof EXPENSE_KINDS_SERVER)[number]) : "other";
  const occurredRaw = opt(form, "occurredAt"); // yyyy-mm-dd from type=date
  let occurredAt: Date;
  if (occurredRaw) {
    const d = new Date(`${occurredRaw}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) redirect(`/machines/${machineId}?tab=maintenance&expense_error=date`);
    occurredAt = d;
  } else {
    occurredAt = new Date();
  }
  const { expensesService } = await import("@/server/services/machine-history");
  try {
    await expensesService.add(ctx, machineId, {
      kind,
      description: description || "Logged expenditure",
      amountKobo: nairaToKobo(amountRaw),
      vendor: opt(form, "vendor"),
      reference: opt(form, "reference"),
      occurredAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/machines/${machineId}?tab=maintenance&expense_error=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/machines/${machineId}`);
  redirect(`/machines/${machineId}?tab=maintenance&expense=added`);
}

export async function deleteMachineExpenseAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  assertRole(ctx);
  const machineId = tagOf(form);
  const expenseId = String(form.get("expenseId") ?? "");
  const { expensesService } = await import("@/server/services/machine-history");
  try {
    await expensesService.remove(ctx, machineId, expenseId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/machines/${machineId}?tab=maintenance&expense_error=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/machines/${machineId}`);
  redirect(`/machines/${machineId}?tab=maintenance&expense=removed`);
}

/* ---------------- CSV import ---------------- */

export async function stageMachineImportAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  assertRole(ctx);
  const csv = String(form.get("csv") ?? "").trim();
  let stagingId: string | null = null;
  try {
    const result = await machineImportService.stageCsv(ctx, csv);
    stagingId = result.stagingId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/machines/import?error=${encodeURIComponent(message)}`);
  }
  redirect(`/machines/import/${stagingId}`);
}

export async function commitMachineImportAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  assertRole(ctx);
  const stagingId = String(form.get("stagingId") ?? "");
  let createdCount = 0;
  let skippedCount = 0;
  try {
    const result = await machineImportService.commit(ctx, stagingId);
    createdCount = result.created.length;
    skippedCount = result.skipped.length;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/machines/import/${stagingId}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/machines?imported=${createdCount}&skipped=${skippedCount}`);
}

/* ---------------- locations (sites/areas) ---------------- */

export async function createSiteAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  assertRole(ctx);
  const name = String(form.get("name") ?? "").trim();
  const code = String(form.get("code") ?? "").trim();
  if (!name || !code) redirect("/settings/locations?error=fields");
  try {
    await sitesService.create(ctx, { name, code, address: opt(form, "address") });
  } catch {
    redirect("/settings/locations?error=dup_code");
  }
  redirect("/settings/locations?created=site");
}

export async function createAreaAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  assertRole(ctx);
  const name = String(form.get("name") ?? "").trim();
  const code = String(form.get("code") ?? "").trim();
  const siteId = String(form.get("siteId") ?? "");
  if (!name || !code || !siteId) redirect("/settings/locations?error=fields");
  try {
    await areasService.create(ctx, { siteId, name, code, kind: (opt(form, "kind") as "area" | "line") ?? "area" });
  } catch {
    redirect("/settings/locations?error=dup_code");
  }
  redirect("/settings/locations?created=area");
}
