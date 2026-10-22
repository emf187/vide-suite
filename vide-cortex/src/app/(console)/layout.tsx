import type { ReactNode } from "react";
import { FooterBar } from "@/components/layout/FooterBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { Providers } from "@/providers/Providers";

/** Console chrome (sidebar/topbar/footer) — every cockpit page, but NOT /login. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <div className="flex min-h-screen flex-col md:flex-row">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 px-4 py-[22px] md:px-[26px]">{children}</main>
          <FooterBar />
        </div>
      </div>
    </Providers>
  );
}
