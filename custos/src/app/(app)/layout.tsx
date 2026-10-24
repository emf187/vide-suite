import { redirect } from "next/navigation";
import { getCtx } from "@/server/ctx";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";

/** Authenticated area for Custos: ctx from the session, shell around children. */
export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  return (
    <div className="shell">
      <Sidebar orgName={ctx.orgName} userName={ctx.name} role={ctx.role} />
      <div className="main">
        <TopBar orgName={ctx.orgName} />
        <div className="content" id="main-content">
          {children}
        </div>
        <footer className="footerbar">
          <span>CUSTOS · TASK GUARDIAN</span>
          <span>{ctx.orgName.toUpperCase()} · ROLE {ctx.role.toUpperCase()}</span>
        </footer>
      </div>
    </div>
  );
}
