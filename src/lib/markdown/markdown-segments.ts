// Splitting a long markdown document into pieces that can be parsed and
// mounted one at a time.
//
// react-markdown turns a source string into React elements in one synchronous
// call: parse, transform, build every element. For a 3,000-section document
// that was a single 800 ms+ task, then one commit inserting ~18,000 nodes. The
// viewer instead renders a document as a list of *segments*, each an ordinary
// react-markdown call on a slice of the source, and mounts them a few at a time
// (see ProgressiveMarkdown). This module decides where the slices go.
//
// A cut is only allowed where the markdown on either side parses exactly as it
// would inside the whole document:
//
//  - before an unindented ATX heading (`## …`). A heading can't be a lazy
//    continuation line, so it always ends any paragraph, list, quote or table
//    above it;
//  - before an unindented line that follows a blank line and doesn't start a
//    list item. After a blank line nothing continues lazily, so that line starts
//    a new top-level block.
//
// and never inside a fenced code block, a `$$` math block, or an HTML block.
//
// Three things in markdown reach across the whole document, and are handled:
//
//  - link reference definitions (`[id]: url`) apply everywhere. Every segment
//    gets all of them, prepended in document order, so the first definition of
//    a label still wins. A definition this scanner can't read with certainty
//    (inside a list or quote, or with its title on the next line) makes it give
//    up and return the document as one segment;
//  - footnotes are numbered and collected across the document, so any footnote
//    definition keeps the document in one segment;
//  - heading ids are de-duplicated across the document by rehype-slug
//    (`intro`, `intro-1`, …). `rehypeSegmentSlug` records the slugs each
//    segment claims and replays those of the earlier segments before slugging
//    its own, so ids match a whole-document render. Segments always render in
//    document order, so the earlier records exist by then.

import GithubSlugger, { slug } from "github-slugger";

/** Below this size a document renders in one piece, exactly as before. */
export const SEGMENT_MIN_DOCUMENT = 16_000;
/** A segment is cut at the next heading once it has reached this size… */
export const SEGMENT_TARGET = 4_000;
/** …or at the next safe line of any kind once it reaches this one. */
export const SEGMENT_MAX = 16_000;

export interface MarkdownSegments {
  /** One markdown source per segment, each parseable on its own. */
  sources: string[];
  /** Characters of the original document in each segment (excludes shared definitions). */
  sizes: number[];
  /** Zero-based source line adjustment, excluding prepended definitions. */
  lineOffsets?: number[];
  /**
   * The base slugs each segment's headings claimed, in order, written by
   * `rehypeSegmentSlug` as the segment renders.
   */
  slugs: Array<string[] | undefined>;
}

const LIST_ITEM = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const UNINDENTED_HEADING = /^#{1,6}(?:[ \t]|$)/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const MATH_OPEN = /^ {0,3}(\${2,})([^$]*)$/;
const FOOTNOTE_DEFINITION = /^[ \t>]*\[\^[^\]\n]+\]:/m;
/** Anything that might be a link reference definition, in any container. */
const LOOSE_DEFINITION = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?\[[^\]\n]+\]:/;
/** A definition this scanner can copy with certainty: one line, top level. */
const STRICT_DEFINITION =
  /^ {0,3}\[(?!\^)(?:[^\]\\\n]|\\.)+\]:[ \t]*(?:<[^>\n]*>|\S+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*$/;

/** HTML blocks that run until an end marker, blank lines included (CommonMark types 1–5). */
const HTML_UNTIL_MARKER: Array<[RegExp, RegExp]> = [
  [/^ {0,3}<(?:pre|script|style|textarea)(?:[\s>]|$)/i, /<\/(?:pre|script|style|textarea)>/i],
  [/^ {0,3}<!--/, /-->/],
  [/^ {0,3}<\?/, /\?>/],
  [/^ {0,3}<!\[CDATA\[/, /\]\]>/],
  [/^ {0,3}<![A-Za-z]/, />/],
];
/** Block-level tags that start an HTML block running to the next blank line (type 6). */
const HTML_BLOCK_TAG =
  /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t>]|\/>|$)/i;
/** A lone complete tag, which starts an HTML block outside a paragraph (type 7). */
const HTML_LONE_TAG =
  /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)[ \t]*$/;

/**
 * Split `source` into segments that each parse on their own exactly as they do
 * inside the whole document. Short documents, and documents this scanner can't
 * split safely, come back as a single segment holding the source unchanged.
 */
