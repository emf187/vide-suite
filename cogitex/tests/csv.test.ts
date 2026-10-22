import { describe, expect, it } from "vitest";
import { parseCsv, rowToRecord } from "@/lib/csv/parse";

describe("CSV parser (RFC-4180 subset)", () => {
  it("handles plain rows", () => {
    const { header, rows } = parseCsv("a,b,c\n1,2,3\n4,5,6");
    expect(header).toEqual(["a", "b", "c"]);
    expect(rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("handles quoted fields with commas, quotes and CRLF", () => {
    const { header, rows } = parseCsv('name,serial\n"Atlas, Nigeria","SN-""8"""\r\nB,2');
    expect(header).toEqual(["name", "serial"]);
    expect(rows[0]).toEqual(["Atlas, Nigeria", 'SN-"8"']);
    expect(rows[1]).toEqual(["B", "2"]);
  });

  it("preserves empty fields and skips fully blank lines", () => {
    const { rows } = parseCsv("a,b\n,values\n\nx,");
    expect(rows).toEqual([["", "values"], ["x", ""]]);
  });

  it("header is lowercased/trimmed for order-free columns", () => {
    const { header } = parseCsv(' Name , TAG ,Category\nx,y,z');
    expect(header).toEqual(["name", "tag", "category"]);
  });

  it("rowToRecord maps header→value and trims", () => {
    expect(rowToRecord(["a", "b"], [" 1 ", "2"])).toEqual({ a: "1", b: "2" });
  });
});
