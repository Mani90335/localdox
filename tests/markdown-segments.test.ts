import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeSlug from "rehype-slug";
import {
  SEGMENT_MIN_DOCUMENT,
  rehypeSegmentSlug,
  splitMarkdownSegments,
  type MarkdownSegments,
} from "../src/lib/markdown/markdown-segments.ts";

const REMARK = [remarkGfm, remarkMath];

/**
 * Rendered HTML must match exactly. The viewer puts back the newline text
 * node a single render has between blocks after every segment but the last,
 * so the segments are joined the same way here.
 *
 * (A last segment holding nothing but link definitions leaves a trailing
 * newline, after all the text; trailing whitespace is trimmed.)
 *
 * Raw HTML is skipped on both sides: the viewer shows it as escaped text, and
 * a block of it cut in the wrong place would still show, because what it
 * swallowed renders as a heading, a paragraph or code.
 */
const renderWhole = (source: string) =>
  renderToStaticMarkup(
    createElement(
      Markdown,
      { remarkPlugins: REMARK, rehypePlugins: [rehypeSlug], skipHtml: true },
      source,
    ),
  ).trimEnd();

const renderSegments = (segments: MarkdownSegments) =>
  segments.sources
    .map((source, index) =>
      renderToStaticMarkup(
        createElement(
          Markdown,
          {
            remarkPlugins: REMARK,
            rehypePlugins: [[rehypeSegmentSlug, { segments, index }]],
            skipHtml: true,
          },
          source,
        ),
      ),
    )
    .join("\n")
    .trimEnd();

/** Deterministic PRNG so a failure names a reproducible seed. */
function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TITLES = [
  "Intro",
  "Intro",
  "Intro 1",
  "Setup",
  "Notes & tips",
  "A `code` title",
  "[Linked](https://example.com/a) title",
  "__init__",
  "Émigré café",
  "Section *two*",
  "intro-1",
];

/**
 * Block generators, including the constructs a naive split would break: code
 * and math containing heading-like lines and blank lines, HTML blocks that
 * swallow headings, fences inside HTML, lazy continuation lines, loose lists
 * and reference links whose definitions live elsewhere.
 */
const BLOCKS: Array<(r: () => number) => string> = [
  (r) => `${"#".repeat(1 + Math.floor(r() * 6))} ${TITLES[Math.floor(r() * TITLES.length)]}`,
  (r) =>
    `Paragraph ${Math.floor(r() * 1e6)} with *emphasis*, \`code\`, $x^2$ and a [reference][ref${Math.floor(r() * 3)}] link.`,
  () => "A paragraph that continues\nlazily onto a second line\n# but this heading interrupts it",
  () => "- item one\n- item two\n\n- item three after a blank\n\n  continued inside the item",
  () => "1. first\n2. second\n   - nested\n\n3. third",
  () => "```js\n# not a heading\n\n## still code\n```js-not-a-closer\n```",
  () => "~~~~\n```\n# tilde fence holds a backtick fence\n~~~~",
  () => "$$\n# math, not a heading\n\n\\frac{1}{2}\n$$",
  () => "<!-- a comment\n\n# inside the comment\n-->",
  () => "<div>\n# inside an html block\n</div>",
  () => "<pre>\n\n# inside pre\n</pre>",
  () => "text before\n<span>\n```\ncode after a paragraph html line\n\n# x\n```",
  () => "> # quoted heading\n> quoted text\n\n> second quote",
  () => "| a | b |\n| - | - |\n| 1 | 2 |",
  () => "---",
  () => "    # indented code\n\n    more code",
  () => "Setext title\n============",
  (r) => `Plain words ${"lorem ipsum dolor sit amet ".repeat(1 + Math.floor(r() * 20))}`,
];

function randomDocument(seed: number, blocks: number, kinds = BLOCKS) {
  const r = prng(seed);
  const parts: string[] = [];
  for (let i = 0; i < blocks; i++) parts.push(kinds[Math.floor(r() * kinds.length)](r));
  // Definitions used from anywhere, defined in one place.
  parts.splice(Math.floor(r() * parts.length), 0, "[ref0]: https://example.com/zero");
  parts.push('[ref1]: https://example.com/one "One"\n[ref2]: <https://example.com/two>');
  return parts.join("\n\n");
}

test("a split document renders exactly as the whole document", () => {
  let split = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const source = randomDocument(seed, 420);
    assert.ok(source.length > SEGMENT_MIN_DOCUMENT, `seed ${seed} is long enough to split`);
    const segments = splitMarkdownSegments(source);
    if (segments.sources.length > 1) split++;
    assert.equal(renderSegments(segments), renderWhole(source), `seed ${seed}`);
  }
  assert.ok(split >= 20, `most documents split (${split}/24)`);
});

