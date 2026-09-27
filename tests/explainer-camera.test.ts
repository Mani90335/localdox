// Unit tests for the explainer's pure layers: how steps group into beats, how
// the camera travels between framings, the pacing curve, and the wheel maths
// the shared diagram viewport uses. The DOM-bound parts (the player painting an
// SVG, the viewport's pointer handling) need a browser and are not covered here.

import assert from "node:assert/strict";
import { test } from "node:test";

import { groupBeats } from "../src/services/diagrams/explainer/beats.ts";
import {
  clampInside,
  travelDuration,
  travelFrame,
  unionFrame,
  type Frame,
} from "../src/services/diagrams/explainer/camera-path.ts";
import { paceFor, type ExplainerStep } from "../src/services/diagrams/explainer/plan.ts";
import { isZoomWheel, wheelPixels, wheelZoomFactor } from "../src/lib/viewport.ts";

const reveal = (nodeId: string): ExplainerStep => ({ type: "reveal-node", nodeId, label: nodeId });
const edge = (from: string, to: string, revisit = false): ExplainerStep => ({
  type: revisit ? "draw-edge-revisit" : "draw-edge",
  edgeId: `${from}-${to}`,
  from,
  to,
  length: 100,
});

test("a node and everything leaving it form one beat", () => {
  const steps = [
    reveal("A"),
    edge("A", "B"),
    reveal("B"),
    edge("A", "C"),
    reveal("C"),
    edge("B", "D"),
    reveal("D"),
  ];
  const beats = groupBeats(steps);
  assert.equal(beats.length, 2);
  assert.deepEqual(
    beats.map((beat) => [beat.first, beat.last, beat.owner]),
    [
      [0, 4, "A"],
      [5, 6, "B"],
    ],
  );
  assert.deepEqual(new Set(beats[0].nodeIds), new Set(["A", "B", "C"]));
  assert.deepEqual(beats[0].edgeIds, ["A-B", "A-C"]);
});

test("beats cover every step exactly once, in order", () => {
  const steps = [
    reveal("A"),
    edge("A", "B"),
    reveal("B"),
    edge("B", "A", true),
    reveal("X"),
    edge("X", "Y"),
    reveal("Y"),
    reveal("Lonely"),
  ];
  const beats = groupBeats(steps);
  let expected = 0;
  for (const beat of beats) {
    assert.equal(beat.first, expected);
    assert.ok(beat.last >= beat.first);
    expected = beat.last + 1;
  }
  assert.equal(expected, steps.length);
});

test("a sequence diagram's cast is introduced as one beat, then one per sender", () => {
  const steps = [
    reveal("Client"),
    reveal("Server"),
    reveal("DB"),
    edge("Client", "Server", true),
    edge("Server", "DB", true),
    edge("DB", "Server", true),
  ];
  const beats = groupBeats(steps);
  assert.equal(beats.length, 4);
  assert.deepEqual(beats[0].edgeIds, []);
  assert.deepEqual(new Set(beats[0].nodeIds), new Set(["Client", "Server", "DB"]));
  assert.deepEqual(
    beats.slice(1).map((beat) => beat.owner),
    ["Client", "Server", "DB"],
  );
});

test("a hub with many children is split into readable beats", () => {
  const steps: ExplainerStep[] = [reveal("Hub")];
  for (let i = 0; i < 14; i++) steps.push(edge("Hub", `N${i}`), reveal(`N${i}`));
  const beats = groupBeats(steps);
  assert.ok(beats.length >= 3, `expected the fan-out split, got ${beats.length} beat(s)`);
  for (const beat of beats) assert.ok(beat.edgeIds.length <= 6);
});

const home: Frame = { x: 0, y: 0, width: 1600, height: 900 };
const left: Frame = { x: 0, y: 300, width: 400, height: 225 };
const right: Frame = { x: 1200, y: 300, width: 400, height: 225 };

function close(a: Frame, b: Frame, tolerance = 1e-6) {
  for (const key of ["x", "y", "width", "height"] as const) {
    assert.ok(Math.abs(a[key] - b[key]) <= tolerance, `${key}: ${a[key]} vs ${b[key]}`);
  }
}

