// Boards: the file format (new `.board` files and older `.excalidraw` ones),
// hit testing, and the scene rules the editor relies on — connectors stay
// attached, labels travel with their shape, deletes and copies keep
// references consistent. The editor UI is covered by tests/e2e/board.spec.ts.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  elementBounds,
  hitTest,
  outlinePoint,
  BINDING_GAP,
} from "../src/services/board/geometry.ts";
import {
  displayColor,
  FONT_HYPERLEGIBLE,
  fontStack,
  newElement,
  parseScene,
  SceneParseError,
  serializeScene,
  STROKE_SWATCHES,
  type BoardElement,
} from "../src/services/board/model.ts";
import {
  bindConnectorEnd,
  cloneElements,
  deleteElements,
  ensureLabel,
  expandToGroups,
  findBindTarget,
  groupElements,
  indexById,
  reorder,
  settle,
} from "../src/services/board/scene-ops.ts";
import { DEFAULT_STYLE } from "../src/services/board/model.ts";
import { wrapText } from "../src/services/board/text.ts";
import { hexToHsv, hsvToHex, parseHex } from "../src/services/board/color.ts";

const rect = (
  id: string,
  x: number,
  y: number,
  w = 100,
  h = 60,
  extra: Partial<BoardElement> = {},
) => newElement("rectangle", { id, x, y, width: w, height: h, ...extra });

function connect(a: BoardElement, b: BoardElement) {
  const arrow = newElement("arrow", {
    id: "arrow",
    x: a.x + a.width,
    y: a.y + a.height / 2,
    points: [
      [0, 0],
      [b.x - (a.x + a.width), 0],
    ],
  });
  let elements = [a, b, arrow];
  elements = bindConnectorEnd(elements, "arrow", "start", a.id);
  elements = bindConnectorEnd(elements, "arrow", "end", b.id);
  return settle(elements, [a.id, b.id]);
}

const endpoints = (arrow: BoardElement) => {
  const pts = arrow.points!;
  return [
    [arrow.x + pts[0][0], arrow.y + pts[0][1]],
    [arrow.x + pts[pts.length - 1][0], arrow.y + pts[pts.length - 1][1]],
  ];
};

// --- format -----------------------------------------------------------------

test("an empty file is a new board, in the format its extension names", () => {
  assert.equal(parseScene("", "Plan.board").format, "board");
  assert.equal(parseScene("", "Old.excalidraw").format, "excalidraw");
  assert.deepEqual(parseScene("  ", "x.board").elements, []);
});

test("unreadable content is reported, never silently opened as a blank board", () => {
  assert.throws(() => parseScene("{not json"), SceneParseError);
  assert.throws(() => parseScene('{"hello": 1}'), SceneParseError);
});

test("an .excalidraw scene round-trips: same envelope, unknown fields kept, deleted dropped", () => {
  const source = JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "https://example.app",
    elements: [
      { id: "a", type: "rectangle", x: 1, y: 2, width: 3, height: 4, futureField: { keep: true } },
      { id: "gone", type: "ellipse", x: 0, y: 0, width: 1, height: 1, isDeleted: true },
      { id: "f", type: "frame", x: 0, y: 0, width: 50, height: 50, name: "Frame 1" },
    ],
    appState: { viewBackgroundColor: "#fafafa", zoom: { value: 3 } },
    files: {},
  });
  const scene = parseScene(source, "Sketch.excalidraw");
  assert.equal(scene.format, "excalidraw");
  assert.deepEqual(
    scene.elements.map((el) => el.id),
    ["a", "f"],
  );
  const out = JSON.parse(serializeScene(scene));
  assert.equal(out.type, "excalidraw");
  assert.equal(out.source, "https://example.app");
  assert.deepEqual(out.elements[0].futureField, { keep: true });
  assert.equal(out.elements[1].name, "Frame 1");
  // Only the drawing-relevant part of the old appState is written back.
  assert.equal(out.appState.viewBackgroundColor, "#fafafa");
  assert.equal(out.appState.zoom, undefined);
});

