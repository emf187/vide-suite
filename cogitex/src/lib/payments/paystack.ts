/**
 * Paystack seam for the DEMO purchase module (sprint item 4). Test keys ONLY.
 *
 * Rules the module never breaks:
 * - `sk_test_*` → real Paystack in TEST mode (sandbox transactions, no money).
 * - `sk_live_*` or anything unrecognised → REFUSED; live keys are never accepted
 *   anywhere in this app, by design.
 * - no key at all → `demo` mode: the built-in fake checkout page runs the same
 *   flow with zero network and a clearly-labelled fake ledger.
 * Every call is fail-honest: a provider error is reported, never swallowed or
 * simulated.
 */

/** Test seam: PAYSTACK_API_BASE overrides the real endpoint (tests point it at a dead port). */
function apiBase(): string {
  return (process.env.PAYSTACK_API_BASE || "https://api.paystack.co").replace(/\/+$/, "").trim();
}
const TIMEOUT_MS = 12_000;

export type PaystackMode =
  | { mode: "paystack_test"; keyMasked: string }
  | { mode: "demo"; reason: "no_key" }
  | { mode: "refused"; reason: "live_or_unrecognized_key" };

export function resolvePaystackMode(secretKey: string | undefined): PaystackMode {
  const key = (secretKey ?? "").trim();
  if (!key) return { mode: "demo", reason: "no_key" };
  if (key.startsWith("sk_test_")) {
    return { mode: "paystack_test", keyMasked: `${key.slice(0, 8)}…${key.slice(-4)}` };
  }
  return { mode: "refused", reason: "live_or_unrecognized_key" };
}

function send(path: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(`${apiBase()}/transaction/${path}`, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

export type InitializeResult = { ok: true; reference: string; checkoutUrl: string } | { ok: false; error: string };

/** Paystack TEST-mode initialize; `reference` is our purchase id + plan stamp. */
export async function initializeTransaction(
  secretKey: string,
  body: { reference: string; amountKobo: number; email: string; metadata: Record<string, string> },
): Promise<InitializeResult> {
  try {
    const res = await send("initialize", {
      method: "POST",
      headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        reference: body.reference,
        amount: body.amountKobo, // Paystack kobo — same integer unit we store
        email: body.email,
        currency: "NGN",
        metadata: body.metadata,
      }),
    });
    const data = (await res.json().catch(() => null)) as
      | { status: boolean; message?: string; data?: { reference: string; authorization_url: string } }
      | null;
    if (!data?.status || !data.data || !data.data.authorization_url) {
      return { ok: false, error: `paystack_initialize_failed:${data?.message ? data.message.replace(/\s+/g, "_").toLowerCase().slice(0, 80) : `http_${res.status}`}` };
    }
    return { ok: true, reference: data.data.reference, checkoutUrl: data.data.authorization_url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `paystack_unreachable:${message.replace(/\s+/g, "_").slice(0, 80)}` };
  }
}

export type VerifyResult =
  | { ok: true; status: "success" | "abandoned" | "failed" }
  | { ok: false; error: string };

/** TEST-mode verify; buys truth from the provider, no local guessing. */
export async function verifyTransaction(secretKey: string, reference: string): Promise<VerifyResult> {
  try {
    const check = await send(`verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${secretKey}` },
    });
    const data = (await check.json().catch(() => null)) as
      | { status: boolean; message?: string; data?: { status: string } }
      | null;
    if (!data?.status || !data.data) {
      return { ok: false, error: `paystack_verify_failed:${data?.message ? data.message.replace(/\s+/g, "_").toLowerCase().slice(0, 80) : `http_${check.status}`}` };
    }
    if (data.data.status === "success") return { ok: true, status: "success" };
    if (data.data.status === "abandoned") return { ok: true, status: "abandoned" };
    return { ok: true, status: "failed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `paystack_unreachable:${message.replace(/\s+/g, "_").slice(0, 80)}` };
  }
}
