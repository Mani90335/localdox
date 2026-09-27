/**
 * Turns a graph into an order to explain it in.
 *
 * The rule the whole planner serves: you may not draw an edge until its source
 * is on screen, and a node appears at the moment an edge arrives at it. That is
 * what makes the result read as an explanation instead of a slideshow — the
 * viewer's attention is led somewhere rather than sprayed across the canvas.
 *
 * Traversal is breadth-first from the graph's natural entry points, which is
 * how someone actually narrates an architecture: name the thing at the front
 * door, follow it in one layer at a time. Depth-first would chase one branch to
 * the leaves and then teleport back to the top, which is exactly the jump-cut
 * we're trying to avoid.
 *
 * This module is pure. It touches no DOM and no clock, so the ordering can be
 * reasoned about (and tested) on its own.
 */

import type { GraphShape } from "./graph";

export type ExplainerStep =
  | { type: "reveal-node"; nodeId: string; label: string }
  | {
      type: "draw-edge";
      edgeId: string;
      from: string;
      to: string;
      length: number;
      /** The arrow's step number as shown on it: "3", or the author's "1.2". */
      number?: string;
    }
  /** Draws an edge whose target is already on screen (a join, or a cycle's
   *  back-edge). Kept distinct so the player can skip the arrival reveal and
   *  pulse the existing node instead. */
  | {
      type: "draw-edge-revisit";
      edgeId: string;
      from: string;
      to: string;
      length: number;
      number?: string;
    };

export interface PlanOptions {
  /**
   * Play arrows the author numbered (`A -->|1| B`, `A -->|2. Pay| C`) in that
   * order before anything else. On by default: a number on an arrow is the
   * author saying "this happens first".
   */
  followNumbers?: boolean;
}

/**
 * The step number an arrow's label declares, as a sortable tuple, or null.
 *
 * Accepted: `1`, `1.`, `1)`, `(1)`, `1:`, `1 -`, `#1`, `Step 1`, `1.2`, each
 * optionally followed by text (`1. Login`, `Step 2 fetch`, `1.2 retry`). A bare
 * number followed by a word is not a step (`10 ms timeout` is a duration), so
 * a plain `3 retries` is left alone unless written `3. retries` or `#3 retries`.
 */
export function stepNumber(text: string | undefined): number[] | null {
  if (!text) return null;
  const match = /^\s*(step\s*|#|\()?\s*(\d+(?:\.\d+)*)(.*)$/is.exec(text);
  if (!match) return null;
  const [, prefix, digits, rest] = match;
  const terminated =
    rest.trim() === "" ||
    /^\s*[.):\-\u2013]/.test(rest) ||
    ((Boolean(prefix) || digits.includes(".")) && /^\s/.test(rest));
  if (!terminated) return null;
  return digits.split(".").map(Number);
}

