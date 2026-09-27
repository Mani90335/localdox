// The remark pass that hands math to React instead of to a rehype plugin.
//
// This replaces `rehype-katex` in the pipeline, and the reason is the original
// LaTeX. `rehype-katex` typesets in place and *discards the source*: what is
// left in the tree is KaTeX's markup, so Copy LaTeX, Show Source, a fallback
// re-render on a different engine and equation labelling would all have to
// reconstruct LaTeX from rendered HTML — which is lossy, and forbidden here.
//
// Instead, remark-math's `math` / `inlineMath` nodes are converted to hast
// elements that carry the source verbatim in a property, and the viewer maps
// those element names to React components. The source therefore survives all
// the way to the component that renders it, untouched.

import { visit } from "unist-util-visit";

/** Element names the viewer's component map binds to. */
export const MATH_ELEMENT = "docs-math";
export const MATH_REF_ELEMENT = "docs-eq-ref";

interface MathNode {
  type: "math" | "inlineMath";
  value: string;
  data?: { hName?: string; hProperties?: Record<string, unknown>; hChildren?: unknown[] };
}

interface TextNode {
  type: "text";
  value: string;
}

/**
 * Give every math node an `hName`/`hProperties` so mdast-to-hast turns it into
 * our own element, LaTeX intact.
 *
 * `hChildren: []` matters: without it the node's text value is carried into the
 * output as a child, and the reader would see the raw LaTeX printed beside the
 * typeset equation.
 */
export function remarkMathNodes() {
  return (tree: unknown) => {
    visit(tree as never, (node: MathNode) => {
      if (node.type !== "math" && node.type !== "inlineMath") return;
      const displayMode = node.type === "math";
      node.data = {
        ...node.data,
        hName: MATH_ELEMENT,
        hProperties: {
          // Property names reach React as-is through react-markdown's
          // component map, so they are kept lowercase-hyphenated to survive
          // hast's property casing rules.
          "data-latex": node.value,
          "data-display": displayMode ? "true" : "false",
        },
        hChildren: [],
      };
    });
  };
}

/**
 * Turn the prose reference form `{{eq:label}}` into a reference element.
 *
 * `\eqref` only works inside math, so referring to an equation from a sentence
 * otherwise means opening a math span just to hold the reference. This is the
 * reader-friendly equivalent, and it renders as the same clickable number.
 *
 * Scoped to text nodes, so an occurrence inside a code span or fence — where
 * remark has already produced `inlineCode`/`code` nodes — is left alone.
 */
export function remarkEquationReferences() {
  const PATTERN = /\{\{\s*(eq:[A-Za-z0-9_:.-]+)\s*\}\}/g;

  return (tree: unknown) => {
    visit(
      tree as never,
      "text",
      (node: TextNode, index: number | undefined, parent: { children: unknown[] } | undefined) => {
        if (!parent || index === undefined) return;
        if (!node.value.includes("{{")) return;

        PATTERN.lastIndex = 0;
        const replacement: unknown[] = [];
        let cursor = 0;
        let match: RegExpExecArray | null;

        while ((match = PATTERN.exec(node.value))) {
          if (match.index > cursor) {
            replacement.push({ type: "text", value: node.value.slice(cursor, match.index) });
          }
          replacement.push({
            type: "inlineMathRef",
            data: {
              hName: MATH_REF_ELEMENT,
              hProperties: { "data-label": match[1], "data-paren": "true" },
              hChildren: [],
            },
          });
          cursor = match.index + match[0].length;
        }

        if (!replacement.length) return;
        if (cursor < node.value.length) {
          replacement.push({ type: "text", value: node.value.slice(cursor) });
        }
        parent.children.splice(index, 1, ...replacement);
        // Skip past what was just inserted so the visitor does not re-scan it.
        return index + replacement.length;
      },
    );
  };
}

/**
 * Split `\ref`/`\eqref` out of inline math into their own reference nodes.
 *
 * Neither KaTeX nor Temml implements `\ref`, and MathJax's would number against
 * its own counter rather than the registry's. Hoisting the reference out of the
 * math means one code path resolves every reference — and it also means the
 * *rest* of the expression still typesets, so `$E = \eqref{eq:energy}$` renders
 * the equals sign instead of erroring out.
 *
 * Display math keeps its references inline (a `\ref` inside an `align` block is
 * part of the equation's own layout), where `stripRegistryCommands` leaves them
 * to the engine.
 */
export function remarkInlineMathRefs() {
  const REF = /\\(eqref|ref)\s*\{([^}]+)\}/g;

  return (tree: unknown) => {
    visit(
      tree as never,
      "inlineMath",
      (node: MathNode, index: number | undefined, parent: { children: unknown[] } | undefined) => {
        if (!parent || index === undefined) return;
        REF.lastIndex = 0;
        if (!REF.test(node.value)) return;

        REF.lastIndex = 0;
        const pieces: unknown[] = [];
        let cursor = 0;
        let match: RegExpExecArray | null;

        const pushMath = (latex: string) => {
          // Only the parts that still contain something to typeset.
          if (!latex.trim()) return;
          pieces.push({
            type: "inlineMath",
            value: latex,
            data: {
              hName: MATH_ELEMENT,
              hProperties: { "data-latex": latex, "data-display": "false" },
              hChildren: [],
            },
          });
        };

        while ((match = REF.exec(node.value))) {
          pushMath(node.value.slice(cursor, match.index));
          pieces.push({
            type: "inlineMathRef",
            data: {
              hName: MATH_REF_ELEMENT,
              hProperties: {
                "data-label": match[2].trim(),
                // `\eqref` parenthesises the number, `\ref` does not.
                "data-paren": match[1] === "eqref" ? "true" : "false",
              },
              hChildren: [],
            },
          });
          cursor = match.index + match[0].length;
        }
        pushMath(node.value.slice(cursor));

        if (!pieces.length) return;
        parent.children.splice(index, 1, ...pieces);
        return index + pieces.length;
      },
    );
  };
}
