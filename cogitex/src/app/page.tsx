import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth/constants";
import { buildSuiteLoginRedirect } from "@/server/auth/sso";

/** Entry point: signed in → /today; else → the SUITE login handoff (or local /login standalone). */
export default async function RootPage() {
  const store = await cookies();
  const hasSession = Boolean(store.get(SESSION_COOKIE)?.value);
  if (hasSession) redirect("/today");

  // Suite mode: the front door must auto-continue a VIDE console login — never
  // show this app's own card first. Standalone (no env): local /login as before.
  const h = await headers();
  const host = h.get("host") ?? "localhost:3030";
  const origin = process.env.COGITEX_PUBLIC_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${host}`;
  const suiteUrl = buildSuiteLoginRedirect(process.env.VIDE_LOGIN_URL, origin, "/today");
  redirect(suiteUrl ?? "/login");
}
