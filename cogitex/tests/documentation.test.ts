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
import { documentsService } from "@/server/services/documents";
import { libraryService } from "@/server/services/library";
import { auditLogs } from "@/server/db/schema";

let db: AppDb;
let ctx: Ctx;
let memberCtx: Ctx; // same org, authoring member (not planner)
let otherCtx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);

  const org = await orgsRepo.create(db, { name: "Docs Plant", slug: `docs-${testId()}` });
  const owner = await usersRepo.create(db, { name: "Docs Owner", email: `d-${testId()}@x.io`, passwordHash: "x" });
  const member = await usersRepo.create(db, { name: "Tech Mike", email: `m-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: owner.id, role: "owner" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: member.id, role: "technician" });
  const base = { email: owner.email, name: owner.name, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos" } as unknown as Ctx;
  ctx = { ...base, userId: owner.id, roles: ["owner"] };
  memberCtx = { ...base, userId: member.id, name: member.name, email: member.email, roles: ["technician"] };
  memberCtx = { ...memberCtx, orgId: org.id, orgSlug: org.slug, orgName: org.name };

  const org2 = await orgsRepo.create(db, { name: "Rival Docs", slug: `rdocs-${testId()}` });
  const outsider = await usersRepo.create(db, { name: "Spy", email: `s-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org2.id, userId: outsider.id, role: "owner" });
  otherCtx = { ...ctx, userId: outsider.id, orgId: org2.id, orgSlug: org2.slug, orgName: org2.name, roles: ["owner"] };
});

afterEach(() => {
  __resetDbForTests();
});

describe("note edition (add and edit)", () => {
  it("edits title and body in place; source and document link untouched; audited", async () => {
    const machine = await machinesWriteService.create(ctx, { name: "Pump A", tag: `PA-${testId()}`, category: "pump" });
    const note = await notesService.add(ctx, machine.id, { title: "Draft", body: "rough notes ## later" });

    const edited = await notesService.edit(ctx, machine.id, note.id, {
      title: "Bearing findings",
      body: "## Bearing\n- replaced\n\n| part | qty |\n| --- | --- |\n| 6205 | 2 |",
    });
    expect(edited.title).toBe("Bearing findings");
    expect(edited.body).toContain("6205");
    expect(edited.source).toBe("typed"); // edition never rewrites provenance

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityType, "machine"));
    expect(audits.some((a) => a.action === "machine.note_edited")).toBe(true);
    const list = await notesService.list(ctx, machine.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe("Bearing findings");
  });

  it("author-or-planner: a member edits their own typed note, never someone else's", async () => {
    const machine = await machinesWriteService.create(ctx, { name: "Pump B", tag: `PB-${testId()}`, category: "pump" });
    const own = await notesService.add(memberCtx, machine.id, { title: "Shift log", body: "ran 4h", source: "typed" });
    // owner (planner) edits the member's note — allowed
    const byPlanner = await notesService.edit(ctx, machine.id, own.id, { title: own.title, body: "ran 4h, temp fine" });
    expect(byPlanner.body).toContain("temp fine");
    // the member cannot edit the owner's note
    const owners = await notesService.add(ctx, machine.id, { title: "Owner note", body: "planner wrote this" });
    await expect(notesService.edit(memberCtx, machine.id, owners.id, { title: "Hijack", body: "no" })).rejects.toThrow("forbidden:plan.manage");
  });

  it("validation and tenancy on edition", async () => {
    const machine = await machinesWriteService.create(ctx, { name: "Pump C", tag: `PC-${testId()}`, category: "pump" });
    const note = await notesService.add(ctx, machine.id, { title: "T", body: "b" });
    await expect(notesService.edit(ctx, machine.id, note.id, { title: "T", body: "  " })).rejects.toThrow("body_required");
    // rival org can't even see the machine — the machine guard is the outer wall
    await expect(notesService.edit(otherCtx, machine.id, note.id, { title: "Sneak", body: "x" })).rejects.toThrow("machine_not_found");
    await expect(notesService.edit(ctx, machine.id, "00000000-0000-0000-0000-000000000000", { title: "?", body: "x" })).rejects.toThrow("note_not_found");
  });
});

describe("documentation library search", () => {
  it("finds notes by title and body, files by name; everything org-scoped", async () => {
    const machine = await machinesWriteService.create(ctx, { name: "Chiller 1", tag: `CH-${testId()}`, category: "chiller" });
    await notesService.add(ctx, machine.id, { title: "Compressor changeout", body: "Oil rig removal took 3 hours. Seal kit 88-42 installed." });
    await documentsService.upload(ctx, { machineId: machine.id, kind: "manual", name: "mainfest-88-42.pdf", mimeType: "application/pdf", bytes: Buffer.from("PDF") });

    const all = await libraryService.search(ctx);
    expect(all.notes).toHaveLength(1);
    expect(all.docs).toHaveLength(1);
    expect(all.notes[0]?.machineTag).toBe(machine.tag);
    expect(all.docs[0]?.name).toBe("mainfest-88-42.pdf");

    const byBody = await libraryService.search(ctx, { q: "seal kit 88-42" });
    expect(byBody.notes.some((n) => n.title === "Compressor changeout")).toBe(true);
    const byFile = await libraryService.search(ctx, { q: "88-42" });
    expect(byFile.docs.some((d) => d.name === "mainfest-88-42.pdf")).toBe(true);
    const miss = await libraryService.search(ctx, { q: "zebra-unicorn" });
    expect(miss.notes).toHaveLength(0);
    expect(miss.docs).toHaveLength(0);

    // machine filter narrows both sections
    const filtered = await libraryService.search(ctx, { machineId: machine.id, q: "hours" });
    expect(filtered.notes).toHaveLength(1);
  });

  it("tenancy: the library never crosses organisations", async () => {
    const machine = await machinesWriteService.create(ctx, { name: "Secret pump", tag: `SP-${testId()}`, category: "pump" });
    await notesService.add(ctx, machine.id, { title: "Confidential", body: "internal only content" });
    await documentsService.upload(ctx, { machineId: machine.id, kind: "manual", name: "secret-manual.pdf", mimeType: "application/pdf", bytes: Buffer.from("PDF") });

    const rival = await libraryService.search(otherCtx);
    expect(rival.notes).toHaveLength(0);
    expect(rival.docs).toHaveLength(0);

    // a q that matches the secret content from the rival org still returns empty
    const rivalSearch = await libraryService.search(otherCtx, { q: "internal only content" });
    expect(rivalSearch.notes).toHaveLength(0);
  });
});
