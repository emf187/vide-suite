import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { purchasesService, PURCHASE_PLANS } from "@/server/services/purchase";
import { purchaseLedger, purchases } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { resolvePaystackMode } from "@/lib/payments/paystack";

let db: AppDb;
let ctx: Ctx;
let otherOrgCtx: Ctx;

/** capture + restore the paystack env keys so tests never leak config */
const beforeEnv: Record<string, string> = {};
const ENV_VARS = ["PAYSTACK_SECRET_KEY", "PAYSTACK_API_BASE"];
function captureEnv(): void {
  for (const name of ENV_VARS) if (name in process.env) beforeEnv[name] = process.env[name] as string;
}
function clearEnv(): void {
  for (const name of ENV_VARS) delete process.env[name];
}

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);
  captureEnv();
  clearEnv();

  const org = await orgsRepo.create(db, { name: "Buyer Plant", slug: `buy-${testId()}` });
  const mkUser = async (name: string, role: "owner" | "viewer") => {
    const u = await usersRepo.create(db, { name, email: `${name}-${testId()}@x.io`, passwordHash: "x" });
    await membershipsRepo.create(db, { organizationId: org.id, userId: u.id, role });
    return u;
  };
  const owner = await mkUser("Owner B", "owner");

  const base = { userId: owner.id, email: owner.email, name: owner.name, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos" };
  ctx = { ...base, roles: ["owner"] };

  const org2 = await orgsRepo.create(db, { name: "NoBuy Plant", slug: `nobuy-${testId()}` });
  const otherOwner = await usersRepo.create(db, { name: "Owner N", email: `n-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org2.id, userId: otherOwner.id, role: "owner" });
  otherOrgCtx = { ...base, userId: otherOwner.id, email: otherOwner.email, name: otherOwner.name, orgId: org2.id, orgSlug: org2.slug, orgName: org2.name, roles: ["owner"] };
});

afterEach(() => {
  for (const key of ["PAYSTACK_SECRET_KEY", "PAYSTACK_API_BASE"]) {
    if (key in beforeEnv) process.env[key] = beforeEnv[key];
    else delete process.env[key];
  }
  __resetDbForTests();
});

describe("paystack mode resolution (test keys only, by design)", () => {
  it("demo without a key, test mode for sk_test_, refusal for live/unrecognized", () => {
    expect(resolvePaystackMode(undefined)).toEqual({ mode: "demo", reason: "no_key" });
    expect(resolvePaystackMode("")).toEqual({ mode: "demo", reason: "no_key" });
    const test = resolvePaystackMode("sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(test.mode).toBe("paystack_test");
    if (test.mode === "paystack_test") expect(test.keyMasked).not.toContain("aaaaaaaa");
    expect(resolvePaystackMode("sk_live_really")).toEqual({ mode: "refused", reason: "live_or_unrecognized_key" });
    expect(resolvePaystackMode("garbage")).toEqual({ mode: "refused", reason: "live_or_unrecognized_key" });
  });

  it("the refused key also refuses the service from starting anything", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_live_really";
    expect(() => purchasesService.mode()).not.toThrow();
    expect(purchasesService.mode().mode).toBe("refused");
    await expect(purchasesService.start(ctx, "pro_monthly", ctx.email)).rejects.toThrow("paystack_key_refused");
  });
});

describe("demo-mode purchase flow (built-in fake ledger)", () => {
  it("starts from the catalog only (form amounts can never win), routes to the fake checkout", async () => {
    const { purchase, checkoutUrl } = await purchasesService.start(ctx, "pro_monthly", ctx.email);
    expect(purchase.status).toBe("initiated");
    expect(purchase.channel).toBe("demo");
    expect(purchase.amountKobo).toBe(5_000_000); // ₦50,000 plan, kobo — always from the catalog
    expect(purchase.providerReference).toBeNull();
    expect(checkoutUrl).toBe(`/purchase/demo/${purchase.id}`);

    await expect(purchasesService.start(ctx, "not_a_plan", ctx.email)).rejects.toThrow("unknown_plan");
  });

  it("confirm marks paid on the fake ledger; decline marks failed; both are audited and trailed", async () => {
    const { purchase } = await purchasesService.start(ctx, "pilot_90", ctx.email);
    const paid = await purchasesService.confirmDemo(ctx, purchase.id);
    expect(paid.status).toBe("paid");

    const second = await purchasesService.start(ctx, "pilot_90", ctx.email);
    const failed = await purchasesService.failDemo(ctx, second.purchase.id);
    expect(failed.status).toBe("failed");

    const events = await db
      .select({ event: purchaseLedger.event })
      .from(purchaseLedger)
      .where(eq(purchaseLedger.purchaseId, purchase.id));
    expect(events.map((e) => e.event)).toEqual(["initiated", "confirmed"]);

    const statuses = await db
      .select({ status: purchases.status })
      .from(purchases)
      .where(eq(purchases.organizationId, ctx.orgId))
      .orderBy(purchases.createdAt);
    expect(statuses.map((s) => s.status)).toEqual(["paid", "failed"]);
  });

  it("double-confirm is refused; paystack_test rows can never be confirmed locally", async () => {
    const { purchase } = await purchasesService.start(ctx, "pro_annual", ctx.email);
    await purchasesService.confirmDemo(ctx, purchase.id);
    await expect(purchasesService.confirmDemo(ctx, purchase.id)).rejects.toThrow("not_pending:paid");

    process.env.PAYSTACK_SECRET_KEY = "sk_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    process.env.PAYSTACK_API_BASE = "http://127.0.0.1:9"; // unreachable on purpose → honest failure, no real network
    const { purchase: foreign, checkoutUrl } = await purchasesService.start(ctx, "pro_monthly", ctx.email);
    expect(checkoutUrl).toBeNull(); // initialize cannot run in tests → honest failure
    expect(foreign.channel).toBe("paystack_test");
    await expect(purchasesService.confirmDemo(ctx, foreign.id)).rejects.toThrow("not_a_demo_purchase");
  });

  it("abandon closes a pending row; resolved rows refuse abandonment", async () => {
    const { purchase } = await purchasesService.start(ctx, "pro_monthly", ctx.email);
    const abandoned = await purchasesService.abandon(ctx, purchase.id);
    expect(abandoned.status).toBe("abandoned");
    await expect(purchasesService.abandon(ctx, purchase.id)).rejects.toThrow("not_pending:abandoned");
  });

  it("check() on a demo purchase is a no-op read; tenancy hides foreign purchases", async () => {
    const { purchase } = await purchasesService.start(ctx, "pro_monthly", ctx.email);
    const checked = await purchasesService.check(ctx, purchase.id);
    expect(checked.purchase.status).toBe("initiated");

    await expect(purchasesService.byId(otherOrgCtx, purchase.id)).resolves.toBeNull();
    await expect(purchasesService.confirmDemo(otherOrgCtx, purchase.id)).rejects.toThrow("purchase_not_found");
    await expect(purchasesService.eventsFor(otherOrgCtx, purchase.id)).resolves.toEqual([]);
  });

  it("listing is org-scoped and newest first", async () => {
    const a = await purchasesService.start(ctx, "pro_monthly", ctx.email);
    const b = await purchasesService.start(ctx, "pilot_90", ctx.email);
    const list = await purchasesService.listForOrg(ctx);
    expect(list.map((p) => p.planKey)).toEqual([b.purchase.planKey, a.purchase.planKey]);
    expect((await purchasesService.listForOrg(otherOrgCtx)).map((p) => p.planKey)).toEqual([]);
  });

  it("the catalog is the pricing truth and stays demo-flavored", () => {
    expect(PURCHASE_PLANS.length).toBeGreaterThanOrEqual(2);
    for (const plan of PURCHASE_PLANS) {
      expect(plan.nairaAmount).toBeGreaterThan(0);
      expect(plan.key).toMatch(/^[a-z0-9_]+$/);
    }
  });
});
