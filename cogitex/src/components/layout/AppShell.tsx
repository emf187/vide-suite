import type { Ctx } from "@/server/ctx";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { profileLabel } from "./nav";
import { getIntegrations } from "@/lib/integrations/factory";

type AppShellProps = {
  ctx: Ctx;
  children: React.ReactNode;
};

/**
 * The app chrome — 230px VIDE sidebar + topbar + content + footerbar.
 * Server component: session/org data resolves here, client islands for interactivity.
 */
export function AppShell({ ctx, children }: AppShellProps) {
  const integrations = getIntegrations();
  const live = integrations.profile === "real";
  const statusLabel = `${profileLabel(integrations.profile)} · TZ ${ctx.timezone === "Africa/Lagos" ? "LAGOS" : ctx.timezone.toUpperCase()}`;

  return (
    <div className="shell">
      <SkipLink />
      <Sidebar
        orgName={ctx.orgName}
        userName={ctx.name}
        statusLabel={statusLabel}
        live={live}
      />
      <div className="main">
        <TopBar orgName={ctx.orgName} />
        <div className="content" id="main-content">
          {children}
        </div>
        <footer className="footerbar">
          <span>ORGO · MAINTENANCE MANAGER</span>
          <span>
            {ctx.orgName.toUpperCase()} · ROLE {ctx.roles[0]?.toUpperCase() ?? "UNKNOWN"}
          </span>
        </footer>
      </div>
    </div>
  );
}

function SkipLink() {
  return (
    <a href="#main-content" className="skip-link">
      Skip to content
    </a>
  );
}
