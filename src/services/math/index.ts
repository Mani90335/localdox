// Math rendering service: LaTeX -> KaTeX/MathJax/Temml, with numbering and
// cross-references. NOTE: the React binding layer here (MathProvider, MathNode,
// EquationRef, MATH_COMPONENTS) is not yet wired into MarkdownViewer.tsx's
// react-markdown components map, so math notation does not currently render
// in the live viewer. Relocated as-is; this is a known pre-existing gap, not
// something this move fixes.

export type { MathPreferences, MathRendererType } from "./types";
export { DEFAULT_MATH_PREFERENCES } from "./types";
export { clearMathCache, mathCacheSize } from "./renderer";
export {
  MATH_ELEMENT,
  MATH_REF_ELEMENT,
  remarkMathNodes,
  remarkEquationReferences,
  remarkInlineMathRefs,
} from "./remark-math-nodes";
export { isKatexLoaded, loadKatex } from "./adapters/katex";

export { MathProvider, useMathContext } from "./MathContext";
export { MathNode } from "./MathNode";
export { EquationRef } from "./EquationRef";
export { MATH_COMPONENTS } from "./components";
export { useMathRender, type MathRenderState } from "./use-math-render";
