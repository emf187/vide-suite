import Link from "next/link";
import { notFound } from "next/navigation";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { machinesService } from "@/server/services/machines";
import { notesService } from "@/server/services/machine-notes";
import { renderMarkdown } from "@/lib/markdown";
import { NOTE_BODY_MAX } from "@/lib/note-editor";
import { saveNoteEditorAction } from "../../../actions";
import NoteEditorSurface from "./NoteEditorSurface";
import { formatDateTime } from "@/lib/time";

export const metadata = { title: "Note editor" };

export default async function NoteEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; noteId: string }>;
  searchParams: Promise<{ preview?: string; error?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const { id, noteId } = await params;
  const sp = await searchParams;
  const machine = await machinesService.byId(ctx, id);
  if (!machine) notFound();
  const note = await notesService.byId(ctx, id, noteId);
  if (!note) notFound();

  const mayEdit = can(ctx.roles, "plan.manage") || ctx.userId === note.createdBy;
  const words = note.body.split(/\s+/).filter(Boolean).length;
  const headingLink = `/machines/${machine.id}?tab=notes#note-${note.id}`;

  if (!mayEdit) {
    return (
      <>
        <div className="row" style={{ alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <Link href={headingLink} style={{ fontSize: 11, color: "var(--accent)" }}>← {machine.tag} · NOTES / DOCS</Link>
            <h1 style={{ margin: "4px 0 0", fontSize: 20 }}>{note.title}</h1>
          </div>
        </div>
        <div className="card">
          <div className="eyebrow">READ ONLY</div>
          <p style={{ fontSize: 11, color: "var(--dim2)", margin: "4px 0 10px" }}>
            {note.source === "typed" ? "typed" : note.source} · {formatDateTime(note.createdAt, ctx.timezone)} — only the author or a planner edits this note.
          </p>
          <div style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(note.body) }} />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="row" style={{ alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <Link href={headingLink} style={{ fontSize: 11, color: "var(--accent)" }}>← {machine.tag} · NOTES / DOCS</Link>
          <h1 style={{ margin: "4px 0 0", fontSize: 20 }}>Note editor</h1>
          <p className="lead" style={{ margin: "4px 0 0", fontSize: 12 }}>
            Write long-form with tables — markdown that renders everywhere it matters. Toolbar inserts at the end;
            every button saves; PREVIEW shows the rendered page.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontSize: 10, color: "var(--dim2)" }}>
            {words} words · {note.body.length}/{NOTE_BODY_MAX} chars
          </span>
        </div>
      </div>

      {sp.error ? (
        <div className="card">
          <div className="eyebrow">NOTHING WAS LOST</div>
          <span className="error-text" style={{ fontSize: 12 }}>{sp.error}</span>
        </div>
      ) : null}

      {sp.preview === "1" ? (
        <div className="card">
          <div className="eyebrow">PREVIEW — WHAT THE NOTE LOOKS LIKE EVERYWHERE</div>
          <div style={{ fontSize: 13, marginTop: 6 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(note.body) }} />
        </div>
      ) : null}

      <form action={saveNoteEditorAction} className="card">
        <input type="hidden" name="machineId" value={machine.id} />
        <input type="hidden" name="noteId" value={note.id} />

        <input
          name="title"
          defaultValue={note.title}
          placeholder="Note title"
          aria-label="Note title"
          style={{ width: "100%", fontSize: 16, fontWeight: 600, marginBottom: 8 }}
        />

        {/* toolbar + writing surface — the one client-JS island (cursor-aware); saves stay server-side */}
        <NoteEditorSurface body={note.body} placeholder="Type freely — markdown works: **bold**, lists, `code`, tables…" />

        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          <button type="submit" name="intent" value="save">SAVE NOTE</button>
          <button type="submit" name="intent" value="preview" className="secondary">PREVIEW</button>
          <span style={{ fontSize: 10, color: "var(--dim2)" }}>
            Toolbar edits stay in this page until you save or preview.
          </span>
        </div>
      </form>

      <details className="card">
        <summary className="eyebrow" style={{ cursor: "pointer", listStyle: "none" }}>MARKDOWN CHEATSHEET</summary>
        <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
          <span><code>## Heading</code> — section titles</span>
          <span><code>**bold**</code>, <code>*italic*</code>, <code>`code`</code></span>
          <span><code>- bullet</code> · <code>1. step</code> · <code>- [ ] task</code></span>
          <span><code>[text](https://target)</code> — https or same-origin links only</span>
          <span>
            <code>| col | col |</code> then <code>| --- | --- |</code> row — a table (alignment: <code>:-:</code> center, <code>---:</code> right)
          </span>
          <span><code>&gt; warning</code> — callout quote · <code>---</code> — rule</span>
        </div>
      </details>
    </>
  );
}
