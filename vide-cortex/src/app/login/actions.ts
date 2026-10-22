"use server";

import { redirect } from "next/navigation";
import { createSessionToken, createSsoToken, clearSessionCookie, setSessionCookie } from "@/lib/auth/session";
import { getSuiteUsers } from "@/lib/auth/users";
import { resolveSsoTarget } from "@/lib/auth/sso";
import { timingSafeEqual, createHash } from "node:crypto";

function sha(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * ONE PASSWORD FOR THE SUITE: when COGITEX_VERIFY_URL is configured, the VIDE
 * login delegates the password check to the maintenance planner's real accounts
 * (server-to-server, shared AUTH_SECRET). Result:
 *   true  → planner verified the password (the normal path)
 *   false → planner REJECTED the credentials (hard invalid — env users ignored)
 *   null  → planner not configured / unreachable → env-user fallback so the
 *           console still works standalone (dev default: cortex-maple-77).
 */
async function verifyAgainstPlanner(email: string, password: string): Promise<boolean | null> {
  const url = process.env.COGITEX_VERIFY_URL;
  const secret = process.env.AUTH_SECRET;
  if (!url || !secret) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
      return body?.ok === true;
    }
    if (res.status === 401) return false; // planner actively said no
    // 503 unconfigured / 4xx malformed / 5xx outage → fall back, announces nothing
    console.error("[vide] suite verify unavailable (status " + res.status + ") — falling back to env users.");
    return null;
  } catch (err) {
    // Cold-start race: right after a dev restart the planner may refuse/timeout
    // its first connections. One short retry on NETWORK failure only — a real
    // 401 (wrong password) is never retried.
    console.error("[vide] suite verify unreachable:", err instanceof Error ? err.message : String(err));
    await new Promise((r) => setTimeout(r, 400));
    try {
      const retry = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(4000),
      });
      if (retry.ok) {
        const body = (await retry.json().catch(() => null)) as { ok?: unknown } | null;
        return body?.ok === true;
      }
      if (retry.status === 401) return false;
    } catch {
      /* still down */
    }
    return null;
  }
}

/**
 * CREATE NEW ACCOUNT (suite door): provisions the account at the planner
 * (fresh email → new org + user; existing email → sets a new password for it,
 * which is the honest demo stand-in for an email-verified reset), then signs
 * the visitor in with the password they just chose.
 */
export async function suiteCreateAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const orgName = String(formData.get("orgName") ?? "").trim();
  const ssoRaw = formData.get("sso");
  const target = resolveSsoTarget(ssoRaw);
  const ssoParam = typeof ssoRaw === "string" && target ? `?sso=${encodeURIComponent(ssoRaw)}` : "";
  const backTo = `/login${ssoParam ? `?sso=${encodeURIComponent(String(ssoRaw))}` : ""}`;

  const url = process.env.COGITEX_PROVISION_URL;
  const secret = process.env.AUTH_SECRET;
  const fieldsOk = email.includes("@") && password.length >= 8 && fullName.length >= 2 && orgName.length >= 2;
  if (!fieldsOk || !url || !secret) {
    const why = !url || !secret ? "unavailable" : "fields";
    const sep = backTo.includes("?") ? "&" : "?";
    redirect(`${backTo}${sep}cerror=${why}`);
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ email, password, fullName, orgName }),
      signal: AbortSignal.timeout(6000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: unknown; error?: unknown };
    if (!res.ok || body.ok !== true) {
      const why = String(body.error ?? "unavailable");
      const sep = backTo.includes("?") ? "&" : "?";
      redirect(`${backTo}${sep}cerror=${encodeURIComponent(why)}`);
    }
  } catch (err) {
    console.error("[vide] suite provision unreachable:", err instanceof Error ? err.message : String(err));
    const sep = backTo.includes("?") ? "&" : "?";
    redirect(`${backTo}${sep}cerror=unavailable`);
  }

  // Provisioned (or password reset) — the planner now accepts these credentials.
  await setSessionCookie(await createSessionToken(email));
  if (target) {
    const to = new URL(target);
    to.searchParams.set("token", await createSsoToken(email));
    redirect(to.toString());
  }
  redirect("/");
}

/** Suite login: one email/password that opens the whole suite. */
export async function suiteLoginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const ssoRaw = formData.get("sso");
  const target = resolveSsoTarget(ssoRaw);
  const ssoParam = typeof ssoRaw === "string" && target ? `?sso=${encodeURIComponent(ssoRaw)}` : "";
  const backTo = `/login${ssoParam}`;

  const verified = await verifyAgainstPlanner(email, password);
  const user =
    verified === true
      ? { email, password: "", name: email } // planner-verified: any live planner account
      : verified === null && password.length > 0
        ? getSuiteUsers().find((u) => u.email.toLowerCase() === email)
        : undefined;
  const ok =
    verified === true ||
    (verified === null && Boolean(user) && password.length > 0 && timingSafeEqual(sha(password), sha(user?.password ?? "")));
  if (!user || !ok) {
    const sep = backTo.includes("?") ? "&" : "?";
    redirect(`${backTo}${sep}error=invalid`);
  }

  await setSessionCookie(await createSessionToken(user!.email));

  if (target) {
    // Suite handoff: straight into the maintenance planner, already signed in.
    const to = new URL(target);
    to.searchParams.set("token", await createSsoToken(user!.email));
    redirect(to.toString());
  }
  redirect("/");
}

export async function suiteLogoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
