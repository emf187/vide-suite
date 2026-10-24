import Link from "next/link";
import { getCtx } from "@/server/ctx";
import { libraryService } from "@/server/services/library";
import { machinesService } from "@/server/services/machines";
import { formatDateTime } from "@/lib/time";

export const metadata = { title: "Documentation Library" };

const SOURCE_LABEL: Record<string, string> = {
  typed: "WRITTEN",
  file: "FROM FILE",
  import: "IMPORTED",
  agent: "AGENT",
};

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; machineId?: string; note?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const sp = await searchParams;
  const [machines, results] = await Promise.all([
    machinesService.list(ctx),
    libraryService.search(ctx, { q: sp.q, machineId: sp.machineId }),
  ]);
  const total = results.notes.length + results.docs.length;

  return (
    <>
      <div className="row" style={{ alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Library</h1>
          <p className="lead" style={{ margin: "4px 0 0" }}>
            Every manual, note, table, photo, video and voice memo in the organisation — searchable in one place.
            Notes are written and edited on the machine page (markdown, tables included).
          </p>
        </div>
      </div>

      {/* GET form — server-side rendering, zero client JS */}
      <form method="get" action="/library" className="card">
        <div className="eyebrow">SEARCH THE LIBRARY</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search note titles, note bodies, file names…" style={{ flex: 1, minWidth: 240 }} />
          <select name="machineId" defaultValue={sp.machineId ?? ""} style={{ maxWidth: 220 }}>
            <option value="">All machines</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>{m.tag} — {m.name}</option>
            ))}
          </select>
          <button type="submit">SEARCH</button>
          <Link href="/library">
            <button type="button" className="secondary">CLEAR</button>
          </Link>
        </div>
        <p style={{ fontSize: 11, color: "var(--dim2)", margin: "8px 0 0" }}>
          {total} item{total === 1 ? "" : "s"} in scope (latest 80 shown per section).
        </p>
      </form>

      {/* ------------------------------ notes ------------------------------ */}
      <div className="card">
        <div className="eyebrow">{`NOTES & TABLES / ${results.notes.length}`}</div>
        {results.notes.length === 0 ? (
          <p className="empty-state">No notes match. Write notes on a machine&apos;s NOTES / DOCS tab.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {results.notes.map((n) => (
              <div key={n.id} style={{ borderBottom: "1px dashed var(--line)", padding: "10px 0" }}>
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <Link href={`/machines/${n.machineId}?tab=notes#note-${n.id}`} style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
                      {n.title}
                    </Link>
                    <span style={{ fontSize: 9, letterSpacing: 1, border: "1px solid var(--line3)", borderRadius: 4, padding: "1px 6px", color: "var(--dim2)" }}>
                      {SOURCE_LABEL[n.source] ?? n.source.toUpperCase()}
                    </span>
                    {n.updatedAt > n.createdAt ? (
                      <span style={{ fontSize: 9, color: "var(--dim2)", letterSpacing: 1 }}>EDITED</span>
                    ) : null}
                  </div>
                  <span style={{ fontSize: 10, color: "var(--dim2)" }}>
                    {formatDateTime(n.createdAt, ctx.timezone)}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: "var(--dim)", margin: "4px 0 0" }}>
                  {n.body.length > 220 ? `${n.body.slice(0, 220)}…` : n.body}
                </p>
                <p style={{ fontSize: 11, margin: "6px 0 0" }}>
                  <Link href={`/machines/${n.machineId}?tab=notes`} style={{ color: "var(--accent)", textDecoration: "none" }}>
                    {n.machineTag}
                  </Link>
                  <span style={{ color: "var(--dim2)" }}> · {n.machineName}</span>
                  {n.documentId ? (
                    <> · <a href={`/machines/${n.machineId}/docs/${n.documentId}`} style={{ color: "var(--accent)" }}>ORIGINAL FILE</a></>
                  ) : null}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* --------------------------- attachments --------------------------- */}
      <div className="card">
        <div className="eyebrow">{`FILES / MANUALS / MEDIA / ${results.docs.length}`}</div>
        {results.docs.length === 0 ? (
          <p className="empty-state">No attachments match. Upload on a machine&apos;s NOTES / DOCS tab.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line3)" }}>
                  <th className="eyebrow" style={{ textAlign: "left", padding: "6px 8px" }}>FILE</th>
                  <th className="eyebrow" style={{ textAlign: "left", padding: "6px 8px" }}>KIND</th>
                  <th className="eyebrow" style={{ textAlign: "left", padding: "6px 8px" }}>MACHINE</th>
                  <th className="eyebrow" style={{ textAlign: "left", padding: "6px 8px" }}>SIZE</th>
                  <th className="eyebrow" style={{ textAlign: "left", padding: "6px 8px" }}>UPLOADED</th>
                  <th className="eyebrow" style={{ textAlign: "left", padding: "6px 8px" }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {results.docs.map((d) => (
                  <tr key={d.id} style={{ borderBottom: "1px dashed var(--line)", fontSize: 12 }}>
                    <td style={{ padding: "8px 8px" }}>
                      <strong>{d.name}</strong>
                      <div style={{ fontSize: 10, color: "var(--dim2)" }}>{d.mimeType}</div>
                    </td>
                    <td style={{ padding: "8px 8px", fontSize: 11 }}>
                      {d.kind.replace(/_/g, " ")}
                      {d.workOrderId ? <span style={{ color: "var(--dim2)", display: "block", fontSize: 10 }}>on work order</span> : null}
                    </td>
                    <td style={{ padding: "8px 8px", fontSize: 11 }}>{d.machineTag ?? "—"}</td>
                    <td style={{ padding: "8px 8px", fontSize: 11 }}>{Math.max(1, Math.round(d.sizeBytes / 1024))} KB</td>
                    <td style={{ padding: "8px 8px", fontSize: 11 }}>{formatDateTime(d.createdAt, ctx.timezone)}</td>
                    <td style={{ padding: "8px 8px" }}>
                      <a href={`/api/documents/${d.id}`} style={{ color: "var(--accent)", fontSize: 11 }}>OPEN</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
