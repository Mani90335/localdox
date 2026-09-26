/**
 * Export blocks → a print-ready document, handed to the browser's PDF writer.
 *
 * The alternative was a JavaScript PDF library, and it is the wrong tool here.
 * Those libraries lay text out themselves: they need every font embedded as
 * bytes, they cannot typeset the KaTeX this app renders, they break a page
 * wherever the cursor happens to be, and they rasterise anything vector. The
 * browser already has a typesetter and a PDF writer that do all of that
 * correctly, and — the deciding point — it draws Mermaid's SVG as vector
 * geometry, so a diagram in the PDF stays sharp at any zoom and its labels stay
 * selectable text. Word gets a bitmap because Word must; print does not.
 *
 * The document is built as a standalone HTML page in a hidden iframe rather
 * than by printing the app. Printing the live view would carry the sidebar, the
 * header, the theme, lazily-mounted diagrams that have not rendered yet and
 * virtualised sections that do not exist in the DOM — the familiar failure
 * where a printed page is the first screen and nothing after it.
 */

import type { ExportBlock, InlineRun } from "./markdown-ast";
import { columnWidthDemand, parseMarkdownBlocks, runsToText } from "./markdown-ast";
import { renderMermaid } from "@/services/diagrams";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function runHtml(run: InlineRun): string {
  let html = escapeHtml(run.text);
  if (run.code) html = `<code>${html}</code>`;
  if (run.bold) html = `<strong>${html}</strong>`;
  if (run.italic) html = `<em>${html}</em>`;
  if (run.strike) html = `<s>${html}</s>`;
  if (run.href) html = `<a href="${escapeHtml(run.href)}">${html}</a>`;
  return html;
}

const runsHtml = (runs: InlineRun[]) => runs.map(runHtml).join("");

/**
 * Strip what makes a Mermaid SVG a *live* diagram before printing it.
 *
 * The rendered SVG carries click handlers, a fixed pixel width from the
 * on-screen stage, and an id that is unique only within the page it was
 * rendered for. In a print document the width has to yield to the page column
 * and the interactivity is meaningless, so both go; the viewBox is what
 * actually carries the shape.
 */
function printableSvg(svg: string): string {
  return svg
    .replace(/\swidth="[^"]*"/i, ' width="100%"')
    .replace(/\sheight="[^"]*"/i, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/<svg\b/i, '<svg preserveAspectRatio="xMidYMid meet"');
}

function listHtml(block: Extract<ExportBlock, { type: "list" }>): string {
  // The parser produces a flat list with depths; print wants real nesting so
  // the browser handles the markers and the hanging indents itself.
  //
  // Each level opens the tag its own items ask for rather than inheriting the
  // list's, so bulleted detail nested under a numbered step stays bulleted
  // instead of becoming "a., b." — a sub-procedure the author did not write.
  const open: string[] = [];
  let html = "";

  const openLevel = (ordered: boolean) => {
    const tag = ordered ? "ol" : "ul";
    open.push(tag);
    html += `<${tag}>`;
  };
  const closeLevel = () => {
    html += `</${open.pop()}>`;
  };

  for (const item of block.items) {
    while (open.length > item.depth + 1) closeLevel();
    while (open.length < item.depth + 1) openLevel(item.ordered);
    // A level that turns out to hold the other kind of marker is reopened, so
    // a list alternating between the two still nests correctly.
    const wanted = item.ordered ? "ol" : "ul";
    if (open[open.length - 1] !== wanted) {
      closeLevel();
      openLevel(item.ordered);
    }
    const box =
      item.checked === undefined ? "" : `<span class="task">${item.checked ? "☑" : "☐"}</span> `;
    const cls = item.checked === undefined ? "" : ' class="task-item"';
    html += `<li${cls}>${box}${runsHtml(item.runs)}</li>`;
  }

  while (open.length) closeLevel();
  return html;
}

/** Columns past which a portrait page stops being able to hold the table. */
const LANDSCAPE_THRESHOLD = 7;

