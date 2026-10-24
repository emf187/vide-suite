const MARK = "O";

/**
 * Custos brand: typography-only (no bitmap carries the name — lesson learned
 * from the Planner's rebrand). The mark is the first letter in the accent
 * chip; the wordmark can evolve in one place.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={`auth-mark ${className ?? ""}`} style={{ display: "inline-flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", fontSize: 13 }}>
      {MARK}
    </span>
  );
}

export function LogoBlock({ sub = "TASK GUARDIAN" }: { sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Logo />
      <div style={{ lineHeight: 1.2 }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: 1.5 }}>CUSTOS</div>
        <div style={{ fontSize: 8.5, letterSpacing: 2, color: "var(--dim)", textTransform: "uppercase" }}>{sub}</div>
      </div>
    </div>
  );
}
