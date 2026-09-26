// Character-offset helpers for the CSS Custom Highlight API.
//
// Highlights are stored as [start,end] character offsets within a page's
// rendered content container. This survives re-renders (no DOM mutation) and
// handles selections that span multiple elements — the text-match approach
// could only wrap text inside a single node.
//
// Everything here runs off a cached index of the container's text nodes.
// Rebuilding that index per call meant a full TreeWalker pass on every mouseup,
// every click, and once per highlight per repaint — O(highlights x document),
// which is what made single-page mode crawl. The index is built once per
// container and invalidated by a MutationObserver, so lookups are a map hit or
// a binary search.

interface TextIndex {
  nodes: Text[];
  /** starts[i] = character offset of nodes[i] from the start of the container. */
  starts: number[];
  /** nodes[i] -> i, so a Selection's node resolves without scanning. */
  order: Map<Text, number>;
  total: number;
  /** Full text content, built lazily (only the text-search paths need it). */
  text: string | null;
  /** Whitespace-collapsed copy of `text` + a map back into it, also lazy. */
  compact: { text: string; map: number[] } | null;
}

// One content container is live at a time, so a single slot beats a WeakMap
// (a WeakMap whose value holds an observer on the key would pin the key alive).
let cachedEl: HTMLElement | null = null;
let cachedIndex: TextIndex | null = null;
let observer: MutationObserver | null = null;

function build(container: HTMLElement): TextIndex {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  const nodes: Text[] = [];
  const starts: number[] = [];
  const order = new Map<Text, number>();
  let acc = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    order.set(t, nodes.length);
    starts.push(acc);
    nodes.push(t);
    acc += t.length;
  }
  return { nodes, starts, order, total: acc, text: null, compact: null };
}

/** The container's full text, cached with the index. */
function fullText(idx: TextIndex): string {
  if (idx.text == null) idx.text = idx.nodes.map((n) => n.data).join("");
  return idx.text;
}

/** Collapse runs of whitespace to a single space. */
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Whitespace-collapsed container text, with map[i] = index in the raw text. */
function compactOf(idx: TextIndex): { text: string; map: number[] } {
  if (idx.compact) return idx.compact;
  const src = fullText(idx);
  const chars: string[] = [];
  const map: number[] = [];
  let space = true; // leading whitespace is dropped
  for (let i = 0; i < src.length; i++) {
    if (/\s/.test(src[i])) {
      if (!space) {
        chars.push(" ");
        map.push(i);
        space = true;
      }
      continue;
    }
    chars.push(src[i]);
    map.push(i);
    space = false;
  }
  idx.compact = { text: chars.join(""), map };
  return idx.compact;
}

function getIndex(container: HTMLElement): TextIndex {
  if (cachedEl !== container) {
    // New container (mode switch, section change, document swap). Re-arm the
    // observer so async content — Mermaid, embeds — invalidates the index too.
    observer?.disconnect();
    observer = new MutationObserver(() => {
      cachedIndex = null;
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    cachedEl = container;
    cachedIndex = null;
  }
  if (!cachedIndex) cachedIndex = build(container);
  return cachedIndex;
}

/** Drop the cached index — call when the container is about to be torn down. */
export function releaseTextIndex() {
  observer?.disconnect();
  observer = null;
  cachedEl = null;
  cachedIndex = null;
}

/** Index of the last text node starting at or before `offset`. */
function nodeAt(idx: TextIndex, offset: number): { node: Text; local: number } | null {
  if (!idx.nodes.length) return null;
  let lo = 0;
  let hi = idx.nodes.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idx.starts[mid] <= offset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const node = idx.nodes[ans];
  return { node, local: Math.max(0, Math.min(offset - idx.starts[ans], node.length)) };
}

/** Offset of (node, nodeOffset) measured in characters from the start of container. */
function pointToOffset(container: HTMLElement, node: Node, nodeOffset: number): number | null {
  const idx = getIndex(container);
  const i = node.nodeType === Node.TEXT_NODE ? idx.order.get(node as Text) : undefined;
  if (i !== undefined) return idx.starts[i] + nodeOffset;

  // The point may sit on an element node (e.g. between children); approximate by
  // summing text length of everything before it.
  if (node.nodeType === Node.ELEMENT_NODE) {
    const range = document.createRange();
    range.selectNodeContents(container);
    try {
      range.setEnd(node, nodeOffset);
      return range.toString().length;
    } catch {
      return null;
    }
  }
  return null;
}

/** Selection start/end as character offsets within container, or null. */
export function getSelectionOffsets(
  container: HTMLElement,
): { start: number; end: number; text: string } | null {
  const sel = window.getSelection();
  // Cheap guards first — a plain click fires mouseup too, and must not pay for
  // an index lookup.
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const start = pointToOffset(container, range.startContainer, range.startOffset);
  const end = pointToOffset(container, range.endContainer, range.endOffset);
  if (start == null || end == null || start === end) return null;
  return { start: Math.min(start, end), end: Math.max(start, end), text: sel.toString() };
}

/**
 * Character offsets of an element's own text within container — the block-level
 * counterpart to `getSelectionOffsets`, used when the reader stars a table, a
 * code block or a quote instead of dragging over it.
 */
export function nodeOffsets(
  container: HTMLElement,
  el: HTMLElement,
): { start: number; end: number; text: string } | null {
  if (!container.contains(el)) return null;
  const start = pointToOffset(container, el, 0);
  const end = pointToOffset(container, el, el.childNodes.length);
  if (start == null || end == null || start >= end) return null;
  return { start, end, text: el.textContent ?? "" };
}

/** Rebuild a DOM Range for the given character offsets within container. */
export function buildRange(container: HTMLElement, start: number, end: number): Range | null {
  const idx = getIndex(container);
  if (start >= end || start < 0 || start > idx.total) return null;
  const a = nodeAt(idx, start);
  const b = nodeAt(idx, Math.min(end, idx.total));
  if (!a || !b) return null;
  const range = document.createRange();
  try {
    range.setStart(a.node, a.local);
    range.setEnd(b.node, b.local);
    return range.collapsed ? null : range;
  } catch {
    return null;
  }
}

/** Character offset under a screen point (for click-to-edit hit testing). */
export function offsetFromPoint(container: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (!r) return null;
    return pointToOffset(container, r.startContainer, r.startOffset);
  }
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (!p) return null;
    return pointToOffset(container, p.offsetNode, p.offset);
  }
  return null;
}

