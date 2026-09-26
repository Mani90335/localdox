// KaTeX adapter — the default renderer.
//
// KaTeX is synchronous and fast (tens of microseconds for a typical
// expression), which is why it is the default and why this adapter exposes a
// synchronous entry point alongside the async one: a document full of
// equations should paint in one commit, not one per equation.
//
// The *module*, however, is loaded on demand. KaTeX is ~250 kB, and a reader
// opening a document with no math in it should not download it — the same rule
// the viewer already applies to highlight.js. So `katex` is behind a dynamic
// import, and the synchronous path becomes available once that import has
// landed. The first equation in a session therefore costs one module fetch;
// every equation after it, in that document and every later one, is
// synchronous.

import { macrosFor, stripRegistryCommands, katexCanAttempt } from "../latex.ts";
import type { MathRendererAdapter, MathRenderRequest, RenderedMath } from "../types.ts";

/** The subset of KaTeX's API this adapter uses. */
interface KatexModule {
  renderToString(latex: string, options?: Record<string, unknown>): string;
}

let katexModule: KatexModule | null = null;
let katexPromise: Promise<KatexModule> | null = null;

/**
 * Load KaTeX. Resolves immediately once resident.
 *
 * Callers that need the synchronous path start this early (the viewer kicks it
 * off as soon as it sees math in the source) so the module is usually already
 * here by the time the first equation renders.
 */
export function loadKatex(): Promise<KatexModule> {
  if (katexModule) return Promise.resolve(katexModule);
  katexPromise ??= import("katex")
    .then((module) => {
      katexModule = (module.default ?? module) as unknown as KatexModule;
      return katexModule;
    })
    .catch((error: unknown) => {
      katexPromise = null;
      throw error instanceof Error ? error : new Error("Failed to load KaTeX");
    });
  return katexPromise;
}

/** Whether the synchronous path is available right now. */
export function isKatexLoaded(): boolean {
  return katexModule !== null;
}

/**
 * KaTeX options, fixed here rather than per call.
 *
 * `trust: false` and `strict: "ignore"` together are the security posture:
 * untrusted markdown must never reach `\href`, `\url`, `\includegraphics` or
 * `\htmlClass` (all gated behind `trust`), while `strict: "ignore"` keeps
 * Unicode and other soft warnings from turning a readable equation into an
 * error. Hard parse errors still throw, which is what drives the fallback.
 *
 * `output: "htmlAndMathml"` is required, not a preference: the MathML half is
 * what screen readers announce and what `Copy MathML` copies.
 */
const BASE_OPTIONS = {
  output: "htmlAndMathml" as const,
  throwOnError: true,
  strict: "ignore" as const,
  trust: false,
  macros: macrosFor("katex"),
  // `\ref`/`\eqref` are resolved by the EquationRegistry and rendered as React
  // elements, so KaTeX never sees them; `fleqn` is left off so display math
  // stays centred, matching the reader's typography.
};

/**
 * KaTeX, called synchronously.
 *
 * Returns `undefined` when the module is not resident yet — the caller then
 * falls through to the async path, which awaits the load. Throws only for a
 * genuine parse failure, which is the signal the fallback chain waits for.
 */
export function renderKatexSync(request: MathRenderRequest): RenderedMath | undefined {
  if (!katexModule) {
    // Start the fetch so the *next* equation (or this one, on the async path)
    // finds the module here.
    void loadKatex().catch(() => {});
    return undefined;
  }
  return renderWith(katexModule, request);
}

function renderWith(katex: KatexModule, request: MathRenderRequest): RenderedMath {
  const { latex, displayMode } = request;
  const html = katex.renderToString(stripRegistryCommands(latex), {
    ...BASE_OPTIONS,
    displayMode,
    // KaTeX has no `\label` of its own, so the anchor id goes on our wrapper
    // element rather than being asked of the engine.
  });
  return { html, mathml: extractMathml(html), engine: "katex", latex, displayMode };
}

export const katexAdapter: MathRendererAdapter = {
  engine: "katex",

  supports(latex: string): boolean {
    return katexCanAttempt(latex);
  },

  async render(request: MathRenderRequest): Promise<RenderedMath> {
    const katex = await loadKatex();
    // Rejecting rather than returning KaTeX's red error markup is deliberate:
    // the chain gets to try MathJax before the reader ever sees a failure.
    return renderWith(katex, request);
  },
};

/**
 * Pull the `<math>` island out of KaTeX's `htmlAndMathml` output.
 *
 * KaTeX emits `<span class="katex"><span class="katex-mathml"><math …>…</math>
 * </span><span class="katex-html" aria-hidden="true">…</span></span>`. Copy
 * MathML wants that `<math>` element alone. Done by string slicing rather than
 * DOM parsing so this stays usable outside the browser (tests, SSR).
 */
export function extractMathml(html: string): string | undefined {
  const open = html.indexOf("<math");
  if (open === -1) return undefined;
  const close = html.indexOf("</math>", open);
  if (close === -1) return undefined;
  return html.slice(open, close + "</math>".length);
}
