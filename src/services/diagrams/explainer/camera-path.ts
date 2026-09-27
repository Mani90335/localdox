/**
 * How the explainer camera travels between two framings.
 *
 * The motion is modelled on a good lecture video rather than a slideshow. When
 * the next idea is somewhere else on the board, the camera pulls back a little
 * on the way, so for a moment you can see both where you were and where you are
 * going, then settles in on the new spot. A short hop between neighbours barely
 * pulls back at all, and a long hop across the diagram pulls back further and
 * takes longer.
 *
 * Everything here is pure arithmetic on rectangles, with no DOM, so the path can
 * be tested on its own.
 */

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Smooth start and stop; used for position. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function lerpFrame(from: Frame, to: Frame, t: number): Frame {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    width: from.width + (to.width - from.width) * t,
    height: from.height + (to.height - from.height) * t,
  };
}

/** Slide a frame so it lies inside `bounds`, shrinking it only if it must. */
export function clampInside(frame: Frame, bounds: Frame): Frame {
  const width = Math.min(frame.width, bounds.width);
  const height = Math.min(frame.height, bounds.height);
  const x = Math.min(Math.max(frame.x, bounds.x), bounds.x + bounds.width - width);
  const y = Math.min(Math.max(frame.y, bounds.y), bounds.y + bounds.height - height);
  return { x, y, width, height };
}

/** The smallest frame of the given aspect ratio that contains both frames. */
export function unionFrame(a: Frame, b: Frame, aspect: number): Frame {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  let width = maxX - minX;
  let height = maxY - minY;
  if (width / height > aspect) height = width / aspect;
  else width = height * aspect;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/**
 * How much of the union the pull-back reveals at its widest.
 *
 * 1 would show both framings whole at the midpoint, which on a long hop means
 * zooming almost all the way out and back in, and that reads as a jump cut.
 * Showing most of the way there keeps the context without the whiplash.
 */
const PULL_BACK = 0.7;

/**
 * The frame at progress `t` (0..1) of a move from `from` to `to`.
 *
 * Position eases in and out. Scale is interpolated in log space, because zoom
 * is perceived as a ratio, so a 2× → 4× zoom should feel like 1× → 2×. A
 * sine-shaped bump in that same log space provides the pull-back, which is zero
 * at both ends, so the move starts and lands exactly on its framings.
 */
export function travelFrame(
  from: Frame,
  to: Frame,
  t: number,
  bounds: Frame,
  pullBack = true,
): Frame {
  const s = Math.min(1, Math.max(0, t));
  const e = easeInOutCubic(s);
  const aspect = to.width / to.height;

  const fromCx = from.x + from.width / 2;
  const fromCy = from.y + from.height / 2;
  const toCx = to.x + to.width / 2;
  const toCy = to.y + to.height / 2;
  const cx = fromCx + (toCx - fromCx) * e;
  const cy = fromCy + (toCy - fromCy) * e;

  const logFrom = Math.log(from.width);
  const logTo = Math.log(to.width);
  let logWidth = logFrom + (logTo - logFrom) * e;

  if (pullBack) {
    const union = unionFrame(from, to, aspect);
    const widest = Math.min(union.width, bounds.width, bounds.height * aspect);
    const middle = (logFrom + logTo) / 2;
    const lift = Math.max(0, Math.log(widest) - middle) * PULL_BACK;
    logWidth += lift * Math.sin(Math.PI * s);
  }

  const width = Math.exp(logWidth);
  const height = width / aspect;
  return clampInside({ x: cx - width / 2, y: cy - height / 2, width, height }, bounds);
}

/**
 * How long a move takes, in milliseconds at 1× speed.
 *
 * It scales with how far the view travels, measured as a share of the whole
 * diagram, and with how much the zoom changes. A camera that crosses the
 * diagram in the time it takes to nudge sideways looks like it is being
 * dragged.
 */
export function travelDuration(from: Frame, to: Frame, bounds: Frame): number {
  const diagonal = Math.hypot(bounds.width, bounds.height) || 1;
  const distance =
    Math.hypot(
      to.x + to.width / 2 - (from.x + from.width / 2),
      to.y + to.height / 2 - (from.y + from.height / 2),
    ) / diagonal;
  const zoomChange = Math.abs(Math.log(to.width / from.width));
  return Math.round(Math.min(1500, Math.max(650, 650 + 1400 * distance + 380 * zoomChange)));
}

export function framesClose(a: Frame, b: Frame, tolerance = 0.5): boolean {
  return (
    Math.abs(a.x - b.x) < tolerance &&
    Math.abs(a.y - b.y) < tolerance &&
    Math.abs(a.width - b.width) < tolerance &&
    Math.abs(a.height - b.height) < tolerance
  );
}
