import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { machinesWriteService } from "@/server/services/machines";
import { workOrderWriteService } from "@/server/services/work-orders";
import { inventoryService, inventoryWriteService, partsCostKobo } from "@/server/services/inventory";
import { inventoryItems, inventoryReservations, stockLedger } from "@/server/db/schema";
import type { AppDb } from "@/server/db/client";

let db: AppDb;
let ctx: Ctx;
let techCtx: Ctx;
let viewerCtx: Ctx;
let otherOrgCtx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);

  const org = await orgsRepo.create(db, { name: "Store Plant", slug: `store-${testId()}` });
  const mk = async (name: string, role: "owner" | "technician" | "viewer" | "maintenance_manager") => {
    const u = await usersRepo.create(db, { name, email: `${name}-${testId()}@x.io`, passwordHash: "x" });
    await membershipsRepo.create(db, { organizationId: org.id, userId: u.id, role });
    return u;
  };
  const owner = await mk("Store Owner", "owner");
  const tech = await mk("Store Tech", "technician");
  const viewer = await mk("Store Viewer", "viewer");
  const outsider = await mk("Outsider", "owner");

  const org2 = await orgsRepo.create(db, { name: "Other Plant", slug: `store2-${testId()}` });
  await membershipsRepo.create(db, { organizationId: org2.id, userId: outsider.id, role: "owner" });

  const base = { userId: owner.id, email: owner.email, name: owner.name, endDate: undefined, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos" } as unknown as Ctx;
  ctx = { ...base, roles: ["owner"] };
  techCtx = { ...base, userId: tech.id, roles: ["technician"] } as Ctx;
  viewerCtx = { ...base, userId: viewer.id, roles: ["viewer"] } as Ctx;
  otherOrgCtx = { ...base, userId: outsider.id, orgId: org2.id, orgSlug: org2.slug, orgName: org2.name, roles: ["owner"] } as Ctx;
});

afterEach(() => {
  __resetDbForTests();
});

async function item(input: Partial<Parameters<typeof inventoryWriteService.createItem>[1]> = {}) {
  return inventoryWriteService.createItem(ctx, {
    sku: `SKU-${testId()}`,
    name: "Deep-groove bearing 6205 2RS",
    catalogry: undefined,
    ...input,
  } as never);
}

describe("M3 inventory: items + opening stock", () => {
  it("managers create items; viewers and techs cannot", async () => {
    const created = await item();
    expect(created.sku).toContain("SKU-");
    await expect(inventoryWriteService.createItem(techCtx, { sku: "S", name: "N" })).rejects.toThrow("forbidden:inventory.manage");
    await expect(inventoryWriteService.createItem(viewerCtx, { sku: "S", name: "N" })).rejects.toThrow("forbidden:inventory.manage");
  });

  it("rejects duplicate SKU inside the org but allows the same SKU in another org", async () => {
    const a = await item({ sku: "BRG-6205" });
    await expect(item({ sku: "BRG-6205" })).rejects.toThrow("sku_taken");
    const b = await inventoryWriteService.createItem(otherOrgCtx, { sku: "BRG-6205", name: "Same code other plant" });
    expect(b.id).not.toBe(a.id);
  });

  it("opening quantity is booked as a receipt so the ledger explains every unit", async () => {
    const it = await item({ sku: "OIL-20L", qtyOnHand: 12 });
    const on = await db.select().from(inventoryItems);
    const row = on.find((r) => r.id === it.id);
    expect(Number(row?.qtyOnHand)).toBe(12);
    const ledger = await inventoryService.ledger(ctx, it.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.kind).toBe("receipt");
    expect(Number(ledger[0]?.balanceAfter)).toBe(12);
  });

  it("tenancy: items never leak across orgs", async () => {
    const mine = await item();
    const foreign = await inventoryWriteService.createItem(otherOrgCtx, { sku: "F-1", name: "Foreign item" });

    expect(await inventoryService.byId(ctx, mine.id)).not.toBeNull();
    expect(await inventoryService.byId(ctx, foreign.id)).toBeNull();
    const foreignList = await inventoryService.list(otherOrgCtx);
    expect(foreignList.find((i) => i.id === mine.id)).toBeUndefined();
  });
});

