// The react-markdown component bindings for math.
//
// `remark-math-nodes` rewrites math into `<docs-math>` and `<docs-eq-ref>`
// elements carrying the original LaTeX in their attributes; these two entries
// are what turn those elements back into React. Held at module scope so the
// viewer can spread them into its own (memoized) component map without
// rebuilding the map — a fresh identity there would re-render the document.

import { MATH_ELEMENT, MATH_REF_ELEMENT } from "./remark-math-nodes";
import { MathNode } from "./MathNode";
import { EquationRef } from "./EquationRef";

/**
 * Attributes reach a custom element renderer as props. hast lowercases unknown
 * attribute names and react-markdown passes them through verbatim, so the
 * `data-*` names set by the remark pass arrive exactly as written.
 */
interface MathElementProps {
  "data-latex"?: string;
  "data-display"?: string;
}

interface RefElementProps {
  "data-label"?: string;
  "data-paren"?: string;
}

export const MATH_COMPONENTS = {
  [MATH_ELEMENT]: (props: MathElementProps) => (
    <MathNode latex={props["data-latex"] ?? ""} displayMode={props["data-display"] === "true"} />
  ),
  [MATH_REF_ELEMENT]: (props: RefElementProps) => (
    <EquationRef
      label={props["data-label"] ?? ""}
      parenthesised={props["data-paren"] !== "false"}
    />
  ),
} as const;
