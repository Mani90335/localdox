/**
 * Parse and lay out a large diagram off the main thread.
 *
 * At 50,000 nodes the Rust parse and layout take about a second — fine as a
 * number, not fine as a second the page cannot scroll or respond to a click.
 * Here that work happens in a worker, and the finished scene comes back with
 * its typed arrays transferred, not copied. The main thread keeps a deadline
 * on every request and terminates the worker if a pathological diagram runs
 * past it, so no input can hang the tab.
 *
 * The worker never touches Mermaid (which needs a DOM): when the Rust fast
 * path declines a source, it says so, the main thread runs Mermaid's parser,
 * and sends the parsed model back here for layout.
 */
import wasmUrl from "./diagram_layout.wasm?url";
import { instantiateEngine, type DiagramWasm } from "./layout";
import type { FlowModel } from "./flowchart";
import { fastModel } from "./fast-parse";
import { buildScene, FONT_SIZE, type Scene } from "./scene";
import { checkModel, DiagramTooLargeError, type DiagramLimits } from "./limits";

export interface WorkerRequest {
  id: number;
  code?: string;
  model?: FlowModel;
  limits: DiagramLimits;
}

export interface WorkerReply {
  id: number;
  scene?: Scene;
  /** The fast path declined; send the model from Mermaid's parser instead. */
  needsMermaid?: boolean;
  error?: string;
  tooLarge?: boolean;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const FONT = `${FONT_SIZE}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;

let engine: Promise<DiagramWasm> | null = null;
function load(): Promise<DiagramWasm> {
  engine ??= fetch(wasmUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load the diagram engine (${response.status}).`);
      return response.arrayBuffer();
    })
    .then(instantiateEngine);
  engine.catch(() => (engine = null));
  return engine;
}

function measurer(): (text: string) => number {
  const ctx =
    typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1).getContext("2d") : null;
  if (!ctx) return (text) => text.length * FONT_SIZE * 0.56;
  ctx.font = FONT;
  return (text) => ctx.measureText(text).width;
}

/** Every typed array's buffer, once each, to hand over without copying. */
function transferables(scene: Scene): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  for (const value of Object.values(scene)) {
    if (ArrayBuffer.isView(value)) buffers.add(value.buffer as ArrayBuffer);
  }
  return [...buffers];
}

scope.onmessage = async (event) => {
  const { id, code, model, limits } = event.data;
  try {
    const wasm = await load();
    const parsed = model ?? (code !== undefined ? fastModel(code, wasm) : null);
    if (!parsed) {
      scope.postMessage({ id, needsMermaid: true });
      return;
    }
    checkModel(parsed.nodes.length, parsed.edges.length, limits);
    const scene = buildScene(parsed, measurer(), wasm.layout);
    scope.postMessage({ id, scene }, transferables(scene));
  } catch (error) {
    scope.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
      tooLarge: error instanceof DiagramTooLargeError,
    });
  }
};
