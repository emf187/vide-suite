import { describe, expect, it } from "vitest";
import { formatKobo, nairaToKobo, koboToNaira } from "@/lib/money";
import { formatDateTime, greeting } from "@/lib/time";

describe("money (integer kobo)", () => {
  it("formats NGN kobo", () => {
    expect(formatKobo(4_500_000, "NGN")).toContain("45,000");
  });

  it("converts naira↔kobo without float drift", () => {
    expect(nairaToKobo(45_000)).toBe(4_500_000);
    expect(koboToNaira(4_500_000)).toBe(45_000);
    expect(nairaToKobo(0.07)).toBe(7);
  });
});

describe("time (Africa/Lagos display over UTC storage)", () => {
  it("renders 00:30Z as 01:30 Lagos", () => {
    expect(formatDateTime("2026-01-01T00:30:00Z")).toBe("01 Jan 2026, 01:30");
  });

  it("renders a midday instant in the evening band correctly", () => {
    expect(greeting("2026-01-01T10:00:00Z")).toBe("morning"); // 11:00 Lagos
    expect(greeting("2026-01-01T16:00:00Z")).toBe("evening"); // 17:00 Lagos
    expect(greeting("2026-01-01T15:00:00Z")).toBe("afternoon"); // 16:00 Lagos
  });
});
