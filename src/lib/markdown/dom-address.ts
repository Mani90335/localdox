// Source addressing on the rendered page (see source-address.ts for the idea).
//
// Rendered blocks carry their file span in `data-src`. Within one block, the
// text is split at its stamped children (a nested list, a table cell, an
// inline equation) into runs, each of which came from a known gap of source
// between those children; a run's characters are aligned with its gap's
// projected source. That gives, for any point on the page, a file offset, and
// for any file offset on the page, a point.

import {
  ATOMIC_ATTR,
  SOURCE_ATTR,
  alignTexts,
  nearestMapped,
  parseSpan,
  type SourceSpan,
} from "./source-address";
import { projectSource } from "./source-locate";

const STAMPED = `[${SOURCE_ATTR}]`;
/** Viewer chrome inside a block: never part of its text. */
const CHROME = "button, svg, style, script, [aria-hidden='true'], [data-viewer-ui]";

interface Gap {
  /** The source this run of text came from. */
  from: number;
  to: number;
  nodes: Text[];
  /** Offset of each node within the run's text. */
  starts: number[];
  length: number;
  /** Lazily: each character of the run → file offset, or -1. */
  map?: Int32Array;
}

interface Block {
  element: Element;
  span: SourceSpan;
  atomic: boolean;
}

function blockOf(element: Element): Block | null {
  const span = parseSpan(element.getAttribute(SOURCE_ATTR));
  return span ? { element, span, atomic: element.hasAttribute(ATOMIC_ATTR) } : null;
}

/** A block's text, split into runs at its stamped children. */
function gapsOf(block: Block): Gap[] {
  const gaps: Gap[] = [];
  let current: Gap = {
    from: block.span.start,
    to: block.span.end,
    nodes: [],
    starts: [],
    length: 0,
  };
  const walk = (parent: Node) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child as Text;
        current.starts.push(current.length);
        current.nodes.push(text);
        current.length += text.length;
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as Element;
      if (element.matches(CHROME)) continue;
      const nested = element.hasAttribute(SOURCE_ATTR) ? blockOf(element) : null;
      if (nested) {
        current.to = nested.span.start;
        gaps.push(current);
        current = { from: nested.span.end, to: block.span.end, nodes: [], starts: [], length: 0 };
        continue;
      }
      walk(element);
    }
  };
  walk(block.element);
  gaps.push(current);
  return gaps;
}

function mapOf(gap: Gap, file: string): Int32Array {
  if (gap.map) return gap.map;
  const text = gap.nodes.map((node) => node.data).join("");
  const projected = projectSource(file.slice(gap.from, Math.max(gap.from, gap.to)));
  const toProjected = alignTexts(text, projected.text);
  const map = new Int32Array(text.length);
  for (let i = 0; i < text.length; i++)
    map[i] = toProjected[i] === -1 ? -1 : gap.from + projected.map[toProjected[i]];
  return (gap.map = map);
}

function firstText(node: Node): Text | null {
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  return document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
}

function lastText(node: Node): Text | null {
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) last = text as Text;
  return last;
}

/**
 * A boundary point, normalised to a text node and an offset within it. An
 * element point (child index) becomes the first text after it for a start,
 * the last text before it for an end; [node, -1] when it holds no text.
 */
function textPoint(node: Node, offset: number, side: "start" | "end"): [Text, number] | [Node, -1] {
  if (node.nodeType === Node.TEXT_NODE) return [node as Text, offset];
  const children = node.childNodes;
  const after = () => {
    for (let i = offset; i < children.length; i++) {
      const text = firstText(children[i]);
      if (text) return [text, 0] as [Text, number];
    }
    return null;
  };
  const before = () => {
    for (let i = Math.min(offset, children.length) - 1; i >= 0; i--) {
      const text = lastText(children[i]);
      if (text) return [text, text.length] as [Text, number];
    }
    return null;
  };
  return (side === "start" ? (after() ?? before()) : (before() ?? after())) ?? [node, -1];
}

/**
 * The file offset of a boundary point on the page, or null when the point is
 * outside every stamped block (the masthead, unaddressed converted HTML).
 * `side` matters at the edges of a character: a selection's end is the
 * offset just past its last character.
 */