/**
 * A table, sized to what it holds.
 *
 * Same problem the DOCX writer has and the same shape of answer, but the
 * mechanisms differ enough to be worth stating: the browser *will* shrink a
 * table to fit, so the failure here is not an overflowing grid but an
 * illegible one — every column equal, the sentence column shredded to one word
 * a line while the two-digit column sits half empty.
 *
 * So columns get a width proportional to their content, dense tables get
 * smaller type, and a table past the column threshold is rotated onto its own
 * landscape page. `@page` orientation cannot vary per element in any browser,
 * so rotation here is a CSS transform rather than a real page rotation — which
 * is also what makes it work when the reader saves to PDF rather than printing.
 */
function tableHtml(block: Extract<ExportBlock, { type: "table" }>): string {
  const columns = Math.max(1, block.header.length);

  const demands = block.header.map((cell, index) =>
    columnWidthDemand(
      cell,
      block.rows.map((row) => row[index] ?? []),
    ),
  );
  const total = demands.reduce((sum, demand) => sum + demand, 0) || columns;
  const widths = demands.map((demand) =>
    Math.min(40, Math.max(100 / columns / 2, (demand / total) * 100)),
  );
  const scale = 100 / widths.reduce((sum, width) => sum + width, 0);

  const cols = widths
    .map((width) => `<col style="width:${(width * scale).toFixed(2)}%"/>`)
    .join("");
  const head = block.header.map((cell) => `<th>${runsHtml(cell)}</th>`).join("");
  const body = block.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${runsHtml(cell)}</td>`).join("")}</tr>`)
    .join("");

  const density = columns > 9 ? " dense" : columns > 6 ? " compact" : "";
  const table =
    `<table class="grid${density}"><colgroup>${cols}</colgroup>` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;

  if (columns <= LANDSCAPE_THRESHOLD) return table;

  return `<div class="landscape"><div class="landscape-inner">${table}</div></div>`;
}

function blockHtml(block: ExportBlock, diagrams: Map<string, string>): string {
  switch (block.type) {
    case "heading": {
      const level = Math.min(Math.max(block.level, 1), 6);
      const id = runsToText(block.runs)
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
      return `<h${level} id="${escapeHtml(id)}">${runsHtml(block.runs)}</h${level}>`;
    }
    case "paragraph":
      return `<p>${runsHtml(block.runs)}</p>`;
    case "list":
      return listHtml(block);
    case "code":
      return `<pre class="code"><code>${escapeHtml(block.text.replace(/\n+$/, ""))}</code></pre>`;
    case "math":
      // Rendering LaTeX would mean loading KaTeX into the print frame and
      // waiting for its stylesheet; displaying the source keeps the export
      // synchronous and loses nothing a reader cannot read.
      return `<pre class="math"><code>${escapeHtml(block.tex.trim())}</code></pre>`;
    case "mermaid": {
      const svg = diagrams.get(block.code);
      if (!svg)
        return (
          `<p class="diagram-note">Diagram (source shown; could not be rendered)</p>` +
          `<pre class="code"><code>${escapeHtml(block.code)}</code></pre>`
        );
      return `<figure class="diagram">${printableSvg(svg)}</figure>`;
    }
    case "quote":
      return `<blockquote>${block.blocks.map((inner) => blockHtml(inner, diagrams)).join("")}</blockquote>`;
    case "table":
      return tableHtml(block);
    case "rule":
      return "<hr/>";
    case "image":
      return `<figure><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}"/>${
        block.alt ? `<figcaption>${escapeHtml(block.alt)}</figcaption>` : ""
      }</figure>`;
  }
}

/**
 * Print stylesheet.
 *
 * The rules that matter are the break controls. Default print behaviour splits
 * a diagram across a page boundary, orphans a heading at the foot of a page and
 * breaks a table row in half — the three things that make a browser-printed
 * document look unmade. `break-inside: avoid` on figures, tables and code, plus
 * `break-after: avoid` on headings, is most of the difference between this and
 * printing the app.
 */
