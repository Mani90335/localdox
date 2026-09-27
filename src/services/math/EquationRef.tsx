// A clickable equation reference.
//
// `\eqref{eq:maxwell}` has to resolve against the same numbering the equation
// itself shows, so it reads from the EquationRegistry rather than from an
// engine — KaTeX has no `\ref` at all, and MathJax's would number against its
// own counter, which the registry deliberately overrides.

import { useCallback } from "react";
import { useMathContext } from "./MathContext";

export function EquationRef({
  label,
  /** `\eqref` parenthesises the number; `\ref` gives the bare number. */
  parenthesised = true,
}: {
  label: string;
  parenthesised?: boolean;
}) {
  const { registry, navigateToEquation } = useMathContext();
  const entry = registry.byLabel(label);

  const go = useCallback(
    (event: React.MouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      if (navigateToEquation) {
        // The viewer knows how to reach an equation in a section that is not
        // currently mounted, which a plain fragment link cannot do.
        navigateToEquation(label);
        return;
      }
      if (entry) document.getElementById(entry.domId)?.scrollIntoView({ block: "center" });
    },
    [entry, label, navigateToEquation],
  );

  // An undefined label is the LaTeX convention: show that something is missing
  // rather than silently dropping the sentence's referent.
  if (!entry) {
    return (
      <span className="docs-eq-ref docs-eq-ref-missing" title={`No equation labelled "${label}"`}>
        ({"??"})
      </span>
    );
  }

  const text = entry.number ?? label;
  return (
    <a
      href={`#${entry.domId}`}
      className="docs-eq-ref"
      onClick={go}
      aria-label={`Go to equation ${text}`}
    >
      {parenthesised ? `(${text})` : text}
    </a>
  );
}
