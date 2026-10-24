import type { IntegrationProfile } from "@/lib/integrations/factory";

/** Inline SVG icons for the sidebar tabs. Consistent 16px line style. */
const ICONS = {
  today: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  machines: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><circle cx="12" cy="13" r="4"/></svg>',
  planning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  "work-orders": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="14" rx="2" ry="2"/><path d="M16 10V6"/><path d="M8 14v2"/><path d="M12 18v-2"/></svg>',
  faults: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  inventory: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 14V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"/><polyline points="3 10 12 1 21 10"/></svg>',
  repairs: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 16.2l-1.3-1.3"/></svg>',
  reports: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  agent: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z"/><line x1="12" y1="12" x2="12.01" y2="12"/></svg>',
  settings: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2v0a2 2 0 0 1-2-2v0a2 2 0 0 1-2-2v-0.9a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-.33-1.82A1.65 1.65 0 0 0 2 13v-6a2 2 0 0 1 2-2 2 2 0 0 1 2 2v0a2 2 0 0 1 2 2v0a2 2 0 0 1 2 2v6a1.65 1.65 0 0 0-.33 1.82z"/></svg>',
  locations: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  about: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  library: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="13" y2="11"/></svg>',
  audit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>',
};

/** Sidebar navigation config. `milestone` gating marks not-yet-built destinations. */
export type NavItem = {
  href: string;
  label: string;
  crumb: string;
  milestone: string | null; // null = built now
  icon: string; // inline SVG markup
};

export type NavSection = { label: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "WORKSPACE",
    items: [{ href: "/today", label: "Today", crumb: "OPERATIONS / TODAY", milestone: null, icon: ICONS.today }],
  },
  {
    label: "OPERATE",
    items: [
      { href: "/machines", label: "Machines", crumb: "ASSET REGISTRY / MACHINES", milestone: null, icon: ICONS.machines },
      { href: "/planning", label: "Planning", crumb: "PLANNING / CALENDAR & BACKLOG", milestone: null, icon: ICONS.planning },
      { href: "/work-orders", label: "Work Orders", crumb: "OPERATE / WORK ORDERS", milestone: null, icon: ICONS["work-orders"] },
      { href: "/faults", label: "Faults", crumb: "OPERATE / FAULTS & ALARMS", milestone: null, icon: ICONS.faults },
      { href: "/inventory", label: "Inventory", crumb: "OPERATE / INVENTORY & LEDGER", milestone: null, icon: ICONS.inventory },
      { href: "/repairs", label: "Repair Requests", crumb: "MARKETPLACE / REPAIR REQUESTS", milestone: null, icon: ICONS.repairs },
      { href: "/library", label: "Library", crumb: "DOCUMENTATION / LIBRARY", milestone: null, icon: ICONS.library },
    ],
  },
  {
    label: "INTELLIGENCE",
    items: [
      { href: "/reports", label: "Reports", crumb: "INTELLIGENCE / REPORTS", milestone: null, icon: ICONS.reports },
      { href: "/agent", label: "Agent", crumb: "INTELLIGENCE / MAINTENANCE AGENT", milestone: null, icon: ICONS.agent },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { href: "/settings", label: "Settings", crumb: "SYSTEM / SETTINGS", milestone: null, icon: ICONS.settings },
      { href: "/settings/locations", label: "Locations", crumb: "SYSTEM / LOCATIONS", milestone: null, icon: ICONS.locations },
      { href: "/audit", label: "Audit trail", crumb: "SYSTEM / AUDIT TRAIL", milestone: null, icon: ICONS.audit },
      { href: "/about", label: "About", crumb: "SYSTEM / ABOUT THE APP", milestone: null, icon: ICONS.about },
    ],
  },
];

export function flattenNav(): NavItem[] {
  return NAV_SECTIONS.flatMap((section) => section.items);
}

export function navLookup(pathname: string): NavItem | null {
  const flat = flattenNav();
  const sorted = [...flat].sort((a, b) => b.href.length - a.href.length);
  return sorted.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) ?? null;
}

export function profileLabel(profile: IntegrationProfile): string {
  return profile === "real" ? "VIDE LIVE" : "MOCK ADAPTERS";
}
