import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { machinesWriteService } from "@/server/services/machines";
import { notesService } from "@/server/services/machine-notes";
import { auditLogs } from "@/server/db/schema";
import { INSERT_BLOCKS, NOTE_BODY_MAX, appendBlock } from "@/lib/note-editor";

let db: AppDb;
let ctx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);
  const org = await orgsRepo.create(db, { name: "Editor Plant", slug: `ed-${testId()}` });
  const user = await usersRepo.create(db, { name: "Editor", email: `ed-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: user.id, role: "owner" });
  ctx = { userId: user.id, email: user.email, name: user.name, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos", roles: ["owner"] };
});

afterEach(() => {
  __resetDbForTests();
});

describe("note editor block insertions", () => {
  it("exposes the toolbar blocks in order", () => {
    expect(INSERT_BLOCKS.map((b) => b.kind)).toEqual(["heading", "bullets", "numbered", "table", "rule", "task"]);
  });

  it("inserts skeletons into empty and populated drafts with blank-line separation", () => {
    expect(appendBlock("", "table")).toContain("| column 1 | column 2 | column 3 |");
    expect(appendBlock("", "table")).toContain("| --- | --- | --- |");
    const grown = appendBlock("# Log", "heading");
    expect(grown).toBe("# Log\n\n## Heading\n");
    const list = appendBlock("first line\n", "bullets");
    expect(list.startsWith("first line\n\n- point one")).toBe(true);
  });

  it("task list uses GFM checkboxes; rule is a horizontal rule", () => {
    expect(appendBlock("x", "task")).toContain("- [ ] todo");
    expect(appendBlock("x", "rule")).toContain("\n\n---\n");
  });

  it("refuses unknown block kinds with an honest error", () => {
    expect(() => appendBlock("body", "cursor-cursor")).toThrow("unknown_block:cursor-cursor");
  });

  it("respects the body cap — a full draft refuses growth instead of truncating", () => {
    const full = "x".repeat(NOTE_BODY_MAX);
    expect(() => appendBlock(full, "table")).toThrow(`body_too_large:${NOTE_BODY_MAX}`);
  });
});

describe("note editor service seam", () => {
  it("byId loads one org-scoped note; foreign and deleted notes read as null", async () => {
    const machine = await machinesWriteService.create(ctx, { name: "Pump", tag: `NP-${testId()}`, category: "pump" });
    const note = await notesService.add(ctx, machine.id, { title: "Log", body: "1" });

    expect((await notesService.byId(ctx, machine.id, note.id))?.title).toBe("Log");
    expect(await notesService.byId(ctx, machine.id, "00000000-0000-0000-0000-000000000000")).toBeNull();

    const rival = await orgsRepo.create(db, { name: "Rival", slug: `er-${testId()}` });
    const rUser = (await usersRepo.create(db, { name: "R", email: `r-${testId()}@x.io`, passwordHash: "x" })).id;
    await membershipsRepo.create(db, { organizationId: rival.id, userId: rUser, role: "owner" });
    const rCtx = { ...ctx, userId: rUser, orgId: rival.id, orgSlug: rival.slug, orgName: rival.name, roles: ["owner"] as Ctx["roles"] };
    expect(await notesService.byId(rCtx, machine.id, note.id)).toBeNull();

    await notesService.remove(ctx, machine.id, note.id);
    expect(await notesService.byId(ctx, machine.id, note.id)).toBeNull(); // soft-deleted notes are gone
  });

  it("editor seam: silent draft saves (audit:false) still persist but do not audit; SAVE does", async () => {
    const machine = await machinesWriteService.create(ctx, { name: "Pump", tag: `NP-${testId()}`, category: "pump" });
    const note = await notesService.add(ctx, machine.id, { title: "Draft", body: "base" });

    // toolbar insert #1 — persisted, silent
    const appended = appendBlock(note.body, "heading");
    await notesService.edit(ctx, machine.id, note.id, { title: note.title, body: appended }, { audit: false });
    let audits = await db.select().from(auditLogs).where(eq(auditLogs.entityType, "machine"));
    expect(audits.some((a) => a.action === "machine.note_edited")).toBe(false);

    const stored = await notesService.byId(ctx, machine.id, note.id);
    expect(stored?.body).toContain("## Heading"); // the insert survived
    expect(stored?.updatedAt).not.toBeNull();

    // explicit SAVE — audited
    await notesService.edit(ctx, machine.id, note.id, { title: "Draft v2", body: "final text" });
    audits = await db.select().from(auditLogs).where(eq(auditLogs.entityType, "machine"));
    expect(audits.some((a) => a.action === "machine.note_edited")).toBe(true);
    expect(audits.some((a) => a.action === "machine.note_removed")).toBe(false);
  });
});
