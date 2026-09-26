/**
 * Where does the time go when a big diagram is explained?
 *
 * Runs one diagram size per call and times every stage of today's pipeline
 * separately, so the answer to "would Rust help?" is a measurement rather than
 * a guess:
 *
 *   parse ─▶ layout ─▶ SVG string ─▶ DOM insert ─▶ read graph ─▶ plan ─▶ frames
 *
 * `dagreLayout` runs Mermaid's own layout engine on the bare graph with fixed
 * node sizes, which isolates the algorithm from label measurement and SVG
 * generation — the part a WASM layout would actually replace.
 *
 * Driven from the console (or DevTools automation):
 *   await runBench(2000)                 // full pipeline
 *   await runBench(10000, { render: false })  // skip Mermaid's full render
 */
import mermaid from "mermaid";
import { graphlib } from "dagre-d3-es";
import { layout as dagreLayout } from "dagre-d3-es/src/dagre/index.js";
import { largeDiagramMermaidConfig } from "@/services/diagrams/mermaid-config";
import { readGraph } from "@/services/diagrams/explainer/graph";
import { planExplainer } from "@/services/diagrams/explainer/plan";
import { ExplainerPlayer } from "@/services/diagrams/explainer/player";
import { homeFrame } from "@/services/diagrams/explainer/camera";
import "@/services/diagrams/explainer.css";
import { syntheticEr, syntheticFlowchart } from "./generate";

type Timings = Record<string, number | string>;

const status = document.getElementById("status")!;
const stage = document.getElementById("stage")!;

function say(text: string) {
  status.textContent = text;
}

async function time<T>(label: string, out: Timings, work: () => T | Promise<T>): Promise<T> {
  say(`${label}…`);
  // Yield so the status paints and a previous stage's GC isn't billed here.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const start = performance.now();
  const result = await work();
  out[label] = Math.round(performance.now() - start);
  return result;
}

/** Frame intervals over `ms`, while `onFrame` runs inside each rAF. */
function measureFrames(ms: number, onFrame?: (t: number) => void) {
  return new Promise<{ fps: number; meanMs: number; p95Ms: number; maxMs: number }>((resolve) => {
    const intervals: number[] = [];
    let first = 0;
    let last = 0;
    const tick = (now: number) => {
      if (first === 0) first = now;
      else intervals.push(now - last);
      last = now;
      onFrame?.(now - first);
      if (now - first < ms) requestAnimationFrame(tick);
      else {
        intervals.sort((a, b) => a - b);
        const mean =
          intervals.reduce((sum, value) => sum + value, 0) / Math.max(1, intervals.length);
        resolve({
          fps: Math.round(1000 / mean),
          meanMs: Math.round(mean * 10) / 10,
          p95Ms: Math.round(intervals[Math.floor(intervals.length * 0.95)] ?? 0),
          maxMs: Math.round(intervals[intervals.length - 1] ?? 0),
        });
      }
    };
    requestAnimationFrame(tick);
  });
}

