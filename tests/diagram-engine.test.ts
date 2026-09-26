// Unit tests for the GPU diagram engine's pure layers: the Rust/WASM layout
// (loaded from the shipped .wasm), Mermaid-model extraction, scene building,
// the explainer schedule, and the gate that routes diagrams to the engine. The
// WebGL renderer and the player's clock need a browser and are not covered
// here; bench/ drives those in Chrome.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  instantiateEngine,
  instantiateLayout,
  type LayoutEngine,
} from "../src/services/diagrams/engine/layout.ts";
import { emitMarker, trimPolyline } from "../src/services/diagrams/engine/markers.ts";
import { checkModel, DiagramTooLargeError } from "../src/services/diagrams/engine/limits.ts";
import {
  labelLines,
  modelFromDb,
  shapeOf,
  type FlowDbLike,
} from "../src/services/diagrams/engine/flowchart.ts";
import {
  mermaidMemberText,
  modelFromClassParsed,
  modelFromErParsed,
  modelFromLayoutData,
  type LayoutData,
} from "../src/services/diagrams/engine/flowchart.ts";
import { basisCurve, buildScene } from "../src/services/diagrams/engine/scene.ts";
import {
  buildSchedule,
  cameraAt,
  evaluate,
  STEP_DRAW,
  STEP_REVEAL,
  STEP_REVISIT,
} from "../src/services/diagrams/engine/schedule.ts";
import {
  diagramKind,
  flowchartDirection,
  shouldUseGpuEngine,
} from "../src/services/diagrams/engine/gate.ts";
import { planExplainer, stepNumber } from "../src/services/diagrams/explainer/plan.ts";
import type { GraphShape } from "../src/services/diagrams/explainer/graph.ts";
import { syntheticFlowchart, syntheticGraph } from "../bench/generate.ts";

const wasm = readFileSync(
  new URL("../src/services/diagrams/engine/diagram_layout.wasm", import.meta.url),
);
let engine: LayoutEngine | null = null;
async function layout(): Promise<LayoutEngine> {
  engine ??= await instantiateLayout(wasm);
  return engine;
}

const box = { width: 100, height: 40 };

function pointsOf(result: ReturnType<LayoutEngine>, edge: number): [number, number][] {
  const out: [number, number][] = [];
  for (let p = result.edgeOffsets[edge]; p < result.edgeOffsets[edge + 1]; p++) {
    out.push([result.points[p * 2], result.points[p * 2 + 1]]);
  }
  return out;
}

/** A Mermaid flow database stand-in with the accessors the model reads. */
function fakeDb(
  vertices: { id: string; text?: string; type?: string; styles?: string[]; classes?: string[] }[],
  edges: { start: string; end: string; text?: string; type?: string; stroke?: string }[],
  direction = "TB",
): FlowDbLike {
  return {
    getVertices: () => new Map(vertices.map((v) => [v.id, v])),
    getEdges: () => edges,
    getDirection: () => direction,
    getClasses: () => new Map([["hot", { styles: ["fill:#f96", "stroke:#333"] }]]),
    getSubGraphs: () => [],
  };
}

test("layout: a chain runs top to bottom and stays straight", async () => {
  const result = (await layout())({
    nodes: [box, box, box],
    edges: [
      { source: 0, target: 1 },
      { source: 1, target: 2 },
    ],
  });
  const y = (i: number) => result.nodes[i * 2 + 1];
  const x = (i: number) => result.nodes[i * 2];
  assert.ok(y(0) < y(1) && y(1) < y(2));
  assert.ok(Math.abs(x(0) - x(2)) < 0.5);
});

test("layout: LR runs left to right, BT runs upward", async () => {
  const run = await layout();
  const edges = [{ source: 0, target: 1 }];
  const lr = run({ nodes: [box, box], edges, direction: "LR" });
  assert.ok(lr.nodes[0] < lr.nodes[2]);
  const bt = run({ nodes: [box, box], edges, direction: "BT" });
  assert.ok(bt.nodes[1] > bt.nodes[3]);
});