export function sourceOffsetAt(
  container: Element,
  node: Node,
  offset: number,
  file: string,
  side: "start" | "end",
): number | null {
  if (!container.contains(node)) return null;
  const [text, local] = textPoint(node, offset, side);
  const anchor = local === -1 ? (text as Element) : text.parentElement;
  const element = anchor?.closest(STAMPED);
  if (!element || !container.contains(element)) return null;
  const block = blockOf(element)!;
  if (block.atomic) return side === "start" ? block.span.start : block.span.end;
  if (local === -1) return side === "start" ? block.span.start : block.span.end;

  for (const gap of gapsOf(block)) {
    const k = gap.nodes.indexOf(text as Text);
    if (k === -1) continue;
    const index = gap.starts[k] + local;
    const map = mapOf(gap, file);
    if (side === "start") {
      const at = index < map.length ? nearestMapped(map, index, 1) : -1;
      if (at !== -1) return at;
      const before = nearestMapped(map, map.length - 1, -1);
      return before === -1 ? gap.from : before + 1;
    }
    const at = index > 0 ? nearestMapped(map, index - 1, -1) : -1;
    return at === -1 ? gap.from : at + 1;
  }
  // A text node in chrome or otherwise outside the runs: the block's edge.
  return side === "start" ? block.span.start : block.span.end;
}

/** The file span a page range covers, or null when either end is unaddressed. */
export function addressOfRange(container: Element, range: Range, file: string): SourceSpan | null {
  const start = sourceOffsetAt(container, range.startContainer, range.startOffset, file, "start");
  const end = sourceOffsetAt(container, range.endContainer, range.endOffset, file, "end");
  if (start === null || end === null) return null;
  return end >= start ? { start, end } : { start: end, end: start };
}

/** The innermost stamped block holding `offset`. */
function innermost(container: Element, offset: number, side: "start" | "end"): Block | null {
  let best: Block | null = null;
  for (const element of container.querySelectorAll(STAMPED)) {
    const block = blockOf(element);
    if (!block) continue;
    const { start, end } = block.span;
    const holds =
      side === "start" ? start <= offset && offset < end : start < offset && offset <= end;
    if (!holds) continue;
    if (!best || end - start <= best.span.end - best.span.start) best = block;
  }
  return best;
}

interface Point {
  node: Node;
  offset: number;
  /** Set when the point fell inside an atomic block (an equation, a diagram). */
  atomic?: Element;
}

function pointAt(
  container: Element,
  offset: number,
  file: string,
  side: "start" | "end",
): Point | null {
  const block = innermost(container, offset, side);
  if (!block) return null;
  if (block.atomic) {
    const element = block.element;
    return {
      node: element,
      offset: side === "start" ? 0 : element.childNodes.length,
      atomic: element,
    };
  }
  const gaps = gapsOf(block);
  for (const gap of gaps) {
    if (
      side === "start"
        ? offset < gap.from || offset >= gap.to
        : offset <= gap.from || offset > gap.to
    )
      continue;
    const map = mapOf(gap, file);
    let index = -1;
    if (side === "start") {
      for (let i = 0; i < map.length; i++)
        if (map[i] !== -1 && map[i] >= offset) {
          index = i;
          break;
        }
    } else {
      for (let i = map.length - 1; i >= 0; i--)
        if (map[i] !== -1 && map[i] < offset) {
          index = i + 1;
          break;
        }
    }
    if (index === -1) continue;
    // Text index → text node and offset.
    let k = gap.starts.length - 1;
    while (k > 0 && gap.starts[k] > index) k--;
    if (side === "end" && k > 0 && gap.starts[k] === index) k--;
    return { node: gap.nodes[k], offset: index - gap.starts[k] };
  }
  // In the block but in no run (markup with no rendered text of its own).
  return {
    node: block.element,
    offset: side === "start" ? 0 : block.element.childNodes.length,
  };
}

export interface AddressedRange {
  range: Range;
  /** The equation or diagram the span fell inside, which has no text to select. */
  atomic: Element | null;
}

/** The page range for a file span, or null when it isn't on this page. */
export function rangeOfAddress(
  container: Element,
  span: SourceSpan,
  file: string,
): AddressedRange | null {
  const start = pointAt(container, span.start, file, "start");
  const end = pointAt(container, Math.max(span.end, span.start + 1), file, "end");
  if (!start || !end) return null;
  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return null;
  }
  if (range.collapsed && !start.atomic) return null;
  return { range, atomic: start.atomic && start.atomic === end.atomic ? start.atomic : null };
}

/**
 * Inside an atomic block (a diagram), the first visible text matching
 * `query` — a node label — so a search hit in a diagram's source lands on
 * the label that shows it, when one does.
 */
export function queryRangeWithin(element: Element, query: string): Range | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("style, script")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
    const at = text.data.toLowerCase().indexOf(needle);
    if (at === -1) continue;
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + needle.length);
    return range;
  }
  return null;
}
