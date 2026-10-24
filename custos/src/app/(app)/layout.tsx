import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { getCtx } from "@/server/ctx";

/** Authenticated area: builds the Ctx (org + role from the verified session) and renders the shell. */
export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  if (!ctx) {
    redirect("/login");
  }
  return <AppShell ctx={ctx}>{children}</AppShell>;
}
