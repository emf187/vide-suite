import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { signInAction } from "../actions";
import { getCtx } from "@/server/ctx";
import { buildSuiteLoginRedirect } from "@/server/auth/sso";
import { Logo } from "@/components/layout/Logo";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  fields: "Check the fields — a valid email and your password are required.",
  invalid: "Sign-in failed — email or password is incorrect.",
  deactivated: "This account is deactivated. Contact your maintenance manager.",
  sso_invalid: "The suite sign-in link expired or was invalid. Open the planner again from the VIDE console.",
  sso_unknown: "This VIDE account is not linked to a planner user here yet — ask your maintenance manager (suite accounts: mikedeimu@gmail.com).",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // "Already signed in?" is a REAL DB-verified check here — not a middleware
  // cookie-presence shortcut. A stale token (e.g. after a dev restart wiped the
  // local DB) must land ON the form, never bounce into a /login ⇄ /today loop.
  const liveCtx = await getCtx();
  if (liveCtx) redirect("/today");

  const params = await searchParams;
  const error = params.error ? ERRORS[params.error] ?? "Sign-in failed." : null;

  // Suite mode: a clean visit without an SSO error never sees this local card —
  // it continues at the VIDE console login (which auto-hands back signed in).
  // Local card still shows for SSO errors and standalone deploys.
  if (!error && process.env.VIDE_LOGIN_URL) {
    const h = await headers();
    const host = h.get("host") ?? "localhost:3030";
    const origin = process.env.COGITEX_PUBLIC_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${host}`;
    const suiteUrl = buildSuiteLoginRedirect(process.env.VIDE_LOGIN_URL, origin, "/today");
    if (suiteUrl) redirect(suiteUrl);
  }

  return (
    <div className="auth-mesh min-h-screen flex items-center justify-center p-4 md:p-8">
      <div className="fixed top-6 left-6 z-0 pointer-events-none opacity-40">
        <div className="auth-mark">O</div>
      </div>

      <div className="auth-glass w-full max-w-md rounded-2xl p-8 relative z-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="auth-mark" style={{ width: 34, height: 34, fontSize: 15 }}>
            O
          </div>
          <div>
            <div className="text-[15px] font-bold tracking-[1px] text-ink">ORGO</div>
            <div className="text-[8.5px] tracking-[2px] text-dim uppercase">MAINTENANCE MANAGER</div>
          </div>
        </div>

        <p className="text-[12px] text-dim mt-3 mb-6 leading-relaxed">
          One plant, one login — live machine health, faults and work orders,
          managed in Orgo and synced from the VIDE console.
        </p>

        <form action={signInAction} id="login-form" className="space-y-4">
          {error ? (
            <p role="alert" className="auth-banner">{error}</p>
          ) : null}
          <label htmlFor="email" className="auth-label">
            EMAIL
          </label>
          <input id="email" name="email" type="email" autoComplete="email" required className="auth-input" />
          <label htmlFor="password" className="auth-label">
            PASSWORD
          </label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="auth-input" />
          <button type="submit" className="auth-btn-primary w-full py-3.5 rounded-xl font-bold text-sm tracking-widest uppercase shadow-sm">
            SIGN IN
          </button>
        </form>

        <div className="auth-divider">OR CREATE A PLANT</div>

        <p className="text-[11px] text-dim2 text-center mb-6">
          New to the suite? Create your Maintenance Planner workspace, then sign
          in with VIDE for live telemetry.
        </p>
        <Link
          href="/signup"
          className="auth-btn-outline w-full py-3.5 rounded-xl font-bold text-sm tracking-widest uppercase shadow-sm"
        >
          CREATE ACCOUNT →
        </Link>

        <p className="text-[11px] text-dim2 text-center mt-6">
          NO VIDE CONNECTION REQUIRED — this planner works standalone. Connect
          VIDE for live health, energy and faults.
        </p>

        {process.env.VIDE_LOGIN_URL ? (
          <p className="text-center mt-4">
            <a
              href={process.env.VIDE_LOGIN_URL}
              className="text-[11px] font-bold tracking-widest text-accent-deep hover:underline"
            >
              Sign in with your VIDE account →
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}
