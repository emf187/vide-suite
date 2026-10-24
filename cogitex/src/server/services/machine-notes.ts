/**
 * Machine notes (sprint item 2): one coherent surface per machine for typed
 * knowledge + imported documents.
 *
 * File-store rule: the note is self-contained (markdown body), but every import
 * ALSO lands the original bytes in the document store — the note cites the
 * document id, the file is always downloadable. PDF/DOCX/XLSX originals stay
 * PREVIEW-ONLY on the documents surface; MD/TXT import as text; CSV/XLSX
 * inline as row-capped markdown tables.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb } from "@/server/db/client";
import {
  machineNotes,
  type MachineNote,
} from "@/server/db/schema";
import { auditRepo } from "@/server/repos/audit";
import { can } from "@/server/policies";
import { documentsService } from "./documents";
import { machinesService } from "./machines";
import { parseCsv } from "@/lib/csv/parse";
import { markdownTable } from "@/lib/markdown";

export const NOTE_SOURCES = ["typed", "import_md", "import_txt", "import_csv", "import_xlsx", "agent"] as const;
export type NoteSource = (typeof NOTE_SOURCES)[number];

const MAX_NOTE_BODY = 60_000; // characters of markdown kept per note (imports are row-capped before this)
/** a 10k-row spreadsheet must never freeze the page: keep the first 100 data rows */
const TABLE_ROWS_MAX = 100;

export type NoteImportKind = "md" | "txt" | "csv" | "xlsx" | "unsupported";