test("without headings, a document splits between top-level blocks and still renders the same", () => {
  // Only after SEGMENT_MAX characters with no heading does a cut fall between
  // other blocks, so these documents have no unindented ATX headings at all.
  const kinds = BLOCKS.slice(1).map((make) => (r: () => number) => make(r).replace(/^#/gm, "\\#"));
  let split = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const source = randomDocument(seed, 500, kinds);
    const segments = splitMarkdownSegments(source);
    if (segments.sources.length > 1) split++;
    assert.equal(renderSegments(segments), renderWhole(source), `seed ${seed}`);
  }
  assert.ok(split >= 10, `most documents split (${split}/12)`);
});

test("a long loose list is never cut between its items", () => {
  const item = (marker: string) => `${marker} ${"word ".repeat(400)}`;
  const source = [
    Array.from({ length: 20 }, () => item("-")).join("\n\n"),
    Array.from({ length: 20 }, (_, i) => item(`${i + 1}.`)).join("\n\n"),
    "Closing paragraph.",
  ].join("\n\n");
  const segments = splitMarkdownSegments(source);
  assert.ok(segments.sources.length > 1);
  assert.equal(renderSegments(segments), renderWhole(source));
  assert.equal((renderSegments(segments).match(/<ul>/g) ?? []).length, 1);
});

test("segments cover the source exactly, and short documents stay whole", () => {
  const source = randomDocument(7, 420);
  const segments = splitMarkdownSegments(source);
  const shared = segments.sources[0].length - segments.sizes[0];
  assert.equal(segments.sources.map((s) => s.slice(shared)).join("\n"), source);
  assert.ok(Math.max(...segments.sizes) < 40_000);

  const short = "# Short\n\ntext\n";
  assert.deepEqual(splitMarkdownSegments(short).sources, [short]);
});

test("the audit's 3,000-section document splits at headings with unique ids", () => {
  let source = "# Long document\n\n";
  for (let i = 0; i < 3000; i++)
    source += `## Section ${i}\n\nParagraph ${i}: alpha **bravo** charlie target passage ${i}.\n\n`;
  const segments = splitMarkdownSegments(source);
  assert.ok(segments.sources.length >= 40, `${segments.sources.length} segments`);
  assert.ok(segments.sources.slice(1).every((s) => s.startsWith("## Section ")));
  assert.equal(renderSegments(segments), renderWhole(source));
});

test("duplicate headings keep document-wide ids across segments", () => {
  const filler = "word ".repeat(900);
  const source = ["## Intro", filler, "## Intro", filler, "## intro-1", filler, "## Intro", filler]
    .join("\n\n")
    .repeat(4);
  const segments = splitMarkdownSegments(source);
  assert.ok(segments.sources.length > 4);
  const ids = [...renderSegments(segments).matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    ids,
    [...renderWhole(source).matchAll(/id="([^"]+)"/g)].map((m) => m[1]),
  );
  assert.equal(new Set(ids).size, ids.length);
  // What each segment claimed is recorded for the segments after it.
  assert.deepEqual(
    segments.slugs.flat(),
    ids.map((id) => id.replace(/-\d+$/, "")),
  );
});

test("setext and quoted headings count towards later ids too", () => {
  const filler = "word ".repeat(900);
  const source = ["Title\n=====", "> ## Title", filler, "## Title", filler, "## Title", filler]
    .join("\n\n")
    .repeat(3);
  const segments = splitMarkdownSegments(source);
  assert.ok(segments.sources.length > 2);
  assert.equal(renderSegments(segments), renderWhole(source));
});

test("documents the scanner can't split safely render whole", () => {
  const long = "## A\n\n" + "word ".repeat(4000) + "\n\n## B\n\n" + "word ".repeat(4000);
  assert.ok(splitMarkdownSegments(long).sources.length > 1);
  // Footnotes are numbered and collected across the document.
  assert.equal(splitMarkdownSegments(long + "\n\nNote[^1].\n\n[^1]: A note.").sources.length, 1);
  // A definition inside a list, or with its title on the next line, isn't
  // copied line by line.
  assert.equal(splitMarkdownSegments(long + "\n\n- [x]: https://example.com").sources.length, 1);
  assert.equal(
    splitMarkdownSegments(long + '\n\n[x]: https://example.com\n"Title"').sources.length,
    1,
  );
  // An unclosed fence swallows every later heading.
  assert.equal(splitMarkdownSegments("```\n" + long).sources.length, 1);
});
