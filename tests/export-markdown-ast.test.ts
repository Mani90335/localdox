// Unit tests for the export parser.
//
// This is the layer both writers read a document through, so a mistake here is
// a mistake in the `.docx` *and* the PDF at once — and neither is easy to eye
// against a source file once it is a binary or a print preview. The DOCX and
// print writers themselves need a DOM (canvas, an iframe, Mermaid's renderer)
// and are exercised in the browser; everything that decides *what* ends up in
// the document is pure and is covered here.
//
// The cases that matter most are the ones that used to be silently wrong in a
// hand-rolled markdown reader: a mermaid fence recognised as a diagram rather
// than as code, emphasis boundaries that eat their spaces, `snake_case` read as
// italics, and a table whose rows do not match its header.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  columnWidthDemand,
  parseInline,
  parseMarkdownBlocks,
  runsToText,
  type ExportBlock,
} from "../src/services/markdown-export/markdown-ast.ts";

function only<T extends ExportBlock["type"]>(
  source: string,
  type: T,
): Extract<ExportBlock, { type: T }> {
  const blocks = parseMarkdownBlocks(source);
  assert.equal(blocks.length, 1, `expected one block, got ${blocks.map((b) => b.type).join(", ")}`);
  assert.equal(blocks[0].type, type);
  return blocks[0] as Extract<ExportBlock, { type: T }>;
}

test("a mermaid fence is a diagram, not a code block", () => {
  const block = only("```mermaid\ngraph TD;\n  A-->B;\n```", "mermaid");
  assert.equal(block.code, "graph TD;\n  A-->B;");
});

test("the mmd alias is also a diagram", () => {
  assert.equal(only("```mmd\npie\n```", "mermaid").code, "pie");
});

test("a non-mermaid fence keeps its language and stays code", () => {
  const block = only("```ts\nconst a = 1;\n```", "code");
  assert.equal(block.language, "ts");
  assert.equal(block.text, "const a = 1;");
});

test("a fence containing backticks is closed by its own marker length", () => {
  const block = only("````\n```\nnested\n```\n````", "code");
  assert.equal(block.text, "```\nnested\n```");
});

test("headings carry their level and drop closing hashes", () => {
  const block = only("### Results ###", "heading");
  assert.equal(block.level, 3);
  assert.equal(runsToText(block.runs), "Results");
});

test("a setext underline is a heading, not a rule", () => {
  const blocks = parseMarkdownBlocks("Overview\n---\n");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "heading");
  assert.equal(blocks[0].type === "heading" && blocks[0].level, 2);
});

test("a bare rule with no text above it stays a rule", () => {
  assert.equal(parseMarkdownBlocks("text\n\n---\n\nmore")[1].type, "rule");
});

test("front matter is dropped rather than printed as a table", () => {
  const blocks = parseMarkdownBlocks("---\ntitle: X\ntags: [a]\n---\n\n# Real\n");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "heading");
});

test("emphasis keeps the spaces around it", () => {
  // The bug this guards: flushing a run on a marker without preserving the
  // surrounding whitespace turns "a bold c" into "aboldc" in Word.
  assert.equal(runsToText(parseInline("a **bold** c")), "a bold c");
});

test("bold and italic are recorded as marks, not as literal asterisks", () => {
  const runs = parseInline("plain **b** _i_ ~~s~~");
  assert.equal(runs.find((r) => r.text === "b")?.bold, true);
  assert.equal(runs.find((r) => r.text === "i")?.italic, true);
  assert.equal(runs.find((r) => r.text === "s")?.strike, true);
});

test("an underscore inside a word is literal", () => {
  assert.equal(runsToText(parseInline("read snake_case_name here")), "read snake_case_name here");
  assert.ok(parseInline("read snake_case_name here").every((run) => !run.italic));
});

test("a code span suppresses emphasis inside it", () => {
  const runs = parseInline("use `a * b * c` here");
  const code = runs.find((run) => run.code);
  assert.equal(code?.text, "a * b * c");
});

test("links keep both label and target", () => {
  const [run] = parseInline("[docs](https://example.com/a)");
  assert.equal(run.text, "docs");
  assert.equal(run.href, "https://example.com/a");
});

test("an escaped marker is a literal character", () => {
  assert.equal(runsToText(parseInline("2 \\* 3 \\* 4")), "2 * 3 * 4");
});

test("nested list items carry their depth", () => {
  const block = only("- a\n  - b\n    - c\n", "list");
  assert.deepEqual(
    block.items.map((item) => [runsToText(item.runs), item.depth]),
    [
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ],
  );
});

test("task items record their checked state and lose the brackets", () => {
  const block = only("- [x] done\n- [ ] todo\n", "list");
  assert.deepEqual(
    block.items.map((item) => [runsToText(item.runs), item.checked]),
    [
      ["done", true],
      ["todo", false],
    ],
  );
});

test("an ordered list is marked ordered", () => {
  assert.equal(only("1. one\n2. two\n", "list").ordered, true);
});

test("bullets nested under numbered steps keep their own marker", () => {
  // Otherwise the detail under step 2 renders as "a., b." in Word and as an
  // <ol> in print — an author's aside promoted to a sub-procedure.
  const block = only("1. First\n2. Second\n   - detail\n   - more\n3. Third\n", "list");
  assert.deepEqual(
    block.items.map((item) => [runsToText(item.runs), item.depth, item.ordered]),
    [
      ["First", 0, true],
      ["Second", 0, true],
      ["detail", 1, false],
      ["more", 1, false],
      ["Third", 0, true],
    ],
  );
});