test("a .board file is written in localdox's own envelope", () => {
  const scene = parseScene("", "New.board");
  scene.elements = [rect("r", 0, 0)];
  const out = JSON.parse(serializeScene(scene));
  assert.equal(out.type, "localdox-board");
  assert.equal(out.version, 1);
  assert.equal(out.elements[0].id, "r");
  assert.equal(out.appState, undefined);
});

test("images nothing points at are dropped on save", () => {
  const scene = parseScene("", "x.board");
  scene.files = {
    used: { id: "used", mimeType: "image/png", dataURL: "data:image/png;base64,AA==", created: 1 },
    orphan: {
      id: "orphan",
      mimeType: "image/png",
      dataURL: "data:image/png;base64,AA==",
      created: 1,
    },
  };
  scene.elements = [newElement("image", { x: 0, y: 0, width: 10, height: 10, fileId: "used" })];
  const out = JSON.parse(serializeScene(scene));
  assert.deepEqual(Object.keys(out.files), ["used"]);
});

test("new text is set in Atkinson Hyperlegible; other families keep their stacks", () => {
  const text = newElement("text", { x: 0, y: 0 });
  assert.equal(text.fontFamily, FONT_HYPERLEGIBLE);
  assert.match(fontStack(FONT_HYPERLEGIBLE), /^"Atkinson Hyperlegible", /);
  assert.doesNotMatch(fontStack(2), /Atkinson/);
  assert.match(fontStack(3), /Mono/);
  assert.doesNotMatch(fontStack(1), /Atkinson/, "hand-lettered ids fall back to the system sans");
});

test("new elements are drawn crisp, not hand-drawn", () => {
  for (const type of ["rectangle", "arrow", "freedraw", "text"] as const) {
    assert.equal(newElement(type, { x: 0, y: 0 }).roughness, 0);
  }
});

test("palette colours have tuned dark variants; foreign colours are mirrored", () => {
  const ink = STROKE_SWATCHES[0];
  assert.equal(displayColor(ink.light, true), ink.dark);
  assert.equal(displayColor(ink.light, false), ink.light);
  assert.equal(displayColor("transparent", true), "transparent");
  const mirrored = displayColor("#111111", true);
  assert.match(mirrored, /^hsl\(/);
  assert.ok(Number(/(\d+)%\)$/.exec(mirrored)![1]) > 70, "near-black becomes near-white");
});

// --- hit testing --------------------------------------------------------------

test("a hollow shape is picked by its outline; a filled one by its area", () => {
  const hollow = rect("h", 0, 0, 100, 100);
  assert.equal(hitTest(hollow, [50, 50], 4), false);
  assert.equal(hitTest(hollow, [1, 50], 4), true);
  assert.equal(hitTest(hollow, [50, 50], 4, true), true, "solid when already selected");
  const filled = rect("f", 0, 0, 100, 100, { backgroundColor: "#fff0b3" });
  assert.equal(hitTest(filled, [50, 50], 4), true);
});

test("hit testing follows rotation", () => {
  // A 200×20 bar rotated 90° stands upright around its centre (100, 10).
  const bar = rect("b", 0, 0, 200, 20, { angle: Math.PI / 2, backgroundColor: "#000000" });
  assert.equal(hitTest(bar, [100, 80], 2), true);
  assert.equal(hitTest(bar, [180, 10], 2), false);
  const b = elementBounds(bar);
  assert.ok(b.maxY > 100 && b.maxX < 115);
});

test("ellipses and lines are hit by their true geometry", () => {
  const ellipse = newElement("ellipse", {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    backgroundColor: "#ffffff",
  });
  assert.equal(hitTest(ellipse, [50, 25], 2), true);
  assert.equal(hitTest(ellipse, [2, 2], 2), false, "the box corner is outside an ellipse");
  const line = newElement("line", {
    x: 0,
    y: 0,
    points: [
      [0, 0],
      [100, 100],
    ],
  });
  assert.equal(hitTest(line, [50, 51], 3), true);
  assert.equal(hitTest(line, [50, 80], 3), false);
});

