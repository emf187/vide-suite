"use client";

/**
 * SIM toggle (the suite-wide simulation switch). One button flips the SIM engine for
 * the WHOLE suite: VIDE's /api/* routes gate on it (so Cogitex's real adapter sees
 * empty/disabled telemetry immediately), and this console hides its fleet through
 * useSimState(). Turning the sim back ON re-pushes the fleet to Cogitex so both apps
 * regain matching data with a single click.
 */
import { useState } from "react";
import { Button, cx } from "@/components/ui";
import { announceSimState, useSimState } from "@/hooks/useSimState";

type Phase = "idle" | "busy" | "error";

export function SimToggle() {
  const { simEnabled } = useSimState();
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState("");

  async function toggle() {
    if (phase === "busy") return;
    const next = !simEnabled;
    setPhase("busy");
    setDetail(next ? "starting simulation…" : "pausing simulation…");
    try {
      const res = await fetch("/api/sim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "toggle", enabled: next }),
      });
      const json = (await res.json()) as { ok?: boolean; enabled?: boolean; error?: string };
      if (!res.ok || !json.ok || typeof json.enabled !== "boolean") {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      announceSimState(json.enabled);
      if (json.enabled) {
        // Suite-wide: restore Cogitex with a fresh fleet push (best-effort in the background).
        void fetch("/api/sim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "push" }),
        })
          .then((r) => (r.ok ? null : Promise.reject(new Error(`push HTTP ${r.status}`))))
          .catch(() => setDetail("sim running — fleet push to Cogitex failed (ingest unreachable)"));
      }
      setDetail(json.enabled ? "simulation running · fleet pushed to Cogitex" : "simulation paused across the suite");
      setTimeout(() => setDetail(""), 6000);
      setPhase("idle");
    } catch (e) {
      setDetail(String((e as Error).message).slice(0, 60));
      setPhase("error");
      setTimeout(() => setPhase("idle"), 4500);
    }
  }

  const dying = !simEnabled;

  return (
    <span className="inline-flex flex-col items-end gap-[3px]">
      <Button
        variant={dying ? "secondary" : "primary"}
        size="sm"
        onClick={toggle}
        disabled={phase === "busy" || phase === "error"}
        title="Turn the SIM engine on/off for the whole suite (VIDE console + CogitexMaintenance telemetry)"
      >
        {phase === "busy" ? "SWITCHING…" : dying ? "SIM OFF" : "SIM ON"}
      </Button>
      <span
        className={cx(
          "flex max-w-[240px] justify-end truncate text-[9px] leading-none tracking-[.5px] text-dim2",
          !detail ? "opacity-0" : "",
        )}
        aria-live="polite"
      >
        {detail || "·"}
      </span>
    </span>
  );
}
