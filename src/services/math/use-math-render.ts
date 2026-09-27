// The hook that turns LaTeX into markup, and the one place that decides
// whether an equation paints now or after an await.

import { useEffect, useState } from "react";
import {
  isMathRenderError,
  peekRenderedMath,
  renderMath,
  renderMathSync,
} from "./renderer";
import type { MathRenderError, MathRendererType, RenderedMath } from "./types";

export type MathRenderState =
  | { status: "ready"; result: RenderedMath }
  | { status: "pending" }
  | { status: "error"; error: MathRenderError };

/**
 * Typeset one expression.
 *
 * Two paths, and which one runs decides whether the document paints in one
 * commit or two:
 *
 *  - The fast path is synchronous and taken during render. Once KaTeX's module
 *    is resident, a KaTeX-renderable expression is already markup by the time
 *    this returns, so a document full of equations paints once with all of
 *    them present.
 *  - Everything else — the first equations of a session (KaTeX is loaded on
 *    demand, so a reader with no math never downloads it), an `align`
 *    environment needing MathJax, a Temml preference — goes through the effect
 *    and paints itself a moment later. Never the document; just that equation.
 */
export function useMathRender(
  latex: string,
  displayMode: boolean,
  renderer: MathRendererType = "auto",
): MathRenderState {
  // Attempted during render, not in an effect. `renderMathSync` is pure with
  // respect to React — it reads and writes a module-level cache and touches no
  // DOM — and doing it here is the difference between one commit and two.
  const immediate = renderMathSync({ latex, displayMode, renderer });

  const [state, setState] = useState<MathRenderState>(() =>
    immediate ? { status: "ready", result: immediate } : { status: "pending" },
  );

  useEffect(() => {
    // Already settled for this exact expression by a synchronous render or an
    // earlier pass — nothing to do, and no placeholder to flash.
    const cached = peekRenderedMath(latex, displayMode, renderer);
    if (cached) {
      setState((previous) =>
        previous.status === "ready" && previous.result === cached
          ? previous
          : { status: "ready", result: cached },
      );
      return;
    }

    // Deliberately *not* guarded by a ref holding "the expression the state
    // describes". That guard deadlocked under React's double-invoked effects:
    // the first pass marked the expression as handled and was then torn down,
    // and the second pass saw the mark and never started the render at all —
    // leaving the equation on its placeholder for good. The cache above is the
    // correct guard: it is keyed by the work rather than by the attempt, so a
    // second pass either finds the result or redoes work that is idempotent.
    let alive = true;
    setState((previous) => (previous.status === "pending" ? previous : { status: "pending" }));

    renderMath({ latex, displayMode, renderer })
      .then((result) => {
        if (alive) setState({ status: "ready", result });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setState({
          status: "error",
          error: isMathRenderError(error)
            ? error
            : {
                latex,
                displayMode,
                message: error instanceof Error ? error.message : String(error),
                attempted: [],
              },
        });
      });

    return () => {
      alive = false;
    };
  }, [latex, displayMode, renderer]);

  // A synchronous result always wins over state that describes something else:
  // when `latex` changes to an expression KaTeX can draw, the markup exists
  // before the effect has had a chance to run.
  if (immediate && (state.status !== "ready" || state.result.latex !== latex)) {
    return { status: "ready", result: immediate };
  }
  return state;
}
