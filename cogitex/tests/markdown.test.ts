import { describe, expect, it } from "vitest";
import { markdownTable, renderMarkdown } from "@/lib/markdown";

describe("markdown renderer (escape-first, no raw passthrough)", () => {
  it("neutralizes raw HTML — <script> can never survive as markup", () => {
    const out = renderMarkdown("<script>alert(1)</script> & <b>bold</b>");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<b>bold</b>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&amp;");
  });

  it("renders headings, bold, italic, inline code and links", () => {
    const out = renderMarkdown("## Seal findings\nText **bold** and *slant* and `code` and [VIDE](https://vide.example)");
    expect(out).toContain('<h4 class="md-h">Seal findings</h4>');
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>slant</em>");
    expect(out).toContain("<code>code</code>");
    expect(out).toContain('<a href="https://vide.example"');
  });

  it("refuses javascript: and other non-http(s) link targets", () => {
    const out = renderMarkdown("[x](javascript:alert(1)) [y](ftp://nope) [z](/ok)");
    expect(out).not.toContain('href="javascript');
    expect(out).not.toContain('href="ftp');
    expect(out).toContain('href="/ok"');
  });

  it("renders bullet/ordered lists and blockquotes", () => {
    const out = renderMarkdown("- oil change\n- filter swap");
    expect(out).toContain("<ul><li>oil change</li><li>filter swap</li></ul>");
    const out2 = renderMarkdown("1. isolate\n2. test");
    expect(out2).toContain("<ol><li>isolate</li><li>test</li></ol>");
    const out3 = renderMarkdown("> caution: live wires");
    expect(out3).toContain("<blockquote>caution");
  });

  it("code fences are verbatim (no bold/heading transforms inside)", () => {
    const out = renderMarkdown("before\n```\n**not bold**\n## not heading\n```");
    expect(out).toContain("<pre><code>");
    expect(out).toContain("**not bold**");
    expect(out).not.toContain("<strong>not bold</strong>");
    expect(out).not.toContain('class="md-h"');
  });

  it("markdownTable escapes pipes and reports truncation count", () => {
    const { md, truncated } = markdownTable(["a", "b"], [["x|y", "1"], ["2", "3"]], 1);
    expect(md).toContain("x\\|y");
    expect(md.split("\n")).toHaveLength(3); // header + sep + 1 row
    expect(truncated).toBe(1);
  });
});
