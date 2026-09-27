/**
 * The layered layout engine, as seen from JavaScript.
 *
 * The algorithm lives in Rust (engine/layout) and is compiled to a small
 * WebAssembly module with no bindings generator: the graph goes in as one flat
 * array of 32-bit words and the layout comes out as another. That keeps the
 * boundary to three bulk copies however large the diagram is — calling across
 * it once per node would cost more than the layout itself.
 *
 * This module is environment-neutral. It is handed the module's bytes (the
 * browser fetches them, see load-layout.ts; the tests read them from disk), so
 * it never touches the DOM or a bundler-specific import.
 */

export type LayoutDirection = "TB" | "BT" | "LR" | "RL";

/** Outline used to decide where an edge meets its node. */
export type LayoutShape = "rect" | "ellipse" | "diamond";

export interface LayoutNode {
  width: number;
  height: number;
  shape?: LayoutShape;
}

export interface LayoutEdge {
  /** Indices into the node array. */
  source: number;
  target: number;
  /** A labelled edge gets a slot of this size midway along it. */
  labelWidth?: number;
  labelHeight?: number;
}

export interface LayoutInput {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  direction?: LayoutDirection;
  nodeSep?: number;
  rankSep?: number;
  edgeSep?: number;
  /**
   * Width / height to fold toward. A layout far off it — a big tree is one
   * enormous bottom rank — is wrapped into bands. Omit to keep it unfolded.
   */
  aspect?: number;
}

export interface LayoutResult {
  width: number;
  height: number;
  /** Node centres, interleaved x, y, in input order. */
  nodes: Float32Array;
  /** Edge `e`'s points are `points[2 * edgeOffsets[e] .. 2 * edgeOffsets[e + 1]]`. */
  edgeOffsets: Uint32Array;
  /** Interleaved x, y for every edge, source end first. */
  points: Float32Array;
  /** Label centres, interleaved; NaN for an edge without a label. */
  labels: Float32Array;
  /** Crossings the ordering could not remove. Diagnostic. */
  crossings: number;
}

interface LayoutExports {
  memory: WebAssembly.Memory;
  alloc_words(n: number): number;
  free_words(ptr: number, n: number): void;
  result_len(): number;
  layout(ptr: number, len: number): number;
  parse_flowchart(ptr: number, len: number): number;
  parse_er(ptr: number, len: number): number;
  parse_class(ptr: number, len: number): number;
}

const DIRECTION: Record<LayoutDirection, number> = { TB: 0, BT: 1, LR: 2, RL: 3 };
const SHAPE: Record<LayoutShape, number> = { rect: 0, ellipse: 1, diamond: 2 };

export type LayoutEngine = (input: LayoutInput) => LayoutResult;

/**
 * The flowchart fast-path parser in the same module (engine/layout/src/parser.rs).
 * Takes UTF-8 source, returns its encoded result; see `modelFromParsed`.
 */
export type FlowParser = (utf8: Uint8Array) => Uint32Array;

export interface DiagramWasm {
  layout: LayoutEngine;
  parse: FlowParser;
  /** The ER fast path (engine/layout/src/er.rs); see `modelFromErParsed`. */
  parseEr: FlowParser;
  /** The class-diagram fast path (engine/layout/src/class.rs). */
  parseClass: FlowParser;
}

export async function instantiateLayout(bytes: BufferSource): Promise<LayoutEngine> {
  return (await instantiateEngine(bytes)).layout;
}

export async function instantiateEngine(bytes: BufferSource): Promise<DiagramWasm> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports as unknown as LayoutExports;
  return {
    layout: createLayoutEngine(exports),
    parse: createFlowParser(exports, "parse_flowchart"),
    parseEr: createFlowParser(exports, "parse_er"),
    parseClass: createFlowParser(exports, "parse_class"),
  };
}

export function createFlowParser(
  wasm: LayoutExports,
  entry: "parse_flowchart" | "parse_er" | "parse_class" = "parse_flowchart",
): FlowParser {
  return (utf8) => {
    const words = Math.max(1, Math.ceil(utf8.length / 4));
    const inputPtr = wasm.alloc_words(words);
    new Uint8Array(wasm.memory.buffer, inputPtr, utf8.length).set(utf8);
    const outputPtr = wasm[entry](inputPtr, utf8.length);
    const outputLength = wasm.result_len();
    const out = new Uint32Array(outputLength);
    out.set(new Uint32Array(wasm.memory.buffer, outputPtr, outputLength));
    wasm.free_words(inputPtr, words);
    wasm.free_words(outputPtr, outputLength);
    return out;
  };
}

export function createLayoutEngine(wasm: LayoutExports): LayoutEngine {
  return (input) => {
    const n = input.nodes.length;
    const m = input.edges.length;
    const length = 8 + n * 3 + m * 4;
    // Written into a JS-side buffer first: the module's memory may grow (and
    // its ArrayBuffer detach) during `alloc_words`, so views on it are only
    // taken after every allocation has happened.
    const words = new Uint32Array(length);
    const floats = new Float32Array(words.buffer);
    words[0] = n;
    words[1] = m;
    words[2] = DIRECTION[input.direction ?? "TB"];
    floats[3] = input.aspect ?? 0;
    floats[4] = input.nodeSep ?? 50;
    floats[5] = input.rankSep ?? 50;
    floats[6] = input.edgeSep ?? 20;
    let cursor = 8;
    for (const node of input.nodes) {
      floats[cursor] = node.width;
      floats[cursor + 1] = node.height;
      words[cursor + 2] = SHAPE[node.shape ?? "rect"];
      cursor += 3;
    }
    for (const edge of input.edges) {
      words[cursor] = edge.source;
      words[cursor + 1] = edge.target;
      floats[cursor + 2] = edge.labelWidth ?? 0;
      floats[cursor + 3] = edge.labelHeight ?? 0;
      cursor += 4;
    }

    const inputPtr = wasm.alloc_words(length);
    new Uint32Array(wasm.memory.buffer, inputPtr, length).set(words);
    const outputPtr = wasm.layout(inputPtr, length);
    const outputLength = wasm.result_len();
    // Copied out whole: the result must outlive the module's next allocation.
    const out = new Uint32Array(outputLength);
    out.set(new Uint32Array(wasm.memory.buffer, outputPtr, outputLength));
    wasm.free_words(inputPtr, length);
    wasm.free_words(outputPtr, outputLength);

    const outFloats = new Float32Array(out.buffer);
    const totalPoints = out[0];
    let offset = 4;
    const nodes = outFloats.subarray(offset, offset + n * 2);
    offset += n * 2;
    const edgeOffsets = out.subarray(offset, offset + m + 1);
    offset += m + 1;
    const labels = outFloats.subarray(offset, offset + m * 2);
    offset += m * 2;
    const points = outFloats.subarray(offset, offset + totalPoints * 2);
    return {
      width: outFloats[1],
      height: outFloats[2],
      nodes,
      edgeOffsets,
      points,
      labels,
      crossings: out[3],
    };
  };
}
