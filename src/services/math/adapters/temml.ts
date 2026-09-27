// Temml adapter — the MathML-first / accessibility renderer.
//
// Temml converts LaTeX to pure MathML with no accompanying HTML layout layer.
// That is its whole value here: the browser's own math layout engine handles
// the typesetting, so the output is a semantic tree that screen readers walk
// natively, at a fraction of the DOM of KaTeX's dual output. Its cost is that
// rendering quality depends on the browser (and needs a math-capable font), so
// it is an opt-in mode rather than the default.
//
// Unlike MathJax this is an ordinary ES module, so a dynamic `import()` is all
// the laziness it needs — Vite gives it its own chunk automatically.

import { macrosFor, stripRegistryCommands } from "../latex.ts";
import type { MathRendererAdapter, MathRenderRequest, RenderedMath } from "../types.ts";

interface TemmlModule {
  renderToString(
    latex: string,
    options?: {
      displayMode?: boolean;
      macros?: Record<string, string>;
      strict?: boolean | string;
      trust?: boolean;
      throwOnError?: boolean;
      annotate?: boolean;
      wrap?: string;
    },
  ): string;
}

let modulePromise: Promise<TemmlModule> | null = null;
/** Temml needs a webfont for correct glyph coverage; requested with the engine. */
let stylesRequested = false;

export function loadTemml(): Promise<TemmlModule> {
  modulePromise ??= import("temml")
    .then((module) => (module.default ?? module) as unknown as TemmlModule)
    .catch((error: unknown) => {
      modulePromise = null;
      throw error instanceof Error ? error : new Error("Failed to load Temml");
    });
  if (!stylesRequested) {
    stylesRequested = true;
    // Local-font stylesheet: uses whatever math font the system provides rather
    // than downloading one, which keeps this the *light* renderer. It fails
    // silently — MathML is still laid out without it, just with wider glyph
    // substitution.
    void import("temml/dist/Temml-Local.css").catch(() => {
      stylesRequested = false;
    });
  }
  return modulePromise;
}

const MACROS = macrosFor("temml");

export const temmlAdapter: MathRendererAdapter = {
  engine: "temml",

  // Temml's coverage sits between KaTeX's and MathJax's. Rather than maintain a
  // third support table, anything it rejects falls through the chain to MathJax
  // exactly as a KaTeX failure does.
  supports(): boolean {
    return true;
  },

  async render(request: MathRenderRequest): Promise<RenderedMath> {
    const { latex, displayMode } = request;
    const temml = await loadTemml();
    // `trust: false` keeps `\href` and friends unavailable to untrusted
    // markdown, matching the KaTeX adapter's posture. `annotate` embeds the
    // LaTeX source in the MathML as a `<annotation encoding="application/x-tex">`
    // element, which is what makes the output round-trippable for assistive
    // tools that prefer the source.
    const mathml = temml.renderToString(stripRegistryCommands(latex), {
      displayMode,
      macros: MACROS,
      strict: false,
      trust: false,
      throwOnError: true,
      annotate: true,
      wrap: "=",
    });

    // For Temml the visual markup *is* the MathML, so both fields are the same
    // string — `Copy MathML` and the rendered output cannot drift apart.
    return { html: mathml, mathml, engine: "temml", latex, displayMode };
  },
};
