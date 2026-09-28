// A04: one renderer decision per diagram for every mode, and a playback stage
// (Stepped) that stays a screenful tall with a camera that can frame a tall
// diagram inside it. The DOM half (Mermaid rendering, the stage measuring
// itself) is covered by tests/e2e/diagram-modes.spec.ts.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearOversizedVerdicts,
  decideDiagramRender,
  isKnownOversized,
  rememberOversized,
} from "../src/services/diagrams/render-decision.ts";
import { GPU_EDGE_THRESHOLD } from "../src/services/diagrams/engine/gate.ts";
import {
  canFollow,
  frameFor,
  homeFrame,
  type CameraView,
} from "../src/services/diagrams/explainer/camera.ts";
import type { GraphShape } from "../src/services/diagrams/explainer/graph.ts";
import {
  STAGE_MAX_HEIGHT,
  TALL_STAGE_RATIO,
  playbackBoxStyle,
  stageBoxStyle,
} from "../src/services/diagrams/stage-ratio.ts";

/** The audit's workload: `n` edges in one top-down chain. */
const chain = (edges: number) =>
  "flowchart TD\n" +
  Array.from(
    { length: edges },
    (_, i) => `  n${i + 1}[Node ${i + 1}] --> n${i + 2}[Node ${i + 2}]`,
  ).join("\n");

test("the source decides only past the GPU threshold; 499–599 edges stay SVG until measured", () => {
  clearOversizedVerdicts();
  for (const edges of [499, 500, GPU_EDGE_THRESHOLD - 1]) {
    assert.deepEqual(
      decideDiagramRender(chain(edges)),
      { renderer: "svg", basis: "source" },
      `${edges}`,
    );
  }
  for (const edges of [GPU_EDGE_THRESHOLD, 1000]) {
    assert.deepEqual(
      decideDiagramRender(chain(edges)),
      { renderer: "gpu", basis: "source" },
      `${edges}`,
    );
  }
});

test("a render measured too large raises every mode's decision, by kind", () => {
  clearOversizedVerdicts();
  // Flowchart, ER, class and state: the GPU engine draws them.
  assert.deepEqual(decideDiagramRender(chain(500), true), { renderer: "gpu", basis: "render" });
  assert.deepEqual(decideDiagramRender("erDiagram\n  A ||--o{ B : has", true), {
    renderer: "gpu",
    basis: "render",
  });
  // Anything else has no live renderer at that size: a still image.
  assert.deepEqual(decideDiagramRender("sequenceDiagram\n  A->>B: hi", true), {
    renderer: "image",
    basis: "render",
  });
  // The source scan still wins where it already knew.
  assert.deepEqual(decideDiagramRender(`sequenceDiagram\n${"A->>B: hi\n".repeat(2000)}`), {
    renderer: "image",
    basis: "source",
  });
  assert.deepEqual(decideDiagramRender(chain(1000), true), { renderer: "gpu", basis: "source" });
});

test("a measured verdict is remembered per source, so a remount does not lay it out again", () => {
  clearOversizedVerdicts();
  const source = chain(500);
  assert.equal(isKnownOversized(source), false);
  rememberOversized(source);
  assert.equal(isKnownOversized(source), true);
  assert.deepEqual(decideDiagramRender(source), { renderer: "gpu", basis: "render" });
  // An edit is a different diagram; the verdict does not carry over.
  const edited = source.replace("Node 7]", "Node seven]");
  assert.deepEqual(decideDiagramRender(edited), { renderer: "svg", basis: "source" });
});

test("remembered verdicts are bounded, oldest first", () => {
  clearOversizedVerdicts();
  const first = chain(3);
  rememberOversized(first);
  for (let i = 0; i < 63; i++) rememberOversized(`flowchart TD\n  a${i} --> b${i}`);
  assert.equal(isKnownOversized(first), true);
  // Touching an entry makes it the newest.
  rememberOversized(first);
  rememberOversized("flowchart TD\n  x --> y");
  assert.equal(isKnownOversized(first), true);
  assert.equal(isKnownOversized("flowchart TD\n  a0 --> b0"), false);
  clearOversizedVerdicts();
});

