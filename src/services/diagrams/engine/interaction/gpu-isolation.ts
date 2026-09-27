/**
 * Narrow a GPU-engine diagram down to a subset of its nodes.
 *
 * There's no DOM to hide elements in, but the renderer already carries a
 * per-node alpha and a per-edge draw-progress in its state textures
 * (`DiagramRenderer.nodeState`/`edgeState`) — the same channels `showAll()`
 * drives to show everything. Setting a node's alpha to 0, or an edge's
 * progress to 0, hides it exactly as fully as `display: none` does on the SVG
 * path, with no shader changes: `renderer.ts`'s fragment shader already
 * multiplies final colour by both.
 */

import type { DiagramRenderer } from "../renderer";
import type { Scene } from "../scene";

/** How dim a non-selected node gets while the reader is building a selection
 *  and hasn't isolated anything yet — a preview, not a hide. */
const SELECT_PREVIEW_DIM = 0.35;

/** Show only `visible`'s nodes and the edges between them, or everything
 *  when `visible` is `null`. */
export function applyGpuVisibility(
  renderer: DiagramRenderer,
  scene: Scene,
  visible: Set<string> | null,
): void {
  for (const [id, index] of scene.nodeIndex) {
    renderer.nodeState[index * 4] = visible === null || visible.has(id) ? 1 : 0;
  }
  for (const edge of scene.graph.edges) {
    const index = scene.edgeIndex.get(edge.id);
    if (index === undefined) continue;
    const show = visible === null || (visible.has(edge.source) && visible.has(edge.target));
    renderer.edgeState[index * 4] = show ? 1 : 0;
  }
  renderer.markState();
}

/**
 * Dim every node but the selection, without hiding anything — feedback while
 * the reader is still choosing, before they isolate or remove.
 */
export function applyGpuSelectionPreview(
  renderer: DiagramRenderer,
  scene: Scene,
  selectedIds: Set<string>,
): void {
  for (const [id, index] of scene.nodeIndex) {
    renderer.nodeState[index * 4] =
      selectedIds.size === 0 || selectedIds.has(id) ? 1 : SELECT_PREVIEW_DIM;
  }
  renderer.markState();
}