test("layout: every edge starts on its source's outline and ends on its target's", async () => {
  const result = (await layout())({
    nodes: [box, box, box],
    edges: [
      { source: 0, target: 1 },
      { source: 0, target: 2 },
    ],
  });
  for (let e = 0; e < 2; e++) {
    const points = pointsOf(result, e);
    const [sx, sy] = points[0];
    const [tx, ty] = points[points.length - 1];
    const source = [result.nodes[0], result.nodes[1]];
    const target = [result.nodes[(e + 1) * 2], result.nodes[(e + 1) * 2 + 1]];
    assert.ok(
      Math.abs(sy - (source[1] + 20)) < 0.5 || Math.abs(Math.abs(sx - source[0]) - 50) < 0.5,
    );
    assert.ok(
      Math.abs(ty - (target[1] - 20)) < 0.5 || Math.abs(Math.abs(tx - target[0]) - 50) < 0.5,
    );
  }
});

test("layout: a cycle terminates, and the back edge still runs source → target", async () => {
  const result = (await layout())({
    nodes: [box, box, box],
    edges: [
      { source: 0, target: 1 },
      { source: 1, target: 2 },
      { source: 2, target: 0 },
    ],
  });
  const back = pointsOf(result, 2);
  assert.ok(back[0][1] > back[back.length - 1][1], "leaves node 2 (lower) for node 0 (upper)");
});

test("layout: labelled edges leave room for the label between the nodes", async () => {
  const result = (await layout())({
    nodes: [box, box],
    edges: [{ source: 0, target: 1, labelWidth: 60, labelHeight: 20 }],
  });
  const labelY = result.labels[1];
  assert.ok(labelY > result.nodes[1] + 20 && labelY < result.nodes[3] - 20);
  assert.ok(
    Number.isNaN(
      (await layout())({ nodes: [box, box], edges: [{ source: 0, target: 1 }] }).labels[0],
    ),
  );
});

test("layout: no two nodes overlap in a large synthetic graph", async () => {
  const graph = syntheticGraph(1500);
  const result = (await layout())({
    nodes: Array.from({ length: graph.nodes }, () => box),
    edges: graph.edges.map(([source, target]) => ({ source, target })),
  });
  // Sort by rank row, then check horizontal neighbours only.
  const rows = new Map<number, number[]>();
  for (let i = 0; i < graph.nodes; i++) {
    const y = Math.round(result.nodes[i * 2 + 1]);
    rows.set(y, [...(rows.get(y) ?? []), result.nodes[i * 2]]);
  }
  for (const xs of rows.values()) {
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 100 - 0.01);
  }
});

test("layout: 10,000 nodes lays out in well under a second", async () => {
  const graph = syntheticGraph(10_000);
  const run = await layout();
  const started = performance.now();
  const result = run({
    nodes: Array.from({ length: graph.nodes }, () => box),
    edges: graph.edges.map(([source, target]) => ({ source, target })),
  });
  const elapsed = performance.now() - started;
  assert.equal(result.nodes.length, 20_000);
  assert.ok(elapsed < 1000, `took ${Math.round(elapsed)}ms`);
});

test("labels: markup, entities and icons reduce to plain lines", () => {
  assert.deepEqual(labelLines("<b>Auth</b><br/>Service", "x"), ["Auth", "Service"]);
  assert.deepEqual(labelLines("Tom &amp; Jerry #quot;hi#quot;", "x"), ['Tom & Jerry "hi"']);
  assert.deepEqual(labelLines("fa:fa-car Car", "x"), ["Car"]);
  assert.deepEqual(labelLines("", "Fallback"), ["Fallback"]);
});

test("model: shapes, styles, arrows and dangling edges", () => {
  const model = modelFromDb(
    fakeDb(
      [
        { id: "A", text: "Start", type: "stadium", classes: ["hot"] },
        { id: "B", text: "Ok?", type: "diamond", styles: ["fill:#0f0"] },
        { id: "C" },
      ],
      [
        { start: "A", end: "B", text: "go", type: "arrow_point" },
        { start: "B", end: "C", type: "arrow_open", stroke: "dotted" },
        { start: "C", end: "A", type: "double_arrow_point", stroke: "thick" },
        { start: "C", end: "cluster1" },
      ],
      "LR",
    ),
  );
  assert.equal(model.direction, "LR");
  assert.deepEqual(
    model.nodes.map((n) => n.shape),
    ["stadium", "diamond", "rect"],
  );
  assert.equal(model.nodes[0].fill, "#f96");
  assert.equal(model.nodes[1].fill, "#0f0");
  assert.deepEqual(model.nodes[2].lines, ["C"]);
  assert.equal(model.edges.length, 3);
  assert.equal(model.skippedEdges, 1);
  assert.deepEqual(model.edges[0].lines, ["go"]);
  assert.equal(model.edges[1].markerEnd, "none");
  assert.equal(model.edges[1].stroke, "dotted");
  assert.equal(model.edges[2].markerStart, "arrow");
  assert.equal(model.edges[2].markerEnd, "arrow");
  assert.equal(shapeOf("cyl"), "round");
  assert.equal(shapeOf("circle"), "ellipse");
});

