/**
 * No-JS grid editing (sprint item 3): "grids" are plain HTML tables of inputs
 * submitted by ONE server action. Because spec/component rows are paired
 * <input> cells, every field of every row always submits (even when blank) —
 * getAll(name) then yields the values in document order, so pairing by index
 * is reliable. The only unchecked-able control per row (the DELETE checkbox)
 * gets an indexed name instead, since unchecked checkboxes submit nothing.
 */

export type SpecsGrid = Record<string, string | number>;

/**
 * Pairs spec_key / spec_value inputs by submission order.
 * A row survives only when BOTH key and value are non-blank — blanking either
 * removes the spec on save (the grid always renders the full current set, so
 * this replacement matches what the operator sees). Keys are lowercased and
 * duplicated keys collapse to the last submitted value. Numeric-looking
 * values are stored as numbers (same rule as the create form's rated_* fields).
 */
export function parseSpecsGrid(form: FormData): SpecsGrid {
  const keys = form.getAll("spec_key").map(String);
  const values = form.getAll("spec_value").map(String);
  const out = new Map<string, string | number>();
  for (let i = 0; i < Math.max(keys.length, values.length); i++) {
    const key = (keys[i] ?? "").trim().toLowerCase().slice(0, 60);
    const raw = (values[i] ?? "").trim().slice(0, 200);
    if (!key || !raw) continue;
    const num = Number(raw.replace(/,/g, ""));
    out.set(key, Number.isFinite(num) ? num : raw);
  }
  return Object.fromEntries(out);
}

/** Component-kind palette for the BOM grid select (sprint item 3). */
export const COMPONENT_KINDS = [
  "assembly", "motor", "bearing_housing", "seal", "belt", "coupling",
  "pump_end", "gearbox", "filter", "valve", "sensor", "other",
] as const;

export type ComponentGridRow = {
  componentId: string; // "" = blank add-row (insert), set = existing row
  name: string;
  tag: string;
  kind: string;
  note: string;
  remove: boolean;
};

/**
 * Pairs the PARTS/BOM grid rows. Text fields pair by index (they always submit);
 * the REMOVE checkbox per row is named comp_remove_<rowIndex> because a plain
 * name=value checkbox would shift indices when unchecked. Blank-named rows are
 * returned as-is — the caller decides whether blanking an existing row is an
 * error or a no-op.
 */
export function parseComponentGrid(form: FormData): ComponentGridRow[] {
  const ids = form.getAll("comp_id").map(String);
  const names = form.getAll("comp_name").map(String);
  const tags = form.getAll("comp_tag").map(String);
  const kinds = form.getAll("comp_kind").map(String);
  const notes = form.getAll("comp_note").map(String);
  const removeIdx = new Set<number>();
  for (const key of form.keys()) {
    const match = /^comp_remove_(\d+)$/.exec(key);
    if (match && form.get(key) === "1") removeIdx.add(Number(match[1]));
  }
  const rows: ComponentGridRow[] = [];
  for (let i = 0; i < Math.max(ids.length, names.length, tags.length, kinds.length, notes.length); i++) {
    rows.push({
      componentId: (ids[i] ?? "").trim(),
      name: (names[i] ?? "").trim().slice(0, 120),
      tag: (tags[i] ?? "").trim().slice(0, 40),
      kind: (kinds[i] ?? "").trim().slice(0, 40),
      note: (notes[i] ?? "").trim().slice(0, 300),
      remove: removeIdx.has(i),
    });
  }
  return rows;
}
