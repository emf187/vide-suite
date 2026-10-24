import { iconFor, NAV_SECTIONS } from "./nav";

type SidebarProps = { orgName: string; userName: string; role: string };

/** Server-rendered brand + nav shell (no client JS — Custos stays JS-free by default). */
export function Sidebar({}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="auth-mark logo" style={{ display: "inline-flex", width: 30, height: 30, alignItems: "center", justifyContent: "center", fontSize: 14 }}>
          O
        </span>
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
              <a key={item.href} href={item.href}>
                <span className="nav-icon" dangerouslySetInnerHTML={{ __html: iconFor[item.icon] ?? "" }} />
                <span className="nav-label">{item.label}</span>
              </a>
            ))}
          </nav>
        </div>
      ))}
      <div className="sidebar-footer">
        <div style={{ fontSize: 9, color: "var(--dim2)", letterSpacing: 1 }}> messaging: SIMULATOR (M1)</div>
      </div>
    </aside>
  );
}
