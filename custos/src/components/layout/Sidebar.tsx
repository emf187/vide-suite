"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "./Logo";
import { NAV_SECTIONS } from "./nav";

type SidebarProps = {
  orgName: string;
  userName: string;
  statusLabel: string;
  live: boolean;
};

/**
 * VIDE-style sidebar ported 1:1 from the sibling Planner (230px rail, brand
 * block, eyebrow sections, accent active bar; off-canvas drawer on mobile).
 * The one client island of the shell — same discipline as ORGO.
 */
export function Sidebar({ orgName, userName, statusLabel, live }: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <>
      <div className="brand">
        <Logo className="logo" />
        <div>
          <div className="name">CUSTOS</div>
          <div className="sub">TASK GUARDIAN</div>
        </div>
      </div>

      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <div className="nav-section">{section.label}</div>
          <nav className="nav">
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={pathname === item.href || pathname.startsWith(`${item.href}/`) ? "active" : undefined}
              >
                <span className="nav-icon" style={{ flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: item.icon }} />
                <span className="nav-label">{item.label}</span>
                {item.milestone ? <span style={{ opacity: 0.55 }}> ·</span> : null}
              </Link>
            ))}
          </nav>
        </div>
      ))}

      <div className="sidebar-footer">
        <div style={{ marginBottom: 6 }}>
          <span className={`status-dot${live ? " live" : ""}`}></span>
          {statusLabel}
        </div>
        <div style={{ color: "var(--dim)", marginBottom: 2 }}>{orgName}</div>
        <div>{userName}</div>
      </div>
    </>
  );

  return (
    <>
      {open ? <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" /> : null}
      <aside className={`sidebar${open ? " nav-open" : ""}`} aria-label="Primary">
        {nav}
      </aside>
      <button
        className="nav-toggle secondary"
        style={{ position: "fixed", right: 14, bottom: 14, zIndex: 60, padding: "11px 16px", borderRadius: 12 }}
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle navigation"
        aria-expanded={open}
      >
        <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>{open ? "✕" : "☰"}</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2 }}>{open ? "CLOSE" : "MENU"}</span>
      </button>
    </>
  );
}