const PRINT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
@page { size: A4; margin: 18mm 16mm; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
  font-family: "Source Serif 4", Georgia, "Times New Roman", serif;
  font-size: 11.5pt;
  line-height: 1.6;
  color: #1a1a18;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.page { max-width: 178mm; margin: 0 auto; padding: 0; }
h1, h2, h3, h4, h5, h6 {
  font-family: "Inter", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.25;
  margin: 1.4em 0 0.5em;
  break-after: avoid;
  page-break-after: avoid;
}
h1 { font-size: 22pt; margin-top: 0; border-bottom: 1px solid #d4d2cc; padding-bottom: 0.3em; }
h2 { font-size: 16pt; }
h3 { font-size: 13pt; }
h4, h5, h6 { font-size: 11.5pt; }
p { margin: 0 0 0.75em; orphans: 3; widows: 3; }
a { color: #1a5fb4; text-decoration: none; }
ul, ol { margin: 0 0 0.75em; padding-left: 1.6em; }
li { margin: 0.2em 0; }
li.task-item { list-style: none; margin-left: -1.2em; }
.task { font-size: 1.05em; }
code {
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
  background: #f1f1ef;
  padding: 0.12em 0.3em;
  border-radius: 3px;
}
pre.code, pre.math {
  background: #f7f6f3;
  border: 1px solid #e6e4df;
  border-radius: 4px;
  padding: 0.7em 0.9em;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  break-inside: avoid;
  page-break-inside: avoid;
  margin: 0 0 1em;
}
pre code { background: none; padding: 0; font-size: 0.82em; }
pre.math { font-style: italic; }
blockquote {
  margin: 0 0 1em;
  padding: 0.1em 0 0.1em 1em;
  border-left: 3px solid #c8c6c0;
  color: #47463f;
}
blockquote > :last-child { margin-bottom: 0; }
hr { border: none; border-top: 1px solid #d4d2cc; margin: 1.6em 0; }
table {
  width: 100%;
  /* Honour the colgroup widths. Under the default 'auto', the browser
     re-measures the content and undoes the proportional sizing entirely. */
  table-layout: fixed;
  border-collapse: collapse;
  margin: 0 0 1.2em;
  font-size: 0.9em;
}
/* A long table must be allowed to break: 'break-inside: avoid' on a table
   taller than the page makes the browser push the whole thing to the next page
   and overflow it anyway, losing the rows past the fold. Rows are kept whole
   instead, which is the part that actually matters to a reader. */
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th, td {
  border: 1px solid #d4d2cc;
  padding: 0.4em 0.55em;
  text-align: left;
  vertical-align: top;
  /* Long unbroken tokens — a URL, an id — would otherwise push a fixed-layout
     column past its share and skew every other column on the row. */
  overflow-wrap: break-word;
  word-break: break-word;
  hyphens: auto;
}
th { background: #f1f1ef; font-weight: 600; }
table.compact { font-size: 0.78em; }
table.compact th, table.compact td { padding: 0.3em 0.4em; }
table.dense { font-size: 0.68em; }
table.dense th, table.dense td { padding: 0.22em 0.3em; }

/* A table too wide for the column gets the page turned under it.
   Page orientation cannot vary per element in any browser, so the table is
   rotated a quarter turn inside a box the size of the page instead - which is
   also what survives "Save as PDF", where a real orientation change would not. */
.landscape {
  break-before: page;
  page-break-before: always;
  break-after: page;
  page-break-after: always;
  break-inside: avoid;
  page-break-inside: avoid;
  height: 244mm;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.landscape-inner {
  transform: rotate(-90deg);
  /* The rotated box swaps the page's axes: its width is the page's usable
     height and vice versa. */
  width: 244mm;
  max-height: 178mm;
}
.landscape-inner table { margin: 0; }
figure { margin: 1.2em 0; text-align: center; break-inside: avoid; page-break-inside: avoid; }
figure img { max-width: 100%; height: auto; }
figcaption { font-size: 0.85em; color: #6b6a62; margin-top: 0.4em; }
/* A diagram is the one element allowed its own page when it cannot fit the
   remaining column — splitting a flowchart across a fold destroys it. */
figure.diagram { margin: 1.4em 0; }
figure.diagram svg { max-width: 100%; height: auto; }
.diagram-note { font-style: italic; color: #6b6a62; margin-bottom: 0.3em; }
.doc-title {
  font-family: "Inter", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 26pt;
  line-height: 1.15;
  margin: 0 0 0.2em;
  border: none;
  padding: 0;
}
.doc-meta { color: #6b6a62; font-size: 9.5pt; margin: 0 0 2em; }
`;

export interface PdfOptions {
  title: string;
  /** Printed under the title. Omitted when empty. */
  subtitle?: string;
}

/**
 * Render every diagram in the document up front.
 *
 * Print is a synchronous snapshot: whatever is in the frame when the dialog
 * opens is what gets written. An async render started during layout would miss
 * the snapshot and print an empty box, so all of them are resolved first and
 * the HTML is assembled from finished SVG.
 */
async function renderDiagrams(blocks: ExportBlock[]): Promise<Map<string, string>> {
  const sources = [...new Set(blocks.flatMap((b) => (b.type === "mermaid" ? [b.code] : [])))];
  const out = new Map<string, string>();
  for (const code of sources) {
    try {
      // Light theme: the page is white regardless of the app's theme.
      const { svg } = await renderMermaid(code, false, false);
      out.set(code, svg);
    } catch {
      // Absent means "show the source" to the block writer.
    }
  }
  return out;
}

/** Diagrams inside a blockquote are nested, so the scan has to recurse. */
function flatten(blocks: ExportBlock[]): ExportBlock[] {
  return blocks.flatMap((block) =>
    block.type === "quote" ? [block, ...flatten(block.blocks)] : [block],
  );
}

/** The complete standalone document, ready to write into a frame. */
export async function markdownToPrintableHtml(
  source: string,
  options: PdfOptions,
): Promise<string> {
  const blocks = parseMarkdownBlocks(source);
  const diagrams = await renderDiagrams(flatten(blocks));

  const opensWithHeading = blocks[0]?.type === "heading" && blocks[0].level === 1;
  const header = opensWithHeading
    ? ""
    : `<h1 class="doc-title">${escapeHtml(options.title)}</h1>` +
      (options.subtitle ? `<p class="doc-meta">${escapeHtml(options.subtitle)}</p>` : "");

  const body = blocks.map((block) => blockHtml(block, diagrams)).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>${escapeHtml(options.title)}</title>
<style>${PRINT_CSS}</style>
</head><body><main class="page">${header}${body}</main></body></html>`;
}

/**
 * Open the browser's print dialog on the document.
 *
 * A hidden same-origin iframe rather than a popup window: popups are blocked
 * unless the call is inside a user gesture, and this one is not — a document
 * with diagrams spends time rendering them first, which ends the gesture. The
 * iframe has no such requirement.
 *
 * The frame is kept until the dialog closes. Removing it synchronously after
 * `print()` returns leaves Safari and Firefox printing a detached document,
 * which comes out blank.
 */
export async function printMarkdownAsPdf(source: string, options: PdfOptions): Promise<void> {
  const html = await markdownToPrintableHtml(source, options);

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;";
  document.body.appendChild(frame);

  const cleanup = () => {
    // A generous delay: the print dialog is modal in some browsers and
    // `afterprint` fires late (or, in a couple, not at all), so the timer is
    // the backstop rather than the primary path.
    window.setTimeout(() => frame.remove(), 1000);
  };

  await new Promise<void>((resolve) => {
    frame.onload = () => resolve();
    const doc = frame.contentDocument;
    if (!doc) {
      resolve();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    // Written documents do not always fire load in every browser; resolving on
    // the next task is a safe floor.
    window.setTimeout(resolve, 0);
  });

  const view = frame.contentWindow;
  if (!view) {
    frame.remove();
    throw new Error("print frame unavailable");
  }

  // Wait for fonts before printing. Without this the layout is measured in a
  // fallback face and the first page reflows as the real one arrives — usually
  // after the snapshot, which is how a printed line ends up clipped.
  try {
    await (frame.contentDocument?.fonts?.ready ?? Promise.resolve());
  } catch {
    // Font loading is an optimisation; a failure here must not block the print.
  }

  view.addEventListener("afterprint", cleanup, { once: true });
  view.focus();
  view.print();
  cleanup();
}
