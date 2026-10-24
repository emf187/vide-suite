/**
 * Orgo brand: the mark is the client-supplied PNG WITHOUT the name
 * (brand-*.png URLs — chosen over the historical logo-*.png because the M8
 * service worker cached those cache-first with broken-era bytes; fresh URLs
 * defeat every cache layer, and the M9+ SW bumped its cache version anyway).
 * The wordmark is TEXT (never baked into pixels): the product name is Orgo,
 * so the name can change in one place — this component — when it does.
 */

/** The mark alone — used everywhere in the shell UI. */
export function Logo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/img/brand-mark.png" alt="Orgo" className={className} draggable={false} />
  );
}

/** Full lockup (mark + wordmark + role line) — for auth / about / print surfaces. */
export function FullLogo({ width = 200 }: { width?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/img/brand-mark.png" alt="Orgo mark" style={{ width: Math.round(width * 0.26), height: "auto" }} draggable={false} />
      <div style={{ lineHeight: 1.25 }}>
        <div style={{ fontWeight: 800, fontSize: Math.round(width * 0.12), letterSpacing: 2 }}>ORGO</div>
        <div style={{ fontSize: Math.max(8, Math.round(width * 0.055)), letterSpacing: 2, color: "var(--dim)" }}>
          MAINTENANCE MANAGER
        </div>
      </div>
    </div>
  );
}