async function runBench(nodes: number, options: { render?: boolean; frames?: boolean } = {}) {
  const { render = true, frames = true } = options;
  const out: Timings = { nodes };
  const code = syntheticFlowchart(nodes);
  out.sourceKB = Math.round(code.length / 1024);
  stage.innerHTML = "";

  mermaid.initialize({ startOnLoad: false, theme: "default", ...largeDiagramMermaidConfig(false) });

  await time("parse", out, () => mermaid.parse(code));
  const diagram = await time("parseToDb", out, () => mermaid.mermaidAPI.getDiagramFromText(code));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = diagram.db as any;
  const vertices: Map<string, unknown> = db.getVertices();
  const flowEdges: { start: string; end: string }[] = db.getEdges();
  out.edges = flowEdges.length;

  await time("dagreLayout", out, () => {
    const graph = new graphlib.Graph({ multigraph: true, compound: false });
    graph.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 50 });
    graph.setDefaultEdgeLabel(() => ({}));
    for (const id of vertices.keys()) graph.setNode(id, { width: 120, height: 40 });
    flowEdges.forEach((edge, index) => graph.setEdge(edge.start, edge.end, {}, `e${index}`));
    dagreLayout(graph);
  });

  if (!render) return out;

  const { svg } = await time("mermaidRender", out, () =>
    mermaid.render(`bench-${Math.random().toString(36).slice(2, 8)}`, code),
  );
  out.svgKB = Math.round(svg.length / 1024);

  const svgEl = await time("domInsert", out, () => {
    stage.innerHTML = svg;
    const el = stage.querySelector("svg") as SVGSVGElement;
    el.setAttribute("preserveAspectRatio", "xMidYMid meet");
    el.style.maxWidth = "none";
    // Force style + layout now, so the cost lands in this stage.
    el.getBoundingClientRect();
    return el;
  });
  out.elements = svgEl.getElementsByTagName("*").length;

  const graph = await time("readGraph", out, () => readGraph(svgEl));
  if (!graph) {
    out.error = "readGraph returned null";
    return out;
  }
  const plan = await time("plan", out, () => planExplainer(graph));
  out.steps = plan.steps.length;

  if (!frames) return out;

  // Camera alone: the same viewBox writes the explainer's viewport performs.
  const home = homeFrame(graph);
  const close = {
    x: home.x + home.width * 0.4,
    y: home.y + home.height * 0.4,
    width: home.width * 0.2,
    height: home.height * 0.2,
  };
  say("camera frames…");
  const camera = await measureFrames(2500, (t) => {
    const k = (Math.sin(t / 400) + 1) / 2;
    const f = {
      x: home.x + (close.x - home.x) * k,
      y: home.y + (close.y - home.y) * k,
      width: home.width + (close.width - home.width) * k,
      height: home.height + (close.height - home.height) * k,
    };
    svgEl.setAttribute("viewBox", `${f.x} ${f.y} ${f.width} ${f.height}`);
  });
  Object.assign(out, {
    cameraFps: camera.fps,
    cameraP95Ms: camera.p95Ms,
    cameraMaxMs: camera.maxMs,
  });

  // The real player: strokes, reveals, spotlight and camera together.
  const player = await time(
    "playerInit",
    out,
    () =>
      new ExplainerPlayer(graph, plan, () => {}, {
        camera: true,
        onFrame: (f) => svgEl.setAttribute("viewBox", `${f.x} ${f.y} ${f.width} ${f.height}`),
      }),
  );
  out.durationMin = Math.round(player.duration / 600) / 100;
  // Skip the opening so the measurement includes settled, spotlit history.
  player.seek(player.duration * 0.3);
  player.play();
  say("player frames…");
  const playing = await measureFrames(3000);
  player.pause();
  Object.assign(out, {
    playerFps: playing.fps,
    playerP95Ms: playing.p95Ms,
    playerMaxMs: playing.maxMs,
  });
  player.destroy();

  say(`done ${nodes}`);
  return out;
}

/**
 * The same diagram through the GPU engine: Mermaid's parser, the Rust/WASM
 * layout, the WebGL renderer, and the stepped player driving it.
 *
 *   await runGpuBench(10000)
 *   await runGpuBench(10000, { keep: true })   // leave it on screen to inspect
 */
async function runGpuBench(
  nodes: number,
  options: { keep?: boolean; zoom?: number; kind?: "flowchart" | "er" } = {},
) {
  const out: Timings = { nodes, engine: "gpu", kind: options.kind ?? "flowchart" };
  const code = options.kind === "er" ? syntheticEr(nodes) : syntheticFlowchart(nodes);
  stage.innerHTML = "";
  const { loadLayoutEngine, loadScene, diagramTheme } = await import("@/services/diagrams/engine/engine");
  const { DiagramRenderer } = await import("@/services/diagrams/engine/renderer");
  const { GpuPlayer } = await import("@/services/diagrams/engine/gpu-player");
  const { SvgViewport } = await import("@/lib/viewport");

  await time("wasmLoad", out, () => loadLayoutEngine());
  const scene = await time("parse+layout+scene", out, () =>
    loadScene(`${code}\n%% ${Math.random()}`),
  );
  out.layoutMs = Math.round(scene.layoutMs);
  out.edges = scene.edgeCount;
  out.size = `${Math.round(scene.width)}×${Math.round(scene.height)}`;
  const theme = await diagramTheme(false);

  const renderer = await time("rendererInit", out, () => {
    const r = new DiagramRenderer(stage, scene, theme, { lineArt: false });
    r.showAll();
    r.render();
    return r;
  });
  const viewport = new SvgViewport(stage, renderer.target, { maxZoom: 5000 });
  viewport.setBase(homeFrame(scene.graph));

  // Camera sweep from the whole diagram into a close-up and back.
  const home = homeFrame(scene.graph);
  const zoom = options.zoom ?? 40;
  const close = {
    x: home.x + home.width * 0.45,
    y: home.y + home.height * 0.3,
    width: home.width / zoom,
    height: home.height / zoom,
  };
  say("gpu camera frames…");
  const camera = await measureFrames(2500, (t) => {
    const k = (Math.sin(t / 400) + 1) / 2;
    viewport.follow({
      x: home.x + (close.x - home.x) * k,
      y: home.y + (close.y - home.y) * k,
      width: home.width + (close.width - home.width) * k,
      height: home.height + (close.height - home.height) * k,
    });
    renderer.render();
  });
  Object.assign(out, {
    cameraFps: camera.fps,
    cameraP95Ms: camera.p95Ms,
    cameraMaxMs: camera.maxMs,
  });

  const plan = await time("plan", out, () => planExplainer(scene.graph));
  const player = await time(
    "playerInit",
    out,
    () =>
      new GpuPlayer(scene, plan, renderer, () => {}, {
        camera: true,
        onFrame: (f) => viewport.follow(f),
        readableSpan: 1200,
        numbers: true,
      }),
  );
  out.mode = player.mode;
  out.durationMin = Math.round(player.duration / 600) / 100;
  player.seek(player.duration * 0.3);
  player.play();
  say("gpu player frames…");
  const playing = await measureFrames(3000);
  player.pause();
  Object.assign(out, {
    playerFps: playing.fps,
    playerP95Ms: playing.p95Ms,
    playerMaxMs: playing.maxMs,
  });

  if (!options.keep) {
    player.destroy();
    renderer.destroy();
    viewport.destroy();
  } else {
    Object.assign(window, { gpu: { scene, renderer, player, viewport } });
  }
  say(`done gpu ${nodes}`);
  return out;
}

