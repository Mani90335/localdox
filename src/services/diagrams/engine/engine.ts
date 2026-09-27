/**
 * Browser entry point for the GPU diagram engine.
 *
 *   Rust/WASM parser (or Mermaid's) ─▶ Rust/WASM layout ─▶ Scene ─▶ WebGL
 *   └──────────── in a worker, under size and time limits ─────────┘
 *
 * The WebAssembly module is fetched once per session and shared. Scenes are
 * cached by source, like `renderMermaid`'s SVGs, so switching between Raw and
 * Stepped or opening full screen reuses the layout instead of redoing it; a
 * scene holds no colours, so the theme can change without a relayout.
 */
import wasmUrl from "./diagram_layout.wasm?url";
import { largeDiagramMermaidConfig } from "../mermaid-config";
import { instantiateEngine, type DiagramWasm, type LayoutEngine } from "./layout";
import type { FlowModel } from "./flowchart";
import { fastModel } from "./fast-parse";
import { parseWithMermaid } from "./mermaid-parse";
import {
  checkModel,
  checkSource,
  diagramLimits,
  DiagramTooLargeError,
  type DiagramLimits,
} from "./limits";
import type { WorkerReply, WorkerRequest } from "./layout-worker";
import { buildScene, FONT_SIZE, type Scene } from "./scene";
import type { DiagramTheme } from "./renderer";