/** Fallback range for legacy highlights that only stored text (no offsets). */
export function firstTextRange(container: HTMLElement, text: string): Range | null {
  const needle = text.trim();
  if (!needle) return null;
  const idx = getIndex(container);
  // Cached with the index — legacy highlights would otherwise rebuild the
  // container's full text string once each, on every repaint.
  const at = fullText(idx).toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return null;
  return buildRange(container, at, at + needle.length);
}

// ---- quote anchoring ----------------------------------------------------
//
// Stored offsets are only valid for the document as it was when the reader
// highlighted it. Editing the markdown above a highlight shifts every offset
// below it, which used to leave highlights painted over unrelated text. So a
// highlight also records the text it covers and a little context on each side,
// and is re-found by that quote whenever the offsets no longer hold.

/** How much surrounding text is stored to disambiguate a repeated quote. */
export const ANCHOR_CONTEXT = 48;

export interface TextAnchor {
  start: number;
  end: number;
}

/** Rendered text on either side of a range — stored with a new highlight. */
export function contextAround(
  container: HTMLElement,
  start: number,
  end: number,
): { prefix: string; suffix: string } {
  const text = fullText(getIndex(container));
  return {
    prefix: text.slice(Math.max(0, start - ANCHOR_CONTEXT), start),
    suffix: text.slice(end, end + ANCHOR_CONTEXT),
  };
}

/** The container's rendered text between two offsets. */
export function textBetween(container: HTMLElement, start: number, end: number): string {
  return fullText(getIndex(container)).slice(start, end);
}

/** True when two pieces of rendered text are the same passage. */
export const sameQuote = (a: string, b: string) =>
  collapse(a).toLowerCase() === collapse(b).toLowerCase();

function occurrences(hay: string, needle: string, cap = 400): number[] {
  const out: number[] = [];
  let i = hay.indexOf(needle);
  while (i !== -1 && out.length < cap) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

/**
 * Locate `quote` in the container's rendered text. When it appears more than
 * once, the copy whose surroundings best match `prefix`/`suffix` wins, with the
 * one nearest `hint` (the highlight's previous offset) breaking the tie — so a
 * phrase repeated across a document re-anchors to the reader's own copy rather
 * than the first one on the page.
 *
 * Returns null only when the text is genuinely gone: the highlight is orphaned,
 * not silently moved somewhere else.
 */
export function findAnchor(
  container: HTMLElement,
  quote: string,
  prefix = "",
  suffix = "",
  hint?: number,
): TextAnchor | null {
  const needle = quote.trim();
  if (!needle) return null;
  const idx = getIndex(container);
  const raw = fullText(idx);
  if (!raw) return null;
  const lower = raw.toLowerCase();

  const candidates = (n: string): TextAnchor[] => {
    const direct = occurrences(lower, n.toLowerCase()).map((s) => ({
      start: s,
      end: s + n.length,
    }));
    if (direct.length) return direct;
    // Re-rendering can change whitespace (a line rewrapped, a list reflowed)
    // without changing a word; match on the collapsed text before giving up.
    const c = compactOf(idx);
    const cn = collapse(n);
    if (!cn) return direct;
    return occurrences(c.text.toLowerCase(), cn.toLowerCase()).map((s) => ({
      start: c.map[s],
      end: c.map[s + cn.length - 1] + 1,
    }));
  };

  let hits = candidates(needle);
  if (!hits.length) {
    // The passage was partly edited. Anchor on the longest surviving prefix so
    // the highlight shrinks to what still exists instead of disappearing.
    for (let len = Math.floor(needle.length * 0.8); len >= 12; len = Math.floor(len * 0.8)) {
      hits = candidates(needle.slice(0, len));
      if (hits.length) break;
    }
  }
  if (!hits.length) return null;
  if (hits.length === 1) return hits[0];

  const pre = prefix.toLowerCase();
  const suf = suffix.toLowerCase();
  let best = hits[0];
  let bestScore = -1;
  let bestDist = Infinity;
  for (const hit of hits) {
    let score = 0;
    for (let k = 1; k <= pre.length && hit.start - k >= 0; k++) {
      if (lower[hit.start - k] !== pre[pre.length - k]) break;
      score++;
    }
    for (let k = 0; k < suf.length && hit.end + k < lower.length; k++) {
      if (lower[hit.end + k] !== suf[k]) break;
      score++;
    }
    const dist = hint == null ? 0 : Math.abs(hit.start - hint);
    if (score > bestScore || (score === bestScore && dist < bestDist)) {
      best = hit;
      bestScore = score;
      bestDist = dist;
    }
  }
  return best;
}
