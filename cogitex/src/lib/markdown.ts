/**
 * Server-side Markdown → HTML for machine notes (sprint item 2).
 * Security posture: EVERYTHING is HTML-escaped FIRST, then a small transform
 * pass re-introduces only the tags we hand-write. A `<script>` in a note can
 * never survive as markup. Links allow only http(s) and same-origin relative
 * hrefs. No client JS, no raw passthrough, deterministic and unit-testable.
 */

const ALLOWED_LINK_RE = /^(https?:\/\/|\/)/i;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** inline transforms on ALREADY-ESCAPED text (hence *not* the `&amp;` conflicts) */
function inline(escaped: string): string {
  let out = escaped;
  // inline code first so its content is protected from further transforms
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);
  // bold, then italic (bold first: ** wins over *)
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/([^*]|^)\*([^*]+)\*/g, "$1<em>$2</em>");
  // links: [text](href) — http(s) or same-origin / only
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (m, text: string, href: string) =>
      ALLOWED_LINK_RE.test(href) ? `<a href="${href}" rel="noopener noreferrer">${text}</a>` : m,
  );
  return out;
}

function renderBlock(block: string): string {
  const lines = block.split("\n");
  // heading (+ optional same-block trailing lines rendered as a paragraph beneath)
  const heading = lines[0]?.match(/^(#{1,3})\s+(.*)$/);
  if (heading && lines.length > 0) {
    const level = heading[1]?.length ?? 1;
    const tag = ["h3", "h4", "h5"][level - 1] ?? "h5";
    const rest = lines.slice(1).join("\n").trim();
    return rest.length > 0
      ? `<${tag} class="md-h">${inline(heading[2] ?? "")}</${tag}><p>${inline(rest)}</p>`
      : `<${tag} class="md-h">${inline(heading[2] ?? "")}</${tag}>`;
  }
  // horizontal rule
  if (/^\s*-{3,}\s*$/.test(lines[0] ?? "") && lines.length === 1) return "<hr />";
  // blockquote (consecutive > lines)
  if (lines[0]?.startsWith("&gt;")) {
    return `<blockquote>${inline(lines.map((l) => (l.startsWith("&gt;") ? l.slice(4).trimStart() : l)).join("<br />"))}</blockquote>`;
  }
  // unordered list block
  if (lines.every((l) => l.trim() === "" || /^\s*[-*]\s+/.test(l)) && lines.some((l) => /^\s*[-*]\s+/.test(l))) {
    const items = lines.filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`);
    return `<ul>${items.join("")}</ul>`;
  }
  // ordered list block
  if (lines.every((l) => l.trim() === "" || /^\s*\d+[.)]\s+/.test(l)) && lines.some((l) => /^\s*\d+[.)]\s+/.test(l))) {
    const items = lines.filter((l) => /^\s*\d+[.)]\s+/.test(l)).map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
    return `<ol>${items.join("")}</ol>`;
  }
  return `<p>${inline(lines.map((l) => (l.startsWith("#") ? l.replace(/^#{1,3}\s+/, "") : l)).join("<br />"))}</p>`;
}

/** Render safe markdown to an HTML string (no raw-HTML passthrough, ever). */
export function renderMarkdown(source: string): string {
  const escaped = escapeHtml(source);
  const fenced = escaped.split(/```/); // odd indices are inside code fences
  const parts: string[] = [];
  for (let i = 0; i < fenced.length; i++) {
    if (i % 2 === 1) {
      // code block: strip a leading language tag line, no other transforms
      const code = fenced[i]?.replace(/^[a-zA-Z0-9_-]+\r?\n/, "") ?? "";
      parts.push(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
    } else {
      for (const block of (fenced[i] ?? "").split(/\n{2,}/)) {
        const trimmed = block.trim();
        if (trimmed) parts.push(renderBlock(trimmed));
      }
    }
  }
  return parts.join("\n");
}

/**
 * Markdown table builder used by CSV/XLSX imports (row-capped at the call site):
 * header row separate, then alignment row, then data — every cell already escaped downstream.
 */
export function markdownTable(header: string[], rows: string[][], maxRows: number): { md: string; truncated: number } {
  const cell = (v: string) => (v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
  const head = `| ${header.map(cell).join(" | ")} |`;
  const sep = `| ${header.map(() => "---").join(" | ")} |`;
  const shown = rows.slice(0, maxRows).map((r) => `| ${header.map((_h, i) => cell(r[i] ?? "")).join(" | ")} |`);
  const md = [head, sep, ...shown].join("\n");
  return { md, truncated: rows.length - shown.length };
}
