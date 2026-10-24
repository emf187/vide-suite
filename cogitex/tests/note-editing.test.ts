import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { machinesWriteService } from "@/server/services/machines";
import { notesService } from "@/server/services/machine-notes";
import { insertSnippet, toggleLinePrefix, wrapInline, wrapLink } from "@/lib/note-editing";

let db: AppDb;
let ctx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);
  const org = await orgsRepo.create(db, { name: "Editing Plant", slug: `we-${testId()}` });
  const user = await usersRepo.create(db, { name: "Writer", email: `w-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: user.id, role: "owner" });
  ctx = { userId: user.id, email: user.email, name: user.name, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos", roles: ["owner"] };
});

afterEach(() => {
  __resetDbForTests();
});

describe("wrapInline (bold / italic / code toggles)", () => {
  it("wraps a selection and keeps the selection on the inner content", () => {
    const r = wrapInline("pump is running hot", 8, 15, "**", "bold text");
    expect(r.text).toBe("pump is **running** hot");
    expect(r.selStart).toBe(10); // right after the opening **
    expect(r.selEnd).toBe(17);
  });

  it("fills a placeholder on an empty selection (no selection = insert and position)", () => {
    const r = wrapInline("abc", 1, 1, "*", "italic");
    expect(r.text).toBe("a*italic*bc");
    expect(r.selStart).toBe(2);
    expect(r.selEnd).toBe(8);
  });

  it("unwraps on the second click (toggle off)", () => {
    const r = wrapInline("a **bold** b", 2, 10, "**", "bold text");
    expect(r.text).toBe("a bold b");
    expect(r.text.includes("**")).toBe(false);
  });

  it("code ticks wrap without touching the rest of the line", () => {
    const r = wrapInline("temp = 45", 0, 4, "`", "code");
    expect(r.text).toBe("`temp` = 45");
  });

  it("refuses to grow a draft past the cap", () => {
    expect(() => wrapInline("x".repeat(59_999), 0, 59_999, "**", "bold", 60_000)).toThrow("body_too_large:60000");
  });
});

describe("wrapLink", () => {
  it("turns the selection into the link text", () => {
    const r = wrapLink("see VIDE docs", 4, 8);
    expect(r.text).toBe("see [VIDE](https://) docs");
  });

  it("puts the cursor on the target span for an empty selection", () => {
    const r = wrapLink("ab", 1, 1);
    expect(r.text).toBe("a[link text](https://)b");
    expect(r.text.slice(r.selStart, r.selEnd)).toBe("https://");
  });
});

describe("toggleLinePrefix (headings, lists, tasks)", () => {
  const doc = "title\n\nstep one\nstep two\n\noutro";

  it("prefixes the line the cursor is on when the selection is empty", () => {
    const r = toggleLinePrefix(doc, 10, 10, "- ");
    expect(r.text).toBe("title\n\n- step one\nstep two\n\noutro");
  });

  it("prefixes every selected line, skipping empty ones", () => {
    const r = toggleLinePrefix(doc, 8, 22, "- ");
    expect(r.text).toBe("title\n\n- step one\n- step two\n\noutro");
  });

  it("removed the prefix when every touched line already has it", () => {
    const bulleted = "title\n\n- step one\n- step two\n\noutro";
    const r = toggleLinePrefix(bulleted, 8, 22, "- ");
    expect(r.text).toBe(doc);
  });

  it("toggles headings the same way", () => {
    const r = toggleLinePrefix("log entry", 0, 9, "## ");
    expect(r.text).toBe("## log entry");
    const off = toggleLinePrefix(r.text, 3, 5, "## ");
    expect(off.text).toBe("log entry");
  });

  it("task checkboxes toggle like lists", () => {
    const r = toggleLinePrefix("check the seal", 0, 14, "- [ ] ");
    expect(r.text).toBe("- [ ] check the seal");
  });
});

describe("insertSnippet (tables, rules at the cursor)", () => {
  it("inserts mid-text with blank-line separation", () => {
    const r = insertSnippet("beforeafter", 6, "---\n");
    expect(r.text).toBe("before\n\n---\nafter");
    expect(r.selStart).toBe(8); // cursor lands after the snippet
  });

  it("appends at the end cleanly", () => {
    const r = insertSnippet("text", 4, "| a | b |\n| --- | --- |\n|  |  |");
    expect(r.text).toBe("text\n\n| a | b |\n| --- | --- |\n|  |  |");
  });

  it("the cap is respected on insertion too", () => {
    expect(() => insertSnippet("x".repeat(60_000), 30_000, "---", 60_000)).toThrow("body_too_large:60000");
  });
});

describe("editor round-trip (lib math + service persistence)", () => {
  it("a capitalized-for-emphasis word survives bold→save→list reads", async () => {
    const machine = await machinesWriteService.create(ctx, { name: "Pump", tag: `WP-${testId()}`, category: "pump" });
    const note = await notesService.add(ctx, machine.id, { title: "Round trip", body: "seal leaking" });
    const bolded = wrapInline("seal leaking", 5, 13, "**", "bold text");
    const listed = toggleLinePrefix(bolded.text, 0, bolded.text.length, "- ");
    const saved = await notesService.edit(ctx, machine.id, note.id, { title: "Round trip", body: listed.text }, { audit: true });
    expect(saved.body).toBe("- seal **leaking**");
    expect(saved.body.includes("**")).toBe(true);
  });
});
