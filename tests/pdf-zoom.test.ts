// Unit tests for the PDF reader's pinch/wheel zoom curve. Every ctrl+wheel
// event used to be a full ×1.25 step, so a trackpad pinch (dozens of small
// events) jumped straight to the zoom limit.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  wheelDeltaPixels,
  wheelZoomFactor,
  ZOOM_STEP,
} from "../src/services/pdf-viewer/pdf-zoom.ts";

const close = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≉ ${expected}`);

test("a mouse-wheel notch is exactly one button step", () => {
  assert.equal(wheelZoomFactor(-100), ZOOM_STEP);
  assert.equal(wheelZoomFactor(120), 1 / ZOOM_STEP);
});

test("zoom follows the gesture: small pinch deltas make small changes", () => {
  close(wheelZoomFactor(0), 1);
  const small = wheelZoomFactor(-2);
  assert.ok(small > 1 && small < 1.011, String(small));
  // Zooming in then out by the same amount returns to where it started.
  close(wheelZoomFactor(-7) * wheelZoomFactor(7), 1);
});

test("a whole trackpad pinch no longer jumps to the zoom limit", () => {
  // A typical macOS Chrome pinch-out: ~40 ctrl+wheel events of −1 to −5 px,
  // arriving a few per frame.
  const deltas = Array.from({ length: 40 }, (_, i) => -1 - (i % 5));
  let oldZoom = 1;
  for (const delta of deltas)
    oldZoom = clampZoom(oldZoom * (delta < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
  assert.equal(oldZoom, MAX_ZOOM, "old behavior: straight to 400%");

  let zoom = 1;
  for (let i = 0; i < deltas.length; i += 3) {
    const frame = deltas.slice(i, i + 3).reduce((sum, d) => sum + d, 0);
    zoom = clampZoom(zoom * wheelZoomFactor(frame));
  }
  // −120 px in total: fingers tracked 1:1 would be e^1.2 ≈ 3.3×; this is half that rate.
  close(zoom, Math.exp(0.6), 1e-6);
  assert.ok(zoom < MAX_ZOOM);
});

test("one frame never moves more than one button step, however large the delta", () => {
  assert.equal(wheelZoomFactor(-10_000), ZOOM_STEP);
  assert.equal(wheelZoomFactor(10_000), 1 / ZOOM_STEP);
});

test("line- and page-mode deltas are converted to pixels", () => {
  assert.equal(wheelDeltaPixels(-3, 0), -3);
  assert.equal(wheelDeltaPixels(-3, 1), -48);
  assert.equal(wheelDeltaPixels(1, 2), 800);
});

test("zoom stays within its limits", () => {
  assert.equal(clampZoom(100), MAX_ZOOM);
  assert.equal(clampZoom(0.01), MIN_ZOOM);
  assert.equal(clampZoom(1.5), 1.5);
});
