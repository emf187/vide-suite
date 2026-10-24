import Link from "next/link";
import { notFound } from "next/navigation";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { formatDateTime } from "@/lib/time";
import { formatKobo } from "@/lib/money";
import { purchasesService } from "@/server/services/purchase";
import { abandonPurchaseAction, checkPaymentAction, confirmDemoPaymentAction, declineDemoPaymentAction } from "../actions";

export const metadata = { title: "Purchase ledger (Demo)" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CheckoutPayload = { provider?: string; checkoutUrl?: string; error?: string; stage?: string };

export default async function PurchaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ purchaseId: string }>;
  searchParams: Promise<{ paid?: string; failed?: string; abandoned?: string; error?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const { purchaseId } = await params;
  if (!UUID.test(purchaseId)) notFound();
  const sp = await searchParams;
  const purchase = await purchasesService.byId(ctx, purchaseId);
  if (!purchase) notFound();
  const mayPurchase = can(ctx.roles, "settings.manage");
  const events = await purchasesService.eventsFor(ctx, purchase.id);
  const payload = (purchase.payload ?? {}) as CheckoutPayload;

  const pending = purchase.status === "initiated" || purchase.status === "awaiting_confirmation";
  const banner =
    purchase.status === "paid" ? "The purchase is marked PAID on the fake ledger." :
    purchase.status === "failed" ? "The purchase FAILED (nothing was marked as paid)." :
    purchase.status === "abandoned" ? "The purchase was abandoned before payment." : null;

  return (
    <>
      <h1>{purchase.planName} — fake ledger entry</h1>
      <p className="lead"><Link href="/purchase" style={{ color: "var(--accent)" }}>← Back to plans</Link></p>

      <div className="card">
        <div className="eyebrow">DEMO — TEST MODE ONLY</div>
        <p style={{ fontSize: 12, color: "var(--dim)", margin: "4px 0 6px" }}>
          This trail is the module&apos;s LOCAL fake ledger. In Paystack test mode, truth still comes
          from the provider&apos;s verify endpoint; in the built-in demo checkout nothing ever leaves
          this server. No real charge exists.
        </p>
        <p className="kv"><span className="k">Plan</span><span className="v">{purchase.planName}</span></p>
        <p className="kv"><span className="k">Amount (kobo)</span><span className="v tnum">{formatKobo(purchase.amountKobo, purchase.currency)} ({purchase.amountKobo})</span></p>
        <p className="kv"><span className="k">Status</span><span className="v">{purchase.status}</span></p>
        <p className="kv"><span className="k">Channel</span><span className="v">{purchase.channel}</span></p>
        <p className="kv"><span className="k">Provider reference</span><span className="v">{purchase.providerReference ?? "(none — demo checkout)"}</span></p>
        <p className="kv"><span className="k">Opened</span><span className="v">{formatDateTime(purchase.createdAt, ctx.timezone)}</span></p>
      </div>

      {banner ? <div className="card"><span className={purchase.status === "paid" ? "ok-text" : "error-text"}>{banner}</span></div> : null}
      {sp.paid ? <div className="card"><span className="ok-text">Payment confirmed and recorded on the ledger.</span></div> : null}
      {sp.failed ? <div className="card"><span className="error-text">Recorded as failed — no paid mark anywhere.</span></div> : null}
      {sp.abandoned ? <div className="card"><span className="ok-text">Recorded as abandoned (pending row closed, nothing paid).</span></div> : null}
      {sp.error ? <div className="card"><span className="error-text">{sp.error}</span></div> : null}

      {mayPurchase && pending ? (
        <div className="card">
          <div className="eyebrow">{purchase.channel === "demo" ? "FAKE CHECKOUT CONTROLS" : "PAYSTACK TEST CHECKOUT"}</div>
          {purchase.channel === "demo" ? (
            <>
              <p style={{ fontSize: 12, color: "var(--dim)", margin: "4px 0 10px" }}>
                Simulated card screen: CONFIRM stands in for a successful test charge, DECLINE for a
                failed one. Both write honest ledger rows — the paid mark says exactly what happened.
              </p>
              <div className="row">
                <form action={confirmDemoPaymentAction}><input type="hidden" name="purchaseId" value={purchase.id} /><button type="submit">CONFIRM (DEMO) PAID</button></form>
                <form action={declineDemoPaymentAction}><input type="hidden" name="purchaseId" value={purchase.id} /><button type="submit" className="secondary">DECLINE (DEMO)</button></form>
                <form action={abandonPurchaseAction}><input type="hidden" name="purchaseId" value={purchase.id} /><button type="submit" className="secondary">ABANDON</button></form>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 12, color: "var(--dim)", margin: "4px 0 10px" }}>
                {payload.checkoutUrl ? (
                  <>The Paystack TEST checkout was opened (<a href={payload.checkoutUrl} style={{ color: "var(--accent)" }}>open it again</a>). Complete the payment there with Paystack&apos;s test card (4084…), then press CHECK PAYMENT — the answer is pulled from Paystack&apos;s verify endpoint, never assumed.</>
                ) : (
                  <>Provider checkout could not be opened ({payload.error ?? "unknown"}). The purchase stays pending.</>
                )}
              </p>
              <div className="row">
                <form action={checkPaymentAction}><input type="hidden" name="purchaseId" value={purchase.id} /><button type="submit">CHECK PAYMENT</button></form>
                <form action={abandonPurchaseAction}><input type="hidden" name="purchaseId" value={purchase.id} /><button type="submit" className="secondary">ABANDON</button></form>
              </div>
            </>
          )}
        </div>
      ) : null}

      <div className="card">
        <div className="eyebrow">{`FAKE LEDGER TRAIL / ${events.length} EVENTS`}</div>
        {events.length === 0 ? (
          <p className="empty-state" style={{ margin: 0 }}>No events (impossible for a started purchase — if you see this, that is a bug).</p>
        ) : (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--dim2)", textAlign: "left" }}>
                <th style={{ padding: "4px 10px 4px 0", width: 170 }}>AT</th>
                <th style={{ padding: "4px 8px 4px 0", width: 150 }}>EVENT</th>
                <th style={{ padding: "4px 0" }}>DETAIL</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td style={{ padding: "4px 10px 4px 0", whiteSpace: "nowrap", color: "var(--dim2)" }}>{formatDateTime(e.at, ctx.timezone)}</td>
                  <td style={{ padding: "4px 8px 4px 0" }}>{e.event}</td>
                  <td style={{ padding: "4px 0" }}><code style={{ fontSize: 11 }}>{JSON.stringify(e.detail)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
