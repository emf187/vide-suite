/**
 * Minimal RFC-4180-ish CSV parser (handles quoted fields, escaped quotes, CRLF).
 * Keeps the import path dependency-free and unit-testable.
 */
export type CsvRow = string[];

export function parseCsv(text: string): { header: string[]; rows: CsvRow[] } {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let sawAnything = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    sawAnything = true;
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      // swallow; \n handles the row break
    } else {
      field += ch;
    }
  }
  if (sawAnything && (field !== "" || row.length > 0)) pushRow();

  const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  return { header, rows: rows.slice(1) };
}

export function rowToRecord(header: string[], row: CsvRow): Record<string, string> {
  const out: Record<string, string> = {};
  header.forEach((key, i) => {
    const value = row[i];
    if (value !== undefined) out[key] = value.trim();
  });
  return out;
}