describe("M3 inventory: ledger movements", () => {
  it("receive grows stock, records cost, and appends the running balance", async () => {
    const it = await item({ sku: "SEAL-50", qtyOnHand: 4 });
    await inventoryWriteService.receive(ctx, it.id, { qty: 10, unitCostKobo: 150000, reference: "PO-77" });
    const row = (await db.select().from(inventoryItems).where(eq(inventoryItems.id, it.id)))[0];
    expect(Number(row?.qtyOnHand)).toBe(14);
    expect(row?.unitCostKobo).toBe(150000);
    const ledger = await inventoryService.ledger(ctx, it.id);
    expect(
      ledger.map((l) => `${l.kind}:${Number(l.qty)}@${Number(l.balanceAfter)}`),
    ).toEqual(["receipt:10@14", "receipt:4@4"]);
  });

  it("issues cannot exceed on-hand; the good path books negatives and a card line", async () => {
    const it = await item({ sku: "SEAL-51", qtyOnHand: 5, unitCostKobo: 100000 });
    const machine = await machinesWriteService.create(ctx, { name: "Seal pump", tag: "SEAL-1", category: "pump" });
    const wo = await workOrderWriteService.create(ctx, { title: "Seal job", type: "corrective", priority: "normal", machineId: machine.id });

    await expect(inventoryWriteService.issueToWorkOrder(ctx, it.id, wo.id, { qty: 6 })).rejects.toThrow("insufficient_stock:5");
    await expect(inventoryWriteService.issueToWorkOrder(viewerCtx, it.id, wo.id, { qty: 1 })).rejects.toThrow("forbidden:wo.execute");

    await inventoryWriteService.issueToWorkOrder(techCtx, it.id, wo.id, { qty: 2, note: "old seal out" });
    const row = (await db.select().from(inventoryItems).where(eq(inventoryItems.id, it.id)))[0];
    expect(Number(row?.qtyOnHand)).toBe(3);

    const ledger = await inventoryService.ledger(ctx, it.id);
    const issue = ledger.find((l) => l.kind === "issue");
    expect(Number(issue?.qty)).toBe(-2);
    expect(issue?.workOrderId).toBe(wo.id);

    const parts = await inventoryService.partsForWorkOrder(ctx, wo.id);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.name).toContain(it.sku);
    expect(parts[0]?.unitCostKobo).toBe(100000);

    // parts cost lands in the card rollup: 2 Ã— â‚¦1,000 = â‚¦2,000 = 200,000 kobo
    expect(await partsCostKobo(ctx, wo.id)).toBe(200000);
  });

  it("cycle-count adjust writes a signed delta and demands a reason", async () => {
    const it = await item({ sku: "CNT-1", qtyOnHand: 10 });
    await expect(inventoryWriteService.adjustToCount(ctx, it.id, { newQty: 9, reason: "" })).rejects.toThrow("reason_required:adjust");
    await expect(inventoryWriteService.adjustToCount(ctx, it.id, { newQty: 10, reason: "no change" })).rejects.toThrow("no_change");
    await inventoryWriteService.adjustToCount(ctx, it.id, { newQty: 8, reason: "physical count" });
    const ledger = await inventoryService.ledger(ctx, it.id);
    expect(ledger[0]?.kind).toBe("adjust");
    expect(Number(ledger[0]?.qty)).toBe(-2);
    expect(Number(ledger[0]?.balanceAfter)).toBe(8);
  });
});

describe("M3 inventory: reservations", () => {
  it("availability subtracts open reservations; over-reserving is refused", async () => {
    const it = await item({ sku: "RSV-1", qtyOnHand: 5 });
    const machine = await machinesWriteService.create(ctx, { name: "Rsv pump", tag: "RSV-1", category: "pump" });
    const wo = await workOrderWriteService.create(ctx, { title: "Reserve job", type: "corrective", priority: "normal", machineId: machine.id });

    await inventoryWriteService.reserve(ctx, it.id, wo.id, { qty: 3 });
    let avail = await inventoryService.availability(ctx, it.id);
    expect(avail).toEqual({ onHand: 5, reserved: 3, available: 2 });

    await expect(inventoryWriteService.reserve(ctx, it.id, wo.id, { qty: 3 })).rejects.toThrow("insufficient_available:2");

    // releasing frees the promise again
    const reservations = await inventoryService.reservationsForWorkOrder(ctx, wo.id);
    await inventoryWriteService.cancelReservation(ctx, reservations[0]?.id ?? "missing");
    avail = await inventoryService.availability(ctx, it.id);
    expect(avail.available).toBe(5);
  });

  it("issuing to a card fulfils its oldest reservation and the balance keeps the ledger honest", async () => {
    const it = await item({ sku: "RSV-2", qtyOnHand: 4, unitCostKobo: 50000 });
    const machine = await machinesWriteService.create(ctx, { name: "Rsv2 pump", tag: "RSV-2", category: "pump" });
    const wo = await workOrderWriteService.create(ctx, { title: "Reserve2 job", type: "corrective", priority: "normal", machineId: machine.id });

    await inventoryWriteService.reserve(ctx, it.id, wo.id, { qty: 2 });
    await inventoryWriteService.issueToWorkOrder(ctx, it.id, wo.id, { qty: 2 });

    const rows = await db.select().from(inventoryReservations);
    expect(rows.filter((r) => r.status === "issued")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "open")).toHaveLength(0);

    const avail = await inventoryService.availability(ctx, it.id);
    expect(avail.onHand).toBe(2);
    expect(avail.reserved).toBe(0);
  });

  it("concluding a work order voids open reservations (promises never issued go back)", async () => {
    const it = await item({ sku: "RSV-3", qtyOnHand: 2 });
    const machine = await machinesWriteService.create(ctx, { name: "Rsv3 pump", tag: "RSV-3", category: "pump" });
    const wo = await workOrderWriteService.create(ctx, { title: "Reserve3 job", type: "corrective", priority: "normal", machineId: machine.id });

    await inventoryWriteService.reserve(ctx, it.id, wo.id, { qty: 2 });
    await workOrderWriteService.transition(ctx, wo.id, "cancelled", { reason: "job scrapped" });

    const avail = await inventoryService.availability(ctx, it.id);
    expect(avail.onHand).toBe(2);
    expect(avail.reserved).toBe(0);
    expect(avail.available).toBe(2);
  });

  it("tenancy: reservations and ledger stay inside the org", async () => {
    const it = await item({ sku: "RSV-4", qtyOnHand: 3 });
    const machine = await machinesWriteService.create(ctx, { name: "Rsv4", tag: "RSV-4", category: "pump" });
    const wo = await inventoryWriteService;
    void wo;
    const other = await machinesWriteService.create(otherOrgCtx, { name: "Other", tag: "OTHER-1", category: "pump" });
    const otherWo = await workOrderWriteService.create(otherOrgCtx, { title: "Foreign job", type: "corrective", priority: "low", machineId: other.id });
    await expect(inventoryWriteService.reserve(otherOrgCtx, it.id, otherWo.id, { qty: 1 })).rejects.toThrow("item_not_found");
    const ledger = await inventoryService.ledger(otherOrgCtx, it.id);
    expect(ledger).toHaveLength(0);
  });
});
