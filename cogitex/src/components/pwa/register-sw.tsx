"use client";

import { useEffect } from "react";

/**
 * Production: register the static-only service worker.
 * Development: actively UNREGISTER any service worker and clear all caches.
 *
 * The unregister matters: a service worker installed on this origin by an
 * earlier production build (or a legacy pre-guard registration) keeps serving
 * stale dev chunks forever — hydration silently dies ("clicks do nothing",
 * chat forms submit natively as GET). Dev heals the origin on every load.
 */
export function RegisterSw() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((r) => r.unregister().catch(() => {}));
        }).catch(() => {});
      }
      if ("caches" in window) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k).catch(() => {}))).catch(() => {});
      }
      return;
    }
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* non-fatal: app works fully without the SW */
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
