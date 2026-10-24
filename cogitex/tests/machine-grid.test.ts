import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { machinesWriteService } from "@/server/services/machines";
import { componentsService } from "@/server/services/machine-extras";
import { parseComponentGrid, parseSpecsGrid } from "@/lib/grid";
import { auditLogs } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";

let db: AppDb;
let ctx: Ctx;
let otherOrgCtx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);

  const org = await orgsRepo.create(db, { name: "Grid Plant", slug: `grid-${testId()}` });
  const mkUser = async (name: string, role: "owner" | "maintenance_manager") => {
    const u = await usersRepo.create(db, { name, email: `${name}-${testId()}@x.io`, passwordHash: "x" });
    await membershipsRepo.create(db, { organizationId: org.id, userId: u.id, role });
    return u;
  };
  const owner = await mkUser("Owner G", "owner");

  const base = { userId: owner.id, email: owner.email, name: owner.name, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos" };
  ctx = { ...base, roles: ["owner"] };

  // allow least-privilege role check in a dedicated test
  const org2 = await orgsRepo.create(db, { name: "Other Plant", slug: `other-${testId()}` });
  const otherOwner = await usersRepo.create(db, { name: "Owner O", email: `o-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org2.id, userId: otherOwner.id, role: "owner" });
  otherOrgCtx = { ...base, userId: otherOwner.id, email: otherOwner.email, name: otherOwner.name, orgId: org2.id, orgSlug: org2.slug, orgName: org2.name, roles: ["owner"] };
});

afterEach(() => {
  __resetDbForTests();
});

async function machineFor(ctxX: Ctx) {
  return machinesWriteService.create(ctxX, { name: "Grid test machine", tag: `G-${testId().toUpperCase()}`, category: "pump" });
}

describe("parseSpecsGrid (no-JS form pairing)", () => {
  it("pairs key/value inputs by submission order, drops blank rows, keeps numbers numeric", () => {
    const form = new FormData();
    form.append("spec_key", "power_kw");
    form.append("spec_value", "22.5");
    form.append("spec_key", ""); // blank key → row dropped
    form.append("spec_value", "1,800");
    form.append("spec_key", "rpm");
    form.append("spec_value", ""); // blank value → spec removed
    form.append("spec_key", "voltage_v");
    form.append("spec_value", "11kV");
    expect(parseSpecsGrid(form)).toEqual({ power_kw: 22.5, voltage_v: "11kV" });
  });

  it("lowercases keys and collapses duplicate keys to the last submitted value", () => {
    const form = new FormData();
    form.append("spec_key", "Power_KW");
    form.append("spec_value", "20");
    form.append("spec_key", "power_kw");
    form.append("spec_value", "30");
    expect(parseSpecsGrid(form)).toEqual({ power_kw: 30 });
  });

  it("an empty grid saves an empty spec set (full replacement semantics)", () => {
    const form = new FormData();
    form.append("spec_key", "power_kw");
    form.append("spec_value", "");
    expect(parseSpecsGrid(form)).toEqual({});
  });
});

describe("parseComponentGrid (indexed remove checkboxes)", () => {
  it("pairs rows by index and only marks rows whose comp_remove_<i> equals 1", () => {
    const form = new FormData();
    form.append("comp_id", "11111111-1111-1111-1111-111111111111");
    form.append("comp_name", "End seal");
    form.append("comp_tag", "SE-1");
    form.append("comp_kind", "seal");
    form.append("comp_note", "");
    form.append("comp_remove_0", "1");
    form.append("comp_id", "22222222-2222-2222-2222-222222222222");
    form.append("comp_name", "Coupling");
    form.append("comp_tag", "");
    form.append("comp_kind", "coupling");
    form.append("comp_note", "worn");
    // row 1 remove box unchecked → just absent, no index shift
    form.append("comp_id", "");
    form.append("comp_name", "");
    form.append("comp_tag", "");
    form.append("comp_kind", "assembly");
    form.append("comp_note", "");

    const rows = parseComponentGrid(form);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ componentId: "11111111-1111-1111-1111-111111111111", name: "End seal", tag: "SE-1", kind: "seal", remove: true });
    expect(rows[1]).toMatchObject({ componentId: "22222222-2222-2222-2222-222222222222", name: "Coupling", note: "worn", remove: false });
    expect(rows[2]).toMatchObject({ componentId: "", name: "", kind: "assembly", remove: false });
  });
});

describe("rated-specs matrix service", () => {
  it("replaces the whole spec set (removing dropped keys) and audits the key list", async () => {
    const machine = await machineFor(ctx);
    await machinesWriteService.updateRatedSpecs(ctx, machine.id, { power_kw: 22.5, rpm: 1450 });

    const after = await machinesWriteService.updateRatedSpecs(ctx, machine.id, { power_kw: 25 });
    expect(after.ratedSpecs).toEqual({ power_kw: 25 }); // rpm gone

    const audits = await db
      .select({ action: auditLogs.action, diff: auditLogs.diff })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, ctx.orgId), eq(auditLogs.action, "machine.specs_updated")));
    expect(audits).toHaveLength(2);
    expect(audits[1]?.diff).toEqual({ count: 1, keys: ["power_kw"] });
  });

  it("persists ratedSpecs through the general update() too", async () => {
    const machine = await machineFor(ctx);
    const updated = await machinesWriteService.update(ctx, machine.id, { name: machine.name, ratedSpecs: { flow_m3h: 8, head_m: 35 } });
    expect(updated.ratedSpecs).toEqual({ flow_m3h: 8, head_m: 35 });
  });

  it("guards tenancy: another org's ctx cannot touch this machine's specs", async () => {
    const machine = await machineFor(ctx);
    await expect(machinesWriteService.updateRatedSpecs(otherOrgCtx, machine.id, { x: 1 })).rejects.toThrow("machine_not_found");
  });

  it("a maintenance manager may save; viewers are rejected only at the action layer", async () => {
    const machine = await machineFor(ctx);
    const mgrCtx: Ctx = { ...ctx, roles: ["maintenance_manager"] };
    const updated = await machinesWriteService.updateRatedSpecs(mgrCtx, machine.id, { oil_type: "EP2" });
    expect(updated.ratedSpecs).toEqual({ oil_type: "EP2" });
  });
});

describe("BOM components grid service", () => {
  it("adds rows, updates a renamed row with audit, and removes a ticked row", async () => {
    const machine = await machineFor(ctx);
    const a = await componentsService.add(ctx, machine.id, { name: "Drive-end bearing", kind: "bearing_housing" });
    await componentsService.add(ctx, machine.id, { name: "Mechanical seal", tag: "MS-1", kind: "seal", note: "leaking" });

    await componentsService.update(ctx, machine.id, a.id, { name: "DE bearing RENAMED", tag: "DEB-1", kind: "motor", note: "" });
    await componentsService.remove(ctx, machine.id, a.id);

    const left = await componentsService.listForMachine(ctx, machine.id);
    expect(left).toHaveLength(1);
    expect(left[0]?.name).toBe("Mechanical seal");
    expect(left[0]?.note).toBe("leaking");

    const audits = await db
      .select({ action: auditLogs.action, diff: auditLogs.diff })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, ctx.orgId), eq(auditLogs.entityType, "machine"), eq(auditLogs.entityId, machine.id)))
      .then((rows) => rows.filter((r) => r.action === "machine.component_updated" || r.action === "machine.component_removed"));
    expect(audits).toHaveLength(2);
  });

  it("a grid row id that belongs to another machine (or a guessed id) throws, never edits blind", async () => {
    const machine = await machineFor(ctx);
    const stranger = await machineFor(ctx); // same org, different machine
    const comp = await componentsService.add(ctx, machine.id, { name: "Bearing" });

    await expect(componentsService.update(ctx, stranger.id, comp.id, { name: "Hijack" })).rejects.toThrow("component_not_found");
    await expect(componentsService.remove(ctx, stranger.id, comp.id)).rejects.toThrow("component_not_found");
    await expect(componentsService.update(ctx, machine.id, "00000000-0000-0000-0000-000000000000", { name: "Ghost" })).rejects.toThrow("component_not_found");

    // the org cage is absolute: another org's empty plant sees nothing
    await expect(componentsService.listForMachine(otherOrgCtx, machine.id)).resolves.toEqual([]);
  });

  it("partial-grid save: rename two, tick one DEL, leave add-rows blank", async () => {
    const machine = await machineFor(ctx);
    const c1 = await componentsService.add(ctx, machine.id, { name: "Pump end" });
    const c2 = await componentsService.add(ctx, machine.id, { name: "Gland" });

    const form = new FormData();
    const row = (id: string, name: string, kind: string, i: number, remove: string) => {
      form.append("comp_id", id);
      form.append("comp_name", name);
      form.append("comp_tag", "");
      form.append("comp_kind", kind);
      form.append("comp_note", "");
      if (remove === "1") form.append(`comp_remove_${i}`, "1");
    };
    row(c1.id, "Pump end casing", "pump_end", 0, "0");
    row(c2.id, "Gland packing", "seal", 1, "1");
    row("", "", "assembly", 2, "0");

    const rows = parseComponentGrid(form);
    let updated = 0, added = 0, removed = 0;
    for (const r of rows) {
      if (r.componentId && r.remove) { await componentsService.remove(ctx, machine.id, r.componentId); removed++; }
      else if (r.componentId && r.name) { await componentsService.update(ctx, machine.id, r.componentId, { name: r.name, kind: r.kind, tag: r.tag || null, note: r.note || null }); updated++; }
      else if (!r.componentId && r.name) { await componentsService.add(ctx, machine.id, { name: r.name, kind: r.kind }); added++; }
    }
    expect({ updated, added, removed }).toEqual({ updated: 1, added: 0, removed: 1 });
    const left = await componentsService.listForMachine(ctx, machine.id);
    expect(left.map((l) => l.name)).toEqual(["Pump end casing"]);
  });
});

describe("grid of components against the listings helper", () => {
  it("keeps list deterministic by name order", async () => {
    const machine = await machineFor(ctx);
    await componentsService.add(ctx, machine.id, { name: "Zebra coupling" });
    await componentsService.add(ctx, machine.id, { name: "Alpha seal" });
    const list = await componentsService.listForMachine(ctx, machine.id);
    expect(list.map((l) => l.name)).toEqual(["Alpha seal", "Zebra coupling"]);
  });
});