/**
 * The fast-path parser against Mermaid's, on the corpus: identical models for
 * everything it accepts, a decline for everything else. Also times both.
 */
async function checkParser() {
  const { accepted, declined } = await import("./parser-corpus");
  const { loadEngine } = await import("@/services/diagrams/engine/engine");
  const { parseFlowchart } = await import("@/services/diagrams/engine/mermaid-parse");
  const { largeDiagramMermaidConfig: config } = await import("@/services/diagrams/mermaid-config");
  const wasm = await loadEngine();
  const { fastModel } = await import("@/services/diagrams/engine/fast-parse");
  const fast = (code: string) => fastModel(code, wasm);
  const report: Record<string, unknown> = {};
  for (const [name, code] of Object.entries(accepted)) {
    const ours = fast(code);
    const theirs = await parseFlowchart(code, config(true));
    if (!ours) {
      report[name] = "DECLINED (expected to accept)";
      continue;
    }
    const a = JSON.stringify(ours);
    const b = JSON.stringify(theirs);
    if (a === b) {
      report[name] = "match";
      continue;
    }
    // Point at the first difference, not the whole model.
    const diff: string[] = [];
    if (ours.direction !== theirs.direction)
      diff.push(`direction ${ours.direction} vs ${theirs.direction}`);
    if (ours.nodes.length !== theirs.nodes.length)
      diff.push(`nodes ${ours.nodes.length} vs ${theirs.nodes.length}`);
    if (ours.edges.length !== theirs.edges.length)
      diff.push(`edges ${ours.edges.length} vs ${theirs.edges.length}`);
    ours.nodes.forEach((node, i) => {
      if (diff.length < 6 && JSON.stringify(node) !== JSON.stringify(theirs.nodes[i]))
        diff.push(`node ${i}: ${JSON.stringify(node)} vs ${JSON.stringify(theirs.nodes[i])}`);
    });
    ours.edges.forEach((edge, i) => {
      if (diff.length < 6 && JSON.stringify(edge) !== JSON.stringify(theirs.edges[i]))
        diff.push(`edge ${i}: ${JSON.stringify(edge)} vs ${JSON.stringify(theirs.edges[i])}`);
    });
    report[name] = diff;
  }
  for (const [name, code] of Object.entries(declined)) {
    report[`declines:${name}`] = fast(code) === null ? "ok" : "ACCEPTED (expected to decline)";
  }

  const big = syntheticFlowchart(10_000);
  let t0 = performance.now();
  fast(big);
  const fastMs = performance.now() - t0;
  t0 = performance.now();
  await parseFlowchart(big, config(true));
  const mermaidMs = performance.now() - t0;
  report.timing10k = { fastMs: Math.round(fastMs), mermaidMs: Math.round(mermaidMs) };
  return report;
}

declare global {
  interface Window {
    runBench: typeof runBench;
    runGpuBench: typeof runGpuBench;
    checkParser: typeof checkParser;
    benchResults: Timings[];
    benchError?: string;
  }
}
window.runBench = runBench;
window.runGpuBench = runGpuBench;
window.checkParser = checkParser;
window.benchResults = [];
say("ready");
