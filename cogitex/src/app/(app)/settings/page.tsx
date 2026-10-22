import { getCtx } from "@/server/ctx";
import { getIntegrations } from "@/lib/integrations/factory";
import { can } from "@/server/policies";

export const metadata = { title: "Settings" };

/** M0 settings: session/org/roles + integration health (read-only). */
export default async function SettingsPage() {
  const ctx = await getCtx();
  if (!ctx) return null;
  const integrations = getIntegrations();
  const notificationHealth = await integrations.notifications.health();

  return (
    <>
      <h1>Settings</h1>
      <p className="lead">System and session state. User management UI lands with M1.</p>

      <div className="card">
        <div className="eyebrow">ORGANIZATION</div>
        <p className="kv"><span className="k">Name</span><span className="v">{ctx.orgName}</span></p>
        <p className="kv"><span className="k">Slug</span><span className="v">{ctx.orgSlug}</span></p>
        <p className="kv"><span className="k">Currency</span><span className="v">{ctx.currency}</span></p>
        <p className="kv"><span className="k">Display timezone</span><span className="v">{ctx.timezone}</span></p>
      </div>

      <div className="card">
        <div className="eyebrow">YOUR SESSION</div>
        <p className="kv"><span className="k">Name</span><span className="v">{ctx.name}</span></p>
        <p className="kv"><span className="k">Email</span><span className="v">{ctx.email}</span></p>
        <p className="kv"><span className="k">Roles</span><span className="v">{ctx.roles.join(", ")}</span></p>
        <p className="kv">
          <span className="k">Can manage plans</span>
          <span className="v">{can(ctx.roles, "plan.manage") ? "YES" : "NO"}</span>
        </p>
        <p className="kv">
          <span className="k">Can manage settings</span>
          <span className="v">{can(ctx.roles, "settings.manage") ? "YES" : "NO"}</span>
        </p>
      </div>

      <div className="card">
        <div className="eyebrow">INTEGRATION HEALTH</div>
        <p className="kv"><span className="k">Profile</span><span className="v">{integrations.profile}</span></p>
        <p className="kv">
          <span className="k">VIDE adapter</span>
          <span className="v">{integrations.profile === "real" ? "verified endpoints" : "mock (fixture data)"}</span>
        </p>
        <p className="kv">
          <span className="k">Notification provider</span>
          <span className={`v ${notificationHealth.ok ? "ok-text" : "error-text"}`}>{notificationHealth.provider} · {notificationHealth.ok ? "ok" : "down"}</span>
        </p>
        <p className="kv">
          <span className="k">Auth</span>
          <span className="v">built-in (email + password)</span>
        </p>
        <div className="demo-hint" style={{ marginTop: 10 }}>
          Swap to real VIDE by setting INTEGRATION_PROFILE=real + VIDE_API_BASE_URL. Contracts: docs/INTEGRATION_CONTRACTS.md
        </div>
      </div>
    </>
  );
}
