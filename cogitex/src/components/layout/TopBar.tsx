"use client";

import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/(auth)/actions";
import { navLookup } from "./nav";

type TopBarProps = {
  orgName: string;
};

/**
 * VIDE-style topbar: crumb + page title, theme toggle and sign-out.
 * The theme button is hydration-independent: it carries data-action instead of
 * a React onClick — the inline theme script in the root layout handles clicks
 * globally and syncs the moon/sun icon, so dark mode works even before
 * hydration (or when hydration is disrupted entirely).
 */
export function TopBar({ orgName }: TopBarProps) {
  const pathname = usePathname();
  const nav = navLookup(pathname);

  return (
    <header className="topbar">
      <div>
        <div className="crumb">{nav?.crumb ?? "COGITEX / MAINTENANCE PLANNER"}</div>
        <div className="title">{orgName}</div>
      </div>
      <div className="topbar-right">
        <button
          id="theme-btn"
          className="secondary"
          data-action="theme-toggle"
          title="Switch to dark mode"
          style={{ padding: "9px 12px", borderRadius: 8, lineHeight: 1, fontSize: 15 }}
          aria-label="Toggle light / dark mode"
        >
          ◑
        </button>
        <form action={signOutAction}>
          <button type="submit" className="secondary" title="Sign out">
            SIGN OUT
          </button>
        </form>
      </div>
    </header>
  );
}
