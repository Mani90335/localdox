/**
 * One renderer decision per diagram, shared by every mode.
 *
 * Raw and Stepped used to decide separately. Raw scanned the source, rendered
 * the SVG, and moved to the GPU engine when the render measured too large.
 * Stepped only re-ran the source scan, so it never heard about the measured
 * size. A 500-edge chain passes the scan (the GPU threshold is 600 edges), so
 * Raw drew it on a canvas while Stepped mounted the whole 52,000 px SVG.
 *
 * The decision now lives in `Mermaid`, is handed to each stage, and either
 * stage can raise it once Mermaid's render turns out too large. The verdict is
 * also remembered per source, so a remount, a second pane or a mode switch
 * starts from what is already known instead of laying the diagram out again to
 * find it.
 */
import { diagramKind, shouldUseGpuEngine } from "./engine/gate.ts";
import { shouldUseDiagramPerformanceMode } from "./mermaid-performance.ts";
import { preflightDiagram, type DiagramPreflight } from "./preflight.ts";

/**
 * - `svg`: Mermaid's own SVG, live. Every mode is available.
 * - `gpu`: the WebAssembly layout and WebGL renderer. Raw and Stepped only.
 * - `image`: Mermaid's SVG flattened to one image. Raw only.
 * - `held`: not drawn until the reader asks, because Mermaid would lay it out
 *   on the main thread for seconds (preflight.ts). The source is shown.
 */
export type DiagramRenderer = "svg" | "gpu" | "image" | "held";

export interface DiagramRenderDecision {
  renderer: DiagramRenderer;
  /** What settled it: the source scan, or the size of Mermaid's render. */
  basis: "source" | "render";
  /** Why a `held` diagram was held. */
  preflight?: DiagramPreflight;
}

/**
 * Decide from the source, raised by a render that measured too large.
 *
 * A diagram kind the GPU engine draws goes there. Any other kind is shown as
 * an image, because it has no live renderer that copes at that size.
 */
export function decideDiagramRender(
  source: string,
  renderedTooLarge = false,
): DiagramRenderDecision {
  if (shouldUseGpuEngine(source)) return { renderer: "gpu", basis: "source" };
  const preflight = heldBack(source);
  if (preflight) return { renderer: "held", basis: "source", preflight };
  if (shouldUseDiagramPerformanceMode(source)) return { renderer: "image", basis: "source" };
  if (renderedTooLarge || isKnownOversized(source)) {
    return { renderer: diagramKind(source) ? "gpu" : "image", basis: "render" };
  }
  return { renderer: "svg", basis: "source" };
}

/** How many measured verdicts to keep. Each entry is a short hash. */
const REMEMBERED = 64;
const oversized = new Set<string>();

/**
 * FNV-1a of the source, with its length.
 *
 * A hash rather than the source itself, because the diagrams worth
 * remembering are the ones with hundreds of kilobytes of source. Trimmed, as
 * the viewer trims its fence and an export may not.
 */
function sourceKey(raw: string): string {
  const source = raw.trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${source.length}:${(hash >>> 0).toString(36)}`;
}

/** Add a verdict at the newest end, dropping the oldest past `REMEMBERED`. */
function remember(set: Set<string>, source: string): void {
  const key = sourceKey(source);
  set.delete(key);
  set.add(key);
  while (set.size > REMEMBERED) {
    const oldest = set.values().next();
    if (oldest.done) break;
    set.delete(oldest.value);
  }
}

/** Record that Mermaid's render of this source measured too large for live SVG. */
export function rememberOversized(source: string): void {
  remember(oversized, source);
}

export function isKnownOversized(source: string): boolean {
  return oversized.has(sourceKey(source));
}

/** Sources the reader chose to draw despite the preflight. Hashes, as above. */
const allowed = new Set<string>();

/** Remember that the reader asked for this held diagram to be drawn. */
export function allowHeavyRender(source: string): void {
  remember(allowed, source);
}

/**
 * Why this diagram shouldn't be drawn without asking, or null.
 *
 * Remembered per source for the session, so a remount, a second pane, and an
 * export of the same document all respect the reader's choice.
 */
export function heldBack(source: string): DiagramPreflight | null {
  const preflight = preflightDiagram(source);
  return preflight && !allowed.has(sourceKey(source)) ? preflight : null;
}

/** Forget every measured verdict and every choice to draw anyway. For tests. */
export function clearOversizedVerdicts(): void {
  oversized.clear();
  allowed.clear();
}
