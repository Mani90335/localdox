/**
 * How big a diagram this device will attempt.
 *
 * The engine draws 10,000 nodes at 60fps and lays out 50,000 in about a
 * second, but nothing is unbounded: a 500,000-node paste would still take a
 * machine down. So there is a ceiling, and it moves with the machine — the
 * browser's reported memory (Chrome's `deviceMemory`, 0.25–8 GB) scales it,
 * with a floor so a low-memory phone can still open a 15,000-node diagram.
 *
 * Past the ceiling the reader gets a clear message instead of a hung tab.
 */

export interface DiagramLimits {
  nodes: number;
  edges: number;
  /** Source size in characters, checked before parsing. */
  characters: number;
  /** Parse and layout together; past this the worker is stopped. */
  layoutMs: number;
}

const FULL_NODES = 60_000;
const FULL_EDGES = 120_000;
const MAX_CHARACTERS = 12_000_000;
const LAYOUT_MS = 30_000;

export function diagramLimits(): DiagramLimits {
  const memory =
    typeof navigator !== "undefined"
      ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8)
      : 8;
  const scale = Math.min(1, Math.max(0.25, memory / 8));
  return {
    nodes: Math.round(FULL_NODES * scale),
    edges: Math.round(FULL_EDGES * scale),
    characters: MAX_CHARACTERS,
    layoutMs: LAYOUT_MS,
  };
}

/** A diagram past this device's ceiling; the message is for the reader. */
export class DiagramTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagramTooLargeError";
  }
}

const count = (value: number) => value.toLocaleString("en-US");

export function checkSource(code: string, limits: DiagramLimits): void {
  if (code.length > limits.characters) {
    throw new DiagramTooLargeError(
      `This diagram is ${count(code.length)} characters of source, more than this device will lay out (${count(limits.characters)}).`,
    );
  }
}

export function checkModel(nodes: number, edges: number, limits: DiagramLimits): void {
  if (nodes > limits.nodes || edges > limits.edges) {
    throw new DiagramTooLargeError(
      `This diagram has ${count(nodes)} nodes and ${count(edges)} connections. This device draws up to ${count(limits.nodes)} nodes and ${count(limits.edges)} connections, so it is shown as source only.`,
    );
  }
}