const FONT = `${FONT_SIZE}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
const MAX_SCENES = 3;

let engine: Promise<DiagramWasm> | null = null;
const scenes = new Map<string, Promise<Scene>>();

export function loadEngine(): Promise<DiagramWasm> {
  engine ??= fetch(wasmUrl)
    .then((response) => {
      if (!response.ok)
        throw new Error(`Could not load the diagram layout engine (${response.status}).`);
      return response.arrayBuffer();
    })
    .then(instantiateEngine);
  // A failed fetch must not poison the session; the next diagram retries.
  engine.catch(() => (engine = null));
  return engine;
}

export async function loadLayoutEngine(): Promise<LayoutEngine> {
  return (await loadEngine()).layout;
}

/**
 * The diagram as data: a Rust fast path when one exists for its type and
 * accepts the source (one pass, ~100× faster), otherwise Mermaid's own parser,
 * which also gives the proper error for a diagram that is actually malformed.
 */
export async function parseModel(code: string, wasm: DiagramWasm): Promise<FlowModel> {
  return fastModel(code, wasm) ?? (await parseWithMermaid(code, largeDiagramMermaidConfig(true)));
}

function textMeasure(): (text: string) => number {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return (text) => text.length * FONT_SIZE * 0.56;
  ctx.font = FONT;
  return (text) => ctx.measureText(text).width;
}

// -- the layout worker ---------------------------------------------------------

let worker: Worker | null = null;
let nextRequest = 1;
const waiting = new Map<
  number,
  { resolve: (reply: WorkerReply) => void; reject: (error: unknown) => void }
>();

function workerAvailable(): boolean {
  return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

/** Stop the worker and fail everything it was doing. */
function stopWorker(error: unknown): void {
  worker?.terminate();
  worker = null;
  for (const { reject } of waiting.values()) reject(error);
  waiting.clear();
}

function layoutWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("./layout-worker.ts", import.meta.url), { type: "module" });
  created.onmessage = (event: MessageEvent<WorkerReply>) => {
    const pending = waiting.get(event.data.id);
    if (!pending) return;
    waiting.delete(event.data.id);
    pending.resolve(event.data);
  };
  created.onerror = (event) => {
    event.preventDefault();
    stopWorker(new Error(event.message || "The diagram layout worker failed."));
  };
  worker = created;
  return created;
}

/**
 * One round trip to the worker, under a deadline. Past it the worker is
 * terminated — the only way to stop a computation already running — and a
 * fresh one is started for the next diagram.
 */
function ask(request: Omit<WorkerRequest, "id">, limits: DiagramLimits): Promise<WorkerReply> {
  const id = nextRequest++;
  return new Promise<WorkerReply>((resolve, reject) => {
    const timer = setTimeout(() => {
      stopWorker(
        new DiagramTooLargeError(
          `Laying out this diagram took longer than ${Math.round(limits.layoutMs / 1000)} seconds, so it was stopped to keep the page responsive.`,
        ),
      );
    }, limits.layoutMs);
    waiting.set(id, {
      resolve: (reply) => {
        clearTimeout(timer);
        resolve(reply);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    layoutWorker().postMessage({ ...request, id });
  });
}

async function sceneInWorker(code: string, limits: DiagramLimits): Promise<Scene> {
  let reply = await ask({ code, limits }, limits);
  if (reply.needsMermaid) {
    // Mermaid needs the DOM, so it parses here; the worker still lays out.
    const model = await parseWithMermaid(code, largeDiagramMermaidConfig(true));
    checkModel(model.nodes.length, model.edges.length, limits);
    reply = await ask({ model, limits }, limits);
  }
  if (reply.error !== undefined) {
    throw reply.tooLarge ? new DiagramTooLargeError(reply.error) : new Error(reply.error);
  }
  return reply.scene!;
}

async function sceneOnMainThread(code: string, limits: DiagramLimits): Promise<Scene> {
  const wasm = await loadEngine();
  const model = await parseModel(code, wasm);
  checkModel(model.nodes.length, model.edges.length, limits);
  return buildScene(model, textMeasure(), wasm.layout);
}

/**
 * Parse and lay out a diagram, reusing an identical earlier result.
 *
 * Work happens in the layout worker when the browser has one, under this
 * device's size limits and time budget (limits.ts); otherwise inline.
 */
export function loadScene(code: string): Promise<Scene> {
  const hit = scenes.get(code);
  if (hit) return hit;
  const pending = (async () => {
    const limits = diagramLimits();
    checkSource(code, limits);
    if (!workerAvailable()) return sceneOnMainThread(code, limits);
    try {
      return await sceneInWorker(code, limits);
    } catch (error) {
      // A limit, a timeout or a real parse error is the answer. Only a worker
      // that could not start at all (a strict CSP, say) falls back to inline.
      if (error instanceof DiagramTooLargeError || waiting.size > 0 || worker) throw error;
      return sceneOnMainThread(code, limits);
    }
  })();
  pending.catch(() => scenes.delete(code));
  scenes.set(code, pending);
  while (scenes.size > MAX_SCENES) {
    const oldest = scenes.keys().next();
    if (oldest.done) break;
    scenes.delete(oldest.value);
  }
  return pending;
}

/**
 * Colours from Mermaid's own resolved theme, so a large diagram looks like a
 * small one in the same document. The accent is the app's, as in explainer.css.
 */
export async function diagramTheme(dark: boolean): Promise<DiagramTheme> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    theme: dark ? "dark" : "default",
    ...largeDiagramMermaidConfig(true),
  });
  const vars = (mermaid.mermaidAPI.getConfig().themeVariables ?? {}) as Record<
    string,
    string | undefined
  >;
  const root = typeof document !== "undefined" ? getComputedStyle(document.documentElement) : null;
  const accent = root?.getPropertyValue("--primary").trim();
  const accentText = root?.getPropertyValue("--primary-foreground").trim();
  return {
    nodeFill: vars.mainBkg ?? (dark ? "#1f2020" : "#ECECFF"),
    nodeStroke: vars.nodeBorder ?? (dark ? "#81B1DB" : "#9370DB"),
    nodeText: vars.nodeTextColor ?? vars.textColor ?? (dark ? "#cccccc" : "#333333"),
    line: vars.lineColor ?? (dark ? "#cccccc" : "#333333"),
    labelText: vars.textColor ?? (dark ? "#cccccc" : "#333333"),
    labelBackground: vars.edgeLabelBackground ?? (dark ? "#585858" : "rgba(232,232,232,0.8)"),
    accent: accent || "#6366f1",
    accentText: accentText || "#ffffff",
  };
}
