import { redirect } from "next/navigation";
import { getVideSession, createSsoToken } from "@/lib/auth/session";
import { resolveSsoTarget } from "@/lib/auth/sso";
import { suiteLoginAction, suiteCreateAction } from "./actions";

export const metadata = { title: "Sign in · VIDE CORTEX" };

const ERRORS: Record<string, string> = {
  invalid: "Sign-in failed — email or password is incorrect.",
};

const CREATE_ERRORS: Record<string, string> = {
  fields: "Check the fields — full name, org name, valid email and a password of 8+ characters.",
  email_taken: "This email already exists — the form sets a new password for it instead (try again).",
  no_password_identity: "This account exists without a password login possible here — ask your maintenance manager.",
  deactivated: "This account is deactivated. Contact your maintenance manager.",
  unauthorized: "Handoff refused by the planner (shared secret mismatch) — check AUTH_SECRET in both apps.",
  unavailable: "The planner app is unreachable right now — start Cogitex and try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sso?: string; error?: string; cerror?: string }>;
}) {
  // Already signed in? Hand off silently if a planner exchange target came in
  // (Cogitex chain), otherwise this is just a signed-in visit to /login.
  const session = await getVideSession();
  if (session) {
    const params = await searchParams;
    const target = resolveSsoTarget(params.sso);
    if (target) {
      const handoff = new URL(target);
      handoff.searchParams.set("token", await createSsoToken(session.sub));
      redirect(handoff.toString());
    }
    redirect("/");
  }

  const params = await searchParams;
  const error = params.error ? ERRORS[params.error] ?? "Sign-in failed." : null;
  const cerror = params.cerror ? CREATE_ERRORS[params.cerror] ?? "Account creation failed." : null;
  const ssoHidden = typeof params.sso === "string" ? params.sso : "";

  return (
    <div className="auth-mesh min-h-screen flex items-center justify-center p-4 md:p-8">
      {/* Subtle top-left brand watermark */}
      <div className="fixed top-6 left-6 z-0 pointer-events-none opacity-40">
        <div className="auth-mark">V</div>
      </div>

      <div className="auth-glass w-full max-w-md rounded-2xl p-8 relative z-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="auth-mark" style={{ width: 34, height: 34, fontSize: 15 }}>
            V
          </div>
          <div>
            <div className="text-[15px] font-bold tracking-[1px] text-ink">VIDE CORTEX</div>
            <div className="text-[8.5px] tracking-[2px] text-dim uppercase">INDUSTRIAL IOT · SUITE LOGIN</div>
          </div>
        </div>

        <p className="text-[12px] text-dim mt-3 mb-6 leading-relaxed">
          One sign-in opens the whole suite — the live console here and your
          Maintenance Planner (Cogitex) session, automatically.
        </p>

        {/* Sign-in form */}
        <form action={suiteLoginAction} className="space-y-4">
          {ssoHidden ? <input type="hidden" name="sso" value={ssoHidden} /> : null}
          {error ? (
            <p role="alert" className="auth-banner">{error}</p>
          ) : null}
          <label htmlFor="email" className="auth-label">
            EMAIL
          </label>
          <input
            id="email" name="email" type="email" autoComplete="email" required
            defaultValue="mikedeimu@gmail.com" className="auth-input"
          />
          <label htmlFor="password" className="auth-label">
            PASSWORD
          </label>
          <input
            id="password" name="password" type="password" autoComplete="current-password" required className="auth-input"
          />
          <button
            type="submit"
            className="auth-btn-primary w-full py-3.5 rounded-xl font-bold text-sm tracking-widest uppercase shadow-sm"
          >
            SIGN IN
          </button>
          <p className="text-[11px] text-dim2 text-center mt-2">
            Use your Maintenance Planner login — one password for both apps.
          </p>
        </form>

        <div className="auth-divider">NEW TO THE SUITE?</div>

        {/* Create account form */}
        <form action={suiteCreateAction} id="create" className="space-y-4">
          {ssoHidden ? <input type="hidden" name="sso" value={ssoHidden} /> : null}
          {cerror ? (
            <p role="alert" className="auth-banner">{cerror}</p>
          ) : null}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="c-fullName" className="auth-label">
                FULL NAME
              </label>
              <input
                id="c-fullName" name="fullName" type="text" autoComplete="name" required minLength={2}
                className="auth-input" placeholder="Ada Obi"
              />
            </div>
            <div>
              <label htmlFor="c-orgName" className="auth-label">
                ORG NAME
              </label>
              <input
                id="c-orgName" name="orgName" type="text" autoComplete="organization" required minLength={2}
                className="auth-input" placeholder="My Plant Ltd"
              />
            </div>
          </div>
          <label htmlFor="c-email" className="auth-label">
            EMAIL
          </label>
          <input id="c-email" name="email" type="email" autoComplete="email" required className="auth-input" />
          <label htmlFor="c-password" className="auth-label">
            PASSWORD (8+ CHARS)
          </label>
          <input id="c-password" name="password" type="password" autoComplete="new-password" required minLength={8} className="auth-input" />
          <button
            type="submit"
            className="auth-btn-outline w-full py-3.5 rounded-xl font-bold text-sm tracking-widest uppercase shadow-sm"
          >
            CREATE NEW ACCOUNT
          </button>
          <p className="text-[10px] text-dim2 leading-relaxed mt-2">
            Creates your plant workspace in the Maintenance Planner. If the email
            already exists there, this sets a fresh password for it instead.
          </p>
        </form>
      </div>
    </div>
  );
}
