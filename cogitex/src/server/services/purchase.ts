import { and, desc, eq } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb, type AppDb } from "@/server/db/client";
import { purchaseLedger, purchases, type Purchase } from "@/server/db/schema";
import { auditRepo } from "@/server/repos/audit";
import { nairaToKobo } from "@/lib/money";
import {
  initializeTransaction,
  resolvePaystackMode,
  verifyTransaction,
  type PaystackMode,
} from "@/lib/payments/paystack";

/* ------------------------------ demo catalog ------------------------------ */

/**
 * The demo plans. Amounts ALWAYS come from this catalog — a form could never
 * influence what a purchase charges, even in test mode.
 */
export const PURCHASE_PLANS = [
  {
    key: "pro_monthly",
    name: "PRO — monthly",
    description: "Full suite features for one plant, billed monthly.",
    nairaAmount: 50_000,
  },
  {
    key: "pro_annual",
    name: "PRO — annual",
    description: "Full suite features for one plant, billed annually (2 months free).",
    nairaAmount: 500_000,
  },
  {
    key: "pilot_90",
    name: "PILOT 90",
    description: "90-day pilot pack for one site, shared with our engineers.",
    nairaAmount: 25_000,
  },
] as const;

export type PlanDef = (typeof PURCHASE_PLANS)[number];

export function planByKey(key: string): PlanDef | undefined {
  return PURCHASE_PLANS.find((p) => p.key === key);
}

/* -------------------------------- service -------------------------------- */

function paystackKey(): string {
  return (process.env.PAYSTACK_SECRET_KEY ?? "").trim();
}

async function addEvent(
  db: AppDb,
  ctx: Ctx,
  purchaseId: string,
  event: string,
  detail?: unknown,
): Promise<void> {
  await db.insert(purchaseLedger).values({
    organizationId: ctx.orgId,
    purchaseId,
    event,
    detail: detail ?? null,
    actorUserId: ctx.userId,
  });
}

