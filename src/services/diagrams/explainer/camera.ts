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
import { TALL_STAGE_RATIO } from "../stage-ratio.ts";
import { clampInside, type Frame } from "./camera-path.ts";

export type { Frame } from "./camera-path.ts";
export { framesClose as framesEqual, lerpFrame } from "./camera-path.ts";

/**
 * The stage a tall diagram plays in, when it is not the diagram's own shape.
 *
 * A tall diagram (a long `flowchart TD`) plays in a stage one screenful high,
 * far wider for its height than the diagram. Framed in the diagram's own
 * proportions, every close-up would be a thin strip, letterboxed down to
 * unreadable. With a view, framings take the stage's proportions instead.
 */
export interface CameraView {
  /** Stage width over height. */
  aspect: number;
  /**
   * The narrowest framing, in diagram units: the stage's width in pixels, so a
   * close-up shows the diagram at its natural size and no larger.
   */
  minWidth: number;
}

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
export function canFollow(graph: GraphShape, view?: CameraView): boolean {
  const { baseView, nodes } = graph;
  if (nodes.size < FOLLOW_MIN_NODES) return false;
  // A tall diagram can only be followed in a stage whose shape is known.
  // Framed in its own 20:1 proportions, a close-up is a sliver.
  return view !== undefined || baseView.height / baseView.width <= TALL_STAGE_RATIO;
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

/**
 * The whole diagram, with a small margin so nothing touches the edge.
 *
 * With a view, widened (or heightened) about its centre to the stage's
 * proportions, so that it and every framing inside it share one shape.
 */
export function homeFrame(graph: GraphShape, view?: CameraView): Frame {
  const { baseView } = graph;
  const pad = Math.max(baseView.width, baseView.height) * 0.02;
  const home = {
    x: baseView.x - pad,
    y: baseView.y - pad,
    width: baseView.width + pad * 2,
    height: baseView.height + pad * 2,
  };
  if (!view || !(view.aspect > 0)) return home;
  const width = Math.max(home.width, home.height * view.aspect);
  const height = width / view.aspect;
  return {
    x: home.x - (width - home.width) / 2,
    y: home.y - (height - home.height) / 2,
    width,
    height,
  };
}

/**
 * Frame the region spanned by the given nodes, keeping the home aspect ratio.
 *
 * The result is clamped inside the home frame, and a close-up that would be
 * barely tighter than the whole diagram collapses to the whole diagram, so the
 * camera doesn't twitch for nothing.
 */
export function frameFor(graph: GraphShape, nodeIds: string[], view?: CameraView): Frame {
  const home = homeFrame(graph, view);
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

  // A tall diagram is far larger than its stage, so a close-up relative to
  // the whole would still be tiny: its floor is natural size instead.
  const narrowest = view ? Math.min(view.minWidth, home.width) : home.width / maxZoomFor(graph);
  if (width < narrowest) {
    width = narrowest;
    height = width / aspect;
  }
  if (width >= home.width * NOT_WORTH_IT || height >= home.height * NOT_WORTH_IT) return home;

  return clampInside({ x: centreX - width / 2, y: centreY - height / 2, width, height }, home);
}
