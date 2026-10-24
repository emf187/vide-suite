import Link from "next/link";
import { notFound } from "next/navigation";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { formatKobo } from "@/lib/money";
import { purchasesService } from "@/server/services/purchase";
import { declineDemoPaymentAction, confirmDemoPaymentAction } from "../../actions";

export const metadata = { title: "Fake checkout (Demo)" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The built-in FAKE checkout — the demo-mode stand-in for Paystack's hosted
 * checkout page. Deliberately NOT styled like a bank: it repeats the DEMO
 * banner everywhere and offers CONFIRM / DECLINE as explicit ledger controls
 * so no human can mistake it for a real payment screen.
 */
export default async function FakeCheckoutPage({
  params,
}: {
  params: Promise<{ purchaseId: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const { purchaseId } = await params;
  if (!UUID.test(purchaseId)) notFound();
  const purchase = await purchasesService.byId(ctx, purchaseId);
  if (!purchase) notFound();
  if (purchase.channel !== "demo") notFound(); // paystack flows never see this page
  const mayPurchase = can(ctx.roles, "settings.manage");

  return (
    <>
      <h1>Fake checkout (DEMO)</h1>
      <p className="lead"><Link href={`/purchase/${purchase.id}`} style={{ color: "var(--accent)" }}>← Back to the ledger trail</Link></p>

      <div className="card">
        <div className="eyebrow">DEMO — THIS IS NOT A PAYMENT PAGE</div>
        <p style={{ fontSize: 12, color: "var(--dim)", margin: "4px 0 6px" }}>
          This local page stands in for the hosted checkout when no Paystack key is configured.
          No card form is shown on purpose — there is nothing to charge. CONFIRM marks the DEMO
          purchase paid on the fake ledger; DECLINE marks it failed. Either way the trail says
          exactly what happened.
        </p>
      </div>

      <div className="card">
        <div className="eyebrow">ORDER</div>
        <p className="kv"><span className="k">Plan</span><span className="v">{purchase.planName}</span></p>
        <p className="kv"><span className="k">Amount (kobo)</span><span className="v tnum">{formatKobo(purchase.amountKobo, purchase.currency)} ({purchase.amountKobo})</span></p>
        <p className="kv"><span className="k">Reference</span><span className="v">{purchase.id}</span></p>
        <p className="kv"><span className="k">Buyer</span><span className="v">{ctx.name} ({ctx.roles.join(", ")})</span></p>

        {purchase.status !== "initiated" ? (
          <p style={{ marginTop: 10 }}>
            <span className={purchase.status === "paid" ? "ok-text" : "error-text"}>
              This purchase is already resolved ({purchase.status}) — the checkout is closed.
            </span>
          </p>
        ) : mayPurchase ? (
          <div className="row" style={{ marginTop: 10 }}>
            <form action={confirmDemoPaymentAction}><input type="hidden" name="purchaseId" value={purchase.id} /><button type="submit">CONFIRM (DEMO) PAID</button></form>
            <form action={declineDemoPaymentAction}><input type="hidden" name="purchaseId" value={purchase.id} /><button type="submit" className="secondary">DECLINE (DEMO)</button></form>
          </div>
        ) : (
          <p style={{ marginTop: 10, fontSize: 12, color: "var(--dim2)" }}>Only owner / admin may walk the checkout.</p>
        )}
      </div>
    </>
  );
}
