/**
 * Time helpers — timestamps stored UTC, displayed in the org timezone
 * (default Africa/Lagos per docs/DATA_MODEL.md conventions).
 */
export const DEFAULT_DISPLAY_TZ = "Africa/Lagos";

const dtf = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEFAULT_DISPLAY_TZ,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDateTime(input: string | Date, timeZone: string = DEFAULT_DISPLAY_TZ): string {
  const date = typeof input === "string" ? new Date(input) : input;
  if (timeZone === DEFAULT_DISPLAY_TZ) return dtf.format(date);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** "Good morning/afternoon/evening" in the display timezone. */
export function greeting(input: string | Date, timeZone: string = DEFAULT_DISPLAY_TZ): "morning" | "afternoon" | "evening" {
  const date = typeof input === "string" ? new Date(input) : input;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(date),
  );
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
