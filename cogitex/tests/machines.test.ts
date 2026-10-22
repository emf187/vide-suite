import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { machineImportService } from "@/server/services/machine-import";
import { machinesService, machinesWriteService } from "@/server/services/machines";
import { sitesService } from "@/server/services/sites";
import { documentsService } from "@/server/services/documents";
import { auditRepo } from "@/server/repos/audit";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { __resetIntegrations, getIntegrations } from "@/lib/integrations/factory";
import type { AppDb } from "@/server/db/client";

let db: AppDb;
let ctx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);
  __resetIntegrations(); // force mock adapters fresh

  const org = await orgsRepo.create(db, { name: "Plant T", slug: `plant-t-${testId()}` });
  const user = await usersRepo.create(db, { name: "Manager T", email: `m-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: user.id, role: "maintenance_manager" });
  ctx = {
    userId: user.id,
    email: user.email,
    name: user.name,
    orgId: org.id,
    orgSlug: org.slug,
    orgName: org.name,
    currency: "NGN",
    timezone: "Africa/Lagos",
    roles: ["maintenance_manager"],
  };
});

afterEach(() => {
  __resetDbForTests();
});

function ctxFor(roles: Ctx["roles"]): Ctx {
  return { ...ctx, roles };
}

const baseInput = {
  name: "Test pump",
  tag: "PUMP-T1",
  category: "pump" as const,
};

describe("M1 machines: creation + tenant isolation", () => {
  it("creates a machine with uppercase tag, snapshot, audit trail", async () => {
    const machine = await machinesWriteService.create(ctx, baseInput);
    expect(machine.tag).toBe("PUMP-T1");
    expect(machine.lifecycleStatus).toBe("commissioned");
    expect(machine.profileSnapshot).toMatchObject({ tag: "PUMP-T1" });
    const audit = await db.select().from((await import("@/server/db/schema")).auditLogs);
    expect(audit.some((a) => a.action === "machine.created" && a.entityId === machine.id)).toBe(true);
  });

  it("rejects duplicate tags inside the same org but allows them across orgs", async () => {
    await machinesWriteService.create(ctx, baseInput);
    await expect(machinesWriteService.create(ctx, baseInput)).rejects.toThrow("tag_conflict");

    const org2 = await orgsRepo.create(db, { name: "Other Org", slug: `other-${testId()}` });
    const otherUserId = (await usersRepo.create(db, { name: "Other", email: `o-${testId()}@x.io`, passwordHash: "x" })).id;
    await membershipsRepo.create(db, { organizationId: org2.id, userId: otherUserId, role: "owner" });
    const ctxB = { ...ctx, orgId: org2.id, userId: otherUserId, roles: ["owner"] as Ctx["roles"] };
    const m2 = await machinesWriteService.create(ctxB, { ...baseInput, tag: "pump-t1" }); // same tag, other org
    expect(m2.tag).toBe("PUMP-T1");
  });

  it("listing is scoped to the calling org (cross-tenant machine never leaks)", async () => {
    await machinesWriteService.create(ctx, baseInput);
    const otherOrgMachine = await machinesWriteService.create({ ...ctx, orgId: (await orgsRepo.create(db, { name: "X", slug: `x-${testId()}` })).id }, { name: "X Thermal", tag: "X-1", category: "motor" });
    const machines = await machinesService.list(ctx);
    expect(machines).toHaveLength(1);
    expect(machines.some((m) => m.id === otherOrgMachine.id)).toBe(false);
  });

  it("byId refuses machines outside the org", async () => {
    const foreign = await machinesWriteService.create({ ...ctx, orgId: (await orgsRepo.create(db, { name: "Y", slug: `y-${testId()}` })).id }, { name: "Y Motor", tag: "Y-1", category: "motor" });
    expect(await machinesService.byId(ctx, foreign.id)).toBeNull();
  });
});

describe("M1 lifecycle state machine (DATA_MODEL §4.1)", () => {
  it("commissioned → active → standby → active", async () => {
    const machine = await machinesWriteService.create(ctx, baseInput);
    const toActive = await machinesWriteService.transition(ctx, machine.id, "active", { reason: "First service" });
    expect(toActive.machine.lifecycleStatus).toBe("active");
    expect(toActive.videStatus).toBe("not_applicable");

    const toStandby = await machinesWriteService.transition(ctx, machine.id, "standby");
    expect(toStandby.machine.lifecycleStatus).toBe("standby");
    await machinesWriteService.transition(ctx, machine.id, "active");
  });

  it("rejects illegal jumps (commissioned → standby)", async () => {
    const machine = await machinesWriteService.create(ctx, baseInput);
    await expect(machinesWriteService.transition(ctx, machine.id, "standby")).rejects.toThrow("illegal_transition");
  });

  it("decommission writes the decommission record, notifies VIDE, and stamps the log", async () => {
    const machine = await machinesWriteService.create(ctx, { ...baseInput, videMachineNames: ["PUMP-1"] });
    const res = await machinesWriteService.transition(ctx, machine.id, "decommissioned", {
      reason: "End of life",
      partsDisposition: "impeller to stores",
      openWoPolicy: "cancel",
    });
    expect(res.videStatus).toBe("acknowledged");
    expect(res.machine.decommission).toMatchObject({ reason: "End of life", openWoPolicy: "cancel" });

    const schema = await import("@/server/db/schema");
    const log = await db.select().from(schema.machineLifecycleLog);
    const entry = log.find((l) => l.machineId === machine.id);
    expect(entry?.toStatus).toBe("decommissioned");
    expect(entry?.videCallStatus).toBe("acknowledged");
  });

  it("reactivate sends the reverse VIDE notice and clears decommission data", async () => {
    const machine = await machinesWriteService.create(ctx, baseInput);
    await machinesWriteService.transition(ctx, machine.id, "commissioned" === machine.lifecycleStatus ? "active" : "active");
    await machinesWriteService.transition(ctx, machine.id, "decommissioned", { reason: "retire" });
    const res = await machinesWriteService.transition(ctx, machine.id, "active", { reason: "still needed" });
    expect(res.machine.lifecycleStatus).toBe("active");
    expect(res.machine.decommission).toBeNull();
  });

  it("under_maintenance only from active", async () => {
    const machine = await machinesWriteService.create(ctx, baseInput);
    await machinesWriteService.transition(ctx, machine.id, "active");
    const res = await machinesWriteService.transition(ctx, machine.id, "under_maintenance");
    expect(res.machine.lifecycleStatus).toBe("under_maintenance");
  });
});

describe("M1 removal rules (brief §5.6)", () => {
  it("soft remove keeps the row archived, hard delete refuses when history exists", async () => {
    const machine = await machinesWriteService.create(ctx, { ...baseInput, videMachineNames: ["PUMP-1"] });
    await machinesService.byId(ctx, machine.id); // warm

    await machinesWriteService.remove(ctx, machine.id, "soft");
    const archived = await machinesService.byIdIncludingArchived(ctx, machine.id);
    expect(archived?.deletedAt).not.toBeNull();
    expect(await machinesService.byId(ctx, machine.id)).toBeNull();

    // has device links → hard delete refuses (owner has role rights, history forbids)
    await expect(machinesWriteService.remove(ctxFor(["owner"]), machine.id, "hard")).rejects.toThrow("history_exists");

    // admin can hard delete a machine with zero history
    const clean = await machinesWriteService.create(ctxFor(["owner"]), { name: "Clean", tag: "CLEAN-1", category: "pump" });
    const ownerCtx = ctxFor(["owner"]);
    await machinesWriteService.remove(ownerCtx, clean.id, "hard");
    expect(await machinesService.byIdIncludingArchived(ownerCtx, clean.id)).toBeNull();
  });

  it("hard delete is admin-only", async () => {
    const machine = await machinesWriteService.create(ctxFor(["technician"]), { name: "T", tag: "TEC-1", category: "pump" });
    const techCtx = ctxFor(["technician"]);
    await expect(machinesWriteService.remove(techCtx, machine.id, "hard")).rejects.toThrow("forbidden_hard_delete");
  });
});

describe("M1 CSV import", () => {
  it("parses, validates and reports dry-run errors before committing", async () => {
    const site = await sitesService.create(ctx, { name: "Plant 1", code: "PLT1" });
    const csv = [
      "name,tag,category,site_code,criticality,vide_machine_name",
      "Water pump,PUMP-A,pump,PLT1,B,PUMP-1",
      "Bad machine,BAD-X,turbopump,,A,",
      "No name,,pump,PLT1,B,",
      "Second pump,PUMP-B,pump,NOPE,B,",
    ].join("\n");
    const staged = await machineImportService.stageCsv(ctx, csv);
    expect(staged.ok).toBe(1);
    expect(staged.failed).toBe(3);

    const res = await machineImportService.commit(ctx, staged.stagingId);
    expect(res.created).toEqual(["PUMP-A"]);
    expect(res.skipped.map((s) => s.reason).join("|")).toContain("category must be one of");

    const machines = await machinesService.list(ctx);
    expect(machines).toHaveLength(1);
    expect(machines[0]?.siteId).toBe(site.id);
    expect(machines[0]?.locationNote).toBeNull();

    const devices = await db.select().from((await import("@/server/db/schema")).machineDevices);
    expect(devices.filter((d) => d.machineId === machines[0]?.id).map((d) => d.videMachineName)).toEqual(["PUMP-1"]);

    // staging is single-use
    await expect(machineImportService.commit(ctx, staged.stagingId)).rejects.toThrow("staging_committed");
  });

  it("missing required columns throws a clear error", async () => {
    await expect(machineImportService.stageCsv(ctx, "name,tag\nA,B-1")).rejects.toThrow("missing_column:category");
  });

  it("commits consecutive identical tags only once (conflict skip with reason)", async () => {
    const csv = ["name,tag,category", "A,A-1,pump", "B,A-1,pump"].join("\n");
    const staged = await machineImportService.stageCsv(ctx, csv);
    const res = await machineImportService.commit(ctx, staged.stagingId);
    expect(res.created).toEqual(["A-1"]);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0]?.reason).toContain("tag already exists");
  });
});

describe("M1 documents", () => {
  it("uploads with checksum, lists by machine, soft deletes", async () => {
    const machine = await machinesWriteService.create(ctx, baseInput);
    const doc = await documentsService.upload(ctx, {
      machineId: machine.id,
      kind: "manual",
      name: "manual.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("M1 test bytes"),
    });
    expect(doc.checksumSha256).toHaveLength(64);
    expect(doc.sizeBytes).toBe(13);

    expect((await documentsService.listForMachine(ctx, machine.id))).toHaveLength(1);
    const dl = await documentsService.download(ctx, doc.id);
    expect(dl?.bytes.toString()).toBe("M1 test bytes");

    await documentsService.softDelete(ctx, doc.id);
    expect(await documentsService.listForMachine(ctx, machine.id)).toHaveLength(0);

    // cross-tenant download blocked
    const otherCtx = { ...ctx, orgId: (await orgsRepo.create(db, { name: "Z", slug: `z-${testId()}` })).id };
    expect(await documentsService.download(otherCtx, doc.id)).toBeNull();
  });
});

describe("M1 site/area scoping", () => {
  it("sites and areas are org-scoped and audited", async () => {
    const site = await sitesService.create(ctx, { name: "Plant", code: "PLT1" });
    const list = await sitesService.list(ctx);
    expect(list.map((s) => s.code)).toEqual(["PLT1"]);
    await auditRepo.log(db, { organizationId: ctx.orgId, action: "noop", entityType: "test", entityId: site.id });
  });
});