test("a playback stage stays a screenful for a tall diagram; a fitted one is unchanged", () => {
  const tall = playbackBoxStyle(26, 56);
  assert.equal(tall.height, STAGE_MAX_HEIGHT);
  assert.equal(tall.paddingBottom, 56);
  assert.equal(tall.aspectRatio, undefined);
  // The still picture keeps its natural-size reading of a tall diagram.
  assert.equal(stageBoxStyle(26, 56, { width: 2000, height: 52000 }).height, 52000);
  for (const ratio of [0.26, 0.6, TALL_STAGE_RATIO]) {
    assert.deepEqual(playbackBoxStyle(ratio, 56), stageBoxStyle(ratio, 56));
  }
});

/** A top-down chain laid out like Mermaid's: 110×54 boxes, 100 units apart. */
function chainGraph(nodes: number): GraphShape {
  const map = new Map<string, GraphShape["nodes"] extends Map<string, infer N> ? N : never>();
  for (let i = 0; i < nodes; i++) {
    map.set(`n${i}`, {
      id: `n${i}`,
      label: `Node ${i}`,
      x: 63,
      y: 35 + i * 100,
      width: 110,
      height: 54,
    });
  }
  return {
    nodes: map,
    edges: Array.from({ length: nodes - 1 }, (_, i) => ({
      id: `e${i}`,
      source: `n${i}`,
      target: `n${i + 1}`,
      length: 46,
    })),
    baseView: { x: 0, y: 0, width: 126, height: nodes * 100 },
  };
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

test("a tall diagram follows only with a view, in the stage's proportions at natural size", () => {
  const graph = chainGraph(300);
  // A 456×512 stage: the reading column at 1280×800.
  const view: CameraView = { aspect: 456 / 512, minWidth: 456 };
  assert.equal(canFollow(graph), false, "no known stage: a close-up would be a 20:1 sliver");
  assert.equal(canFollow(graph, view), true);

  const home = homeFrame(graph, view);
  assert.ok(close(home.width / home.height, view.aspect));
  const bare = homeFrame(graph);
  assert.ok(home.x <= bare.x && home.x + home.width >= bare.x + bare.width);
  assert.ok(home.y <= bare.y && home.y + home.height >= bare.y + bare.height);

  for (const ids of [["n0"], ["n150", "n151"], ["n299"]]) {
    const frame = frameFor(graph, ids, view);
    assert.ok(close(frame.width / frame.height, view.aspect), `${ids} aspect`);
    // Natural size: one diagram unit per pixel of the stage.
    assert.ok(close(frame.width, view.minWidth), `${ids} width ${frame.width}`);
    assert.ok(frame.y >= home.y && frame.y + frame.height <= home.y + home.height + 1e-6);
    for (const id of ids) {
      const node = graph.nodes.get(id)!;
      assert.ok(
        node.y - node.height / 2 >= frame.y && node.y + node.height / 2 <= frame.y + frame.height,
      );
    }
  }
});

test("a fitted diagram frames exactly as before when no view is given", () => {
  const graph = chainGraph(6);
  graph.baseView = { x: 0, y: 0, width: 900, height: 600 };
  let n = 0;
  for (const node of graph.nodes.values()) {
    node.x = 80 + (n % 3) * 300;
    node.y = 60 + Math.floor(n / 3) * 300;
    n++;
  }
  const home = homeFrame(graph);
  assert.deepEqual(homeFrame(graph, undefined), home);
  const frame = frameFor(graph, ["n0"]);
  assert.ok(close(frame.width / frame.height, home.width / home.height));
  assert.ok(frame.width < home.width);
});
