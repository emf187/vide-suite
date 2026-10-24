import Link from "next/link";
import { redirect } from "next/navigation";
import { getCtx } from "@/server/ctx";
import { LogoBlock } from "@/components/layout/Logo";
import { signInAction } from "../actions";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  fields: "Check the fields — a valid email and your password are required.",
  invalid: "Sign-in failed — email or password is incorrect.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const liveCtx = await getCtx();
  if (liveCtx) redirect("/today");
  const params = await searchParams;
  const error = params.error ? (ERRORS[params.error] ?? "Sign-in failed.") : null;

  return (
    <div className="auth-mesh min-h-screen flex items-center justify-center p-4 md:p-8">
      <div className="auth-glass w-full max-w-md rounded-2xl p-8 relative z-10">
        <div className="flex items-center gap-3 mb-2">
          <LogoBlock />
        </div>

        <p className="text-[12px] text-dim mt-3 mb-6 leading-relaxed">
          The task guardian: set tasks here, staff answer in ordinary WhatsApp,
          proof and escalations flow back to this dashboard.
        </p>

        <form action={signInAction} className="space-y-4">
          {error ? <p role="alert" className="auth-banner">{error}</p> : null}
          <label htmlFor="email" className="auth-label">EMAIL</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="auth-input" />
          <label htmlFor="password" className="auth-label">PASSWORD</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="auth-input" />
          <button type="submit" className="auth-btn-primary w-full py-3.5 rounded-xl font-bold text-sm tracking-widest uppercase shadow-sm">
            SIGN IN
          </button>
        </form>

        <div className="auth-divider">NEW HERE</div>
        <Link href="/signup" className="auth-btn-outline w-full py-3.5 rounded-xl font-bold text-sm tracking-widest uppercase shadow-sm">
          CREATE ACCOUNT →
        </Link>
      </div>
    </div>
  );
}