test("a camera move starts and lands exactly on its framings", () => {
  close(travelFrame(left, right, 0, home), left);
  close(travelFrame(left, right, 1, home), right);
});

test("a long move pulls back mid-flight, then closes in again", () => {
  const middle = travelFrame(left, right, 0.5, home);
  assert.ok(middle.width > left.width * 1.5, `mid-flight width ${middle.width}`);
  // It pulls back most of the way, never past the whole diagram.
  assert.ok(middle.width <= home.width + 1e-6);
  // Without the pull back, the same move stays at the framings' own size.
  const flat = travelFrame(left, right, 0.5, home, false);
  assert.ok(Math.abs(flat.width - left.width) < 1e-6);
});

test("camera frames never leave the diagram", () => {
  for (let i = 0; i <= 20; i++) {
    const frame = travelFrame(left, right, i / 20, home);
    assert.ok(frame.x >= home.x - 1e-6 && frame.y >= home.y - 1e-6);
    assert.ok(frame.x + frame.width <= home.x + home.width + 1e-6);
    assert.ok(frame.y + frame.height <= home.y + home.height + 1e-6);
  }
});

test("zoom changes the same amount in every stretch of a move (log-space scale)", () => {
  const wide: Frame = { x: 0, y: 0, width: 1600, height: 900 };
  const tight: Frame = { x: 600, y: 337.5, width: 400, height: 225 };
  const quarter = travelFrame(wide, tight, 0.5, home, false).width;
  // Halfway through a 4× zoom is 2×, not the arithmetic midpoint (2.5×).
  assert.ok(Math.abs(quarter - 800) < 1e-6, `midpoint width ${quarter}`);
});

test("longer moves take longer, within bounds", () => {
  const near: Frame = { ...left, x: left.x + 100 };
  const short = travelDuration(left, near, home);
  const long = travelDuration(left, right, home);
  assert.ok(long > short);
  assert.ok(short >= 650 && long <= 1500);
});

test("union and clamp helpers", () => {
  const union = unionFrame(left, right, 16 / 9);
  assert.ok(union.x <= 0 && union.x + union.width >= 1600);
  assert.ok(Math.abs(union.width / union.height - 16 / 9) < 1e-9);
  const clamped = clampInside({ x: -50, y: 800, width: 400, height: 225 }, home);
  assert.deepEqual(clamped, { x: 0, y: 675, width: 400, height: 225 });
});

test("pacing is calm for small plans and bounded for huge ones", () => {
  assert.equal(paceFor(10), 1);
  assert.equal(paceFor(60), 1);
  assert.ok(paceFor(240) < 1);
  assert.equal(paceFor(100_000), 0.45);
});

const wheel = (init: Partial<WheelEvent>) =>
  ({
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...init,
  }) as WheelEvent;

test("pinch and modifier wheels zoom; plain wheels scroll", () => {
  assert.equal(isZoomWheel(wheel({ ctrlKey: true })), true);
  assert.equal(isZoomWheel(wheel({ metaKey: true })), true);
  assert.equal(isZoomWheel(wheel({ deltaY: 40 })), false);
});

test("pinching out zooms in, and one mouse notch is a bounded step", () => {
  assert.ok(wheelZoomFactor(wheel({ ctrlKey: true, deltaY: -8 })) > 1);
  assert.ok(wheelZoomFactor(wheel({ ctrlKey: true, deltaY: 8 })) < 1);
  const notch = wheelZoomFactor(wheel({ ctrlKey: true, deltaY: 100 }));
  assert.ok(notch < 1 && notch > 0.7, `notch factor ${notch}`);
  assert.ok(wheelZoomFactor(wheel({ ctrlKey: true, deltaY: 10_000 })) >= 1 / 1.6);
});

test("wheel deltas are normalised to pixels, and Shift scrolls sideways", () => {
  assert.deepEqual(wheelPixels(wheel({ deltaY: 3, deltaMode: 1 })), { dx: 0, dy: 48 });
  assert.deepEqual(wheelPixels(wheel({ deltaY: 1, deltaMode: 2 }), 500), { dx: 0, dy: 500 });
  assert.deepEqual(wheelPixels(wheel({ deltaY: 30, shiftKey: true })), { dx: 30, dy: 0 });
});