/** best-effort classification (mime values browsers send are unreliable) */
export function classifyImport(name: string, mimeType: string): NoteImportKind {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (ext === "md" || ext === "markdown" || mimeType === "text/markdown") return "md";
  if (ext === "txt" || mimeType === "text/plain") return "txt";
  if (ext === "csv" || mimeType === "text/csv") return "csv";
  if (ext === "xlsx" || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  return "unsupported";
}

export const notesService = {
  async list(ctx: Ctx, machineId: string): Promise<MachineNote[]> {
    const db = await getDb();
    return db
      .select()
      .from(machineNotes)
      .where(and(eq(machineNotes.organizationId, ctx.orgId), eq(machineNotes.machineId, machineId), isNull(machineNotes.deletedAt)))
      .orderBy(desc(machineNotes.createdAt));
  },

  async add(
    ctx: Ctx,
    machineId: string,
    input: { title: string; body: string; source?: NoteSource; documentId?: string | null },
  ): Promise<MachineNote> {
    // tenant guard (defense-in-depth: actions call page-scoped machines first)
    const machine = await machinesService.byId(ctx, machineId);
    if (!machine) throw new Error("machine_not_found");
    const title = input.title.trim() || "Untitled note";
    const body = input.body;
    if (!body.trim()) throw new Error("body_required");
    if (body.length > MAX_NOTE_BODY) throw new Error(`body_too_large:${MAX_NOTE_BODY}`);
    const source = input.source ?? "typed";
    if (!(NOTE_SOURCES as readonly string[]).includes(source)) throw new Error("unknown_note_source");

    const db = await getDb();
    const inserted = await db
      .insert(machineNotes)
      .values({
        organizationId: ctx.orgId,
        machineId,
        title,
        body,
        source,
        documentId: input.documentId ?? null,
        createdBy: ctx.userId,
      })
      .returning();
    const note = inserted[0];
    if (!note) throw new Error("note insert returned no rows");
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "machine.note_added",
      entityType: "machine",
      entityId: machineId,
      diff: { noteId: note.id, title, source },
    });
    return note;
  },

  /** soft delete (audited); the original document keeps its own lifecycle */
  async remove(ctx: Ctx, machineId: string, noteId: string): Promise<void> {
    const db = await getDb();
    const rows = await db
      .select({ id: machineNotes.id })
      .from(machineNotes)
      .where(
        and(
          eq(machineNotes.organizationId, ctx.orgId),
          eq(machineNotes.machineId, machineId),
          eq(machineNotes.id, noteId),
          isNull(machineNotes.deletedAt),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new Error("note_not_found");
    await db
      .update(machineNotes)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(machineNotes.id, rows[0].id));
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "machine.note_removed",
      entityType: "machine",
      entityId: machineId,
      diff: { noteId },
    });
  },

  /** Org-scoped single note — the note editor's load path. */
  async byId(ctx: Ctx, machineId: string, noteId: string): Promise<MachineNote | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(machineNotes)
      .where(
        and(
          eq(machineNotes.organizationId, ctx.orgId),
          eq(machineNotes.machineId, machineId),
          eq(machineNotes.id, noteId),
          isNull(machineNotes.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  /**
   * Documentation edition (docs & multimedia sprint): rewrite title/body in
   * place. Audited as machine.note_edited; source and the import linkage are
   * never rewritten — imported notes stay marked as imports. The note-taker
   * editor passes `audit: false` for silent draft-persistence writes
   * (toolbar inserts / preview round-trips) and `audit: true` on explicit
   * SAVE — the audit trail keeps meaningful saves, not every keystroke-step.
   */
  async edit(
    ctx: Ctx,
    machineId: string,
    noteId: string,
    input: { title: string; body: string },
    opts: { audit?: boolean } = {},
  ): Promise<MachineNote> {
    const machine = await machinesService.byId(ctx, machineId);
    if (!machine) throw new Error("machine_not_found");
    const title = input.title.trim() || "Untitled note";
    if (!input.body.trim()) throw new Error("body_required");
    if (input.body.length > MAX_NOTE_BODY) throw new Error(`body_too_large:${MAX_NOTE_BODY}`);
    const db = await getDb();
    const rows = await db
      .select()
      .from(machineNotes)
      .where(
        and(
          eq(machineNotes.organizationId, ctx.orgId),
          eq(machineNotes.machineId, machineId),
          eq(machineNotes.id, noteId),
          isNull(machineNotes.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new Error("note_not_found");
    // note edition is author-or-planner (MaintainX rule); viewers never write
    if (!can(ctx.roles, "plan.manage") && existing.createdBy !== ctx.userId) {
      throw new Error("forbidden:plan.manage");
    }
    const updatedRows = await db
      .update(machineNotes)
      .set({ title, body: input.body, updatedAt: new Date() })
      .where(eq(machineNotes.id, noteId))
      .returning();
    const updated = updatedRows[0];
    if (!updated) throw new Error("note edit returned no rows");
    if (opts.audit !== false) {
      await auditRepo.log(db, {
        organizationId: ctx.orgId,
        actorUserId: ctx.userId,
        action: "machine.note_edited",
        entityType: "machine",
        entityId: machineId,
        diff: { noteId, title, bodyChanged: input.body !== existing.body },
      });
    }
    return updated;
  },

  /**
   * Import a file as a note + document. The original bytes ALWAYS land in the
   * shared document store (nothing is lost at the truncation cap).
   */
  async importFile(
    ctx: Ctx,
    machineId: string,
    file: { name: string; mimeType: string; bytes: Buffer },
  ): Promise<{ note: MachineNote; doc: import("@/server/db/schema").DocumentRow }> {
    const machine = await machinesService.byId(ctx, machineId);
    if (!machine) throw new Error("machine_not_found");
    if (file.bytes.byteLength === 0) throw new Error("empty_file");
    if (file.bytes.byteLength > MAX_IMPORT_FILE_BYTES) throw new Error("file_too_large:5MB");

    const kind = classifyImport(file.name, file.mimeType);
    if (kind === "unsupported") {
      throw new Error("unsupported_import: attach it on the DOCUMENTS tab instead");
    }

    /* ---- compose the self-contained note body ---- */
    let body: string;
    if (kind === "md" || kind === "txt") {
      body = file.bytes.toString("utf8").slice(0, MAX_IMPORT_BODY);
    } else if (kind === "csv") {
      const parsed = parseCsv(file.bytes.toString("utf8"));
      if (parsed.rows.length === 0) throw new Error("csv_empty");
      const { md, truncated } = markdownTable(parsed.header, parsed.rows, TABLE_ROWS_MAX);
      body = [
        `Imported from \`${file.name}\` — ${parsed.rows.length} data rows.`,
        "",
        md,
        truncated > 0 ? `\n\n_… ${truncated} more row(s) truncated — download the file for the full sheet._` : "",
      ].join("\n");
    } else {
      const parsed = await sheetToRows(file.bytes);
      if (parsed.rows.length === 0) throw new Error("xlsx_empty");
      const { md, truncated } = markdownTable(parsed.header, parsed.rows, TABLE_ROWS_MAX);
      body = [
        `Imported from \`${file.name}\` — \`${parsed.sheetName}\` sheet, ${parsed.rows.length} data rows.`,
        "",
        md,
        truncated > 0 ? `\n\n_… ${truncated} more row(s) truncated — download the file for the full sheet._` : "",
      ].join("\n");
    }

    /* ---- store the original in the shared document file-store ---- */
    const doc = await documentsService.upload(ctx, {
      machineId,
      kind: "other",
      name: file.name.slice(0, 200),
      mimeType: file.mimeType || "application/octet-stream",
      bytes: file.bytes,
    });

    const title = file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 120) || "Imported note";
    const note = await this.add(ctx, machineId, {
      title,
      body: body.slice(0, MAX_IMPORT_BODY),
      source: `import_${kind}` as NoteSource,
      documentId: doc.id,
    });
    return { note, doc };
  },
};

/** shared store limit (documents service re-verifies its own) */
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
/** imported markdown/table bodies get a slightly larger ceiling than typed notes */
const MAX_IMPORT_BODY = 60_000;

/** XLSX → {header, rows} via the vendored SheetJS build (bounded to the first sheet rows). */
async function sheetToRows(bytes: Buffer): Promise<{ sheetName: string; header: string[]; rows: string[][] }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "buffer" });
  const sheetName = wb.SheetNames[0] ?? "";
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  const matrix = sheet ? (XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, blankrows: false }) as string[][]) : [];
  const header = (matrix[0] ?? []).map((c) => String(c ?? ""));
  const rows = matrix.slice(1).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : [String(r ?? "")]));
  return { sheetName: sheetName || "sheet", header, rows };
}
