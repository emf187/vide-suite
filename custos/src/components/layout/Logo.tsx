/**
 * Custos brand: TEXT-ONLY mark (lesson carried from the Planner's rebrand —
 * no bitmap ever carries the name). The "C" chip renders from tokens, so a
 * future rename touches exactly one component.
 */

/** The mark alone — used in the sidebar brand block and auth surfaces. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: "inline-flex",
        width: 26,
        height: 26,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        background: "var(--accent)",
        color: "var(--accent-ink)",
        fontFamily: "var(--font-mono)",
        fontWeight: 700,
        fontSize: 14,
        flexShrink: 0,
      }}
    >
      C
    </span>
  );
}

/** Full lockup (mark + wordmark + role line) — auth / about surfaces. */
export function FullLogo({ width = 200 }: { width?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div
        aria-hidden="true"
        style={{
          display: "inline-flex",
          width: Math.round(width * 0.26),
          height: Math.round(width * 0.26),
          alignItems: "center",
          justifyContent: "center",
          borderRadius: Math.round(width * 0.09),
          background: "var(--accent)",
          color: "var(--accent-ink)",
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: Math.round(width * 0.14),
        }}
      >
        C
      </div>
      <div style={{ lineHeight: 1.25 }}>
        <div style={{ fontWeight: 800, fontSize: Math.round(width * 0.12), letterSpacing: 2 }}>CUSTOS</div>
        <div style={{ fontSize: Math.max(8, Math.round(width * 0.055)), letterSpacing: 2, color: "var(--dim)" }}>
          TASK GUARDIAN
        </div>
      </div>
    </div>
  );
}
