/**
 * Groups a plan's steps into beats: the unit a reader actually follows.
 *
 * A step is one stroke or one fade, far too small a unit to explain anything.
 * Someone walking through a diagram says "from the gateway, requests go to
 * auth, orders and search", which is one node and everything leaving it, said
 * in a breath. A beat is exactly that: the node the explanation is standing on
 * plus the edges it draws out of it and the nodes those edges reveal.
 *
 * The camera frames one beat at a time, the spotlight lights one beat at a
 * time, and "step forward" advances one beat. Moving per stroke instead is what
 * made the old explainer feel frantic.
 *
 * Pure: steps in, index ranges out.
 */

import type { ExplainerStep } from "./plan";

export interface Beat {
  /** First and last step index (inclusive). Beats are contiguous and ordered. */
  first: number;
  last: number;
  /** The node the beat is "standing on", when there is one. */
  owner: string | null;
  /** Every node the beat touches, the owner included. */
  nodeIds: string[];
  edgeIds: string[];
}

/** Keeps a hub with forty children from becoming one unreadable beat. */
const MAX_EDGES_PER_BEAT = 6;

interface OpenBeat {
  first: number;
  last: number;
  owner: string | null;
  nodes: Set<string>;
  edgeIds: string[];
}

function openBeat(index: number, owner: string | null): OpenBeat {
  return { first: index, last: index, owner, nodes: new Set(owner ? [owner] : []), edgeIds: [] };
}

function closeBeat(beat: OpenBeat): Beat {
  return {
    first: beat.first,
    last: beat.last,
    owner: beat.owner,
    nodeIds: [...beat.nodes],
    edgeIds: beat.edgeIds,
  };
}

export function groupBeats(steps: ExplainerStep[]): Beat[] {
  const beats: Beat[] = [];
  let current: OpenBeat | null = null;

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const previous = index > 0 ? steps[index - 1] : null;

    if (step.type === "reveal-node") {
      // A reveal straight after the edge that reaches it is that edge's
      // arrival, so it belongs to the same beat. Any other reveal is a new
      // starting point (a root, or an isolated node)...
      const arrival = previous?.type === "draw-edge" && previous.to === step.nodeId;
      // ...except that consecutive starting points share one beat: a sequence
      // diagram's cast, or a row of isolated nodes, is introduced together.
      const introRun =
        previous?.type === "reveal-node" && current !== null && current.edgeIds.length === 0;
      if (current === null || (!arrival && !introRun)) {
        if (current) beats.push(closeBeat(current));
        current = openBeat(index, step.nodeId);
      }
      current.nodes.add(step.nodeId);
    } else {
      const continues =
        current !== null &&
        current.owner === step.from &&
        current.edgeIds.length < MAX_EDGES_PER_BEAT &&
        // A cast of several nodes introduced together has no single owner;
        // its first edge begins a beat of its own.
        !(current.edgeIds.length === 0 && current.nodes.size > 1);
      if (current === null || !continues) {
        if (current) beats.push(closeBeat(current));
        current = openBeat(index, step.from);
      }
      current.nodes.add(step.from);
      current.nodes.add(step.to);
      current.edgeIds.push(step.edgeId);
    }
    current.last = index;
  }

  if (current) beats.push(closeBeat(current));
  return beats;
}
