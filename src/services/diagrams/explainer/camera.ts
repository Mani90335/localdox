/**
 * Where the explainer camera looks.
 *
 * The camera works like a teacher at a whiteboard. It moves in on the part
 * being explained, close enough that you can see what is being drawn, but
 * never so close that you lose where it sits in the whole. Once everything is
 * drawn it steps back and shows the finished picture. How it travels between
 * framings lives in camera-path.ts, and when it travels is up to the player.
 *
 * Two limits keep it honest:
 *
 *  - The zoom it may use grows with the diagram. A five-box flowchart is
 *    readable whole, so the camera only leans in a little; a sprawling
 *    architecture gets real close-ups, because that is where they pay off.
 *  - A framing never shows empty space past the diagram's edge. The picture
 *    should never look like it is sliding off the board.
 *
 * Framing is expressed as a viewBox, so a camera move costs one attribute
 * write per frame and nothing re-renders.
 */

import type { GraphShape } from "./graph";
import { TALL_STAGE_RATIO } from "../stage-ratio";
import { clampInside, type Frame } from "./camera-path";

export type { Frame } from "./camera-path";
export { framesClose as framesEqual, lerpFrame } from "./camera-path";

/** Below this there is nothing to move between. */
const FOLLOW_MIN_NODES = 4;
/**
 * How much of the view the active region fills.
 *
 * Well over half: the thing being drawn is unmistakably the subject, with a
 * ring of context around it so you can see where it came from.
 */
const FOCUS_FILL = 0.55;
/** Close-ups this near the whole view aren't worth a camera move. */
const NOT_WORTH_IT = 0.9;

/** Whether the camera should move at all for this diagram. */
export function canFollow(graph: GraphShape): boolean {
  const { baseView, nodes } = graph;
  if (nodes.size < FOLLOW_MIN_NODES) return false;
  // A very tall diagram is rendered at full height and scrolled by the page, so
  // every node is already on screen at natural size as the reader arrives at
  // it. Panning a viewBox underneath that would fight the page's own scroll.
  return baseView.height / baseView.width <= TALL_STAGE_RATIO;
}

/**
 * The strongest close-up this diagram may use, relative to the whole.
 *
 * Grows roughly with the square root of the node count, the diagram's linear
 * size: about 1.6× for a handful of boxes, 2.2× at sixteen, capped at 3.2×.
 */
export function maxZoomFor(graph: GraphShape): number {
  return Math.min(3.2, Math.max(1.6, Math.sqrt(graph.nodes.size) / 1.8));
}

/** The whole diagram, with a small margin so nothing touches the edge. */
export function homeFrame(graph: GraphShape): Frame {
  const { baseView } = graph;
  const pad = Math.max(baseView.width, baseView.height) * 0.02;
  return {
    x: baseView.x - pad,
    y: baseView.y - pad,
    width: baseView.width + pad * 2,
    height: baseView.height + pad * 2,
  };
}

/**
 * Frame the region spanned by the given nodes, keeping the home aspect ratio.
 *
 * The result is clamped inside the home frame, and a close-up that would be
 * barely tighter than the whole diagram collapses to the whole diagram, so the
 * camera doesn't twitch for nothing.
 */
export function frameFor(graph: GraphShape, nodeIds: string[]): Frame {
  const home = homeFrame(graph);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of nodeIds) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    minX = Math.min(minX, node.x - node.width / 2);
    maxX = Math.max(maxX, node.x + node.width / 2);
    minY = Math.min(minY, node.y - node.height / 2);
    maxY = Math.max(maxY, node.y + node.height / 2);
  }
  if (!Number.isFinite(minX)) return home;

  const aspect = home.width / home.height;
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;

  // Grow the region to the target fill, then to the home aspect ratio, so the
  // SVG never letterboxes and the active nodes sit in a pocket of context.
  let width = Math.max(1, maxX - minX) / FOCUS_FILL;
  let height = Math.max(1, maxY - minY) / FOCUS_FILL;
  if (width / height > aspect) height = width / aspect;
  else width = height * aspect;

  const maxZoom = maxZoomFor(graph);
  if (width < home.width / maxZoom) {
    width = home.width / maxZoom;
    height = width / aspect;
  }
  if (width >= home.width * NOT_WORTH_IT || height >= home.height * NOT_WORTH_IT) return home;

  return clampInside({ x: centreX - width / 2, y: centreY - height / 2, width, height }, home);
}
