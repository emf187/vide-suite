import Link from "next/link";
import { redirect } from "next/navigation";
import { getCtx } from "@/server/ctx";
import { LogoBlock } from "@/components/layout/Logo";
import { signUpAction } from "../actions";

export const metadata = { title: "Create account" };

const ERRORS: Record<string, string> = {
  fields: "Check the fields — everything is required, password at least 8 characters.",
  email_taken: "That email already has an account — sign in instead. For safety, an existing account is never overwritten or given a new password.",
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const liveCtx = await getCtx();
  if (liveCtx) redirect("/today");
  const params = await searchParams;
  const error = params.error ? (ERRORS[params.error] ?? "Sign-up failed.") : null;

  return (
    <div className="auth-mesh min-h-screen flex items-center justify-center p-4 md:p-8">
      <div className="auth-glass w-full max-w-md rounded-2xl p-8 relative z-10">
        <div className="flex items-center gap-3 mb-2">
          <LogoBlock />
        </div>

        <p className="text-[12px] text-dim mt-3 mb-6 leading-relaxed">
          Create your workspace — this becomes your business&apos; guardian.
        </p>

        <form action={signUpAction} className="space-y-4">
          {error ? <p role="alert" className="auth-banner">{error}</p> : null}
          <label htmlFor="orgName" className="auth-label">BUSINESS NAME</label>
          <input id="orgName" name="orgName" required minLength={2} className="auth-input" placeholder="Demo Kitchen Ltd" />
          <label htmlFor="fullName" className="auth-label">YOUR NAME</label>
          <input id="fullName" name="fullName" required minLength={2} className="auth-input" />
          <label htmlFor="email" className="auth-label">EMAIL</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="auth-input" />
          <label htmlFor="password" className="auth-label">PASSWORD (8+ CHARACTERS)</label>
          <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} className="auth-input" />
          <button type="submit" className="auth-btn-primary w-full py-3.5 rounded-xl font-bold text-sm tracking-widest uppercase shadow-sm">
            CREATE ACCOUNT
          </button>
        </form>

        <p className="text-[11px] text-dim2 text-center mt-6">
          Already have an account? <Link href="/login" style={{ color: "var(--accent)" }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}
