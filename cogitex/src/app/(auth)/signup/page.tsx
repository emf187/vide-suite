import Link from "next/link";
import { redirect } from "next/navigation";
import { signUpAction } from "../actions";
import { getCtx } from "@/server/ctx";
import { Logo } from "@/components/layout/Logo";

export const metadata = { title: "Create account" };

const ERRORS: Record<string, string> = {
  fields: "Check the fields — org name, your name, email and a password of 8+ characters.",
  email_taken: "That email already has an account — sign in instead.",
  slug_taken: "Could not allocate an organization code — try a different org name.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error ? ERRORS[params.error] ?? "Sign-up failed." : null;
  // DB-verified "already signed in?" — same rationale as the login page.
  const liveCtx = await getCtx();
  if (liveCtx) redirect("/today");

  return (
    <div className="auth-shell">
      <div className="auth-card card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <Logo className="logo" />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>ORGO</div>
            <div style={{ fontSize: 9, color: "var(--dim)", letterSpacing: 1 }}>MAINTENANCE MANAGER</div>
          </div>
        </div>

        <form action={signUpAction}>
          {error ? (
            <p className="error-text" role="alert" style={{ marginBottom: 12 }}>
              {error}
            </p>
          ) : null}
          <div className="auth-field">
            <label className="field-label" htmlFor="orgName">
              ORGANIZATION
            </label>
            <input id="orgName" name="orgName" type="text" required minLength={2} maxLength={80} placeholder="e.g. Anyanwu Fabrics" />
          </div>
          <div className="auth-field">
            <label className="field-label" htmlFor="fullName">
              YOUR NAME
            </label>
            <input id="fullName" name="fullName" type="text" required minLength={2} maxLength={80} autoComplete="name" />
          </div>
          <div className="auth-field">
            <label className="field-label" htmlFor="email">
              WORK EMAIL
            </label>
            <input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="auth-field">
            <label className="field-label" htmlFor="password">
              PASSWORD (MIN 8)
            </label>
            <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
          </div>
          <button type="submit">CREATE ACCOUNT</button>
        </form>

        <div className="auth-footlinks">
          <span>ALREADY ONBOARD?</span>
          <Link href="/login">SIGN IN →</Link>
        </div>
        <p className="demo-hint">
          You become the OWNER. Roles: owner/admin · maintenance manager ·
          technician · viewer · external technician (assigned jobs only).
        </p>
      </div>
    </div>
  );
}