// --- connectors -----------------------------------------------------------------

test("a connector attaches to the outlines of both shapes", () => {
  const a = rect("a", 0, 0);
  const b = rect("b", 300, 0);
  const elements = connect(a, b);
  const arrow = indexById(elements).get("arrow")!;
  const [start, end] = endpoints(arrow);
  assert.ok(Math.abs(start[0] - (100 + BINDING_GAP)) < 0.01, `start x ${start[0]}`);
  assert.ok(Math.abs(end[0] - (300 - BINDING_GAP)) < 0.01, `end x ${end[0]}`);
  assert.deepEqual(indexById(elements).get("a")!.boundElements, [{ id: "arrow", type: "arrow" }]);
});

test("moving a shape re-routes the connectors bound to it", () => {
  let elements = connect(rect("a", 0, 0), rect("b", 300, 0));
  elements = elements.map((el) => (el.id === "b" ? { ...el, y: 400 } : el));
  elements = settle(elements, ["b"]);
  const arrow = indexById(elements).get("arrow")!;
  const [, end] = endpoints(arrow);
  const moved = indexById(elements).get("b")!;
  // The end now lands on b's outline, aimed back toward a.
  assert.ok(end[1] < moved.y && end[1] > moved.y - BINDING_GAP * 2, `end y ${end[1]}`);
});

test("a photo takes connectors only at its rim, so arrows can point inside it", () => {
  const photo = newElement("image", { id: "p", x: 0, y: 0, width: 400, height: 300, fileId: "f" });
  const box = rect("b", 600, 0);
  assert.equal(findBindTarget([photo, box], [200, 150], 4, new Set()), undefined);
  assert.equal(findBindTarget([photo, box], [2, 150], 4, new Set())?.id, "p");
  assert.equal(findBindTarget([photo, box], [650, 30], 4, new Set())?.id, "b");
});

test("outline points work for ellipses and diamonds", () => {
  const ellipse = newElement("ellipse", { x: 0, y: 0, width: 200, height: 100 });
  const p = outlinePoint(ellipse, [500, 50], 0);
  assert.ok(Math.abs(p[0] - 200) < 0.01 && Math.abs(p[1] - 50) < 0.01);
  const diamond = newElement("diamond", { x: 0, y: 0, width: 100, height: 100 });
  const q = outlinePoint(diamond, [50, -500], 0);
  assert.ok(Math.abs(q[1]) < 0.01);
});

// --- structure ------------------------------------------------------------------

test("deleting a shape deletes its label and frees connectors pointing at it", () => {
  let elements = connect(rect("a", 0, 0), rect("b", 300, 0));
  const labelled = ensureLabel(elements, "a", DEFAULT_STYLE);
  elements = labelled.elements;
  elements = deleteElements(elements, ["a"]);
  const map = indexById(elements);
  assert.equal(map.has("a"), false);
  assert.equal(map.has(labelled.textId), false);
  assert.equal(map.get("arrow")!.startBinding, null);
  assert.equal(map.get("arrow")!.endBinding?.elementId, "b");
});

test("copies remap their own references and drop references to anything outside", () => {
  const elements = connect(rect("a", 0, 0), rect("b", 300, 0));
  const clones = cloneElements(elements, ["a", "arrow"], [10, 10]);
  const ids = new Set(clones.map((c) => c.id));
  assert.equal(clones.length, 2);
  assert.ok(![...ids].some((id) => id === "a" || id === "arrow"));
  const arrow = clones.find((c) => c.type === "arrow")!;
  const shape = clones.find((c) => c.type === "rectangle")!;
  assert.equal(arrow.startBinding?.elementId, shape.id);
  assert.equal(arrow.endBinding, null, "b wasn't copied, so the copy is free at that end");
  assert.deepEqual(shape.boundElements, [{ id: arrow.id, type: "arrow" }]);
  assert.equal(shape.x, 10);
});

