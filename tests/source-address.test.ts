// Source addressing: rendered blocks stamped with their file spans, rendered
// text aligned with source, search hits and note anchors as file spans.
// The DOM half (dom-address.ts) is exercised in tests/e2e/addressing.spec.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";

import {
  alignTexts,
  anchorSpan,
  parseSpan,
  rehypeSourceAddress,
  relocateAnchor,
  renderSourceMap,
  searchHitSpan,
} from "../src/lib/markdown/source-address.ts";
import { splitMarkdownSegments } from "../src/lib/markdown/markdown-segments.ts";
import { remarkMathNodes } from "../src/services/math/remark-math-nodes.ts";
import { prepareWorkspaceEmbeds } from "../src/lib/workspace/workspace-artifacts.ts";
import { parseRows } from "../src/lib/search/rows.ts";

interface Hast {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Hast[];
  value?: string;
}

/** Parse `rendered` as the reader does and return each stamped element's file text. */
function stamps(file: string, rendered: string, toFile: (offset: number) => number) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkMathNodes)
    .use(remarkRehype)
    .use(rehypeSourceAddress, { toFile });
  const tree = processor.runSync(processor.parse(rendered)) as unknown as Hast;
  const out: Array<[string, string]> = [];
  const visit = (node: Hast) => {
    const span = parseSpan(node.properties?.dataSrc as string | undefined);
    if (span) out.push([node.tagName!, file.slice(span.start, span.end)]);
    node.children?.forEach(visit);
  };
  visit(tree);
  return out;
}

const DOC = [
  "Preamble words.",
  "",
  "# Guide",
  "",
  "Energy $E = mc^2$ here.",
  "",
  "| Part | Note |",
  "| --- | --- |",
  "| widget | the widget cell |",
  "",
  "- one",
  "- two",
  "",
  "```js",
  "const widget = 1;",
  "```",
].join("\n");

// Spans are Markdown's own node positions: a cell starts at its pipe and an
// item at its marker. Alignment treats those characters as markup.
test("every block, cell and equation is stamped with exactly its file text", () => {
  const map = renderSourceMap(DOC, DOC, 0);
  const found = stamps(DOC, DOC, map.toFile);
  assert.deepEqual(found, [
    ["p", "Preamble words."],
    ["h1", "# Guide"],
    ["p", "Energy $E = mc^2$ here."],
    ["docs-math", "$E = mc^2$"],
    ["table", "| Part | Note |\n| --- | --- |\n| widget | the widget cell |"],
    ["tr", "| Part | Note |"],
    ["th", "| Part "],
    ["th", "| Note |"],
    ["tr", "| widget | the widget cell |"],
    ["td", "| widget "],
    ["td", "| the widget cell |"],
    ["li", "- one"],
    ["li", "- two"],
    ["pre", "```js\nconst widget = 1;\n```"],
  ]);
});

test("a paged document's page, rendered without its heading, still stamps file offsets", () => {
  // What the viewer renders for page "guide": the H1 line and the blank after
  // it stripped, so the rendered text starts at the paragraph.
  const base = DOC.indexOf("Energy");
  const rendered = DOC.slice(base);
  const map = renderSourceMap(DOC, rendered, base);
  const found = stamps(DOC, rendered, map.toFile);
  assert.deepEqual(found.slice(0, 2), [
    ["p", "Energy $E = mc^2$ here."],
    ["docs-math", "$E = mc^2$"],
  ]);
});

test("embed shorthand rewritten before rendering keeps every other line exact", () => {
  const file = "Before.\n\n![[scan.png]]\n\nAfter the embed.";
  const rendered = prepareWorkspaceEmbeds(file);
  assert.notEqual(rendered, file);
  const found = stamps(file, rendered, renderSourceMap(file, rendered, 0).toFile);
  assert.deepEqual(found[0], ["p", "Before."]);
  assert.deepEqual(found.at(-1), ["p", "After the embed."]);
});

