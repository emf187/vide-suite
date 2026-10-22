"use client";

import { useEffect, useState } from "react";

/**
 * Suite-wide simulation switch, client side. State lives on the server (/api/sim →
 * lib/sim/state); this hook mirrors it locally so every page hides its fleet the same
 * moment the SIM toggle flips, no reload needed. localStorage keeps the pre-fetch paint
 * honest; the fetch on mount corrects it against the real state.
 */

const KEY = "vide_sim_enabled";
export const SIM_STATE_EVENT = "vide-sim-state";

function readLocal(): boolean | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // private mode / storage disabled → default ON
  }
  return null;
}

/** Announce a new state to every mounted consumer (used by the SIM toggle button). */
export function announceSimState(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, enabled ? "true" : "false");
  } catch {
    // storage unavailable → event still updates mounted consumers
  }
  window.dispatchEvent(new CustomEvent(SIM_STATE_EVENT, { detail: { enabled } }));
}

export function useSimState(): { simEnabled: boolean } {
  const [enabled, setEnabled] = useState<boolean>(() => readLocal() ?? true);

  useEffect(() => {
    let alive = true;
    fetch("/api/sim", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { enabled?: unknown }) => {
        if (alive && typeof j.enabled === "boolean") {
          setEnabled(j.enabled);
          try {
            localStorage.setItem(KEY, j.enabled ? "true" : "false");
          } catch {
            // storage unavailable → session-local only
          }
        }
      })
      .catch(() => {
        // route unreachable → keep the local mirror
      });
    const handler = (e: Event): void => {
      const v = (e as CustomEvent<{ enabled?: boolean }>).detail?.enabled;
      if (typeof v === "boolean") setEnabled(v);
    };
    window.addEventListener(SIM_STATE_EVENT, handler);
    return () => {
      alive = false;
      window.removeEventListener(SIM_STATE_EVENT, handler);
    };
  }, []);

  return { simEnabled: enabled };
}
