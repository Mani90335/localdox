/**
 * Deciding when a diagram is too big to render as live DOM.
 *
 * The thing that kills a browser tab is the *rendered* element count, not the
 * length of the source text. A 10,000-line flowchart of simple `A --> B` pairs
 * is large but survivable; a 400-line `erDiagram` with forty entities of thirty
 * attributes each explodes into tens of thousands of SVG nodes and takes the
 * tab with it. So the gate is two-stage:
 *
 *  1. A cheap structural pre-scan of the source, to catch the obvious monsters
 *     before Mermaid is ever asked to lay them out.
 *  2. A post-render element count, which is the only number that is actually
 *     true, to catch the dense-but-short diagrams the pre-scan cannot see.
 *
 * Either one tripping is enough. The pre-scan exists to avoid the expensive
 * render where possible; the post-render count is the backstop that makes the
 * guarantee real.
 */

/** Source length past which a diagram is assumed heavy without further study. */
export const PERFORMANCE_MODE_CHARACTER_THRESHOLD = 100_000;
export const PERFORMANCE_MODE_LINE_THRESHOLD = 1_500;

/**
 * Structural budgets for the pre-scan.
 *
 * These are counted on the source text, so they are approximations of what the
 * renderer will produce. They sit low enough to catch a genuinely dense
 * diagram and high enough that an ordinary architecture flowchart — which is
 * the common case, and which animates beautifully — never trips them.
 */
export const PERFORMANCE_MODE_EDGE_THRESHOLD = 900;
export const PERFORMANCE_MODE_ENTITY_THRESHOLD = 60;
/**
 * ER and class diagrams render one row per attribute, and the rows dominate
 * the element count: forty entities is nothing, forty entities of thirty
 * attributes is forty thousand elements.
 */
export const PERFORMANCE_MODE_ATTRIBUTE_THRESHOLD = 700;

/**
 * The real ceiling: how many SVG elements we will keep live in the document.
 *
 * Past this the diagram is flattened to a single decoded image, because every
 * subsequent operation — a hover rule, a zoom, a class toggle — otherwise costs
 * a style recalculation over the whole tree.
 */
export const PERFORMANCE_MODE_ELEMENT_BUDGET = 12_000;

/** Rendered-SVG length past which we don't even bother counting elements. */
export const PERFORMANCE_MODE_SVG_LENGTH_BUDGET = 2_000_000;

/**
 * Count lines without allocating.
 *
 * Splitting a multi-megabyte source just to classify it builds another large
 * array before rendering has even started.
 */
function countLines(source: string, stopAt: number): number {
  let lines = 1;
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 10 && ++lines >= stopAt) return lines;
  }
  return lines;
}

/**
 * What the source looks like structurally, as far as a single pass can tell.
 *
 * One pass over the lines, classifying each by its shape. Nothing here parses
 * Mermaid properly — it does not need to. It needs to distinguish "this will
 * produce a lot of elements" from "this will not", and the shapes that produce
 * many elements are recognisable without a grammar.
 */
export interface DiagramScan {
  lines: number;
  characters: number;
  /** Lines that look like an edge/relationship declaration. */
  edges: number;
  /** Top-level blocks: ER entities, classes, subgraphs. */
  entities: number;
  /** Attribute/member rows inside those blocks. */
  attributes: number;
}

