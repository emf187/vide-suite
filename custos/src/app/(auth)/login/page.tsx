import Link from "next/link";
import { redirect } from "next/navigation";
import { signInAction } from "../actions";
import { getCtx } from "@/server/ctx";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  fields: "Check the fields — a valid email and your password are required.",
  invalid: "Sign-in failed — email or password is incorrect.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  // "Already signed in?" is a REAL DB-verified check — not a cookie-presence
  // shortcut. A stale token (e.g. after a dev DB reset) must land ON the form,
  // never bounce into a /login ⇄ /today loop.
  const liveCtx = await getCtx();
  if (liveCtx) redirect("/today");

  const params = await searchParams;
  const error = params.error ? (ERRORS[params.error] ?? "Sign-in failed.") : null;

  return (
    <div className="auth-mesh min-h-screen flex items-center justify-center p-4 md:p-8">
      <div className="fixed top-6 left-6 z-0 pointer-events-none opacity-40">
        <div className="auth-mark">C</div>
      </div>

      <div className="auth-glass w-full max-w-md rounded-2xl p-8 relative z-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="auth-mark" style={{ width: 34, height: 34, fontSize: 15 }}>
            C
          </div>
          <div>
            <div className="text-[15px] font-bold tracking-[1px] text-ink">CUSTOS</div>
            <div className="text-[8.5px] tracking-[2px] text-dim uppercase">TASK GUARDIAN</div>
          </div>
        </div>

        <p className="text-[12px] text-dim mt-3 mb-6 leading-relaxed">
          The follow-through loop: set tasks here, staff answer in ordinary
          WhatsApp — no app, no login — and proof and escalations flow back to
          this dashboard.
        </p>

        <form action={signInAction} id="login-form" className="space-y-4">
          {error ? <p role="alert" className="auth-banner">{error}</p> : null}
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

        <div className="auth-divider">OR START A WORKSPACE</div>

        <p className="text-[11px] text-dim2 text-center mb-6">
          New to Custos? Create your workspace, register your staff, and the
          simulator guards the loop until WhatsApp mode lands.
        </p>
        <Link
          href="/signup"
          className="auth-btn-outline w-full py-3.5 rounded-xl font-bold text-sm tracking-widest uppercase shadow-sm"
        >
          CREATE ACCOUNT →
        </Link>

        <p className="text-[11px] text-dim2 text-center mt-6">
          NO EXTERNAL SERVICE REQUIRED — the built-in simulator always works.
          Real WhatsApp arrives via Meta&apos;s Cloud API behind the same bot.
        </p>
      </div>
    </div>
  );
}
