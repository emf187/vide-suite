import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { csvFilename } from "@/server/services/reports";

/**
 * Brand contract — the product name is ORGO ("the maintenance manager").
 * The codename Cogitex survives only in infra identifiers (cookies, log
 * prefixes, mirror folder), never in what a user sees exported/installed.
 */
describe("ORGO branding contract", () => {
  it("the PWA installs as Orgo", () => {
    const m = manifest();
    expect(m.name).toBe("ORGO Maintenance Manager");
    expect(m.short_name).toBe("ORGO");
  });

  it("report exports download as orgo-* files", () => {
    const r = { kind: "plant_summary", generatedAt: new Date("2026-02-14T10:00:00Z") };
    expect(csvFilename(r)).toBe("orgo-plant_summary-2026-02-14.csv");
    expect(csvFilename(r).startsWith("orgo-")).toBe(true);
    expect(csvFilename(r).includes("cogitex")).toBe(false);
  });
});