test("z-order moves a shape and its label together", () => {
  const base = [rect("a", 0, 0), rect("b", 0, 0), rect("c", 0, 0)];
  const { elements, textId } = ensureLabel(base, "a", DEFAULT_STYLE);
  const front = reorder(elements, new Set(["a"]), "front").map((el) => el.id);
  assert.deepEqual(front, ["b", "c", "a", textId]);
  const back = reorder(
    front.map((id) => indexById(elements).get(id)!),
    new Set(["c"]),
    "back",
  );
  assert.deepEqual(
    back.map((el) => el.id),
    ["c", "b", "a", textId],
  );
  const forward = reorder(elements, new Set(["b"]), "forward").map((el) => el.id);
  assert.deepEqual(forward, ["a", textId, "c", "b"]);
});

test("grouped elements are selected as a group", () => {
  const elements = groupElements(
    [rect("a", 0, 0), rect("b", 0, 0), rect("c", 0, 0)],
    new Set(["a", "b"]),
  );
  assert.deepEqual([...expandToGroups(elements, ["a"])].sort(), ["a", "b"]);
  assert.deepEqual([...expandToGroups(elements, ["c"])], ["c"]);
});

test("a sticky note grows to fit its text", () => {
  const note = rect("n", 0, 0, 200, 200, {
    backgroundColor: "#fff0b3",
    strokeColor: "transparent",
  });
  const { elements, textId } = ensureLabel([note], "n", DEFAULT_STYLE);
  const long = "word ".repeat(200);
  const typed = elements.map((el) => (el.id === textId ? { ...el, text: long } : el));
  const settled = settle(typed, [textId]);
  const grown = indexById(settled).get("n")!;
  const label = indexById(settled).get(textId)!;
  assert.ok(grown.height > 200, `height ${grown.height}`);
  assert.ok(label.y >= grown.y && label.y + label.height <= grown.y + grown.height + 0.5);
});

test("wrapping breaks at spaces and splits words wider than the line", () => {
  // Without a canvas, widths are a fixed 0.56em per character: 10 chars ≈ 112px at 20px.
  assert.deepEqual(wrapText("alpha beta gamma", 20, 2, 120), ["alpha beta", "gamma"]);
  const pieces = wrapText("x".repeat(30), 20, 2, 120);
  assert.ok(pieces.length >= 3 && pieces.every((line) => line.length <= 10));
  assert.deepEqual(wrapText("one\n\ntwo", 20, 2, 500), ["one", "", "two"]);
});

test("hex input accepts what people type and rejects what isn't a colour yet", () => {
  assert.equal(parseHex("#ABC"), "#aabbcc");
  assert.equal(parseHex("12ab34"), "#12ab34");
  assert.equal(parseHex("  #12AB34 "), "#12ab34");
  assert.equal(parseHex("#12ab3"), null);
  assert.equal(parseHex("zzz"), null);
});

test("colours round-trip through HSV, the wheel's coordinates", () => {
  for (const hex of ["#000000", "#ffffff", "#ff0000", "#12ab34", "#5b5bd6", "#808080"]) {
    assert.equal(hsvToHex(hexToHsv(hex)!), hex);
  }
  const red = hexToHsv("#ff0000")!;
  assert.deepEqual([Math.round(red.h), red.s, red.v], [0, 1, 1]);
  assert.equal(Math.round(hexToHsv("#00ff00")!.h), 120);
});

test("custom saturated colours show exactly in dark mode; inks still flip", () => {
  assert.equal(displayColor("#12ab34", true), "#12ab34");
  assert.notEqual(displayColor("#111111", true), "#111111");
  assert.notEqual(displayColor("#f5f5f5", true), "#f5f5f5");
});