export const purchasesService = {
  /** Resolved paystack mode for the demo banner (masked key, never the raw one). */
  mode(): PaystackMode {
    return resolvePaystackMode(paystackKey());
  },

  async listForOrg(ctx: Ctx, limit = 25): Promise<Purchase[]> {
    const db = await getDb();
    return db
      .select()
      .from(purchases)
      .where(eq(purchases.organizationId, ctx.orgId))
      .orderBy(desc(purchases.createdAt))
      .limit(limit);
  },

  /** Org- and tenant-safe byId: another org's purchase reads as not found. */
  async byId(ctx: Ctx, purchaseId: string): Promise<Purchase | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(purchases)
      .where(and(eq(purchases.organizationId, ctx.orgId), eq(purchases.id, purchaseId)))
      .limit(1);
    return rows[0] ?? null;
  },

  async eventsFor(ctx: Ctx, purchaseId: string) {
    const db = await getDb();
    return db
      .select()
      .from(purchaseLedger)
      .where(and(eq(purchaseLedger.organizationId, ctx.orgId), eq(purchaseLedger.purchaseId, purchaseId)))
      .orderBy(purchaseLedger.at, purchaseLedger.id);
  },

  /**
   * Start a purchase against a CATALOG PLAN (amounts never come from forms).
   * demo channel → internal fake checkout; paystack_test → real TEST-mode
   * initialize and the provider's own hosted checkout page.
   */
  async start(
    ctx: Ctx,
    planKey: string,
    email: string,
  ): Promise<{ purchase: Purchase; checkoutUrl: string | null; error?: string }> {
    const plan = planByKey(planKey);
    if (!plan) throw new Error("unknown_plan");
    const db = await getDb();

    const mode = this.mode();
    if (mode.mode === "refused") {
      throw new Error(mode.reason === "live_or_unrecognized_key" ? "paystack_key_refused" : "paystack_unavailable");
    }
    const channel: "demo" | "paystack_test" = mode.mode === "paystack_test" ? "paystack_test" : "demo";

    const inserted = await db
      .insert(purchases)
      .values({
        organizationId: ctx.orgId,
        userId: ctx.userId,
        planKey: plan.key,
        planName: plan.name,
        amountKobo: nairaToKobo(plan.nairaAmount),
        currency: "NGN",
        status: "initiated",
        channel,
      })
      .returning();
    const purchase = inserted[0];
    if (!purchase) throw new Error("purchase insert returned no rows");
    await addEvent(db, ctx, purchase.id, "initiated", { channel, mode: mode.mode === "paystack_test" ? mode.keyMasked : "demo" });
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "purchase.started",
      entityType: "purchase",
      entityId: purchase.id,
      diff: { plan: plan.key, amountKobo: purchase.amountKobo, channel },
    });

    if (channel === "demo") {
      return { purchase, checkoutUrl: `/purchase/demo/${purchase.id}` };
    }

    const init = await initializeTransaction(paystackKey(), {
      reference: purchase.id, // globally-unique from day one; the callback page trusts OUR row
      amountKobo: purchase.amountKobo,
      email,
      metadata: { purchaseId: purchase.id, orgSlug: ctx.orgSlug, plan: plan.key, demo: "true" },
    });
    if (!init.ok) {
      await db
        .update(purchases)
        .set({ status: "failed", payload: { provider: "paystack", stage: "initialize", error: init.error }, updatedAt: new Date() })
        .where(eq(purchases.id, purchase.id));
      await addEvent(db, ctx, purchase.id, "failed", { stage: "initialize", error: init.error });
      return { purchase, checkoutUrl: null, error: init.error };
    }
    await db
      .update(purchases)
      .set({ status: "awaiting_confirmation", providerReference: init.reference, payload: { provider: "paystack", checkoutUrl: init.checkoutUrl }, updatedAt: new Date() })
      .where(eq(purchases.id, purchase.id));
    await addEvent(db, ctx, purchase.id, "checkout_opened", { reference: init.reference, provider: "paystack_test" });
    return { purchase, checkoutUrl: init.checkoutUrl };
  },

  /**
   * DEMO path only: confirm the fake checkout. A paystack_test purchase can
   * never be confirmed locally — truth comes from the provider's verify.
   */
  async confirmDemo(ctx: Ctx, purchaseId: string): Promise<Purchase> {
    const db = await getDb();
    const purchase = await this.byId(ctx, purchaseId);
    if (!purchase) throw new Error("purchase_not_found");
    if (purchase.channel !== "demo") throw new Error("not_a_demo_purchase");
    if (purchase.status !== "initiated") throw new Error(`not_pending:${purchase.status}`);
    const updated = await db
      .update(purchases)
      .set({ status: "paid", payload: { demoCheckout: "confirmed_on_fake_checkout" }, updatedAt: new Date() })
      .where(eq(purchases.id, purchase.id))
      .returning();
    const next = updated[0];
    if (!next) throw new Error("confirm returned no rows");
    await addEvent(db, ctx, purchase.id, "confirmed", { mode: "fake" });
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "purchase.paid",
      entityType: "purchase",
      entityId: purchase.id,
      diff: { mode: "fake", plan: purchase.planKey, amountKobo: purchase.amountKobo },
    });
    return next;
  },

  /** Force-fail the DEMO path (simulates a declined card on the fake checkout). */
  async failDemo(ctx: Ctx, purchaseId: string): Promise<Purchase> {
    const db = await getDb();
    const purchase = await this.byId(ctx, purchaseId);
    if (!purchase) throw new Error("purchase_not_found");
    if (purchase.channel !== "demo") throw new Error("not_a_demo_purchase");
    if (purchase.status !== "initiated") throw new Error(`not_pending:${purchase.status}`);
    const updated = await db
      .update(purchases)
      .set({ status: "failed", payload: { demoCheckout: "declined_on_fake_checkout" }, updatedAt: new Date() })
      .where(eq(purchases.id, purchase.id))
      .returning();
    const next = updated[0];
    if (!next) throw new Error("fail returned no rows");
    await addEvent(db, ctx, purchase.id, "failed", { mode: "fake", stage: "checkout" });
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "purchase.failed",
      entityType: "purchase",
      entityId: purchase.id,
      diff: { mode: "fake", plan: purchase.planKey },
    });
    return next;
  },

  /**
   * Pull truth for a paystack_test purchase (CHECK PAYMENT button). Idempotent:
   * a paid/failed/abandoned row never re-verifies; filters out another user's
   * zero-knowledge guesses because byId is already org-scoped.
   */
  async check(ctx: Ctx, purchaseId: string): Promise<{ purchase: Purchase; result?: "success" | "abandoned" | "failed" | "error"; error?: string }> {
    const db = await getDb();
    const purchase = await this.byId(ctx, purchaseId);
    if (!purchase) throw new Error("purchase_not_found");
    if (purchase.channel !== "paystack_test") {
      if (purchase.status === "initiated") return { purchase };
      return { purchase };
    }
    if (purchase.status !== "awaiting_confirmation" && purchase.status !== "initiated") {
      return { purchase };
    }
    if (!purchase.providerReference) throw new Error("missing_provider_reference");
    const verified = await verifyTransaction(paystackKey(), purchase.providerReference);
    if (!verified.ok) {
      await addEvent(db, ctx, purchase.id, "rechecked", { stage: "verify", error: verified.error });
      return { purchase, result: "error", error: verified.error };
    }
    let status: Purchase["status"];
    if (verified.status === "success") status = "paid";
    else if (verified.status === "abandoned") status = "abandoned";
    else status = "failed";
    const updated = await db
      .update(purchases)
      .set({ status, updatedAt: new Date() })
      .where(eq(purchases.id, purchase.id))
      .returning();
    const next = updated[0];
    if (!next) throw new Error("check update returned no rows");
    if (status === "paid") {
      await addEvent(db, ctx, purchase.id, "confirmed", { reference: purchase.providerReference, provider: "paystack_test" });
      await auditRepo.log(db, {
        organizationId: ctx.orgId,
        actorUserId: ctx.userId,
        action: "purchase.paid",
        entityType: "purchase",
        entityId: purchase.id,
        diff: { provider: "paystack_test", plan: purchase.planKey, amountKobo: purchase.amountKobo },
      });
    } else {
      await addEvent(db, ctx, purchase.id, status === "abandoned" ? "abandoned" : "failed", { reference: purchase.providerReference, provider: "paystack_test" });
      await auditRepo.log(db, {
        organizationId: ctx.orgId,
        actorUserId: ctx.userId,
        action: `purchase.${status}`,
        entityType: "purchase",
        entityId: purchase.id,
        diff: { provider: "paystack_test", plan: purchase.planKey },
      });
    }
    return { purchase: next, result: verified.status };
  },

  /** Abandon any pending purchase (user-driven; provider rows included). */
  async abandon(ctx: Ctx, purchaseId: string): Promise<Purchase> {
    const db = await getDb();
    const purchase = await this.byId(ctx, purchaseId);
    if (!purchase) throw new Error("purchase_not_found");
    if (purchase.status !== "initiated" && purchase.status !== "awaiting_confirmation") {
      throw new Error(`not_pending:${purchase.status}`);
    }
    const updated = await db
      .update(purchases)
      .set({ status: "abandoned", updatedAt: new Date() })
      .where(eq(purchases.id, purchase.id))
      .returning();
    const next = updated[0];
    if (!next) throw new Error("abandon returned no rows");
    await addEvent(db, ctx, purchase.id, "abandoned", { by: "user" });
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "purchase.abandoned",
      entityType: "purchase",
      entityId: purchase.id,
      diff: { plan: purchase.planKey },
    });
    return next;
  },
};
