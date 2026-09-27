/**
 * Which diagrams the GPU engine draws instead of Mermaid's SVG.
 *
 * Flowcharts, ER, class and state diagrams, and only large ones. Below the threshold Mermaid's own SVG
 * is the better picture: exact shapes, theming, semantic colouring, subgraph
 * boxes — and at a few hundred nodes it lays out in well under a second and
 * animates at 60fps. Past it, the same pipeline measured 1.5s at 1,000 nodes,
 * 40s at 5,000 and never finishes at 10,000, with playback falling to 2fps.
 * That is the range where a WebAssembly layout and a WebGL renderer trade a
 * little fidelity for a diagram that appears at all.
 *
 * This runs on every source change, so it only scans text and never imports
 * Mermaid or the engine.
 */
import {
  scanDiagramSource,
  shouldUseDiagramPerformanceMode,
} from "../mermaid-performance.ts";
import type { DiagramKind } from "./flowchart.ts";

/** Edge lines at which a flowchart moves to the GPU engine. */
export const GPU_EDGE_THRESHOLD = 600;
/** Node-ish lines, for flowcharts that declare many nodes and few edges. */
export const GPU_LINE_THRESHOLD = 900;

const FLOWCHART_HEADER = /^(?:flowchart|graph)(?:\s+(TB|TD|BT|LR|RL))?\s*;?\s*$/i;

/** Structure thresholds for ER, class and state diagrams, where rows add up. */
export const GPU_ENTITY_THRESHOLD = 60;
export const GPU_ATTRIBUTE_THRESHOLD = 700;
export const GPU_RELATION_THRESHOLD = 300;

/** The first meaningful line: skips front matter, blank lines and comments. */
function headerLine(source: string): string | null {
  let inFrontMatter = false;
  let start = 0;
  for (let lines = 0; lines < 200 && start <= source.length; lines++) {
    const end = source.indexOf("\n", start);
    const line = source.slice(start, end < 0 ? source.length : end).trim();
    start = end < 0 ? source.length + 1 : end + 1;
    if (line === "---") {
      inFrontMatter = !inFrontMatter;
      continue;
    }
    if (inFrontMatter || !line || line.startsWith("%%")) continue;
    return line;
  }
  return null;
}

/** The flowchart header's direction, or null when this isn't a flowchart. */
export function flowchartDirection(source: string): string | null {
  const line = headerLine(source);
  const match = line ? FLOWCHART_HEADER.exec(line) : null;
  return match ? (match[1] ?? "TB").toUpperCase() : null;
}

/** Which kind of diagram the engine can draw this is, or null. */
export function diagramKind(source: string): DiagramKind | null {
  const line = headerLine(source);
  if (!line) return null;
  if (FLOWCHART_HEADER.test(line)) return "flowchart";
  const word = line.split(/\s/)[0];
  if (word === "erDiagram") return "er";
  if (word === "classDiagram" || word === "classDiagram-v2") return "class";
  if (word === "stateDiagram" || word === "stateDiagram-v2") return "state";
  return null;
}

export function shouldUseGpuEngine(source: string): boolean {
  const kind = diagramKind(source);
  if (!kind) return false;
  if (shouldUseDiagramPerformanceMode(source)) return true;
  const scan = scanDiagramSource(source);
  if (kind === "flowchart") {
    return scan.edges >= GPU_EDGE_THRESHOLD || scan.lines >= GPU_LINE_THRESHOLD;
  }
  return (
    scan.edges >= GPU_RELATION_THRESHOLD ||
    scan.entities >= GPU_ENTITY_THRESHOLD ||
    scan.attributes >= GPU_ATTRIBUTE_THRESHOLD ||
    scan.lines >= GPU_LINE_THRESHOLD
  );
}
