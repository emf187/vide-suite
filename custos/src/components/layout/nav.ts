/** Inline SVG icons for the sidebar — same 16px line style as the sibling Planner. */
const ICONS = {
  today: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  chat: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="13" y2="13"/></svg>',
  people: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/><path d="M16 3.5a4 4 0 0 1 0 7.7"/><path d="M22 21c0-3.2-2-5.7-4.5-6.6"/></svg>',
  about: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};

/** Sidebar navigation config, same shape as the Planner: milestone marks not-yet-built destinations. */
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
    items: [
      { href: "/today", label: "Today", crumb: "OBSERVE / TODAY", milestone: null, icon: ICONS.today },
      { href: "/simulator", label: "WhatsApp Simulator", crumb: "SIMULATOR / LIVE CHAT", milestone: null, icon: ICONS.chat },
      { href: "/people", label: "People", crumb: "WORKSPACE / PEOPLE & CONSENT", milestone: "M2", icon: ICONS.people },
    ],
  },
  {
    label: "SYSTEM",
    items: [{ href: "/about", label: "About", crumb: "SYSTEM / ABOUT CUSTOS", milestone: null, icon: ICONS.about }],
  },
];

export function flattenNav(): NavItem[] {
  return NAV_SECTIONS.flatMap((section) => section.items);
}

export function navLookup(pathname: string): NavItem | null {
  const flat = flattenNav();
  const sorted = [...flat].sort((a, b) => b.href.length - a.href.length);
  return sorted.find((item) => pathname === item.href || item.href !== "/" && pathname.startsWith(`${item.href}/`)) ?? null;
}