const EDGE_PATTERN = /(-->|---|-\.->|==>|~~~|--[ox|>]|\|\||\}o|\|\{|o\{|\}\||<\|--|\*--|o--|-->)/;
const BLOCK_OPEN_PATTERN = /^\s*(?:erDiagram\s+)?[\w".:-]+\s*\{\s*$/;
const SUBGRAPH_PATTERN = /^\s*subgraph\b/i;
const CLASS_PATTERN = /^\s*class\s+[\w.]+\s*\{/;

/**
 * Scan the source once and report its rough structure.
 *
 * Exported because the caller may want to explain *why* a diagram was
 * downgraded, and because it is the unit worth testing directly.
 */
export function scanDiagramSource(source: string): DiagramScan {
  const scan: DiagramScan = {
    lines: 0,
    characters: source.length,
    edges: 0,
    entities: 0,
    attributes: 0,
  };

  let lines = 1;
  let depth = 0;
  let lineStart = 0;

  // Walk the string once, slicing a line at a time. Slicing per line is far
  // cheaper than one big split: the substrings are short-lived and most are
  // collected immediately.
  for (let index = 0; index <= source.length; index++) {
    const atEnd = index === source.length;
    if (!atEnd && source.charCodeAt(index) !== 10) continue;

    const line = source.slice(lineStart, index);
    lineStart = index + 1;
    if (!atEnd) lines++;

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;

    if (EDGE_PATTERN.test(trimmed)) {
      scan.edges++;
      // An edge line inside a block is still an edge, not an attribute row.
      continue;
    }

    if (SUBGRAPH_PATTERN.test(trimmed) || CLASS_PATTERN.test(trimmed)) {
      scan.entities++;
      if (trimmed.includes("{")) depth++;
      continue;
    }

    if (BLOCK_OPEN_PATTERN.test(trimmed)) {
      scan.entities++;
      depth++;
      continue;
    }

    if (trimmed === "}" || trimmed.startsWith("}")) {
      if (depth > 0) depth--;
      continue;
    }

    // Inside a block, a plain line is an attribute or member row — exactly the
    // thing that multiplies into elements at render time.
    if (depth > 0) scan.attributes++;
  }

  scan.lines = lines;
  return scan;
}

/**
 * Stage one: decide from the source alone, before paying for a render.
 *
 * Cheap checks first so a genuinely huge file short-circuits immediately and
 * never reaches the structural scan.
 */
export function shouldUseDiagramPerformanceMode(source: string): boolean {
  if (source.length >= PERFORMANCE_MODE_CHARACTER_THRESHOLD) return true;
  if (
    source.length >= PERFORMANCE_MODE_LINE_THRESHOLD &&
    countLines(source, PERFORMANCE_MODE_LINE_THRESHOLD) >= PERFORMANCE_MODE_LINE_THRESHOLD
  ) {
    return true;
  }

  const scan = scanDiagramSource(source);
  return (
    scan.edges >= PERFORMANCE_MODE_EDGE_THRESHOLD ||
    scan.attributes >= PERFORMANCE_MODE_ATTRIBUTE_THRESHOLD ||
    scan.entities >= PERFORMANCE_MODE_ENTITY_THRESHOLD
  );
}

/**
 * Stage two: the rendered truth.
 *
 * Counts elements on the SVG *markup* rather than a parsed DOM, because
 * building a second DOM tree to find out whether the first one is too big is
 * self-defeating. Counting `<` is a close enough proxy for element count and
 * costs one linear scan of a string we already hold.
 */
export function isRenderedDiagramTooLarge(svg: string): boolean {
  if (svg.length >= PERFORMANCE_MODE_SVG_LENGTH_BUDGET) return true;
  let elements = 0;
  for (let index = 0; index < svg.length; index++) {
    if (svg.charCodeAt(index) === 60 /* < */) {
      if (++elements >= PERFORMANCE_MODE_ELEMENT_BUDGET) return true;
    }
  }
  return false;
}

/**
 * Whether a live (non-image) diagram is small enough to decorate.
 *
 * Semantic colouring and the explainer's graph read both walk every element,
 * so they get their own, stricter budget than the image cutover: a diagram can
 * be perfectly fine as live DOM and still be too big to run three extra full
 * passes over.
 */
export const DECORATION_ELEMENT_BUDGET = 4_000;

export function canDecorateDiagram(svg: SVGSVGElement): boolean {
  return svg.getElementsByTagName("*").length <= DECORATION_ELEMENT_BUDGET;
}

/** Read Mermaid's root viewBox without constructing a second SVG DOM tree. */
export function readSvgViewBox(svg: string): { width: number; height: number } | null {
  const rootStart = svg.search(/<svg\b/i);
  if (rootStart < 0) return null;
  const rootEnd = svg.indexOf(">", rootStart);
  if (rootEnd < 0) return null;
  const match = svg.slice(rootStart, rootEnd + 1).match(/\bviewBox=["']([^"']+)["']/i);
  if (!match) return null;
  const values = match[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const [, , width, height] = values;
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Hint that visual precision is less important than paint speed for this SVG. */
export function optimizeSvgForImageRendering(svg: string): string {
  return svg.replace(
    /<svg\b/i,
    '<svg shape-rendering="optimizeSpeed" text-rendering="optimizeSpeed" color-rendering="optimizeSpeed"',
  );
}
