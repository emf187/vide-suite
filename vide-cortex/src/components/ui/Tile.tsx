"use client";

import { useState, type ReactNode } from "react";
import { DASH } from "@/lib/format";
import { cx } from "./cx";

interface TileProps {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  /** Border tint for threshold breaches ("ok" = neutral instrument look). */
  state?: "ok" | "warn" | "crit";
  size?: "lg" | "md";
  /** Soft glass panel instead of solid paper. */
  glass?: boolean;
  /** When this changes the value flashes orange (steppy "machined" pulse). */
  pulseKey?: unknown;
}

/** Big-number stat box — instrument-panel style. Glass variant for dashboards. */
export function Tile({ label, value, unit, sub, state, size = "lg", glass, pulseKey }: TileProps) {
  const [prevKey, setPrevKey] = useState(pulseKey);
  const [tick, setTick] = useState(0);
  if (pulseKey !== prevKey) {
    setPrevKey(pulseKey);
    setTick((t) => t + 1);
  }

  const stateColor =
    state === "crit"
      ? "text-crit border-crit-line"
      : state === "warn"
        ? "text-warn border-warn-line"
        : "text-ink border-line";

  return (
    <div
      className={cx(
        "min-w-0 rounded-xl p-3.5 shadow-sm group transition-all",
        glass
          ? "bg-panel/60 backdrop-blur-md border border-line/50"
          : "bg-panel border border-line",
        stateColor,
        "hover:border-accent hover:-translate-y-0.5 hover:shadow-md",
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-[9px] tracking-[1.5px] text-dim2 uppercase group-hover:text-accent transition-colors">
        {label}
      </div>
      <div className={cx("font-bold break-words", size === "lg" ? "text-[22px]" : "text-base")}>
        <span key={tick} className={cx("inline-block", tick > 0 && "animate-tick")}>
          {value}
        </span>
        {unit && value !== DASH && <span className="ml-1 text-[11px] font-normal text-dim">{unit}</span>}
      </div>
      {sub !== undefined && <div className="mt-1 text-[10px] text-dim2">{sub}</div>}
    </div>
  );
}