test("segments of a long document stamp offsets in the whole document", () => {
  const sections = Array.from(
    { length: 12 },
    (_, i) =>
      `# Section ${i}\n\n${"Filler sentence for size. ".repeat(80)}\n\nMarker paragraph ${i}.`,
  );
  const file = `[ref]: https://example.com\n\n${sections.join("\n\n")}`;
  const segments = splitMarkdownSegments(file);
  assert.ok(segments.sources.length > 1, "the document is long enough to be split");
  assert.ok(segments.prefix > 0, "shared definitions are copied to the front of each segment");
  const map = renderSourceMap(file, file, 0);
  for (let s = 0; s < segments.sources.length; s++) {
    const toFile = (o: number) => map.toFile(segments.starts[s] + Math.max(0, o - segments.prefix));
    for (const [tag, text] of stamps(file, segments.sources[s], toFile)) {
      if (tag !== "p" || !text.startsWith("Marker")) continue;
      assert.match(text, /^Marker paragraph \d+\.$/, `segment ${s} stamps the paragraph exactly`);
    }
  }
});

test("rendered text aligns with projected source across collapsed whitespace and list numbers", () => {
  const rendered = "1.  First   item\nsecond";
  const source = "First item\nsecond";
  const map = alignTexts(rendered, source);
  // "F" of "First" maps to 0; "s" of "second" to its own position.
  assert.equal(map[rendered.indexOf("F")], 0);
  assert.equal(map[rendered.indexOf("second")], source.indexOf("second"));
  assert.equal(map[0], -1, "the list number has no source here");
});

test("search hits map to the occurrence the index counted: prose, table cells, code, diagrams", () => {
  const file = [
    "Intro mentions a widget once.",
    "",
    "| Part | Note |",
    "| --- | --- |",
    "| widget | the widget cell |",
    "",
    "```mermaid",
    "graph TD",
    "  A[widget start] --> B[End]",
    "```",
    "",
    "Two: widget and **widget**.",
  ].join("\n");
  const rows = parseRows(file);
  const hits = rows.flatMap((row) => {
    const out: Array<{ lineIndex: number; text: string; occurrence: number }> = [];
    let n = 0;
    for (const _ of row.text.matchAll(/widget/gi))
      out.push({ lineIndex: row.lineIndex, text: row.text, occurrence: n++ });
    return out;
  });
  const spans = hits.map((hit) =>
    searchHitSpan(file, hit.lineIndex, hit.text, "widget", hit.occurrence),
  );
  // Every hit is exactly the word, and no two hits share a span.
  for (const span of spans) assert.equal(span && file.slice(span.start, span.end), "widget");
  assert.equal(new Set(spans.map((s) => s!.start)).size, spans.length);
  // The second table hit is in the second cell, not the first.
  const tableLine = file.indexOf("| widget |");
  assert.equal(spans[2]!.start, file.indexOf("widget cell"));
  assert.equal(spans[1]!.start, tableLine + 2);
  // The diagram hit points into the fence source.
  assert.equal(spans[3]!.start, file.indexOf("widget start"));
  // Bold markers are not counted as text.
  assert.equal(spans[5]!.start, file.lastIndexOf("widget"));
});

test("a source anchor survives edits around it and reports its own text being gone", () => {
  const file = "Alpha paragraph.\n\nThe passage we kept, word for word.\n\nOmega.";
  const span = { start: file.indexOf("The passage"), end: file.indexOf("word.") + 5 };
  const anchor = anchorSpan(file, span);
  assert.deepEqual(relocateAnchor(file, anchor), span, "unchanged: the same span");

  const shifted = "New intro.\n\n" + file;
  const moved = relocateAnchor(shifted, anchor)!;
  assert.equal(shifted.slice(moved.start, moved.end), "The passage we kept, word for word.");

  // Two copies: the one nearest the old position wins.
  const twice = file.replace("Omega.", "The passage we kept, word for word.\n\nOmega.");
  assert.deepEqual(relocateAnchor(twice, anchor), span);

  const rewritten = file.replace("The passage we kept", "A different passage");
  assert.equal(relocateAnchor(rewritten, anchor), null);
});
