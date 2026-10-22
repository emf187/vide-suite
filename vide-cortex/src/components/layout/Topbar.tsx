"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Modal } from "@/components/ui";
import { NAV_ITEMS } from "@/lib/constants";
import { useTheme } from "@/hooks/useTheme";
import { useApi } from "@/providers/ApiProvider";
import { usePageTitleValue } from "@/providers/PageTitleProvider";
import { suiteLogoutAction } from "@/app/login/actions";
import { ConnectionPanel } from "./ConnectionPanel";
import { connectionLabel } from "./connectionLabel";
import { SimToggle } from "./SimToggle";
import { isActive } from "./Sidebar";

export function useSection(): string {
  const pathname = usePathname();
  return NAV_ITEMS.find((n) => isActive(pathname, n.href))?.section ?? "CONSOLE";
}

export function Topbar() {
  const section = useSection();
  const pageTitle = usePageTitleValue();
  const { status, useMocks, factoryName } = useApi();
  const { theme, toggle } = useTheme();
  const [sourceOpen, setSourceOpen] = useState(false);
  const label = connectionLabel(status, useMocks);
  const plannerUrl = (process.env.NEXT_PUBLIC_SUITE_COAPP_URL ?? "http://localhost:3030").replace(/\/$/, "");

  return (
    <header className="no-print flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-4 py-4 md:px-[26px]">
      <div className="min-w-0">
        <div className="text-[10px] tracking-[1.5px] text-dim2">CONTROL ROOM / {section}</div>
        <div className="mt-[3px] truncate text-sm font-bold">{pageTitle ?? factoryName ?? "No workspace connected"}</div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <SimToggle />
        <a
          href={`${plannerUrl}/today`}
          title="Open the Cogitex Maintenance Planner — already signed in via the suite"
          className="rounded-lg border border-line-lit bg-transparent px-[9px] py-[5px] text-[10px] font-bold tracking-[.4px] text-ink shadow-sm hover:border-accent hover:text-accent active:scale-[0.98]"
        >
          PLANNER ↗
        </a>
        <form action={suiteLogoutAction}>
          <button
            type="submit"
            title="End the suite session on this device (planner signs out separately)"
            className="rounded-lg border border-line bg-transparent px-[9px] py-[5px] text-[10px] font-bold tracking-[.4px] text-dim shadow-sm hover:border-crit hover:text-crit active:scale-[0.98]"
          >
            SIGN OUT
          </button>
        </form>
        <Button variant="secondary" size="sm" onClick={() => setSourceOpen(true)} title="Backend URL / mock data">
          SOURCE
        </Button>
        <Button variant="secondary" size="sm" onClick={toggle} title="Toggle light / dark mode">
          {theme === "light" ? "DARK" : "LIGHT"}
        </Button>
        <span className="hidden sm:inline-flex">
          <Badge tone={label.tone}>{label.badge}</Badge>
        </span>
      </div>

      <Modal open={sourceOpen} title="DATA SOURCE" onClose={() => setSourceOpen(false)}>
        <ConnectionPanel />
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => setSourceOpen(false)}>
            Close
          </Button>
        </div>
      </Modal>
    </header>
  );
}
