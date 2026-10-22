"use client";

import { useApi } from "@/providers/ApiProvider";
import { connectionLabel } from "./connectionLabel";
import { useSection } from "./Topbar";

/** Suite bridge — where Cogitex Maintenance lives (env-config, local fallback). */
export const COAPP_URL = process.env.NEXT_PUBLIC_SUITE_COAPP_URL ?? "http://localhost:3030";

export function FooterBar() {
  const section = useSection();
  const { status, useMocks } = useApi();

  return (
    <footer className="no-print flex items-center justify-between gap-2.5 border-t-2 border-line px-4 py-2.5 text-[10px] tracking-[.5px] text-dim2 md:px-[26px]">
      <span>VIDE CORTEX / {section}</span>
      <span className="flex items-center gap-4">
        <span className="hidden md:inline">{connectionLabel(status, useMocks).footer}</span>
        <a
          href={COAPP_URL}
          target="_blank"
          rel="noreferrer"
          className="border border-accent px-2 py-1 text-accent transition-colors hover:bg-accent hover:text-on-accent"
        >
          OPEN COGITEX MAINTENANCE ↗
        </a>
      </span>
    </footer>
  );
}