function compareNumbers(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? -1) - (b[i] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

export interface ExplainerPlan {
  steps: ExplainerStep[];
  /** Element ids of everything the plan will ever show, for the initial hide. */
  nodeIds: string[];
  edgeIds: string[];
}

/**
 * Pick the nodes to start from.
 *
 * Sources (no incoming edges) are the honest entry points, and reading order
 * breaks ties so the choice is deterministic rather than hash-ordered. A graph
 * that is all cycle has no source at all; there we fall back to the node with
 * the greatest out-degree, which is the closest thing to a hub, and finally to
 * document order so we always start somewhere.
 */
function entryPoints(
  graph: GraphShape,
  incoming: Map<string, number>,
  outgoing: Map<string, string[]>,
): string[] {
  const ordered = [...graph.nodes.values()].sort(byReadingOrder);
  const sources = ordered.filter((node) => (incoming.get(node.id) ?? 0) === 0);
  if (sources.length > 0) return sources.map((node) => node.id);

  const hub = ordered.reduce((best, node) => {
    const degree = outgoing.get(node.id)?.length ?? 0;
    const bestDegree = outgoing.get(best.id)?.length ?? 0;
    return degree > bestDegree ? node : best;
  }, ordered[0]);
  return hub ? [hub.id] : [];
}

/**
 * Top-to-bottom, then left-to-right, with a tolerance band on the row.
 *
 * Comparing raw y would treat two nodes on the same visual row as ordered when
 * the layout engine put them a pixel apart; the band keeps a row a row for both
 * `flowchart TD` and `flowchart LR`.
 */
const ROW_TOLERANCE = 24;
function byReadingOrder(a: { x: number; y: number }, b: { x: number; y: number }): number {
  if (Math.abs(a.y - b.y) > ROW_TOLERANCE) return a.y - b.y;
  return a.x - b.x;
}

/**
 * Build the step list.
 *
 * Cycles and joins are handled by one invariant rather than a special case for
 * each: a node is revealed at most once, and an edge is drawn at most once. An
 * edge whose target is already revealed becomes a `draw-edge-revisit`, so a
 * loop closes visibly — you see the arrow come back around — without the
 * traversal ever re-entering the node and running forever.
 *
 * Disconnected components fall out of the same loop: when the queue drains and
 * unvisited nodes remain, the next unvisited entry point seeds a fresh walk, so
 * components play one after another instead of interleaving.
 */
/**
 * A sequence diagram is a timeline, not a graph to traverse.
 *
 * The participants are the stage — a message arriving at a lifeline nobody has
 * introduced reads as a message to nowhere — so they are all revealed first,
 * and then the messages play in the order Mermaid emitted them, which is the
 * order they happen. Running BFS over this instead would reorder a protocol,
 * which is the one thing a sequence diagram must not do.
 */
function planSequence(graph: GraphShape): ExplainerPlan {
  const steps: ExplainerStep[] = [];
  const revealed = new Set<string>();
  for (const node of graph.nodes.values()) {
    revealed.add(node.id);
    steps.push({ type: "reveal-node", nodeId: node.id, label: node.label });
  }
  for (const edge of graph.edges) {
    steps.push({
      // Every participant is already on screen, so each message is a revisit:
      // it draws the arrow and pulses the recipient rather than revealing it.
      type: "draw-edge-revisit",
      edgeId: edge.id,
      from: edge.source,
      to: edge.target,
      length: edge.length,
    });
  }
  return {
    steps,
    nodeIds: [...graph.nodes.keys()],
    edgeIds: graph.edges.map((edge) => edge.id),
  };
}

/**
 * Past this many steps, a step-through has stopped being an explanation.
 *
 * Each step is a beat the reader is meant to watch; at a few thousand the run
 * is over an hour long and nobody is watching it. The ceiling exists as much
 * for that reason as for the cost of scheduling the steps.
 */
export const MAX_EXPLAINER_STEPS = 4_000;

/** Whether this graph is small enough to be worth stepping through at all. */
export function canExplain(graph: GraphShape): boolean {
  return graph.nodes.size + graph.edges.length <= MAX_EXPLAINER_STEPS;
}

export function planExplainer(graph: GraphShape, options: PlanOptions = {}): ExplainerPlan {
  if (graph.sequence) {
    return planSequence(graph);
  }
  const followNumbers = options.followNumbers ?? true;

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  const edgesById = new Map<string, (typeof graph.edges)[number]>();

  for (const node of graph.nodes.keys()) {
    outgoing.set(node, []);
    incoming.set(node, 0);
  }
  for (const edge of graph.edges) {
    edgesById.set(edge.id, edge);
    outgoing.get(edge.source)?.push(edge.id);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  // Fan-out follows the same reading order as everything else, so a branch
  // resolves top-to-bottom (TD) or left-to-right (LR) rather than in whatever
  // order Mermaid happened to emit the paths.
  for (const [nodeId, edgeIds] of outgoing) {
    edgeIds.sort((left, right) => {
      const a = graph.nodes.get(edgesById.get(left)!.target);
      const b = graph.nodes.get(edgesById.get(right)!.target);
      if (!a || !b) return 0;
      return byReadingOrder(a, b);
    });
    outgoing.set(nodeId, edgeIds);
  }

  const steps: ExplainerStep[] = [];
  const revealed = new Set<string>();
  const drawn = new Set<string>();

  const reveal = (nodeId: string) => {
    if (revealed.has(nodeId)) return;
    revealed.add(nodeId);
    steps.push({
      type: "reveal-node",
      nodeId,
      label: graph.nodes.get(nodeId)?.label ?? "",
    });
  };

  /** Draw one edge; returns whether it brought a new node on screen. */
  const draw = (edgeId: string, number?: string): boolean => {
    const edge = edgesById.get(edgeId)!;
    drawn.add(edgeId);
    const seen = revealed.has(edge.target);
    steps.push({
      type: seen ? "draw-edge-revisit" : "draw-edge",
      edgeId,
      from: edge.source,
      to: edge.target,
      length: edge.length,
      ...(number ? { number } : {}),
    });
    // The reveal is emitted immediately after its edge; the player is what
    // holds it until the stroke actually lands.
    if (!seen) reveal(edge.target);
    return !seen;
  };

  const walk = (seed: string) => {
    reveal(seed);
    const queue = [seed];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edgeId of outgoing.get(current) ?? []) {
        if (drawn.has(edgeId)) continue;
        if (draw(edgeId)) queue.push(edgesById.get(edgeId)!.target);
      }
    }
  };

  // The author's numbered arrows come first, in their order. An arrow never
  // leaves a node that isn't there yet, so its source appears just before it.
  // Equal numbers play back to back; ties keep the order they were written in.
  const numbered = followNumbers
    ? graph.edges
        .map((edge, index) => ({ edge, index, order: stepNumber(edge.text) }))
        .filter((entry): entry is typeof entry & { order: number[] } => entry.order !== null)
        .sort((a, b) => compareNumbers(a.order, b.order) || a.index - b.index)
    : [];
  for (const { edge, order } of numbered) {
    reveal(edge.source);
    draw(edge.id, order.join("."));
  }
  // Then everything else, carried on from what the numbered story revealed,
  // so the rest grows out of it instead of starting over at the top.
  for (const step of [...steps]) {
    if (step.type === "reveal-node") walk(step.nodeId);
  }

  for (const seed of entryPoints(graph, incoming, outgoing)) {
    if (!revealed.has(seed)) walk(seed);
  }

  // Anything still unvisited is a component with no reachable entry point of
  // its own (a detached cycle, typically). Seed it in reading order so the
  // whole diagram is always explained, never partially.
  const remaining = [...graph.nodes.values()]
    .filter((node) => !revealed.has(node.id))
    .sort(byReadingOrder);
  for (const node of remaining) {
    if (!revealed.has(node.id)) walk(node.id);
  }

  // A node with no edges at all still deserves to appear.
  for (const node of [...graph.nodes.values()].sort(byReadingOrder)) {
    reveal(node.id);
  }

  // Every other arrow is numbered in the order it is drawn, carrying on after
  // the author's last whole number, so the numbers read as one sequence.
  let next = numbered.length ? Math.floor(numbered[numbered.length - 1].order[0]) + 1 : 1;
  for (const step of steps) {
    if (step.type !== "reveal-node" && !step.number) step.number = String(next++);
  }

  return {
    steps,
    nodeIds: [...graph.nodes.keys()],
    edgeIds: graph.edges.map((edge) => edge.id),
  };
}

