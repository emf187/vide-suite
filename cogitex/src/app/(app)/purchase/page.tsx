import Link from "next/link";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { formatDateTime } from "@/lib/time";
import { formatKobo } from "@/lib/money";
import { PURCHASE_PLANS, purchasesService } from "@/server/services/purchase";
import { startPurchaseAction } from "./actions";

export const metadata = { title: "Purchase (Demo)" };

const STATUS_CLASS: Record<string, string> = {
  paid: "ok-text",
  failed: "error-text",
  abandoned: "urgency-none",
  initiated: "urgency-low",
  awaiting_confirmation: "urgency-low",
};

const STATUS_LABEL: Record<string, string> = {
  paid: "PAID",
  failed: "FAILED",
  abandoned: "ABANDONED",
  initiated: "INITIATED",
  awaiting_confirmation: "AWAITING CHECK",
};

export default async function PurchasePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const sp = await searchParams;
  const mode = purchasesService.mode();
  const mayPurchase = can(ctx.roles, "settings.manage");
  const rows = await purchasesService.listForOrg(ctx);

  const modeLine =
    mode.mode === "demo"
      ? "fake checkout (no PAYSTACK key set — zero network)"
      : mode.mode === "paystack_test"
        ? `Paystack TEST mode (${mode.keyMasked})`
        : "REFUSED — the key is not a sk_test_ test key, this module never runs with it";

  return (
    <>
      <h1>Purchase plans (DEMO)</h1>
      <p className="lead">The demo purchase module for the suite: buy a plan end to end — the whole flow is provably seam-complete, nothing real is charged.</p>

      <div className="card">
        <div className="eyebrow">DEMO — TEST MODE ONLY</div>
        <p style={{ fontSize: 12, color: "var(--dim)", margin: "4px 0 6px" }}>
          This is a demonstration module. The ledger below is LOCAL and fake — it exists to prove
          the purchase seam works end to end. Paystack is used only with TEST keys (sk_test_…);
          live keys are refused outright, so no real money can ever move through this app.
        </p>
        <p className="kv"><span className="k">Payment mode</span><span className="v">{modeLine}</span></p>
        {sp.error ? <span className="error-text">{sp.error}</span> : null}
      </div>

      <div className="card">
        <div className="eyebrow">PLANS</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
          {PURCHASE_PLANS.map((plan) => (
            <div key={plan.key} className="tile" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontWeight: 600 }}>{plan.name}</div>
                <div style={{ fontSize: 12, color: "var(--dim2)" }}>{plan.description}</div>
              </div>
              <div className="tnum" style={{ fontWeight: 600 }}>{formatKobo(100 * plan.nairaAmount, ctx.currency)}</div>
              {mayPurchase ? (
                <form action={startPurchaseAction}>
                  <input type="hidden" name="planKey" value={plan.key} />
                  <button type="submit">BUY DEMO</button>
                </form>
              ) : (
                <span style={{ fontSize: 11, color: "var(--dim2)" }}>owner / admin buys</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="eyebrow">{`FAKE LEDGER (LOCAL, PROOF OF SEAM) / ${rows.length}`}</div>
        {rows.length === 0 ? (
          <p className="empty-state" style={{ margin: 0 }}>No purchases yet — press BUY DEMO on a plan above to walk the flow.</p>
        ) : (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--dim2)", textAlign: "left" }}>
                <th style={{ padding: "4px 8px 4px 0" }}>WHEN</th>
                <th style={{ padding: "4px 8px 4px 0" }}>PLAN</th>
                <th style={{ padding: "4px 8px 4px 0" }}>AMOUNT</th>
                <th style={{ padding: "4px 8px 4px 0" }}>STATUS</th>
                <th style={{ padding: "4px 8px 4px 0" }}>CHANNEL</th>
                <th style={{ padding: "4px 0" }}>TRAIL</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td style={{ padding: "4px 8px 4px 0", whiteSpace: "nowrap" }}>{formatDateTime(p.createdAt, ctx.timezone)}</td>
                  <td style={{ padding: "4px 8px 4px 0" }}>{p.planName}</td>
                  <td style={{ padding: "4px 8px 4px 0" }}>{formatKobo(p.amountKobo, p.currency)}</td>
                  <td style={{ padding: "4px 8px 4px 0" }}><span className={STATUS_CLASS[p.status] ?? ""}>{STATUS_LABEL[p.status] ?? p.status}</span></td>
                  <td style={{ padding: "4px 8px 4px 0", color: "var(--dim2)" }}>{p.channel}</td>
                  <td style={{ padding: "4px 0" }}>
                    <Link href={`/purchase/${p.id}`} style={{ color: "var(--accent)" }}>LEDGER →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
