/**
 * Note editor support (note-taker sprint): the block skeletons a no-JS editor
 * can insert. A word-processor toolbar that inserts at the cursor needs client
 * JS; the suite is deliberately JS-free, so insert buttons append block-level
 * markdown (headings, lists, tables, rules, tasks) at the end of the draft —
 * the natural rhythm of building structured notes top-to-bottom — and every
 * interaction persists the draft, so nothing typed is ever silently lost.
 */

export type InsertBlockKind =
  | "bold"
  | "italic"
  | "inlinecode"
  | "link"
  | "heading"
  | "bullets"
  | "numbered"
  | "table"
  | "rule"
  | "task";

/** Insert-toolbar labels, in toolbar order (inline marks first — a mini word processor). */
export const INSERT_BLOCKS: ReadonlyArray<{ kind: InsertBlockKind; label: string }> = [
  { kind: "bold", label: "B" },
  { kind: "italic", label: "I" },
  { kind: "inlinecode", label: "CODE" },
  { kind: "link", label: "LINK" },
  { kind: "heading", label: "H" },
  { kind: "bullets", label: "• LIST" },
  { kind: "numbered", label: "1. LIST" },
  { kind: "table", label: "TABLE" },
  { kind: "rule", label: "RULE" },
  { kind: "task", label: "TASK" },
];

/** Editor cap matches the machine-notes body cap (one shared limit). */
export const NOTE_BODY_MAX = 60000;

const SKELETONS: Record<InsertBlockKind, string> = {
  bold: "**bold**\n",
  italic: "*italic*\n",
  inlinecode: "`code`\n",
  link: "[link text](https://example.com)\n",
  heading: "## Heading\n",
  bullets: "- point one\n- point two\n",
  numbered: "1. step one\n2. step two\n",
  table: "| column 1 | column 2 | column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n",
  rule: "---\n",
  task: "- [ ] todo\n",
};
/**
 * Append a block skeleton to the draft (with sane blank-line separation).
 * Throws `unknown_block` for anything not in INSERT_BLOCKS, and
 * `body_too_large:<cap>` when the result would exceed the cap.
 */
export function appendBlock(
  body: string,
  kind: string,
  max = NOTE_BODY_MAX,
): string {
  const skeleton = SKELETONS[kind as InsertBlockKind];
  if (!skeleton) throw new Error(`unknown_block:${kind}`);
  const trimmed = body.trimEnd();
  const next =
    trimmed.length === 0
      ? skeleton
      : `${trimmed}\n\n${skeleton}`.replace(/\n{3,}$/, "\n\n");
  if (next.length > max) throw new Error(`body_too_large:${max}`);
  return next;
}
