import Link from "next/link";
import { notFound } from "next/navigation";
import { getCtx } from "@/server/ctx";
import { machinesService } from "@/server/services/machines";
import { documentsService } from "@/server/services/documents";
import { parseCsv } from "@/lib/csv/parse";
import { formatDateTime } from "@/lib/time";

export const metadata = { title: "Document preview" };

/** images/pdf render themselves; text/csv parse server-side; xlsx via the vendored SheetJS (200-row preview cap) */
async function sheetPreviewRows(bytes: Buffer): Promise<{ sheetName: string; header: string[]; rows: string[][] }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "buffer" });
  const sheetName = wb.SheetNames[0] ?? "";
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  const matrix = sheet ? (XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, blankrows: false }) as string[][]) : [];
  return {
    sheetName: sheetName || "sheet",
    header: (matrix[0] ?? []).map((c) => String(c ?? "")),
    rows: matrix.slice(1, 201).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : [String(r ?? "")])),
  };
}

export default async function DocumentPreviewPage({
  params,
}: {
  params: Promise<{ id: string; documentId: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const { id, documentId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId)) notFound();

  const machine = await machinesService.byId(ctx, id);
  if (!machine) notFound();
  const got = await documentsService.download(ctx, documentId);
  if (!got) notFound();
  const { doc, bytes } = got;
  if (doc.machineId !== machine.id) notFound();

  const mime = doc.mimeType.toLowerCase();
  const ext = doc.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  const src = `/api/documents/${doc.id}`;

  /* ---------------- classification ---------------- */
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");
  const isPdf = mime === "application/pdf" || ext === "pdf";
  const isXlsx = mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || ext === "xlsx";
  const isCsv = mime === "text/csv" || ext === "csv";
  const isText = mime.startsWith("text/") || ["md", "txt", "log", "json", "markdown"].includes(ext);
  const isDocx = ext === "docx" || ext === "doc" || mime.includes("wordprocessing");

  return (
    <>
      <div className="row" style={{ alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18 }}>{doc.name}</h1>
          <p className="lead" style={{ margin: "4px 0 0", fontSize: 12, color: "var(--dim2)" }}>
            {machine.tag} · {Math.round(doc.sizeBytes / 1024)} KB · {doc.mimeType} · uploaded {formatDateTime(doc.createdAt, ctx.timezone)}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link href={`/machines/${machine.id}?tab=notes`}>
            <button type="button" className="secondary">← NOTES / DOCS</button>
          </Link>
          <a href={src} download>
            <button type="button">DOWNLOAD</button>
          </a>
        </div>
      </div>

      {/* -------------------------------- image -------------------------------- */}
      {isImage ? (
        <div className="card" style={{ textAlign: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={doc.name} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 8 }} />
        </div>
      ) : null}

      {/* ------------------------------- video -------------------------------- */}
      {isVideo ? (
        <div className="card" style={{ textAlign: "center" }}>
          <video controls preload="metadata" src={src} style={{ width: "100%", maxHeight: "70vh", borderRadius: 8, background: "black" }} />
          <p style={{ fontSize: 10, color: "var(--dim2)", margin: "8px 0 0" }}>
            Clips up to 10 MB play from the DB file-store; mov depends on the browser codec.
          </p>
        </div>
      ) : null}

      {/* ------------------------------- audio -------------------------------- */}
      {isAudio ? (
        <div className="card" style={{ textAlign: "center" }}>
          <div className="eyebrow">AUDIO NOTE</div>
          <p style={{ fontSize: 12, color: "var(--dim)", margin: "4px 0 10px" }}>{doc.name}</p>
          {/* eslint-disable-next-line */}
          <audio controls preload="metadata" src={src} style={{ width: "100%" }} />
          <p style={{ fontSize: 10, color: "var(--dim2)", margin: "8px 0 0" }}>Voice memos stream from the DB file-store (≤10 MB).</p>
        </div>
      ) : null}

      {/* --------------------------------- pdf --------------------------------- */}
      {isPdf ? (
        <div className="card">
          <iframe src={src} title={doc.name} style={{ width: "100%", height: "70vh", border: "1px solid var(--line3)", borderRadius: 8 }} />
          <p style={{ fontSize: 10, color: "var(--dim2)", margin: "8px 0 0" }}>PDF preview is the browser viewer; DOWNLOAD for printing and archiving.</p>
        </div>
      ) : null}

      {/* --------------------------------- csv --------------------------------- */}
      {isCsv ? (
        <div className="card">
          <div className="eyebrow">CSV PREVIEW</div>
          <CsvTable bytes={bytes} />
        </div>
      ) : null}

      {/* -------------------------------- xlsx --------------------------------- */}
      {isXlsx ? <XlsxTable bytes={bytes} /> : null}

      {/* --------------------------------- text -------------------------------- */}
      {isText && !isCsv ? (
        <div className="card">
          <div className="eyebrow">TEXT PREVIEW (first 40 KB)</div>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }}>{bytes.toString("utf8").slice(0, 40_960)}</pre>
        </div>
      ) : null}

      {/* --------------------------- docx / unsupported ------------------------- */}
      {isDocx ? (
        <div className="card">
          <div className="eyebrow">PREVIEW ONLY</div>
          <p style={{ fontSize: 12 }}>
            Word documents can&apos;t be rendered in-page — <a href={src} download style={{ color: "var(--accent)" }}>download {doc.name}</a> to view.
          </p>
        </div>
      ) : null}
      {!isImage && !isVideo && !isAudio && !isPdf && !isCsv && !isXlsx && !isText && !isDocx ? (
        <div className="card">
          <div className="eyebrow">PREVIEW ONLY</div>
          <p style={{ fontSize: 12 }}>
            No in-page preview for <code>{doc.mimeType || "unknown type"}</code> — <a href={src} download style={{ color: "var(--accent)" }}>download the file</a>.
          </p>
        </div>
      ) : null}
    </>
  );
}

function CsvTable({ bytes }: { bytes: Buffer }) {
  const { header, rows } = parseCsv(bytes.toString("utf8"));
  return <DataTable header={header} rows={rows.slice(0, 200)} total={rows.length} />;
}

async function XlsxTable({ bytes }: { bytes: Buffer }) {
  const parsed = await sheetPreviewRows(bytes);
  return (
    <div className="card">
      <div className="eyebrow">{`XLSX PREVIEW / ${parsed.sheetName} SHEET`}</div>
      <DataTable header={parsed.header} rows={parsed.rows} total={parsed.rows.length} />
    </div>
  );
}

function DataTable({ header, rows, total }: { header: string[]; rows: string[][]; total: number }) {
  if (header.length === 0) {
    return <p className="empty-state" style={{ margin: 0 }}>Empty sheet.</p>;
  }
  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {header.map((h, i) => (
                <th key={`h-${i}`} style={{ textAlign: "left", borderBottom: "1px solid var(--line3)", padding: "6px 10px 6px 0", fontSize: 10, color: "var(--dim2)", letterSpacing: 1, whiteSpace: "nowrap" }}>{h || `col ${i + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={`r-${ri}`}>
                {header.map((_h, ci) => (
                  <td key={`c-${ri}-${ci}`} style={{ borderBottom: "1px solid var(--line2)", padding: "4px 10px 4px 0", whiteSpace: "nowrap", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{r[ci] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 10, color: "var(--dim2)", margin: "8px 0 0" }}>
        {total > rows.length ? `First ${rows.length} of ${total} rows — DOWNLOAD for the full file.` : `${rows.length} data rows.`}
      </p>
    </>
  );
}
