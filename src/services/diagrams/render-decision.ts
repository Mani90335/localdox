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

/**
 * - `svg`: Mermaid's own SVG, live. Every mode is available.
 * - `gpu`: the WebAssembly layout and WebGL renderer. Raw and Stepped only.
 * - `image`: Mermaid's SVG flattened to one image. Raw only.
 */
export type DiagramRenderer = "svg" | "gpu" | "image";

export interface DiagramRenderDecision {
  renderer: DiagramRenderer;
  /** What settled it: the source scan, or the size of Mermaid's render. */
  basis: "source" | "render";
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
 * remembering are the ones with hundreds of kilobytes of source.
 */
function sourceKey(source: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${source.length}:${(hash >>> 0).toString(36)}`;
}

/** Record that Mermaid's render of this source measured too large for live SVG. */
export function rememberOversized(source: string): void {
  const key = sourceKey(source);
  // Re-inserting moves the entry to the newest end.
  oversized.delete(key);
  oversized.add(key);
  while (oversized.size > REMEMBERED) {
    const oldest = oversized.values().next();
    if (oldest.done) break;
    oversized.delete(oldest.value);
  }
}

export function isKnownOversized(source: string): boolean {
  return oversized.has(sourceKey(source));
}

/** Forget every measured verdict. For tests. */
export function clearOversizedVerdicts(): void {
  oversized.clear();
}