test("curve: basis smoothing keeps both endpoints and leaves straight edges alone", () => {
  assert.deepEqual(basisCurve([0, 0, 10, 10]), [0, 0, 10, 10]);
  const curve = basisCurve([0, 0, 50, 100, 0, 200]);
  assert.deepEqual(curve.slice(0, 2), [0, 0]);
  assert.deepEqual(curve.slice(-2), [0, 200]);
  assert.ok(curve.length > 6);
});

async function sceneFor(nodes: number) {
  const model = modelFromDb(
    fakeDb(
      Array.from({ length: nodes }, (_, i) => ({ id: `n${i}`, text: `Service ${i}` })),
      syntheticGraph(nodes).edges.map(([a, b]) => ({ start: `n${a}`, end: `n${b}` })),
    ),
  );
  return buildScene(model, (text) => text.length * 7, await layout());
}

test("scene: typed arrays line up with the model and the graph", async () => {
  const scene = await sceneFor(120);
  assert.equal(scene.nodeCount, 120);
  assert.equal(scene.nodeX.length, 120);
  assert.equal(scene.graph.nodes.size, 120);
  assert.equal(scene.graph.edges.length, scene.edgeCount);
  assert.equal(scene.pointOffsets[scene.edgeCount], scene.points.length / 2);
  for (let e = 0; e < scene.edgeCount; e++) {
    assert.ok(scene.edgeLength[e] > 0);
    assert.equal(scene.edgeIndex.get(`e${e}`), e);
  }
  const node = scene.graph.nodes.get("n7")!;
  assert.equal(node.label, "Service 7");
  assert.equal(node.x, scene.nodeX[7]);
});

function scheduleFor(scene: Awaited<ReturnType<typeof sceneFor>>, mode?: "narrated" | "wave") {
  const home = { x: 0, y: 0, width: scene.width, height: scene.height };
  return buildSchedule({
    plan: planExplainer(scene.graph),
    nodeCount: scene.nodeCount,
    nodeIndex: scene.nodeIndex,
    edgeIndex: scene.edgeIndex,
    nodeLabel: (i) => scene.nodeLines[i].join(" "),
    edgeLabel: () => "",
    home,
    frameFor: () => home,
    camera: true,
    mode,
  });
}

/** The explainer's two promises, checked step by step. */
function assertOrdering(
  schedule: ReturnType<typeof scheduleFor>,
  scene: Awaited<ReturnType<typeof sceneFor>>,
) {
  const revealedAt = new Map<number, number>();
  for (let i = 0; i < schedule.kind.length; i++) {
    if (schedule.kind[i] === STEP_REVEAL) {
      revealedAt.set(schedule.target[i], schedule.start[i]);
      if (
        i > 0 &&
        schedule.kind[i - 1] === STEP_DRAW &&
        schedule.landsOn[i - 1] === schedule.target[i]
      ) {
        assert.ok(
          schedule.start[i] >= schedule.end[i - 1] - 1e-6,
          "a node appears when its edge lands",
        );
      }
      continue;
    }
    const source = scene.edgeSource[schedule.target[i]];
    assert.ok(revealedAt.has(source), "an edge never starts from a node that isn't there");
    assert.ok(schedule.start[i] >= revealedAt.get(source)! - 1e-6);
  }
}

test("schedule: narrated pacing keeps the explainer's ordering", async () => {
  const scene = await sceneFor(60);
  const schedule = scheduleFor(scene);
  assert.equal(schedule.mode, "narrated");
  assertOrdering(schedule, scene);
  assert.ok(schedule.beats.length > 1);
});

test("schedule: a 10,000-node diagram becomes a wave of a couple of minutes", async () => {
  const scene = await sceneFor(10_000);
  const schedule = scheduleFor(scene);
  assert.equal(schedule.mode, "wave");
  assert.ok(schedule.duration <= 160_000, `${schedule.duration}ms`);
  assert.ok(schedule.kind.some((k) => k === STEP_REVISIT));
  assertOrdering(schedule, scene);
});

