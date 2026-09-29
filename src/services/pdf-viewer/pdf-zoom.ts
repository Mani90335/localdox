// Zoom limits and the Ctrl/⌘ + wheel (trackpad pinch) zoom curve for the PDF
// reader. Pure, so it is unit tested directly.
//
// A trackpad pinch arrives as a burst of ctrl+wheel events with small deltas
// (dozens per gesture). Each one used to be a full ×1.25 button step, so the
// slightest pinch jumped from fit to 400%. Zoom now follows the size of the
// gesture. Chrome reports a pinch as deltaY = −100·ln(scale) (pdf.js's viewer
// applies e^(−deltaY/100) to track the fingers 1:1); this reader zooms at
// half that rate, a deliberately calmer pinch. A mouse-wheel notch (~100 px)
// is capped at exactly one button step.

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
/** One toolbar/keyboard zoom step. */
export const ZOOM_STEP = 1.25;
/** Zoom per pixel of wheel delta: half of the 1:1 finger-tracking rate (0.01). */
export const WHEEL_ZOOM_SENSITIVITY = 0.005;

const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 800;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** A wheel event's vertical delta in pixels, whatever unit the browser reported it in. */
export function wheelDeltaPixels(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * LINE_HEIGHT_PX;
  if (deltaMode === 2) return deltaY * PAGE_HEIGHT_PX;
  return deltaY;
}

/**
 * The zoom factor for an accumulated wheel/pinch delta in pixels (negative
 * zooms in). Proportional to the delta, and never more than one button step
 * per frame, so a fast flick or a high-resolution wheel can't overshoot.
 */
export function wheelZoomFactor(deltaPixels: number): number {
  const factor = Math.exp(-deltaPixels * WHEEL_ZOOM_SENSITIVITY);
  return Math.min(ZOOM_STEP, Math.max(1 / ZOOM_STEP, factor));
}
