/**
 * The Rust fast-path parsers, by diagram kind. Null means "ask Mermaid": no
 * fast path for this kind, or the source uses syntax the fast path declines.
 * Shared by the main thread and the layout worker.
 */
import type { DiagramWasm } from "./layout";
import {
  modelFromClassParsed,
  modelFromErParsed,
  modelFromParsed,
  type FlowModel,
} from "./flowchart";
import { diagramKind } from "./gate";

export function fastModel(code: string, wasm: DiagramWasm): FlowModel | null {
  const kind = diagramKind(code);
  if (kind === "state" || kind === null) return null;
  const utf8 = new TextEncoder().encode(code);
  if (kind === "flowchart") return modelFromParsed(wasm.parse(utf8), utf8);
  if (kind === "er") return modelFromErParsed(wasm.parseEr(utf8), utf8);
  return modelFromClassParsed(wasm.parseClass(utf8), utf8);
}
