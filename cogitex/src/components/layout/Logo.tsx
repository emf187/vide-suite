/**
 * Cogitex brand assets (client-supplied):
 *  - <Logo /> renders the mark WITHOUT the name — used everywhere in the shell UI.
 *  - <FullLogo /> renders the with-name lockup — reserved for auth/about/contact blocks.
 * Assets are the trimmed transparent PNGs in /public/img. IMPORTANT: they live at
 * `brand-*.png` URLs (not the historical `logo-*.png`) because the M8 service worker
 * cached the historical URLs cache-first with broken-era bytes at the same path —
 * fresh URLs defeat every cache layer; the M9+ SW also bumped its cache version.
 */
export function Logo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/img/brand-mark.png" alt="Cogitex" className={className} draggable={false} />
  );
}

/** With-name lockup — for auth / about / contact surfaces only. */
export function FullLogo({ className, width = 180 }: { className?: string; width?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/img/brand-lockup.png" alt="Cogitex Maintenance Planner" width={width} className={className} draggable={false} />
  );
}