export function splitMarkdownSegments(source: string): MarkdownSegments {
  const whole = (): MarkdownSegments => ({ sources: [source], sizes: [source.length], slugs: [] });
  if (source.length < SEGMENT_MIN_DOCUMENT || FOOTNOTE_DEFINITION.test(source)) return whole();

  const lines = source.split("\n");
  const cuts: number[] = [0];
  const definitions: string[] = [];

  let fence: { char: string; length: number } | null = null;
  let math = 0;
  let htmlEnd: RegExp | null = null;
  let htmlUntilBlank = false;
  let previousBlank = true;
  // Whether the previous line was paragraph text, which an HTML block of
  // type 7 can't interrupt.
  let paragraph = false;
  let size = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const blank = line.trim() === "";

    // Inside a block that ignores markdown: only look for its end.
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      paragraph = false;
      size += line.length + 1;
      previousBlank = false;
      continue;
    }
    if (math) {
      const close = /^ {0,3}(\${2,})[ \t]*$/.exec(line);
      if (close && close[1].length >= math) math = 0;
      paragraph = false;
      size += line.length + 1;
      previousBlank = false;
      continue;
    }
    if (htmlEnd) {
      if (htmlEnd.test(line)) htmlEnd = null;
      paragraph = false;
      size += line.length + 1;
      previousBlank = blank;
      continue;
    }
    if (htmlUntilBlank && blank) htmlUntilBlank = false;
    if (htmlUntilBlank) {
      size += line.length + 1;
      previousBlank = false;
      paragraph = false;
      continue;
    }

    // Is this line a safe place to start a new segment?
    if (i > cuts[cuts.length - 1]) {
      const heading = UNINDENTED_HEADING.test(line);
      const blockStart = previousBlank && !blank && !/^\s/.test(line) && !LIST_ITEM.test(line);
      if ((heading && size >= SEGMENT_TARGET) || ((heading || blockStart) && size >= SEGMENT_MAX)) {
        cuts.push(i);
        size = 0;
      }
    }

    // What does this line open? (Inside an HTML block nothing does: a fence
    // marker there is HTML text, and treating it as a fence would put the
    // scanner out of step with the parser for the rest of the document. Those
    // lines were skipped above.)
    const fenceOpen = FENCE_OPEN.exec(line);
    const marker = HTML_UNTIL_MARKER.find(([open]) => open.test(line));
    if (fenceOpen && !(fenceOpen[1][0] === "`" && fenceOpen[2].includes("`"))) {
      fence = { char: fenceOpen[1][0], length: fenceOpen[1].length };
    } else if (MATH_OPEN.test(line)) {
      math = MATH_OPEN.exec(line)![1].length;
    } else if (marker) {
      // The end marker may sit on the opening line itself.
      const rest = line.slice(line.search(marker[0]) + 1);
      if (!marker[1].test(rest)) htmlEnd = marker[1];
    } else if (HTML_BLOCK_TAG.test(line) || (!paragraph && HTML_LONE_TAG.test(line))) {
      htmlUntilBlank = true;
    }

    let definition = false;
    if (!fence && !math && !htmlEnd && !htmlUntilBlank && LOOSE_DEFINITION.test(line)) {
      // A definition can't interrupt a paragraph, and one whose title (or
      // destination) is on the next line isn't something to copy by line.
      const next = lines[i + 1] ?? "";
      const strict =
        STRICT_DEFINITION.test(line) &&
        !paragraph &&
        (next.trim() === "" || LOOSE_DEFINITION.test(next) || UNINDENTED_HEADING.test(next));
      if (!strict) return whole();
      definitions.push(line);
      definition = true;
    }

    paragraph =
      !blank &&
      !fence &&
      !math &&
      !htmlEnd &&
      !htmlUntilBlank &&
      !definition &&
      !ATX_HEADING.test(line);
    size += line.length + 1;
    previousBlank = blank;
  }

  if (cuts.length === 1) return whole();

  const shared = definitions.length ? definitions.join("\n") + "\n\n" : "";
  const sources: string[] = [];
  const sizes: number[] = [];
  for (let s = 0; s < cuts.length; s++) {
    const body = lines.slice(cuts[s], cuts[s + 1] ?? lines.length).join("\n");
    sources.push(shared + body);
    sizes.push(body.length);
  }

  const sharedLines = shared ? shared.split("\n").length - 1 : 0;
  return { sources, sizes, slugs: [], lineOffsets: cuts.map((line) => line - sharedLines) };
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** `hast-util-to-string`: the text of every descendant text node, in order. */
function hastText(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return node.children ? node.children.map(hastText).join("") : "";
}

/**
 * rehype-slug for one segment of a longer document.
 *
 * rehype-slug de-duplicates ids across the tree it is given, so a segment
 * slugged on its own would restart at `intro` where the whole document had
 * reached `intro-3`. This replays the slugs the earlier segments claimed (in
 * the order GithubSlugger would have seen them), then slugs this segment's
 * headings and records them for the segments after it.
 */
export function rehypeSegmentSlug(options: { segments: MarkdownSegments; index: number }) {
  return (tree: HastNode) => {
    const { segments, index } = options;
    const slugger = new GithubSlugger();
    for (let k = 0; k < index; k++)
      for (const base of segments.slugs[k] ?? []) claim(slugger, base);

    const claimed: string[] = [];
    const visit = (node: HastNode) => {
      if (
        node.type === "element" &&
        /^h[1-6]$/.test(node.tagName ?? "") &&
        !(node.properties && node.properties.id)
      ) {
        const base = slug(hastText(node));
        claimed.push(base);
        node.properties ??= {};
        node.properties.id = claim(slugger, base);
      }
      node.children?.forEach(visit);
    };
    visit(tree);
    segments.slugs[index] = claimed;
  };
}

/** `GithubSlugger#slug` for an already-computed base slug. */
function claim(slugger: GithubSlugger, base: string): string {
  const occurrences = slugger.occurrences;
  let result = base;
  while (Object.hasOwn(occurrences, result)) {
    occurrences[base]++;
    result = `${base}-${occurrences[base]}`;
  }
  occurrences[result] = 0;
  return result;
}