test("schedule: evaluate is blank at 0, complete at the end, and cheap", async () => {
  const scene = await sceneFor(10_000);
  const schedule = scheduleFor(scene);
  const nodes = new Float32Array(scene.nodeCount * 4);
  const edges = new Float32Array(scene.edgeCount * 4);
  evaluate(schedule, 0, nodes, edges);
  for (let i = 0; i < scene.nodeCount; i++) assert.equal(nodes[i * 4], 0);
  const started = performance.now();
  for (let frame = 0; frame < 60; frame++)
    evaluate(schedule, (schedule.duration * frame) / 60, nodes, edges);
  const perFrame = (performance.now() - started) / 60;
  evaluate(schedule, schedule.duration, nodes, edges);
  for (let i = 0; i < scene.nodeCount; i++) assert.equal(nodes[i * 4], 1);
  for (let e = 0; e < scene.edgeCount; e++) assert.equal(edges[e * 4], 1);
  assert.ok(perFrame < 4, `evaluate took ${perFrame.toFixed(2)}ms per frame`);
});

test("gate: only large diagrams of kinds the engine draws go to it", () => {
  assert.equal(flowchartDirection("flowchart LR\n A-->B"), "LR");
  assert.equal(flowchartDirection("---\ntitle: x\n---\n%% note\ngraph TD;\nA-->B"), "TD");
  assert.equal(flowchartDirection("sequenceDiagram\nA->>B: hi"), null);
  assert.equal(shouldUseGpuEngine(syntheticFlowchart(50)), false);
  assert.equal(shouldUseGpuEngine(syntheticFlowchart(2000)), true);
  assert.equal(shouldUseGpuEngine(`erDiagram\n${"A ||--o{ B : has\n".repeat(2000)}`), true);
  assert.equal(shouldUseGpuEngine(`sequenceDiagram\n${"A->>B: hi\n".repeat(2000)}`), false);
});

test("step numbers: what counts as a numbered arrow", () => {
  assert.deepEqual(stepNumber("1"), [1]);
  assert.deepEqual(stepNumber("2. Pay"), [2]);
  assert.deepEqual(stepNumber("(3) retry"), [3]);
  assert.deepEqual(stepNumber("Step 4 fetch"), [4]);
  assert.deepEqual(stepNumber("#5 notify"), [5]);
  assert.deepEqual(stepNumber("1.2 retry"), [1, 2]);
  assert.deepEqual(stepNumber("6: done"), [6]);
  assert.equal(stepNumber("10 ms timeout"), null);
  assert.equal(stepNumber("yes"), null);
  assert.equal(stepNumber(undefined), null);
});

function shape(edges: [string, string, string?][]): GraphShape {
  const ids = [...new Set(edges.flatMap(([a, b]) => [a, b]))];
  return {
    nodes: new Map(
      ids.map((id, i) => [id, { id, label: id, x: i * 100, y: i * 10, width: 50, height: 20 }]),
    ),
    edges: edges.map(([source, target, text], i) => ({
      id: `e${i}`,
      source,
      target,
      length: 100,
      text,
    })),
    baseView: { x: 0, y: 0, width: 1000, height: 1000 },
  };
}

test("plan: numbered arrows play in the author's order, sources first", () => {
  // Written out of order, and against the automatic top-down walk.
  const graph = shape([
    ["A", "B", "3"],
    ["C", "D", "1. first"],
    ["A", "C", "2"],
    ["B", "E"],
  ]);
  const plan = planExplainer(graph);
  const draws = plan.steps.filter((s) => s.type !== "reveal-node");
  assert.deepEqual(
    draws.map((s) => (s.type === "reveal-node" ? "" : `${s.from}${s.to}:${s.number}`)),
    ["CD:1", "AC:2", "AB:3", "BE:4"],
  );
  // C is on screen before its arrow leaves it.
  const order = plan.steps.map((s) => (s.type === "reveal-node" ? s.nodeId : s.edgeId));
  assert.ok(order.indexOf("C") < order.indexOf("e1"));
  // Every node still appears exactly once.
  const reveals = plan.steps.filter((s) => s.type === "reveal-node").map((s) => s.nodeId);
  assert.deepEqual([...reveals].sort(), ["A", "B", "C", "D", "E"]);
});

