/**
 * Cursor-aware text-editing math for the note editor (mini note app sprint).
 * Pure string/offset functions — unit-tested — so the tiny client component
 * stays a thin wrapper and the server keeps owning all persistence. With JS
 * disabled the toolbar buttons still submit to the server action (append
 * skeletons at the end); with JS they edit at the cursor and cancel the
 * round-trip. Rendering stays server-only (escape-first) — these helpers
 * never render, they only move text around.
 */
import { NOTE_BODY_MAX } from "./note-editor";

export type EditResult = { text: string; selStart: number; selEnd: number };

function capGuard(next: string, max: number): void {
  if (next.length > max) throw new Error(`body_too_large:${max}`);
}

/**
 * Wrap (or unwrap, toggle-style) the selection between a mark pair.
 * Empty selection gets the filler placeholder. Returns the text with the
 * selection restored over the inner content.
 */
export function wrapInline(
  text: string,
  selStart: number,
  selEnd: number,
  mark: string,
  filler: string,
  max: number = NOTE_BODY_MAX,
): EditResult {
  const s = Math.min(selStart, selEnd);
  const e = Math.max(selStart, selEnd);
  const selected = text.slice(s, e);
  const isWrapped =
    selected.length >= mark.length * 2 && selected.startsWith(mark) && selected.endsWith(mark);
  if (isWrapped) {
    const inner = selected.slice(mark.length, selected.length - mark.length);
    const next = text.slice(0, s) + inner + text.slice(e);
    capGuard(next, max);
    return { text: next, selStart: s, selEnd: s + inner.length };
  }
  const inner = selected || filler;
  const next = text.slice(0, s) + mark + inner + mark + text.slice(e);
  capGuard(next, max);
  return { text: next, selStart: s + mark.length, selEnd: s + mark.length + inner.length };
}

/**
 * Turn the selection into a markdown link: selected text becomes the link
 * text, empty spot gets a placeholder. Target is inserted for real editing.
 */
export function wrapLink(
  text: string,
  selStart: number,
  selEnd: number,
  target: string = "https://",
  max: number = NOTE_BODY_MAX,
): EditResult {
  const s = Math.min(selStart, selEnd);
  const e = Math.max(selStart, selEnd);
  const selected = text.slice(s, e);
  const inner = selected || "link text";
  const next = text.slice(0, s) + `[${inner}](${target})` + text.slice(e);
  capGuard(next, max);
  const mark = 1 + inner.length + 2; // "[" + inner + "]("
  return { text: next, selStart: s + mark, selEnd: s + mark + target.length };
}

/**
 * Toggle a line-level prefix (heading `## `, bullets `- `, tasks `- [ ] `, …)
 * across every line the selection touches (selection expands to full lines).
 * Prefixes empty lines when adding? No — empty lines never get one; when all
 * non-empty lines already carry it, removes it. Selection restored over the
 * same line span.
 */
export function toggleLinePrefix(
  text: string,
  selStart: number,
  selEnd: number,
  prefix: string,
  max: number = NOTE_BODY_MAX,
): EditResult {
  const s = Math.min(selStart, selEnd);
  const e = Math.max(selStart, selEnd);
  const lineStart = s === 0 ? 0 : text.lastIndexOf("\n", s - 1) + 1;
  const nl = text.indexOf("\n", e);
  const lineEnd = nl === -1 ? text.length : nl;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const allHave = lines.filter((l) => l.trim() !== "").every((l) => l.startsWith(prefix));
  const toggled = allHave
    ? lines.map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l)).join("\n")
    : lines.map((l) => (l.trim() === "" || l.startsWith(prefix) ? l : prefix + l)).join("\n");
  const next = text.slice(0, lineStart) + toggled + text.slice(lineEnd);
  capGuard(next, max);
  return { text: next, selStart: lineStart, selEnd: lineStart + toggled.length };
}

/** Insert a snippet exactly at an offset; cursor lands after the snippet. */
export function insertSnippet(
  text: string,
  pos: number,
  snippet: string,
  max: number = NOTE_BODY_MAX,
): EditResult {
  const clamped = Math.min(Math.max(pos, 0), text.length);
  const needsBlank =
    clamped > 0 && text[clamped - 1] !== "\n" && !snippet.startsWith("\n");
  const leading = needsBlank ? "\n\n" : "";
  const next = text.slice(0, clamped) + leading + snippet + text.slice(clamped);
  capGuard(next, max);
  const cursor = clamped + leading.length;
  return { text: next, selStart: cursor, selEnd: cursor };
}
