// One equation on the page.
//
// Everything renderer-specific stops at `useMathRender`; this component's job
// is the reading experience around the markup: numbering, the anchor a
// reference jumps to, the actions tray, horizontal scrolling on narrow screens,
// and a failure that does not take the document with it.

import { memo, useMemo, useState } from "react";
import { extractLabel, isNumberSuppressed } from "./latex";
import { slugLabel } from "./equation-registry";
import { useMathContext } from "./MathContext";
import { useMathRender } from "./use-math-render";

interface MathNodeProps {
  /** Original LaTeX, exactly as the author wrote it between the delimiters. */
  latex: string;
  displayMode: boolean;
}

/**
 * Inline math. No chrome at all: an action tray on `$\hbar$` mid-sentence would
 * be noise, and inline math is rarely what a reader wants to copy separately.
 * The selection popover already copies any span of text, math included.
 */
function InlineMath({ latex }: { latex: string }) {
  const { preferences } = useMathContext();
  const state = useMathRender(latex, false, preferences.renderer);

  if (state.status === "error") {
    return <MathFailure latex={latex} message={state.error.message} displayMode={false} />;
  }
  if (state.status === "pending") {
    // The source itself, monospaced, rather than a skeleton: it is the most
    // informative thing available and it occupies roughly the right width, so
    // the line does not reflow twice.
    return <code className="docs-math-pending">{latex}</code>;
  }
  return (
    <span
      className="docs-math-inline"
      data-math-engine={state.result.engine}
      // Sanitized in `renderer.ts` before it ever reaches here.
      dangerouslySetInnerHTML={{ __html: state.result.html }}
    />
  );
}

/**
 * A display equation: its own block, numbered, anchored, scrollable and
 * actionable.
 */
function DisplayMath({ latex }: { latex: string }) {
  const { registry, preferences } = useMathContext();
  const state = useMathRender(latex, true, preferences.renderer);

  // Numbering comes from the registry, which numbered the whole document from
  // its source — so this number is the same whichever engine drew the equation
  // and whichever section of a paginated document is on screen.
  const entry = useMemo(() => {
    const label = extractLabel(latex);
    if (label) return registry.byLabel(label);
    return registry.resolve(latex, true);
  }, [registry, latex]);

  const number = isNumberSuppressed(latex) ? undefined : entry?.number;
  const domId =
    entry?.domId ?? (extractLabel(latex) ? `eq-${slugLabel(extractLabel(latex)!)}` : undefined);

  if (state.status === "error") {
    return (
      <MathFailure
        latex={latex}
        message={state.error.message}
        displayMode
        attempted={state.error.attempted.join(" → ")}
        number={number}
      />
    );
  }

  return (
    <div
      className="docs-math-block group"
      id={domId}
      data-equation-number={number}
      data-math-engine={state.status === "ready" ? state.result.engine : undefined}
    >
      {/* The equation itself scrolls horizontally inside its own box. A long
          equation must never widen the article — and must never be shrunk to
          fit either, which is what `max-width` on the math would do. */}
      <div
        className="docs-math-scroll"
        tabIndex={0}
        role="group"
        aria-label={equationLabel(number)}
      >
        {state.status === "pending" ? (
          // A div, not a <pre>: `.docs-prose pre` would style it as a code
          // block (padding, a 240px size estimate), several times the height
          // of the equation that replaces it.
          <div className="docs-math-pending-block">{latex}</div>
        ) : (
          <span
            className="docs-math-rendered"
            dangerouslySetInnerHTML={{ __html: state.result.html }}
          />
        )}
      </div>

      {number && (
        <span className="docs-math-number" aria-hidden="true">
          ({number})
        </span>
      )}

    </div>
  );
}

function equationLabel(number?: string): string {
  return number ? `Equation ${number}` : "Equation";
}

/**
 * A malformed or unsupported equation.
 *
 * Non-destructive by construction: the source is shown as written, so nothing
 * the author typed is lost, and the surrounding document renders normally. The
 * point is to make the mistake findable, not to punish the page for it.
 */
function MathFailure({
  latex,
  message,
  displayMode,
  attempted,
  number,
}: {
  latex: string;
  message: string;
  displayMode: boolean;
  attempted?: string;
  number?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!displayMode) {
    return (
      <code
        className="docs-math-error-inline"
        title={message}
        // The message is the useful content for a screen reader here; the
        // source is already read out as the code element's text.
        aria-label={`Math error: ${message}`}
      >
        {latex}
      </code>
    );
  }

  return (
    <div
      className="docs-math-error"
      role="group"
      aria-label={`${equationLabel(number)}: math error`}
    >
      <button
        type="button"
        className="docs-math-error-head"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
      >
        <span className="docs-math-error-badge">LaTeX error</span>
        <span className="docs-math-error-message">{message}</span>
      </button>
      <pre className="docs-math-source">
        <code>{latex}</code>
      </pre>
      {expanded && attempted && (
        <p className="docs-math-error-detail">Renderers tried: {attempted}</p>
      )}
    </div>
  );
}

/**
 * The component react-markdown mounts for every math node.
 *
 * Memoized on `latex`/`displayMode` alone: an equation must not re-render
 * because the document around it did, because the theme changed (colours are
 * inherited CSS variables) or because the viewport resized (scrolling is CSS).
 */
export const MathNode = memo(function MathNode({ latex, displayMode }: MathNodeProps) {
  return displayMode ? <DisplayMath latex={latex} /> : <InlineMath latex={latex} />;
});
