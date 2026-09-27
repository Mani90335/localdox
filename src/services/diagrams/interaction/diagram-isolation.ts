/**
 * Narrow a rendered Mermaid diagram down to a subset of its nodes.
 *
 * The graph already knows every node's position and every edge's endpoints
 * (`explainer/graph.ts`), so "show only these nodes" is just hiding the DOM
 * elements that don't belong — no re-render, no re-layout.
 */

import type { ExplainerGraph } from "../explainer/graph";
import type { GraphShape } from "../explainer/graph";

/**
 * The given nodes, plus every node directly connected to one of them.
 *
 * Typed against the narrower `GraphShape` (just `edges[].source/target`)
 * rather than `ExplainerGraph`, so the GPU engine's `Scene.graph` — a plain
 * `GraphShape` with no DOM behind it — can reuse this unchanged.
 */
export function neighborsOf(graph: GraphShape, nodeIds: Iterable<string>): Set<string> {
  const seeds = new Set(nodeIds);
  const ids = new Set(seeds);
  for (const edge of graph.edges) {
    if (seeds.has(edge.source)) ids.add(edge.target);
    if (seeds.has(edge.target)) ids.add(edge.source);
  }
  return ids;
}

function setHidden(el: SVGElement, hidden: boolean): void {
  if (hidden) {
    el.style.setProperty("display", "none", "important");
    el.setAttribute("aria-hidden", "true");
  } else {
    el.style.removeProperty("display");
    el.removeAttribute("aria-hidden");
  }
}

function clusterHasVisibleNode(
  cluster: ExplainerGraph["clusters"][number],
  visibleNodes: ExplainerGraph["nodes"],
  visible: Set<string>,
): boolean {
  for (const id of visible) {
    const node = visibleNodes.get(id);
    if (!node) continue;
    if (
      node.x >= cluster.x &&
      node.x <= cluster.x + cluster.width &&
      node.y >= cluster.y &&
      node.y <= cluster.y + cluster.height
    ) {
      return true;
    }
  }
  return false;
}

/**
 * A participant's lifeline, its repeated box at the bottom, and any
 * activation bars along it — everything a sequence diagram draws for a
 * participant that lives outside `node.el` (the top actor box `readSequence`
 * tracks). Hidden or shown alongside the participant so isolating never
 * leaves a dangling lifeline running down an otherwise-empty column.
 *
 * Matched by nearest x for the lifeline/activations (their centre x equals
 * the participant's `node.x`, the same value `readSequence` computed it
 * from), and by the shared `name` attribute for the bottom box — mermaid's
 * own internal id, present on both the top and bottom rect, robust even
 * under `participant A as Alice` aliasing.
 */
function applySequenceChrome(graph: ExplainerGraph, visible: Set<string> | null): void {
  const svg = graph.svg;
  const nodes = [...graph.nodes.values()];
  const nearestNode = (x: number) =>
    nodes.reduce((best, node) => (Math.abs(node.x - x) < Math.abs(best.x - x) ? node : best));
  const hiddenOf = (node: (typeof nodes)[number]) => visible !== null && !visible.has(node.id);

  for (const line of svg.querySelectorAll<SVGLineElement>("line.actor-line")) {
    const x1 = parseFloat(line.getAttribute("x1") ?? "NaN");
    if (Number.isNaN(x1) || nodes.length === 0) continue;
    setHidden(line, hiddenOf(nearestNode(x1)));
  }
  for (const bar of svg.querySelectorAll<SVGRectElement>("rect[class*='activation']")) {
    const x = parseFloat(bar.getAttribute("x") ?? "NaN");
    const width = parseFloat(bar.getAttribute("width") ?? "0");
    if (Number.isNaN(x) || nodes.length === 0) continue;
    setHidden(bar, hiddenOf(nearestNode(x + width / 2)));
  }
  const bottomRects = [...svg.querySelectorAll<SVGRectElement>("rect.actor-bottom")];
  for (const node of nodes) {
    const name = node.el.querySelector("rect.actor-top")?.getAttribute("name");
    if (!name) continue;
    const bottomRect = bottomRects.find((rect) => rect.getAttribute("name") === name);
    const bottomChrome = (bottomRect?.closest("g") ?? bottomRect) as SVGElement | null;
    if (bottomChrome) setHidden(bottomChrome, hiddenOf(node));
  }
}

/**
 * Show only `visible`'s nodes (and the edges/clusters between them), or
 * everything when `visible` is `null`.
 */
export function applyVisibility(graph: ExplainerGraph, visible: Set<string> | null): void {
  for (const node of graph.nodes.values()) {
    setHidden(node.el, visible !== null && !visible.has(node.id));
  }
  for (const edge of graph.edges) {
    const show = visible === null || (visible.has(edge.source) && visible.has(edge.target));
    setHidden(edge.path, !show);
    if (edge.label) setHidden(edge.label, !show);
  }
  for (const cluster of graph.clusters) {
    const show = visible === null || clusterHasVisibleNode(cluster, graph.nodes, visible);
    setHidden(cluster.el, !show);
  }
  if (graph.sequence) applySequenceChrome(graph, visible);
}
