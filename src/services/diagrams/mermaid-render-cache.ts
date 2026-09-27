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
 */

import { largeDiagramMermaidConfig } from "./mermaid-config";
import { clearRenderArtifacts } from "./render-error";

export interface MermaidRenderResult {
  svg: string;
}

/**
 * Small, because the entries are large.
 *
 * A handful of diagrams is enough to cover the document the reader is looking
 * at plus the one they just scrolled past; holding more risks pinning several
 * megabytes of SVG text for diagrams nobody will look at again.
 */
const MAX_ENTRIES = 6;

const cache = new Map<string, Promise<MermaidRenderResult>>();

function cacheKey(code: string, dark: boolean, performanceMode: boolean): string {
  return `${dark ? "d" : "l"}:${performanceMode ? "p" : "n"}:${code}`;
}

/** Drop the oldest entry once the map outgrows its budget. */
function evict(): void {
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    cache.delete(oldest.value);
  }
}

/**
 * Render a diagram, reusing an identical render when one exists.
 *
 * Mermaid is imported lazily here rather than by each caller so the dynamic
 * import is also shared; the module registry would dedupe it anyway, but
 * keeping it inside the cache means a cache hit never touches the import at
 * all.
 */
export async function renderMermaid(
  code: string,
  dark: boolean,
  performanceMode: boolean,
): Promise<MermaidRenderResult> {
  const key = cacheKey(code, dark, performanceMode);
  const hit = cache.get(key);
  if (hit) return hit;

  const pending = (async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      theme: dark ? "dark" : "default",
      ...largeDiagramMermaidConfig(performanceMode),
    });
    // A unique id per render: Mermaid namespaces its marker defs by id, and two
    // diagrams sharing one would have the second steal the first's arrowheads.
    const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const { svg } = await mermaid.render(id, code);
      return { svg };
    } catch (error) {
      clearRenderArtifacts(id);
      throw error;
    }
  })();

  // A failed render must not be cached: the reader may fix the source and
  // re-render the same key, and a rejected promise would deny them forever.
  pending.catch(() => cache.delete(key));

  cache.set(key, pending);
  evict();
  return pending;
}

/** Forget everything. Exported for tests and for a hard document reload. */
export function clearMermaidRenderCache(): void {
  cache.clear();
}