test("plan: numbering can be switched off, and unnumbered diagrams count 1, 2, 3", () => {
  const graph = shape([
    ["A", "B", "3"],
    ["C", "D", "1"],
  ]);
  const automatic = planExplainer(graph, { followNumbers: false });
  const first = automatic.steps.find((s) => s.type !== "reveal-node");
  assert.ok(first && first.type !== "reveal-node" && first.from === "A");
  const plain = planExplainer(
    shape([
      ["A", "B"],
      ["B", "C"],
    ]),
  );
  assert.deepEqual(
    plain.steps.flatMap((s) => (s.type === "reveal-node" ? [] : [s.number])),
    ["1", "2"],
  );
});

test("layout: a 10,000-node tree folds to near the target aspect", async () => {
  const graph = syntheticGraph(10_000);
  const result = (await layout())({
    nodes: Array.from({ length: graph.nodes }, () => box),
    edges: graph.edges.map(([source, target]) => ({ source, target })),
    aspect: 1.8,
  });
  const ratio = result.width / result.height;
  assert.ok(ratio > 1.8 / 2.5 && ratio < 1.8 * 2.5, `ratio ${ratio}`);
});

test("scene: badges sit on their edges, inside the diagram", async () => {
  const scene = await sceneFor(300);
  for (let e = 0; e < scene.edgeCount; e++) {
    assert.ok(scene.badgeX[e] >= 0 && scene.badgeX[e] <= scene.width);
    assert.ok(scene.badgeY[e] >= 0 && scene.badgeY[e] <= scene.height);
  }
  assert.ok(scene.width / scene.height < 1.8 * 2.5);
});

test("gate: ER, class and state diagrams are recognised and routed when large", () => {
  assert.equal(diagramKind("erDiagram\n  A ||--o{ B : x"), "er");
  assert.equal(diagramKind("classDiagram\n  A <|-- B"), "class");
  assert.equal(diagramKind("stateDiagram-v2\n  [*] --> A"), "state");
  assert.equal(diagramKind("sequenceDiagram\n  A->>B: hi"), null);
  const er = ["erDiagram"];
  for (let i = 0; i < 80; i++)
    er.push(`  T${i} ||--o{ T${i + 1} : has`, `  T${i} {`, "    int id PK", "  }");
  assert.equal(shouldUseGpuEngine(er.join("\n")), true);
  assert.equal(shouldUseGpuEngine("erDiagram\n  A ||--o{ B : x"), false);
});

test("model: ER layout data becomes tables with crow's-foot ends", () => {
  const data: LayoutData = {
    direction: "LR",
    nodes: [
      {
        id: "entity-CUSTOMER-0",
        label: "CUSTOMER",
        shape: "erBox",
        attributes: [{ type: "string", name: "name", keys: ["PK"], comment: "full name" }],
      },
      { id: "entity-ORDER-1", label: "ORDER", shape: "erBox", attributes: [] },
    ],
    edges: [
      {
        start: "entity-CUSTOMER-0",
        end: "entity-ORDER-1",
        label: "places",
        arrowTypeStart: "only_one",
        arrowTypeEnd: "zero_or_more",
        pattern: "dashed",
      },
    ],
  };
  const model = modelFromLayoutData(data, "er");
  assert.equal(model.direction, "LR");
  assert.deepEqual(model.nodes[0].table, {
    header: ["CUSTOMER"],
    sections: [[["string", "name", "PK", "full name"]]],
  });
  assert.equal(model.edges[0].markerStart, "one");
  assert.equal(model.edges[0].markerEnd, "zeroMany");
  assert.equal(model.edges[0].stroke, "dotted");
});

test("model: class layout data keeps members, methods and relation markers", () => {
  const model = modelFromLayoutData(
    {
      nodes: [
        {
          id: "Animal",
          label: "Animal",
          shape: "classBox",
          annotations: ["interface"],
          members: [{ text: "\\+int age" }],
          methods: [{ text: "+isMammal() bool" }],
        },
        { id: "Duck", label: "Duck", shape: "classBox" },
        { id: "ns", label: "ns", isGroup: true },
      ],
      edges: [{ start: "Animal", end: "Duck", arrowTypeStart: "extension", arrowTypeEnd: "none" }],
    },
    "class",
  );
  assert.equal(model.nodes.length, 2, "namespaces are containers, not nodes");
  assert.deepEqual(model.nodes[0].table?.header, ["«interface»", "Animal"]);
  assert.deepEqual(model.nodes[0].table?.sections, [[["+int age"]], [["+isMammal() bool"]]]);
  assert.equal(model.edges[0].markerStart, "triangleOpen");
  assert.equal(model.subgraphs, 1);
});

