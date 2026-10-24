"use client";

/**
 * Note editor surface — the one deliberate client-JS island in Cogitex
 * (mini note app, by design decision): toolbar edits happen at the cursor so
 * writing feels like a real note app. Everything else is unchanged:
 * the textarea still lives inside the SERVER form, SAVE/PREVIEW still hit the
 * audited server action, and rendering stays server-side escape-first.
 *
 * Progressive enhancement: without JS, the same buttons submit
 * `intent=append:<kind>` to the server action (block skeletons at the end) —
 * the editor still fully works, just without cursor placement.
 */
import { useRef, useState, type MouseEvent } from "react";
import { INSERT_BLOCKS, NOTE_BODY_MAX, TOOL_TIPS } from "@/lib/note-editor";
import { insertSnippet, toggleLinePrefix, wrapInline, wrapLink } from "@/lib/note-editing";

type EditFn = (text: string, selStart: number, selEnd: number) => { text: string; selStart: number; selEnd: number };

const TABLE = "| column 1 | column 2 | column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |";

export default function NoteEditorSurface({ body, placeholder }: { body: string; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(body);
  const [warn, setWarn] = useState<string | null>(null);
  const words = value.split(/\s+/).filter(Boolean).length;

  const apply = (edit: EditFn): boolean => {
    const ta = ref.current;
    if (!ta) return false;
    try {
      const r = edit(ta.value, ta.selectionStart ?? ta.value.length, ta.selectionEnd ?? ta.value.length);
      setValue(r.text);
      requestAnimationFrame(() => {
        if (!ref.current) return;
        ref.current.focus();
        ref.current.setSelectionRange(r.selStart, r.selEnd);
      });
      setWarn(null);
      return true;
    } catch {
      setWarn("The note is at its 60 000-character cap — trim before inserting more.");
      return true; // swallow the submit locally: there is nothing useful for the server to append
    }
  };

  const toolbarClick = (kindOrIntent: string) => (e: MouseEvent<HTMLButtonElement>) => {
    // no-JS fallback: let the button submit `append:<kind>` to the server action
    if (typeof window === "undefined") return;
    const kind = kindOrIntent.startsWith("append:") ? kindOrIntent.slice("append:".length) : kindOrIntent;
    let handled = true;
    switch (kind) {
      case "bold": handled = apply((t, s, e2) => wrapInline(t, s, e2, "**", "bold text")); break;
      case "italic": handled = apply((t, s, e2) => wrapInline(t, s, e2, "*", "italic")); break;
      case "inlinecode": handled = apply((t, s, e2) => wrapInline(t, s, e2, "`", "code")); break;
      case "link": handled = apply((t, s, e2) => wrapLink(t, s, e2)); break;
      case "heading": handled = apply((t, s, e2) => toggleLinePrefix(t, s, e2, "## ")); break;
      case "bullets": handled = apply((t, s, e2) => toggleLinePrefix(t, s, e2, "- ")); break;
      case "numbered": handled = apply((t, s, e2) => toggleLinePrefix(t, s, e2, "1. ")); break;
      case "task": handled = apply((t, s, e2) => toggleLinePrefix(t, s, e2, "- [ ] ")); break;
      case "table": handled = apply((t, s, e2) => insertSnippet(t, e2, TABLE)); break;
      case "rule": handled = apply((t, s, e2) => insertSnippet(t, e2, "---\n")); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  };

  return (
    <>
      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 10, alignItems: "center" }}>
        {INSERT_BLOCKS.map((b) => (
          <span key={b.kind} style={{ display: "contents" }}>
            {/* divider between the formatting group and the block-insert group */}
            {b.kind === "heading" ? (
              <span aria-hidden="true" style={{ width: 1, height: 18, background: "var(--line)", margin: "0 4px", display: "inline-block" }} />
            ) : null}
            <button
              type="submit"
              name="intent"
              value={`append:${b.kind}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={toolbarClick(b.kind)}
              className="secondary"
              title={TOOL_TIPS[b.kind]}
              aria-label={TOOL_TIPS[b.kind]}
              style={{
                fontSize: 11,
                padding: "4px 10px",
                minWidth: b.label.length <= 2 ? 34 : undefined,
                fontWeight: b.kind === "bold" ? 700 : undefined,
                fontStyle: b.kind === "italic" ? "italic" : undefined,
                fontFamily: b.kind === "inlinecode" ? "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" : undefined,
              }}
            >
              {b.label}
            </button>
          </span>
        ))}
        <span style={{ fontSize: 10, color: "var(--dim2)", marginLeft: "auto" }}>
          {words} words · {value.length}/{NOTE_BODY_MAX}
        </span>
      </div>

      <textarea
        ref={ref}
        name="body"
        value={value}
        maxLength={NOTE_BODY_MAX}
        onChange={(e) => { setValue(e.target.value); setWarn(null); }}
        placeholder={placeholder}
        aria-label="Note body"
        style={{ width: "100%", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 13, lineHeight: 1.55, padding: 12 }}
        rows={22}
      />

      {warn ? <p className="error-text" style={{ fontSize: 11, margin: "6px 0 0" }}>{warn}</p> : null}
    </>
  );
}
