/*
 * Visual tokens for Cogitex Maintenance Planner.
 * ORIGIN: copied verbatim from the VIDE main app front-end
 *   (vide manage/index.html, :root CSS variables + typography).
 * These mirror the CSS custom properties in src/styles/globals.css.
 * Do NOT invent new visual styles here — extend only with reviewed additions (see ARCHITECTURE.md §3).
 */

export const color = {
  // dark theme (default)
  bg: "#0b0c10",
  panel: "#131519",
  line: "#24262c",
  lineLit: "#3a3d46",
  ink: "#e7e8ec",
  dim: "#71757f",
  dim2: "#4b4e57",
  grad1: "#ff3d1a",
  grad2: "#ff9d1a",
  accent: "#ff7a1a",
  ok: "#3ddc84",
  warn: "#ffd020",
  high: "#ffb020",
  crit: "#ff5252",
} as const;

export const lightColor = {
  bg: "#f2f3f5",
  panel: "#ffffff",
  line: "#d8dbe0",
  lineLit: "#b9bec7",
  ink: "#16181d",
  dim: "#5b606b",
  dim2: "#9a9faa",
  accent: "#e85d04",
  ok: "#0d7a3f",
  warn: "#8a6d00",
  high: "#b25e00",
  crit: "#d00000",
} as const;

export const font = {
  stack: "'JetBrains Mono', 'Consolas', monospace",
} as const;

export const radius = { none: 0 } as const; // VIDE look: sharp corners everywhere
export const borderWidth = { base: 2 } as const;

export type ColorToken = keyof typeof color;