/**
 * How long an edge takes to draw.
 *
 * Duration tracks length so a long hop across the diagram reads as further than
 * a short one, but the clamp matters more than the slope: unbounded, a big
 * diagram's longest edge would crawl and its shortest would flick past too fast
 * to follow. `PER_UNIT` is tuned so a typical inter-node hop lands near the
 * middle of the band.
 */
// Tuned for someone following along, not for throughput. The first cut ran at
// 260–900ms a stroke with a 140ms rest, which is a stroke every half second:
// accurate but breathless, like a lecturer racing the clock. A stroke is now
// long enough to watch travel, and every node gets a real pause to register.
const EDGE_MS = { min: 420, max: 1150, perUnit: 3.4 };
export const REVEAL_MS = 420;
/** A beat after a node lands, so the eye can register it before the next hop. */
export const SETTLE_MS = 220;
/** Rest between beats, so one idea visibly ends before the next begins. */
export const BEAT_PAUSE_MS = 320;
/** How long a revisit target keeps pulsing after its edge lands. */
export const PULSE_TAIL_MS = 420;
/** The finished last beat stays framed this long before the pull back. */
export const OUTRO_HOLD_MS = 700;
/** The final pull back to the whole diagram: slow, like a closing wide shot. */
export const OUTRO_MS = 1900;
/** Without a camera, the time the finished picture takes to light up fully. */
export const FINALE_MS = 600;

export function edgeDuration(length: number): number {
  return Math.min(EDGE_MS.max, Math.max(EDGE_MS.min, length * EDGE_MS.perUnit));
}

/** Wall-clock duration of a step at 1x, used for the scrubber and for seeking. */
export function stepDuration(step: ExplainerStep): number {
  if (step.type === "reveal-node") return REVEAL_MS + SETTLE_MS;
  return edgeDuration(step.length);
}

/**
 * A multiplier on every duration, by plan length.
 *
 * The calm pacing above is right for a diagram of a few dozen steps. At a few
 * hundred it would run for many minutes, so long plans speed up gradually,
 * but never below 0.45×, where a stroke is still long enough to follow.
 */
export function paceFor(stepCount: number): number {
  if (stepCount <= 60) return 1;
  return Math.max(0.45, Math.sqrt(60 / stepCount));
}
