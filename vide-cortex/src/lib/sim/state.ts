/**
 * SIM state (suite-wide simulation switch).
 *
 * One flag controls the whole VIDE suite: every /api/* route gates on it, Cogitex's
 * real adapter sees "disabled" instantly (it polls these same routes), and the console
 * hides its fleet through the useSimState() client hook. Persisted to .sim-state.json
 * (gitignored) so the choice survives dev restarts; on read-only filesystems (Vercel)
 * the write silently no-ops and the flag lives in the process memory until cold start.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const g = globalThis as typeof globalThis & { __videSimEnabled?: boolean };

function loadOnce(): boolean {
  if (g.__videSimEnabled !== undefined) return g.__videSimEnabled;
  let enabled = true; // default: the SIM demo fleet is running
  try {
    const raw = readFileSync(path.join(process.cwd(), ".sim-state.json"), "utf8");
    const parsed = JSON.parse(raw) as { enabled?: unknown };
    if (typeof parsed.enabled === "boolean") enabled = parsed.enabled;
  } catch {
    // first boot / no file / read-only fs → default ON
  }
  g.__videSimEnabled = enabled;
  return enabled;
}

export function simEnabled(): boolean {
  return loadOnce();
}

export function setSimEnabled(enabled: boolean): void {
  g.__videSimEnabled = enabled;
  try {
    writeFileSync(path.join(process.cwd(), ".sim-state.json"), JSON.stringify({ enabled }), "utf8");
  } catch {
    // read-only filesystem (serverless) → in-memory only until cold start
  }
}
