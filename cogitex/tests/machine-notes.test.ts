import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { machinesWriteService } from "@/server/services/machines";
import { notesService } from "@/server/services/machine-notes";
import { documentsService } from "@/server/services/documents";
import { auditLogs, machineNotes } from "@/server/db/schema";
import { eq, isNull, and } from "drizzle-orm";

let db: AppDb;
let ctx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);
  const org = await orgsRepo.create(db, { name: "Notes Plant", slug: `notes-${testId()}` });
  const user = await usersRepo.create(db, { name: "Owner N", email: `n-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: user.id, role: "owner" });
  ctx = { userId: user.id, email: user.email, name: user.name, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos", roles: ["owner"] };
});

afterEach(() => {
  __resetDbForTests();
});

async function machineFor(ctxX: Ctx) {
  return machinesWriteService.create(ctxX, { name: "Notes pump", tag: `N-${testId().toUpperCase()}`, category: "pump" });
}

describe("machine notes: typed notes", () => {
  it("adds and lists markdown notes; soft delete is audited", async () => {
    const machine = await machineFor(ctx);
    const note = await notesService.add(ctx, machine.id, {
      title: "PM findings",
      body: "## Drive end\n- seal **replaced**\n- 10 min dry run ok",
    });
    expect(note.source).toBe("typed");
    expect(notesService.list(ctx, machine.id)).resolves.toHaveLength(1);

    await notesService.remove(ctx, machine.id, note.id);
    const still = await notesService.list(ctx, machine.id);
    expect(still).toHaveLength(0);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityType, "machine"));
    expect(audits.some((a) => a.action === "machine.note_added")).toBe(true);
    expect(audits.some((a) => a.action === "machine.note_removed")).toBe(true);
    // soft-deleted row is still in the table (never destroyed)
    const rows = await db.select().from(machineNotes);
    expect(rows[0]?.deletedAt).not.toBeNull();
  });

  it("validation: empty body and oversized bodies are refused; blank title falls back", async () => {
    const machine = await machineFor(ctx);
    await expect(notesService.add(ctx, machine.id, { title: "x", body: "   " })).rejects.toThrow("body_required");
    await expect(
      notesService.add(ctx, machine.id, { title: "big", body: "x".repeat(60_001) }),
    ).rejects.toThrow("body_too_large");
    const untitled = await notesService.add(ctx, machine.id, { title: "  ", body: "fine" });
    expect(untitled.title).toBe("Untitled note");
  });

  it("tenancy: notes never cross orgs (list and write are org-scoped)", async () => {
    const machine = await machineFor(ctx);
    const note = await notesService.add(ctx, machine.id, { title: "private", body: "org A only" });
    const org2 = await orgsRepo.create(db, { name: "Org B", slug: `b-${testId()}` });
    const userB = (await usersRepo.create(db, { name: "B", email: `b-${testId()}@x.io`, passwordHash: "x" })).id;
    await membershipsRepo.create(db, { organizationId: org2.id, userId: userB, role: "owner" });
    const ctxB = { ...ctx, orgId: org2.id, userId: userB, orgSlug: org2.slug, orgName: org2.name, roles: ["owner"] as Ctx["roles"] };

    expect(await notesService.list(ctxB, machine.id)).toHaveLength(0);
    await expect(notesService.add(ctxB, machine.id, { title: "sneaky", body: "no" })).rejects.toThrow("machine_not_found");
    await expect(notesService.remove(ctxB, machine.id, note.id)).rejects.toThrow("note_not_found");
  });
});

describe("machine notes: import pipeline (same file-store)", () => {
  it("imports .md as a note whose original file lands on the documents store", async () => {
    const machine = await machineFor(ctx);
    const md = Buffer.from("# From the field\n- coupling replaced\n- see photos", "utf8");
    const { note, doc } = await notesService.importFile(ctx, machine.id, { name: "pm-findings.md", mimeType: "text/markdown", bytes: md });
    expect(note.source).toBe("import_md");
    expect(note.documentId).toBe(doc.id);
    expect(note.body).toContain("## From the field".replace("##", "#"));
    expect(note.body).toContain("coupling replaced");
    const got = await documentsService.download(ctx, doc.id);
    expect(got?.doc.name).toBe("pm-findings.md");
    expect(got?.doc.machineId).toBe(machine.id);
  });

  it("imports .csv as a row-capped markdown table (cap reported, original kept)", async () => {
    const machine = await machineFor(ctx);
    const big = ["pressure,temp", ...Array.from({ length: 150 }, (_, i) => `${i},${100 + i}`)].join("\n");
    const { note } = await notesService.importFile(ctx, machine.id, { name: "readings.csv", mimeType: "text/csv", bytes: Buffer.from(big, "utf8") });
    expect(note.source).toBe("import_csv");
    expect(note.body).toContain("Imported from `readings.csv`");
    expect(note.body).toContain("| pressure | temp |");
    expect(note.body).toContain("truncated");
    expect(await db.select().from(machineNotes).where(and(eq(machineNotes.machineId, machine.id), isNull(machineNotes.deletedAt)))).toHaveLength(1);
  });

  it("imports .xlsx from a real SheetJS workbook (first sheet, raw=false)", async () => {
    const machine = await machineFor(ctx);
    const XLSX = (await import("xlsx")).default as typeof import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["sku", "qty"], ["BRG-6204", "4"], ["SEAL-1", "2"]]), "Parts");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const { note } = await notesService.importFile(ctx, machine.id, {
      name: "parts-list.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: Buffer.from(buf),
    });
    expect(note.source).toBe("import_xlsx");
    expect(note.body).toContain("`Parts` sheet");
    expect(note.body).toContain("BRG-6204");
  });

  it("refuses unsupported and empty imports with actionable guidance", async () => {
    const machine = await machineFor(ctx);
    await expect(
      notesService.importFile(ctx, machine.id, { name: "manual.docx", mimeType: "application/msword", bytes: Buffer.from("docx-bytes") }),
    ).rejects.toThrow("unsupported_import");
    await expect(
      notesService.importFile(ctx, machine.id, { name: "empty.csv", mimeType: "text/csv", bytes: Buffer.from("", "utf8") }),
    ).rejects.toThrow("empty_file");
    await expect(
      notesService.importFile(ctx, machine.id, { name: "headersonly.csv", mimeType: "text/csv", bytes: Buffer.from("a,b", "utf8") }),
    ).rejects.toThrow("csv_empty");
  });

  it("tenancy: a foreign-org machine never accepts an import", async () => {
    const org2 = await orgsRepo.create(db, { name: "Foreign Org", slug: `fx-${testId()}` });
    const userF = (await usersRepo.create(db, { name: "F", email: `f-${testId()}@x.io`, passwordHash: "x" })).id;
    await membershipsRepo.create(db, { organizationId: org2.id, userId: userF, role: "owner" });
    const foreign = await machinesWriteService.create({ ...ctx, orgId: org2.id, userId: userF, roles: ["owner"] }, { name: "Foreign pump", tag: "F-N1", category: "pump" });
    await expect(
      notesService.importFile(ctx, foreign.id, { name: "a.md", mimeType: "text/markdown", bytes: Buffer.from("# hi", "utf8") }),
    ).rejects.toThrow("machine_not_found");
  });
});
