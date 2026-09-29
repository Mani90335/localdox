/**
 * One render per diagram, shared by every stage that shows it.
 *
 * The inline stage and the fullscreen stage are two React components rendering
 * the same source. Without a cache, opening fullscreen ran Mermaid's parse and
 * layout a second time while the first copy was still mounted — on a large ER
 * diagram that is several seconds of blocked main thread for a picture we had
 * already drawn. Closing fullscreen did it again. That is the reader-visible
 * "reloading" on every toggle.
 *
 * Keyed on everything that changes the output — the source, the theme, and
 * whether performance mode changed Mermaid's configuration — so a cache hit is
 * always byte-identical to what a fresh render would have produced.
 *
 * In-flight renders are cached as promises rather than results, so two stages
 * mounting in the same tick share one render instead of racing to start two.
 * Every render goes through `withMermaid` (mermaid-runtime.ts), so it is drawn
 * with its own theme and settings even when other diagrams render beside it.
 */

import { BoundedPromiseCache } from "@/lib/bounded-promise-cache";
import { largeDiagramMermaidConfig } from "./mermaid-config";
import { withMermaid } from "./mermaid-runtime";
import { DiagramHeldError } from "./preflight";
import { heldBack } from "./render-decision";
import { clearRenderArtifacts } from "./render-error";

export interface MermaidRenderResult {
  svg: string;
}

/**
 * Bounded by the bytes of SVG held, not by how many diagrams.
 *
 * Six entries used to be the limit. Six small diagrams are a few hundred
 * kilobytes, and a document with more than six re-rendered each one it
 * scrolled back to. Six flattened ER diagrams could be tens of megabytes. Now
 * the whole cache holds at most 12 MiB (a JavaScript string costs up to two
 * bytes a character), however it is split. The entry just used always stays,
 * even past the budget, so a large diagram still opens in full screen without
 * a second render. The entry count only caps bookkeeping.
 */
export const RENDER_CACHE_BYTES = 12 * 1024 * 1024;
const MAX_ENTRIES = 64;

export const svgBytes = (result: MermaidRenderResult) => result.svg.length * 2;

const cache = new BoundedPromiseCache<string, MermaidRenderResult>({
  maxEntries: MAX_ENTRIES,
  maxWeight: RENDER_CACHE_BYTES,
  weigh: svgBytes,
});
const counts = { hits: 0, misses: 0 };

function cacheKey(code: string, dark: boolean, performanceMode: boolean): string {
  return `${dark ? "d" : "l"}:${performanceMode ? "p" : "n"}:${code}`;
}

/**
 * Render a diagram, reusing an identical render when one exists.
 *
 * A diagram the preflight holds back (preflight.ts) is refused with
 * `DiagramHeldError` unless the reader chose to draw it (`allowHeavyRender`).
 * Exports already fall back to the source when a render throws, so a
 * 1,000-node mindmap no longer freezes an export either.
 */
export function renderMermaid(
  code: string,
  dark: boolean,
  performanceMode: boolean,
): Promise<MermaidRenderResult> {
  const held = heldBack(code);
  if (held) return Promise.reject(new DiagramHeldError(held));
  const key = cacheKey(code, dark, performanceMode);
  if (cache.has(key)) counts.hits++;
  else counts.misses++;
  // A failed render is not kept: the reader may fix the source and render the
  // same key again. The cache drops a rejected promise by itself.
  return cache.get(key, () =>
    withMermaid(
      async (mermaid) => {
        // A unique id per render: Mermaid namespaces its marker defs by id, and
        // two diagrams sharing one would have the second steal the first's
        // arrowheads.
        const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
        try {
          const { svg } = await mermaid.render(id, code);
          return { svg };
        } catch (error) {
          clearRenderArtifacts(id);
          throw error;
        }
      },
      {
        label: "render",
        config: { theme: dark ? "dark" : "default", ...largeDiagramMermaidConfig(performanceMode) },
      },
    ),
  );
}

/** What the cache holds, for tests and for debugging from the console. */
export function mermaidRenderCacheStats() {
  return { entries: cache.size, bytes: cache.weight, ...counts };
}

/** Forget everything. Exported for tests and for a hard document reload. */
export function clearMermaidRenderCache(): void {
  cache.clear();
  counts.hits = 0;
  counts.misses = 0;
}
