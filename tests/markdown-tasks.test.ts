import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkTasks, setMarkdownTask } from "../src/lib/markdown/markdown-tasks.ts";
import { splitMarkdownSegments } from "../src/lib/markdown/markdown-segments.ts";
import { checklist } from "../src/lib/markdown/markdown-format.ts";
import { parseMarkdownBlocks } from "../src/services/markdown-export/markdown-ast.ts";

const render = (source: string) =>
  renderToStaticMarkup(
    createElement(
      Markdown,
      {
        remarkPlugins: [remarkGfm, remarkTasks],
      },
      source,
    ),
  );

test("custom and standard tasks render with states and source lines", () => {
  const html = render("- [] First\n- [y] Second\n- [ ] Third\n- [x] Fourth\n\n[] Fifth\n[y] Sixth");
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 6);
  assert.equal((html.match(/checked=""/g) ?? []).length, 3);
  for (const line of [0, 1, 2, 3, 5, 6]) assert.ok(html.includes(`data-task-line="${line}"`), html);
});

test("code, escaped markers, inline prose and links remain literal", () => {
  const html = render(
    "```md\n- [] Fenced\n```\n\n    - [y] Indented\n\n`[] Inline`\n\n\\[] Escaped\n\nText [] inline\n\n[y](https://example.com) Link\n\n[y] Reference\n\n[y]: https://example.com",
  );
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 0);
});

test("nested, quoted, ordered and formatted tasks retain source locations", () => {
  const html = render("- [] **Parent**\n  - [y] Child\n\n> 1. [] Quoted\n\n- []\n");
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 4);
  for (const line of [0, 1, 3, 5]) assert.ok(html.includes(`data-task-line="${line}"`), html);
  assert.ok(html.includes("<strong>Parent</strong>"));
  assert.ok(html.includes('aria-label="Parent"'));
});

test("toolbar inserts and removes custom task markers and exports preserve state", () => {
  const inserted = checklist({ text: "Task", start: 0, end: 4 });
  assert.equal(inserted.text, "- [] Task");
  assert.equal(checklist(inserted).text, "Task");
  const [list] = parseMarkdownBlocks("- [] First\n- [y] Second\n- [x] Third");
  assert.equal(list.type, "list");
  if (list.type === "list")
    assert.deepEqual(
      list.items.map((item) => item.checked),
      [false, true, true],
    );
});

test("toggle preserves unrelated bytes, duplicate labels, dialect and CRLF", () => {
  const source = "# Tasks\r\n\r\n- [] Same\r\n- [] Same\r\n> 1. [X] Imported\r\n";
  const checked = setMarkdownTask(source, 3, true);
  assert.equal(checked, source.replace("- [] Same\r\n> 1.", "- [y] Same\r\n> 1."));
  assert.equal(setMarkdownTask(checked, 3, false), source);
  assert.equal(setMarkdownTask(source, 4, false), source.replace("[X]", "[ ]"));
  assert.equal(setMarkdownTask(source, 100, true), source);
  assert.equal(setMarkdownTask(source, 0, true), source);
});

test("segment line offsets account for shared definitions", () => {
  const source =
    "[link]: https://example.com\n\n" +
    Array.from(
      { length: 250 },
      (_, i) => `## Section ${i}\n\n${"Paragraph. ".repeat(15)}\n\n- [] Same\n\n`,
    ).join("");
  const segments = splitMarkdownSegments(source);
  assert.ok(segments.sources.length > 1);
  for (let i = 0; i < segments.sources.length; i++) {
    const html = render(segments.sources[i]);
    for (const match of html.matchAll(/data-task-line="(\d+)"/g)) {
      const line = Number(match[1]) + segments.lineOffsets![i];
      assert.equal(source.split("\n")[line], "- [] Same");
    }
  }
});
