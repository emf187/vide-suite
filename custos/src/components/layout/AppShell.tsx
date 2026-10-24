import type { Ctx } from "@/server/ctx";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

type AppShellProps = {
  ctx: Ctx;
  children: React.ReactNode;
};

/**
 * The app chrome — the Planner's 230px VIDE sidebar + topbar + content +
 * footerbar, server-rendered. Status line is honest: the simulator is the
 * live mode until M7 flips MESSAGING_MODE to WhatsApp.
 */
export function AppShell({ ctx, children }: AppShellProps) {
  const statusLabel = `SIMULATOR · TZ ${ctx.timezone === "Africa/Lagos" ? "LAGOS" : ctx.timezone.toUpperCase()}`;

  return (
    <div className="shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Sidebar orgName={ctx.orgName} userName={ctx.name} statusLabel={statusLabel} live />
      <div className="main">
        <TopBar orgName={ctx.orgName} />
        <div className="content" id="main-content">
          {children}
        </div>
        <footer className="footerbar">
          <span>CUSTOS · TASK GUARDIAN</span>
          <span>
            {ctx.orgName.toUpperCase()} · ROLE {ctx.roles[0]?.toUpperCase() ?? "UNKNOWN"}
          </span>
        </footer>
      </div>
    </div>
  );
}
