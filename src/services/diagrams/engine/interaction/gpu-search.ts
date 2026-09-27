/**
 * Find diagram text in a GPU-engine `Scene` — the same job
 * `interaction/diagram-search.ts` does for a live SVG, just reading the flat
 * arrays and JS side-arrays a `Scene` keeps instead of the DOM. There's no
 * shared implementation because the two have no representation in common
 * beyond the `DiagramMatch` shape the search bar reads back.
 *
 * A node's searchable text is its label plus, for an ER/class table, every
 * header and row cell — `scene.graph`'s own `label` field only carries the
 * table's title line, not its rows.
 */

import type { Scene } from "../scene";
import type { DiagramMatch } from "../../interaction/types";

export type { DiagramMatch } from "../../interaction/types";

function nodeText(scene: Scene, index: number, label: string): string {
  const parts = [label, ...(scene.nodeLines[index] ?? [])];
  const table = scene.nodeTable[index];
  if (table) parts.push(...table.header, ...table.sections.flat(2));
  return parts.join(" ").toLowerCase();
}

/** A point to sort a match by, so results read top-to-bottom, left-to-right. */
function matchPosition(scene: Scene, match: DiagramMatch): { x: number; y: number } {
  if (match.kind === "node") {
    const node = scene.graph.nodes.get(match.id);
    return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
  }
  const index = scene.edgeIndex.get(match.id);
  if (index === undefined) return { x: 0, y: 0 };
  return { x: scene.labelX[index], y: scene.labelY[index] };
}

/**
 * Every node or edge whose visible text contains `query`, case-insensitively.
 *
 * Returns an empty array for a blank query, matching `findMatches`'s reading
 * of "the reader hasn't asked to jump anywhere yet."
 */
export function findGpuMatches(scene: Scene, query: string): DiagramMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matches: DiagramMatch[] = [];
  for (const [id, index] of scene.nodeIndex) {
    const node = scene.graph.nodes.get(id);
    if (!node) continue;
    if (nodeText(scene, index, node.label).includes(q)) matches.push({ kind: "node", id });
  }
  for (const edge of scene.graph.edges) {
    if (edge.text?.toLowerCase().includes(q)) matches.push({ kind: "edge", id: edge.id });
  }

  matches.sort((a, b) => {
    const pa = matchPosition(scene, a);
    const pb = matchPosition(scene, b);
    return pa.y - pb.y || pa.x - pb.x;
  });
  return matches;
}