test("model: state layout data maps start, end and bars", () => {
  const model = modelFromLayoutData(
    {
      nodes: [
        { id: "root_start", label: "root_start", shape: "stateStart" },
        { id: "Still", label: "Still", shape: "rect" },
        { id: "root_end", label: "root_end", shape: "stateEnd" },
      ],
      edges: [
        { start: "root_start", end: "Still", arrowTypeEnd: "arrow_barb" },
        { start: "Still", end: "root_end", arrowTypeEnd: "arrow_barb" },
      ],
    },
    "state",
  );
  assert.deepEqual(
    model.nodes.map((n) => n.shape),
    ["start", "round", "end"],
  );
  assert.deepEqual(model.nodes[0].lines, []);
  assert.equal(model.edges[0].markerEnd, "arrow");
});

test("ER fast path: matches the layout-data model Mermaid would give", async () => {
  const wasm = await instantiateEngine(
    readFileSync(new URL("../src/services/diagrams/engine/diagram_layout.wasm", import.meta.url)),
  );
  const source = `erDiagram
  direction LR
  CUSTOMER ||--o{ ORDER : places
  ORDER }|..|{ ADDRESS : "ships to"
  CUSTOMER["Customer account"] {
    string name PK "full name"
    varchar(255) email UK, FK
  }`;
  const utf8 = new TextEncoder().encode(source);
  const model = modelFromErParsed(wasm.parseEr(utf8), utf8);
  assert.ok(model);
  assert.equal(model.kind, "er");
  assert.equal(model.direction, "LR");
  assert.deepEqual(
    model.nodes.map((n) => n.id),
    ["entity-CUSTOMER-0", "entity-ORDER-1", "entity-ADDRESS-2"],
  );
  assert.deepEqual(model.nodes[0].table?.header, ["Customer account"]);
  assert.deepEqual(model.nodes[0].table?.sections[0][1], ["varchar(255)", "email", "UK,FK", ""]);
  assert.deepEqual(
    model.edges.map((e) => [e.markerStart, e.markerEnd, e.stroke, e.lines.join(" ")]),
    [
      ["one", "zeroMany", "normal", "places"],
      ["oneMany", "oneMany", "dotted", "ships to"],
    ],
  );
  const declined = new TextEncoder().encode("erDiagram\n  A one or more--zero or more B : x");
  assert.equal(modelFromErParsed(wasm.parseEr(declined), declined), null);
});

test("markers: each marker sits at the tip and extends back along the edge", () => {
  const segments: number[][] = [];
  const triangles: number[][] = [];
  const sink = {
    segment: (...p: number[]) => segments.push(p),
    triangle: (...p: number[]) => triangles.push(p),
  };
  // Arriving downward at (0, 100): the marker lies above the tip.
  emitMarker("arrow", 0, 100, 0, 1, sink);
  assert.equal(triangles.length, 1);
  assert.ok(triangles[0].filter((_, i) => i % 2 === 1).every((y) => y <= 100 + 1e-9));
  emitMarker("zeroMany", 0, 100, 0, 1, sink);
  assert.ok(segments.length > 3, "crow's foot plus a ring");
  assert.ok(
    segments
      .flat()
      .filter((_, i) => i % 2 === 1)
      .every((y) => y <= 100 + 1e-9),
  );
});

test("markers: trimming stops the stroke short of a hollow marker", () => {
  const trimmed = trimPolyline([0, 0, 0, 100], 12, false);
  assert.deepEqual(trimmed, [0, 0, 0, 88]);
  assert.deepEqual(trimPolyline([0, 0, 0, 100], 12, true), [0, 12, 0, 100]);
});

test("scene: ER tables are sized to their columns", async () => {
  const model = modelFromLayoutData(
    {
      nodes: [
        {
          id: "e1",
          label: "ORDERS",
          shape: "erBox",
          attributes: [
            { type: "int", name: "id", keys: ["PK"], comment: "" },
            { type: "varchar", name: "customer_reference", keys: [], comment: "" },
          ],
        },
        { id: "e2", label: "X", shape: "erBox", attributes: [] },
      ],
      edges: [{ start: "e1", end: "e2", arrowTypeStart: "only_one", arrowTypeEnd: "zero_or_more" }],
    },
    "er",
  );
  const scene = buildScene(model, (text) => text.length * 7, await layout());
  const table = scene.nodeTable[0]!;
  assert.equal(table.columns.length, 4);
  assert.ok(scene.nodeW[0] >= "customer_reference".length * 7 + "varchar".length * 7);
  assert.ok(scene.nodeH[0] > scene.nodeH[1], "rows add height");
  assert.ok(scene.markerSegments.length > 0, "crow's feet emitted");
});

