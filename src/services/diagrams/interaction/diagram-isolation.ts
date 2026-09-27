/**
 * Narrow a rendered Mermaid diagram down to a subset of its nodes.
 *
 * The graph already knows every node's position and every edge's endpoints
 * (`explainer/graph.ts`), so "show only these nodes" is just hiding the DOM
 * elements that don't belong — no re-render, no re-layout.
 */

import type { ExplainerGraph } from "../explainer/graph";

/** The given nodes, plus every node directly connected to one of them. */
export function neighborsOf(graph: ExplainerGraph, nodeIds: Iterable<string>): Set<string> {
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
}
