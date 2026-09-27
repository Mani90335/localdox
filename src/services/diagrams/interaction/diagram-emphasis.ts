/**
 * Mark a node or edge as "selected" or "the current search match".
 *
 * Applied as inline styles, `!important`, the same way `diagram-node-colors.ts`
 * paints a node's override colour — a node can carry a semantic role
 * (`diagram-colors.css`) or sit under the neutral-node rule, both of which
 * already claim `stroke` with their own `!important`, and a stylesheet rule
 * for the mark would lose that specificity fight on exactly the nodes this is
 * meant to be visible on. An inline `!important` style beats any of them
 * regardless of selector specificity, which is the guarantee needed here: a
 * selected "failure" node must still look selected.
 */

import type { ExplainerEdge, ExplainerNode } from "../explainer/graph";

export type Mark = "selected" | "match" | null;

const SHAPES = "rect, polygon, circle, ellipse, path";

const STROKE: Record<Exclude<Mark, null>, string> = {
  selected: "var(--diagram-select)",
  match: "var(--diagram-match)",
};
const GLOW: Record<Exclude<Mark, null>, string> = {
  selected: "var(--diagram-select-tint)",
  match: "var(--diagram-match-tint)",
};

function applyMark(shape: SVGElement, mark: Mark): void {
  if (mark) {
    shape.setAttribute("data-diagram-mark", mark);
    shape.style.setProperty("stroke", STROKE[mark], "important");
    shape.style.setProperty("stroke-width", "3px", "important");
    shape.style.setProperty("filter", `drop-shadow(0 0 4px ${GLOW[mark]})`, "important");
  } else {
    shape.removeAttribute("data-diagram-mark");
    shape.style.removeProperty("stroke");
    shape.style.removeProperty("stroke-width");
    shape.style.removeProperty("filter");
  }
}

export function markNode(node: ExplainerNode, mark: Mark): void {
  for (const shape of node.el.querySelectorAll<SVGElement>(SHAPES)) applyMark(shape, mark);
}

export function markEdge(edge: ExplainerEdge, mark: Mark): void {
  applyMark(edge.path, mark);
}

/** Strip every mark of the given kind (or all marks) from the whole graph. */
export function clearMarks(
  nodes: Iterable<ExplainerNode>,
  edges: Iterable<ExplainerEdge>,
  only?: Exclude<Mark, null>,
): void {
  for (const node of nodes) {
    for (const shape of node.el.querySelectorAll<SVGElement>(`[data-diagram-mark]`)) {
      if (!only || shape.getAttribute("data-diagram-mark") === only) applyMark(shape, null);
    }
  }
  for (const edge of edges) {
    if (!only || edge.path.getAttribute("data-diagram-mark") === only) applyMark(edge.path, null);
  }
}