test("numbered sub-steps under a bullet keep their own marker", () => {
  const block = only("- Setup\n  1. install\n  2. configure\n", "list");
  assert.deepEqual(
    block.items.map((item) => [item.depth, item.ordered]),
    [
      [0, false],
      [1, true],
      [1, true],
    ],
  );
});

test("every table row is padded to the header width", () => {
  // A short row is common in hand-written markdown and used to produce a row
  // with fewer cells than the header, which Word renders as a torn grid.
  const block = only("| a | b | c |\n|---|---|---|\n| 1 | 2 |\n", "table");
  assert.equal(block.header.length, 3);
  assert.equal(block.rows[0].length, 3);
  assert.deepEqual(block.rows[0].map(runsToText), ["1", "2", ""]);
});

test("an escaped pipe stays inside its cell", () => {
  const block = only("| a | b |\n|---|---|\n| x \\| y | z |\n", "table");
  assert.deepEqual(block.rows[0].map(runsToText), ["x | y", "z"]);
});

test("a blockquote parses its contents as blocks", () => {
  const block = only("> # Title\n> body\n", "quote");
  assert.deepEqual(
    block.blocks.map((inner) => inner.type),
    ["heading", "paragraph"],
  );
});

test("a diagram inside a blockquote is still a diagram", () => {
  const block = only("> ```mermaid\n> graph TD;\n> ```\n", "quote");
  assert.equal(block.blocks[0].type, "mermaid");
});

test("an image on its own line becomes an image block", () => {
  const block = only("![alt text](pic.png)", "image");
  assert.equal(block.src, "pic.png");
  assert.equal(block.alt, "alt text");
});

test("display math is a math block in both spellings", () => {
  assert.equal(only("$$\nE = mc^2\n$$", "math").tex, "E = mc^2");
  assert.equal(only("```math\nE = mc^2\n```", "math").tex, "E = mc^2");
});

test("consecutive paragraph lines join into one paragraph", () => {
  const block = only("one line\nand its continuation\n", "paragraph");
  assert.equal(runsToText(block.runs), "one line and its continuation");
});

test("a document round-trips its block order", () => {
  const source = [
    "# Title",
    "",
    "Intro paragraph.",
    "",
    "```mermaid",
    "graph LR; A-->B;",
    "```",
    "",
    "## Detail",
    "",
    "- one",
    "- two",
    "",
    "| k | v |",
    "|---|---|",
    "| a | 1 |",
    "",
    "> quoted",
    "",
    "---",
  ].join("\n");
  assert.deepEqual(
    parseMarkdownBlocks(source).map((block) => block.type),
    ["heading", "paragraph", "mermaid", "heading", "list", "table", "quote", "rule"],
  );
});

test("an unterminated fence does not swallow the rest of the document silently", () => {
  // It still consumes to the end — there is nothing else it could mean — but it
  // must produce a block rather than throwing or returning nothing.
  const blocks = parseMarkdownBlocks("# T\n\n```\nunclosed\n");
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["heading", "code"],
  );
});

test("an empty document produces no blocks", () => {
  assert.deepEqual(parseMarkdownBlocks("   \n\n  \n"), []);
});

// Column widths. Both writers proportion tables through `columnWidthDemand`,
// and a wide table that Word renders as a wall of one-word lines is the exact
// failure this is here to prevent — so the relationships between columns are
// asserted rather than the numbers, which are free to be tuned.

const column = (header: string, ...cells: string[]) =>
  columnWidthDemand(parseInline(header), cells.map((cell) => parseInline(cell)));

test("a prose column is given more width than a short-value column", () => {
  const notes = column("Notes", "Migrated to the new pool last sprint; watch p99", "Rebuilding");
  const id = column("ID", "1", "2", "3");
  assert.ok(notes > id * 2, `expected the notes column to dwarf the id column (${notes} vs ${id})`);
});

test("a long header claims width even when its values are short", () => {
  // Otherwise "Error rate" wraps to two lines on every page of a long table
  // while the column sits half empty.
  assert.ok(column("Error rate", "0.01%", "1.2%") > column("Err", "0.01%", "1.2%"));
});

test("an unbreakable token sets a floor under the column", () => {
  // A column narrower than its longest word forces a mid-word break no matter
  // how many lines it gets.
  assert.ok(column("URL", "https://example.com/a/very/long/path") >= 36);
});

test("one outlier row does not take the width nine ordinary rows need", () => {
  const ordinary = Array.from({ length: 9 }, () => "ok");
  const withOutlier = column("Status", ...ordinary, "a".repeat(200));
  const without = column("Status", ...ordinary);
  assert.ok(
    withOutlier < without * 3,
    `one outlier should not triple the column (${without} -> ${withOutlier})`,
  );
});

test("prose width grows sub-linearly with length", () => {
  // Weighted by a square root: longer notes deserve more room, but not
  // proportionally more, or one prose column consumes the whole table.
  const short = column("Notes", "a".repeat(10).replace(/a/g, "x "));
  const long = column("Notes", "a".repeat(60).replace(/a/g, "x "));
  assert.ok(long > short);
  assert.ok(long < short * 6);
});

test("every column has a usable minimum", () => {
  assert.ok(column("#", "1") >= 4);
  assert.ok(column("", "") >= 4);
});
