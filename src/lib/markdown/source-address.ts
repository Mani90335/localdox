// Source addressing: naming any place in a rendered document by its offset in
// the Markdown file it was rendered from.
//
// The reader used to find things by searching rendered text. Inspect looked
// for the selected words in the whole file, a search hit counted the N-th
// occurrence of the query on the page, and a note looked for its quote. Each
// works until the words repeat, or until the page holds text the source
// doesn't (a diagram's labels and stylesheet) or lacks text it does (a table
// row's cell separators). Then they land somewhere else, silently.
//
// An address instead says *where in the file*: `{ start, end }`, offsets into
// the document's Markdown. Three parts make that usable on a rendered page:
//
//  1. `rehypeSourceAddress` stamps each block the renderer emits (paragraph,
//     heading, list item, table cell, code block, equation, …) with the file
//     span it came from, as `data-src="start:end"`. Spans are translated into
//     file coordinates while rendering, through the segment a long document
//     was split into and the page a paged document shows (`renderSourceMap`).
//  2. Inside one block, `alignTexts` lines the block's rendered text up with
//     its projected source (source-locate.ts), so any character maps to a file
//     offset and back. One block is small, so this is exact in practice; the
//     whole-file searches it replaces were not.
//  3. Things that aren't source-shaped have their own way in: a search hit is
//     a line plus an occurrence (`searchHitSpan`); a note keeps a source
//     anchor that survives edits elsewhere in the file (`relocateAnchor`).
//
// The DOM side is dom-address.ts. Everything here is pure and runs in Node.

import { projectSource } from "./source-locate.ts";
import { queryPattern } from "../search/rows.ts";

export interface SourceSpan {
  start: number;
  end: number;
}

/** The attribute a rendered block carries its file span in. */
export const SOURCE_ATTR = "data-src";
/** Marks a block whose inside has no text correspondence (an equation, a diagram). */
export const ATOMIC_ATTR = "data-src-atomic";

export const formatSpan = ({ start, end }: SourceSpan) => `${start}:${end}`;

export function parseSpan(value: string | null | undefined): SourceSpan | null {
  if (!value) return null;
  const colon = value.indexOf(":");
  const start = Number(value.slice(0, colon));
  const end = Number(value.slice(colon + 1));
  return colon > 0 && Number.isInteger(start) && Number.isInteger(end) && end >= start
    ? { start, end }
    : null;
}

// ---- from the rendered source to the file ----------------------------------

/** Offsets in the string handed to the renderer, mapped into the file. */
export interface RenderSourceMap {
  toFile(offset: number): number;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  return starts;
}

/**
 * Map offsets in `rendered` to offsets in `file`.
 *
 * The renderer doesn't see the file as-is. A paged document renders one page
 * with its heading and edge rules stripped (`rendered` then starts at `base`),
 * and `prepareWorkspaceEmbeds` rewrites `![[name]]` shorthands into longer
 * image syntax. Both keep lines intact, so the map is per line: a line the
 * renderer saw unchanged maps column for column; a rewritten one clamps to the
 * file line's length. Lines past the file (footnote definitions appended to a
 * converted page) map to its end.
 */
export function renderSourceMap(file: string, rendered: string, base = 0): RenderSourceMap {
  const rendStarts = lineStarts(rendered);
  const fileStarts: number[] = [];
  const fileEnds: number[] = [];
  let at = Math.min(base, file.length);
  for (let i = 0; i < rendStarts.length; i++) {
    const newline = at < file.length ? file.indexOf("\n", at) : -1;
    const end = newline === -1 ? file.length : newline;
    fileStarts.push(at);
    fileEnds.push(end);
    at = newline === -1 ? file.length : newline + 1;
  }
  return {
    toFile(offset) {
      const o = Math.max(0, Math.min(offset, rendered.length));
      let lo = 0;
      let hi = rendStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (rendStarts[mid] <= o) lo = mid;
        else hi = mid - 1;
      }
      const column = o - rendStarts[lo];
      const fileLength = fileEnds[lo] - fileStarts[lo];
      const rendEnd = lo + 1 < rendStarts.length ? rendStarts[lo + 1] - 1 : rendered.length;
      const same =
        rendEnd - rendStarts[lo] === fileLength &&
        rendered.slice(rendStarts[lo], rendEnd) === file.slice(fileStarts[lo], fileEnds[lo]);
      return fileStarts[lo] + (same ? column : Math.min(column, fileLength));
    },
  };
}

