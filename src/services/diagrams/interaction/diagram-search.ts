/**
 * Find diagram text — a node's or an edge's label — matching a reader's query.
 *
 * Reuses the graph `readGraph` already builds for the Stepped explainer: this
 * is the same topology, just read for "where does this text appear" instead of
 * "what order does this play in".
 */

import type { ExplainerGraph } from "../explainer/graph";

export interface DiagramMatch {
  kind: "node" | "edge";
  id: string;
}

/** A point to sort a match by, so results read top-to-bottom, left-to-right. */
function matchPosition(graph: ExplainerGraph, match: DiagramMatch): { x: number; y: number } {
  if (match.kind === "node") {
    const node = graph.nodes.get(match.id);
    return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
  }
  const edge = graph.edges.find((candidate) => candidate.id === match.id);
  if (!edge) return { x: 0, y: 0 };
  try {
    const point = edge.path.getPointAtLength(0);
    return { x: point.x, y: point.y };
  } catch {
    return { x: 0, y: 0 };
  }
}

/**
 * Every node or edge whose visible text contains `query`, case-insensitively.
 *
 * Returns an empty array for a blank query rather than "everything" — a
 * reader who has typed nothing has not asked to jump anywhere yet.
 */
export function findMatches(graph: ExplainerGraph, query: string): DiagramMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matches: DiagramMatch[] = [];
  for (const node of graph.nodes.values()) {
    if (node.label.toLowerCase().includes(q)) matches.push({ kind: "node", id: node.id });
  }
  for (const edge of graph.edges) {
    if (edge.text?.toLowerCase().includes(q)) matches.push({ kind: "edge", id: edge.id });
  }

  matches.sort((a, b) => {
    const pa = matchPosition(graph, a);
    const pb = matchPosition(graph, b);
    return pa.y - pb.y || pa.x - pb.x;
  });
  return matches;
}
