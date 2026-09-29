/**
 * Diagrams too costly to lay out without asking.
 *
 * Flowcharts, ER, class and state diagrams have a way out when they are large:
 * the GPU engine lays them out in a worker under a time limit (engine/gate.ts).
 * Every other kind is laid out by Mermaid on the main thread, and a
 * performance-mode image (mermaid-performance.ts) only changes what is shown
 * afterwards. The stall has already happened by then.
 *
 * Most of those kinds scale linearly and stay under about 1.5 s even at 1,500
 * lines (measured in Chromium, 2026-09-28: sequence 2,000 messages 540 ms,
 * gantt 1,000 tasks 215 ms, kanban 1,500 cards 1.4 s). Mindmaps don't. Their
 * force layout grows much faster than the node count: 200 nodes took 1.0 s,
 * 400 took 2.8 s, 1,000 took 19 s and then threw, and 2,000 did not finish in a
 * minute. The source scan counts none of that, because a mindmap has no edge
 * lines.
 *
 * So these are held back: shown as source, with a button to render anyway.
 * The check is a line count on text the page already has, before Mermaid is
 * imported.
 */
import { diagramKind, headerLine } from "./engine/gate.ts";

/** Mindmap nodes past which layout is expected to take seconds. */
export const MINDMAP_NODE_LIMIT = 200;
/** Any other kind Mermaid lays out on the main thread. */
export const MAIN_THREAD_LINE_LIMIT = 3_000;
export const MAIN_THREAD_CHARACTER_LIMIT = 300_000;

export interface DiagramPreflight {
  /** What was counted, for the reader: "nodes" or "lines". */
  unit: "nodes" | "lines" | "characters";
  count: number;
  limit: number;
  /** One sentence the source view shows. */
  reason: string;
}

/** A render refused by the preflight. Exports catch it and keep the source. */
export class DiagramHeldError extends Error {
  readonly preflight: DiagramPreflight;
  constructor(preflight: DiagramPreflight) {
    super(preflight.reason);
    this.name = "DiagramHeldError";
    this.preflight = preflight;
  }
}

const count = (value: number) => value.toLocaleString("en-US");

/**
 * Content lines: not blank, not a `%%` comment. For a mindmap each one is a
 * node (the header line is counted too, which errs toward holding).
 */
function contentLines(source: string): number {
  let lines = 0;
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("%%")) lines++;
  }
  return lines;
}

/**
 * Null when the diagram may be rendered straight away, otherwise why not.
 * Kinds the GPU engine draws are never held: that path has its own limits.
 */
export function preflightDiagram(source: string): DiagramPreflight | null {
  if (diagramKind(source)) return null;
  if (source.length > MAIN_THREAD_CHARACTER_LIMIT) {
    return {
      unit: "characters",
      count: source.length,
      limit: MAIN_THREAD_CHARACTER_LIMIT,
      reason: `This diagram is ${count(source.length)} characters of source. Drawing it would freeze the page for several seconds.`,
    };
  }
  const lines = contentLines(source);
  if (headerLine(source)?.split(/\s/)[0] === "mindmap") {
    if (lines > MINDMAP_NODE_LIMIT) {
      return {
        unit: "nodes",
        count: lines,
        limit: MINDMAP_NODE_LIMIT,
        reason: `This mindmap has more than ${count(MINDMAP_NODE_LIMIT)} nodes. Laying it out would freeze the page for several seconds, or much longer.`,
      };
    }
    return null;
  }
  if (lines > MAIN_THREAD_LINE_LIMIT) {
    return {
      unit: "lines",
      count: lines,
      limit: MAIN_THREAD_LINE_LIMIT,
      reason: `This diagram has more than ${count(MAIN_THREAD_LINE_LIMIT)} lines. Drawing it would freeze the page for several seconds.`,
    };
  }
  return null;
}
