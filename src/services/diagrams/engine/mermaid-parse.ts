/**
 * Mermaid's own parser, for what the Rust fast paths decline.
 *
 * Kept apart from the pure model code so the layout worker, which never needs
 * Mermaid (and could not run it: it wants a DOM), never loads it.
 */
import {
  kindOfDiagramType,
  modelFromDb,
  modelFromLayoutData,
  type FlowDbLike,
  type FlowModel,
  type LayoutData,
} from "./flowchart";

/**
 * Run Mermaid's parser and return the model.
 *
 * Mermaid's edge ceiling is raised here: the configured one protects the SVG
 * renderer, which this path never calls.
 */
export async function parseWithMermaid(
  code: string,
  baseConfig: Record<string, unknown>,
): Promise<FlowModel> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, ...baseConfig, maxEdges: 500_000 });
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(code);
  const kind = kindOfDiagramType(diagram.type);
  if (!kind) throw new Error(`The large-diagram engine does not draw ${diagram.type} diagrams.`);
  if (kind === "flowchart") return modelFromDb(diagram.db as unknown as FlowDbLike);
  const db = diagram.db as unknown as { getData(): LayoutData; getDirection?(): string };
  // `getData()` reports TB for an ER diagram even after `direction LR`, while
  // Mermaid's own render honours it; the database's direction is the truth.
  const data = db.getData();
  return modelFromLayoutData({ ...data, direction: db.getDirection?.() ?? data.direction }, kind);
}

/** Flowcharts only; kept for the parser comparison in bench/. */
export async function parseFlowchart(
  code: string,
  baseConfig: Record<string, unknown>,
): Promise<FlowModel> {
  return parseWithMermaid(code, baseConfig);
}