// ---- stamping rendered blocks -----------------------------------------------

/** Elements that get a span: blocks, cells, images and equations. */
const STAMPED = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
  "table",
  "tr",
  "td",
  "th",
  "dt",
  "dd",
  "img",
  "docs-math",
]);
/** Stamped elements whose rendering has no character-level relation to their source. */
const ATOMIC = new Set(["docs-math"]);

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

/**
 * rehype plugin: put each block's file span on it as `data-src`.
 *
 * `toFile` maps an offset in the source this tree was parsed from into the
 * file. Nodes without a position (made by a plugin rather than parsed) are
 * left alone; the nearest stamped ancestor covers them.
 *
 * Blocks only, deliberately. A document's inline elements outnumber its blocks
 * many times over, and within one block the text alignment is exact enough.
 */
export function rehypeSourceAddress(options: { toFile: (offset: number) => number }) {
  return (tree: HastNode) => {
    const visit = (node: HastNode) => {
      if (node.type === "element" && STAMPED.has(node.tagName ?? "")) {
        const start = node.position?.start?.offset;
        const end = node.position?.end?.offset;
        if (typeof start === "number" && typeof end === "number") {
          node.properties ??= {};
          node.properties.dataSrc = formatSpan({
            start: options.toFile(start),
            end: options.toFile(end),
          });
          if (ATOMIC.has(node.tagName!)) node.properties.dataSrcAtomic = "";
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

// ---- aligning rendered text with source ----------------------------------------

const isSpace = (code: number) =>
  code === 32 || code === 10 || code === 9 || code === 13 || code === 12 || code === 160;

/** How far ahead to look for the two texts to agree again after they diverge. */
const RESYNC_WINDOW = 256;
const RESYNC_KEY = 6;

/**
 * For each index in `a`, the index in `b` holding the same character, or -1.
 *
 * `a` is a block's rendered text and `b` its projected source. They agree
 * almost everywhere; where they don't — whitespace the renderer collapsed or
 * added, a list number, a footnote marker, an entity — the walk skips ahead
 * on whichever side lets the next few characters match again. Linear, apart
 * from bounded look-ahead at each divergence.
 */
export function alignTexts(a: string, b: string): Int32Array {
  const out = new Int32Array(a.length).fill(-1);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(j);
    if (ca === cb || (isSpace(ca) && isSpace(cb))) {
      out[i++] = j++;
      continue;
    }
    if (isSpace(ca)) {
      // Rendered whitespace with no source counterpart (between table cells,
      // after a list marker): it belongs where the source is now.
      out[i++] = j;
      continue;
    }
    if (isSpace(cb)) {
      j++;
      continue;
    }
    const key = a.slice(i, i + RESYNC_KEY);
    const inB = b.indexOf(key, j);
    if (inB !== -1 && inB - j <= RESYNC_WINDOW) {
      j = inB;
      continue;
    }
    const keyB = b.slice(j, j + RESYNC_KEY);
    const inA = a.indexOf(keyB, i);
    if (inA !== -1 && inA - i <= RESYNC_WINDOW) {
      i = inA;
      continue;
    }
    i++;
  }
  return out;
}

/** The nearest mapped neighbour of `index`, searching in `direction` first. */
export function nearestMapped(map: Int32Array, index: number, direction: 1 | -1): number {
  for (let k = index; k >= 0 && k < map.length; k += direction) if (map[k] !== -1) return map[k];
  for (let k = index; k >= 0 && k < map.length; k -= direction) if (map[k] !== -1) return map[k];
  return -1;
}

// ---- search hits -----------------------------------------------------------------

/**
 * The file span of one search hit: occurrence `occurrence` of `query` within
 * the indexed text `rowText` of line `lineIndex`.
 *
 * Counted in `rowText`, exactly as the index counted it, then mapped through
 * the line's projected source. Works the same for prose, table rows (whose
 * indexed text separates cells with tabs), code, and the source of a drawn
 * diagram, which has no text on the page to count at all.
 */
export function searchHitSpan(
  file: string,
  lineIndex: number,
  rowText: string,
  query: string,
  occurrence: number,
): SourceSpan | null {
  const needle = query.trim();
  if (!needle || lineIndex < 0) return null;
  let lineStart = 0;
  for (let line = 0; line < lineIndex; line++) {
    const next = file.indexOf("\n", lineStart);
    if (next === -1) return null;
    lineStart = next + 1;
  }
  const newline = file.indexOf("\n", lineStart);
  const line = file.slice(lineStart, newline === -1 ? file.length : newline);

  const pattern = queryPattern(needle);
  let match: RegExpExecArray | null;
  let count = 0;
  let hit: { index: number; length: number } | null = null;
  while ((match = pattern.exec(rowText))) {
    if (count++ === occurrence) {
      hit = { index: match.index, length: match[0].length };
      break;
    }
  }
  if (!hit) return null;

  const projected = projectSource(line);
  const toProjected = alignTexts(rowText, projected.text);
  const first = nearestMapped(toProjected, hit.index, 1);
  const last = nearestMapped(toProjected, hit.index + hit.length - 1, -1);
  if (first === -1 || last === -1 || last < first) return null;
  return {
    start: lineStart + projected.map[first],
    end: lineStart + projected.map[last] + 1,
  };
}

/** A span widened to whole lines — what "Copy code" hands over. */
export function lineSpan(file: string, span: SourceSpan): SourceSpan {
  const start = file.lastIndexOf("\n", Math.max(0, span.start - 1)) + 1;
  const last = Math.max(span.start, span.end - 1);
  const newline = file.indexOf("\n", last);
  let end = newline === -1 ? file.length : newline;
  if (file[end - 1] === "\r") end--;
  return { start: span.start === 0 ? 0 : start, end };
}

// ---- anchors that survive edits ------------------------------------------------------

/**
 * A source span, plus enough of its own text to find it again: the first and
 * last characters of the span as they were in the file. Offsets are tried
 * first; when the file has changed, the span's own head and tail relocate it.
 */
export interface SourceAnchor extends SourceSpan {
  head: string;
  tail: string;
}

const ANCHOR_EDGE = 32;

export function anchorSpan(file: string, span: SourceSpan): SourceAnchor {
  const text = file.slice(span.start, span.end);
  return {
    ...span,
    head: text.slice(0, ANCHOR_EDGE),
    tail: text.slice(-ANCHOR_EDGE),
  };
}

/**
 * Where an anchored span is in `file` now, or null if its text is gone.
 *
 * Unchanged in place → the same span. Moved (text inserted or removed before
 * it) → the occurrence of its head nearest the old position whose tail follows
 * at about the old length. Edited inside its middle → still found, by head and
 * tail. Its head or tail edited → null, and the caller falls back to the
 * rendered quote.
 */
export function relocateAnchor(file: string, anchor: SourceAnchor): SourceSpan | null {
  const { start, end, head, tail } = anchor;
  if (!head || !tail || end < start) return null;
  const fits = (from: number, to: number) =>
    file.startsWith(head, from) &&
    to - tail.length >= from &&
    file.startsWith(tail, to - tail.length);
  if (fits(start, end)) return { start, end };

  const length = end - start;
  const slack = Math.max(64, Math.round(length * 0.25));
  const heads: number[] = [];
  for (let at = file.indexOf(head); at !== -1; at = file.indexOf(head, at + 1)) heads.push(at);
  heads.sort((x, y) => Math.abs(x - start) - Math.abs(y - start));
  for (const from of heads) {
    // The tail nearest where it used to sit, relative to the head.
    const expected = from + length - tail.length;
    let best = -1;
    for (
      let at = file.indexOf(tail, Math.max(from, expected - slack));
      at !== -1 && at <= expected + slack;
      at = file.indexOf(tail, at + 1)
    ) {
      if (best === -1 || Math.abs(at - expected) < Math.abs(best - expected)) best = at;
    }
    if (best !== -1) return { start: from, end: best + tail.length };
  }
  return null;
}
