// Shared vocabulary for the math layer.
//
// The reader's math pipeline is deliberately renderer-agnostic: markdown is
// parsed once by remark-math, every math node keeps its *original* LaTeX, and
// an adapter turns that LaTeX into markup. Which adapter runs is a policy
// decision (`MathRendererType`), never something the surrounding components
// know about — that is what lets KaTeX stay the fast default while MathJax 4
// covers what KaTeX cannot and Temml serves MathML-first accessibility.

/**
 * Which engine to typeset with.
 *
 * `auto` is the production default and means: KaTeX if it can, MathJax 4 if it
 * cannot. The explicit values exist for the reader's preference and for tests
 * that need to pin one engine.
 */
export type MathRendererType = "auto" | "katex" | "mathjax" | "temml";

/** One typesetting job. The LaTeX here is always the author's source text. */
export interface MathRenderRequest {
  /** Original LaTeX, exactly as written between the `$` delimiters. */
  latex: string;
  displayMode: boolean;
  renderer?: MathRendererType;
  /** `\label{…}` target, if the equation declared one. */
  equationId?: string;
  /** Resolved display number ("3", "A.1"), assigned by the EquationRegistry. */
  equationNumber?: string;
}

/** Which engine actually produced a result. Never `auto` — that is a request. */
export type MathEngine = Exclude<MathRendererType, "auto">;

/** Successful typesetting output. */
export interface RenderedMath {
  /** HTML (KaTeX/MathJax CHTML) or MathML (Temml) markup, already sanitized. */
  html: string;
  /**
   * MathML for `Copy MathML` and for assistive technology when the visual
   * markup carries none. KaTeX's `htmlAndMathml` output embeds it, Temml *is*
   * it, MathJax exposes it through its own serializer.
   */
  mathml?: string;
  engine: MathEngine;
  /** The source that produced this — echoed back so `Copy LaTeX` never guesses. */
  latex: string;
  displayMode: boolean;
}

/** A typesetting failure that the UI shows in place, without losing the source. */
export interface MathRenderError {
  latex: string;
  displayMode: boolean;
  message: string;
  /** Engines that were tried, in order, before giving up. */
  attempted: MathEngine[];
}

export interface MathRendererAdapter {
  readonly engine: MathEngine;
  /**
   * Cheap, synchronous pre-flight: whether this engine is worth trying at all.
   *
   * A `false` here skips straight to the fallback without paying for a parse.
   * It is a heuristic, not a promise — `render` must still reject cleanly for
   * anything it turns out not to handle.
   */
  supports(latex: string): boolean;
  render(request: MathRenderRequest): Promise<RenderedMath>;
}

/** Accessibility/typesetting preferences the reader controls. */
export interface MathPreferences {
  renderer: MathRendererType;
  /** Number display equations and resolve `\ref`/`\eqref` against them. */
  numberEquations: boolean;
}

export const DEFAULT_MATH_PREFERENCES: MathPreferences = {
  renderer: "auto",
  numberEquations: true,
};