test("schedule: the camera rides edges whose far end is out of view", async () => {
  const scene = await sceneFor(400);
  const home = { x: 0, y: 0, width: scene.width, height: scene.height };
  const span = 400;
  const around = (x: number, y: number) => ({
    x: x - span / 2,
    y: y - span / 4,
    width: span,
    height: span / 2,
  });
  const schedule = buildSchedule({
    plan: planExplainer(scene.graph),
    nodeCount: scene.nodeCount,
    nodeIndex: scene.nodeIndex,
    edgeIndex: scene.edgeIndex,
    nodeLabel: () => "",
    edgeLabel: () => "",
    home,
    frameFor: () => around(scene.nodeX[0], scene.nodeY[0]),
    camera: true,
    mode: "narrated",
    edgeFollow: {
      along: (edge, f) => {
        const s = scene.edgeSource[edge];
        const t = scene.edgeTarget[edge];
        return [
          scene.nodeX[s] + (scene.nodeX[t] - scene.nodeX[s]) * f,
          scene.nodeY[s] + (scene.nodeY[t] - scene.nodeY[s]) * f,
        ];
      },
      around,
    },
  });
  const tracks = schedule.moves.filter((m) => m.track !== undefined);
  assert.ok(tracks.length > 0, "long edges are ridden");
  for (const move of tracks) {
    // The ride ends framed on the target.
    const t = scene.edgeTarget[move.track!];
    const frame = cameraAt(schedule, move.end + 1);
    assert.ok(frame.x <= scene.nodeX[t] && scene.nodeX[t] <= frame.x + frame.width);
  }
  const moves = schedule.moves;
  for (let i = 1; i < moves.length; i++) assert.ok(moves[i].start >= moves[i - 1].start);
});

test("limits: past the ceiling is a clear, catchable refusal", () => {
  const limits = { nodes: 100, edges: 200, characters: 1_000, layoutMs: 1_000 };
  assert.doesNotThrow(() => checkModel(100, 200, limits));
  assert.throws(() => checkModel(101, 10, limits), DiagramTooLargeError);
  assert.throws(() => checkModel(10, 201, limits), /101|201|connections/);
});

test("class members: Mermaid's own text rules", () => {
  assert.equal(mermaidMemberText("+int age"), "\\+int age");
  assert.equal(mermaidMemberText("+isMammal() bool"), "\\+isMammal() : bool");
  assert.equal(mermaidMemberText("-String name$"), "\\-String name");
  assert.equal(mermaidMemberText("+mate(Animal other)*"), "\\+mate(Animal other)");
  assert.equal(mermaidMemberText("#eat(food) void$"), "\\#eat(food) : void");
  assert.equal(mermaidMemberText("count"), "count");
});

test("class fast path: tables, annotations and relation markers", async () => {
  const wasm = await instantiateEngine(
    readFileSync(new URL("../src/services/diagrams/engine/diagram_layout.wasm", import.meta.url)),
  );
  const source = `classDiagram
  class Animal {
    <<interface>>
    +int age
    +isMammal() bool
  }
  Animal <|-- Duck
  Duck *-- Leg : has
  Duck ..> Pond`;
  const utf8 = new TextEncoder().encode(source);
  const model = modelFromClassParsed(wasm.parseClass(utf8), utf8);
  assert.ok(model);
  assert.deepEqual(model.nodes[0].table, {
    header: ["«interface»", "Animal"],
    sections: [[["+int age"]], [["+isMammal() : bool"]]],
  });
  assert.deepEqual(
    model.edges.map((e) => [e.markerStart, e.markerEnd, e.stroke]),
    [
      ["triangleOpen", "none", "normal"],
      ["diamond", "none", "normal"],
      ["none", "arrowOpen", "dotted"],
    ],
  );
  const generic = new TextEncoder().encode("classDiagram\n  class Box~T~");
  assert.equal(modelFromClassParsed(wasm.parseClass(generic), generic), null);
});
