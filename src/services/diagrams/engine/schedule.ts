/**
 * The explainer's timeline for the GPU engine, as typed arrays.
 *
 * Same rules as the SVG player (services/diagrams/explainer/player.ts): an edge may not start
 * until its source is on screen, a node appears the moment its incoming edge
 * lands, beats rest between each other, the camera arrives before anything is
 * drawn in its new framing. What differs is the cost model. The SVG player has
 * to be incremental because every DOM write invalidates style; here a frame is
 * a write into a Float32Array, so `evaluate` simply recomputes every step from
 * `t` — 22,000 steps in a fraction of a millisecond — and seeking, stepping
 * back and scrubbing are exact by construction.
 *
 * Two pacings:
 *
 *  - Narrated: the SVG player's timeline, beat by beat, with camera moves and a
 *    spotlight. Used whenever that fits in a few minutes.
 *  - Wave: past that, a narrated walk would run for hours (10,000 nodes is
 *    ~22,000 steps). The steps are staggered instead, so the diagram grows
 *    outward from its entry points level by level in a minute or two, every
 *    stroke still waiting for its source. Beats become those levels, so
 *    stepping moves a level at a time.
 *
 * Pure: no DOM and no clock.
 */
import {
  BEAT_PAUSE_MS,
  FINALE_MS,
  OUTRO_HOLD_MS,
  OUTRO_MS,
  PULSE_TAIL_MS,
  REVEAL_MS,
  paceFor,
  stepDuration,
  type ExplainerPlan,
} from "../explainer/plan.ts";
import { groupBeats } from "../explainer/beats.ts";
import {
  easeInOutCubic,
  framesClose,
  travelDuration,
  travelFrame,
  type Frame,
} from "../explainer/camera-path.ts";

export const STEP_REVEAL = 0;
export const STEP_DRAW = 1;
export const STEP_REVISIT = 2;

/** A narrated run longer than this is played as a wave instead. */
export const NARRATED_LIMIT_MS = 6 * 60_000;
/** Spotlight cross-fade, matching explainer.css. */
export const FOCUS_FADE_MS = 480;
const WAVE_MIN_MS = 40_000;
const WAVE_MAX_MS = 150_000;
const WAVE_MS_PER_STEP = 8;
const WAVE_EDGE_MS = 520;
const WAVE_REVEAL_MS = 320;

export interface ScheduleBeat {
  activeFrom: number;
  start: number;
  end: number;
  frame: Frame;
  caption: string;
  nodes: Uint32Array;
  edges: Uint32Array;
}

export interface CameraMove {
  start: number;
  end: number;
  from: Frame;
  to: Frame;
  pullBack: boolean;
  /** Set when the camera rides along this edge as it is drawn. */
  track?: number;
}

/**
 * How the camera follows an edge too long to frame whole: it travels with the
 * stroke's head, at reading zoom, from the source to the target.
 */
export interface EdgeFollow {
  /** A point `fraction` of the way along edge `edge`. */
  along(edge: number, fraction: number): [number, number];
  /** A readable framing centred on a point. */
  around(x: number, y: number): Frame;
}

/** How fast the camera rides along an edge: frame widths per second. */
const TRACK_SPEED = 1.1;
const TRACK_MAX_MS = 6000;

export interface Schedule {
  mode: "narrated" | "wave";
  /** Per step. */
  kind: Uint8Array;
  /** Node index for a reveal, edge index for a draw. */
  target: Uint32Array;
  /** For a revisit, the node it lands on. */
  landsOn: Uint32Array;
  /** 1 where the camera rides along this edge (drawn with a matching ease). */
  tracked: Uint8Array;
  /** How to find points on tracked edges, for the camera. */
  edgeFollow?: EdgeFollow;
  start: Float64Array;
  end: Float64Array;
  /** Per node: how long its fade takes. */
  revealMs: number;
  beats: ScheduleBeat[];
  moves: CameraMove[];
  stepsEnd: number;
  duration: number;
  follow: boolean;
  home: Frame;
}

export interface ScheduleInput {
  plan: ExplainerPlan;
  nodeCount: number;
  nodeIndex: Map<string, number>;
  edgeIndex: Map<string, number>;
  nodeLabel: (node: number) => string;
  edgeLabel: (edge: number) => string;
  home: Frame;
  /** The camera's framing of a set of nodes (services/diagrams/explainer/camera.ts). */
  frameFor: (nodeIds: string[]) => Frame;
  /** Whether the camera may move at all. */
  camera: boolean;
  /** Force a pacing; otherwise chosen by length. */
  mode?: "narrated" | "wave";
  /** Ride along edges whose far end is out of view (GPU engine, large diagrams). */
  edgeFollow?: EdgeFollow;
  /**
   * Multiplier on camera travel time. A tour of thousands of beats needs a
   * brisker camera than a ten-box diagram, or it never gets anywhere.
   */
  travelScale?: number;
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

function listOf(names: string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 3) return unique.join(", ");
  return `${unique.slice(0, 3).join(", ")} +${unique.length - 3} more`;
}

function encodeSteps(input: ScheduleInput) {
  const { steps } = input.plan;
  const kind = new Uint8Array(steps.length);
  const target = new Uint32Array(steps.length);
  const landsOn = new Uint32Array(steps.length);
  steps.forEach((step, i) => {
    if (step.type === "reveal-node") {
      kind[i] = STEP_REVEAL;
      target[i] = input.nodeIndex.get(step.nodeId) ?? 0;
    } else {
      kind[i] = step.type === "draw-edge" ? STEP_DRAW : STEP_REVISIT;
      target[i] = input.edgeIndex.get(step.edgeId) ?? 0;
      landsOn[i] = input.nodeIndex.get(step.to) ?? 0;
    }
  });
  return { kind, target, landsOn, tracked: new Uint8Array(steps.length) };
}

/** Whether a point is comfortably inside a frame (not at its very edge). */
function inView(frame: Frame, x: number, y: number): boolean {
  const mx = frame.width * 0.08;
  const my = frame.height * 0.08;
  return (
    x >= frame.x + mx &&
    x <= frame.x + frame.width - mx &&
    y >= frame.y + my &&
    y <= frame.y + frame.height - my
  );
}

function narrated(input: ScheduleInput): Schedule {
  const { steps } = input.plan;
  const encoded = encodeSteps(input);
  const start = new Float64Array(steps.length);
  const end = new Float64Array(steps.length);
  const pace = paceFor(steps.length);
  const follow = input.camera && input.nodeCount >= 4;
  const pause = BEAT_PAUSE_MS * pace;
  const beats: ScheduleBeat[] = [];
  const moves: CameraMove[] = [];

  let cursor = 0;
  let previous: Frame | null = null;
  for (const beat of groupBeats(steps)) {
    const frame = follow ? input.frameFor(beat.nodeIds) : input.home;
    let activeFrom = cursor;
    if (previous) {
      cursor += pause;
      activeFrom = cursor;
      if (!framesClose(previous, frame)) {
        const duration = travelDuration(previous, frame, input.home) * (input.travelScale ?? 1);
        moves.push({
          start: cursor,
          end: cursor + duration,
          from: previous,
          to: frame,
          pullBack: true,
        });
        cursor += duration;
      }
    }
    const beatStart = cursor;
    let current = frame;
    const ride = follow ? input.edgeFollow : undefined;
    for (let i = beat.first; i <= beat.last; i++) {
      const step = steps[i];
      const natural = stepDuration(step) * pace;
      if (ride && step.type !== "reveal-node") {
        const edge = encoded.target[i];
        const [sx, sy] = ride.along(edge, 0);
        const [tx, ty] = ride.along(edge, 1);
        if (!inView(current, tx, ty)) {
          // The far end is off screen. Make sure the source is in view, then
          // ride the stroke to its target so the whole connection is seen.
          if (!inView(current, sx, sy)) {
            const back = ride.around(sx, sy);
            const duration = travelDuration(current, back, input.home) * (input.travelScale ?? 1);
            moves.push({
              start: cursor,
              end: cursor + duration,
              from: current,
              to: back,
              pullBack: true,
            });
            cursor += duration;
            current = back;
          }
          const to = ride.around(tx, ty);
          const distance = Math.hypot(tx - sx, ty - sy);
          const duration = Math.min(
            TRACK_MAX_MS,
            Math.max(natural, (distance / current.width / TRACK_SPEED) * 1000),
          );
          moves.push({
            start: cursor,
            end: cursor + duration,
            from: current,
            to,
            pullBack: false,
            track: edge,
          });
          encoded.tracked[i] = 1;
          start[i] = cursor;
          cursor += duration;
          end[i] = cursor;
          current = to;
          continue;
        }
      }
      start[i] = cursor;
      cursor += natural;
      end[i] = cursor;
    }
    const nodes = Uint32Array.from(beat.nodeIds, (id) => input.nodeIndex.get(id) ?? 0);
    const edges = Uint32Array.from(beat.edgeIds, (id) => input.edgeIndex.get(id) ?? 0);
    beats.push({
      activeFrom,
      start: beatStart,
      end: cursor,
      frame,
      caption: narratedCaption(input, beat.owner, nodes, edges, beats.length === 0),
      nodes,
      edges,
    });
    previous = current;
  }
  const stepsEnd = cursor;
  if (previous && follow && !framesClose(previous, input.home)) {
    cursor += OUTRO_HOLD_MS;
    moves.push({
      start: cursor,
      end: cursor + OUTRO_MS,
      from: previous,
      to: input.home,
      pullBack: false,
    });
    cursor += OUTRO_MS;
  } else if (beats.length > 1) {
    cursor += FINALE_MS;
  }

  return {
    mode: "narrated",
    ...encoded,
    start,
    end,
    revealMs: REVEAL_MS * pace,
    beats,
    moves,
    stepsEnd,
    duration: cursor,
    follow,
    edgeFollow: input.edgeFollow,
    home: input.home,
  };
}

function narratedCaption(
  input: ScheduleInput,
  owner: string | null,
  nodes: Uint32Array,
  edges: Uint32Array,
  first: boolean,
): string {
  if (edges.length === 0) {
    const names = Array.from(nodes, input.nodeLabel);
    if (names.length > 1) return `Introducing ${listOf(names)}`;
    return first ? `Start: ${names[0] ?? ""}` : (names[0] ?? "");
  }
  const ownerIndex = owner !== null ? input.nodeIndex.get(owner) : undefined;
  const from = input.nodeLabel(ownerIndex ?? nodes[0]);
  // The plan's edges carry the target; recover it from the step list's order
  // via the beat's nodes (the owner first, then each arrival).
  const targets = Array.from(nodes).filter((n) => n !== ownerIndex);
  if (edges.length === 1) {
    const label = input.edgeLabel(edges[0]);
    const to = targets.length ? input.nodeLabel(targets[0]) : from;
    return `${from} → ${to}${label ? ` · ${label}` : ""}`;
  }
  return `${from} → ${listOf(targets.map(input.nodeLabel))}`;
}

function wave(input: ScheduleInput): Schedule {
  const { steps } = input.plan;
  const encoded = encodeSteps(input);
  const { kind, target, landsOn } = encoded;
  const count = steps.length;

  // The plan puts a node's reveal straight after the edge that reaches it.
  const arrivalOf = (i: number) => {
    const step = steps[i];
    const previous = steps[i - 1];
    return step.type === "reveal-node" &&
      previous?.type === "draw-edge" &&
      previous.to === step.nodeId
      ? previous
      : null;
  };

  // Levels first: a node's level is one past the node its arrival edge left.
  const level = new Int32Array(input.nodeCount).fill(-1);
  let deepest = 0;
  for (let i = 0; i < count; i++) {
    if (kind[i] !== STEP_REVEAL) continue;
    const arrival = arrivalOf(i);
    const from = arrival ? (input.nodeIndex.get(arrival.from) ?? 0) : -1;
    level[target[i]] = from >= 0 ? level[from] + 1 : 0;
    deepest = Math.max(deepest, level[target[i]]);
  }

  const total = Math.min(WAVE_MAX_MS, Math.max(WAVE_MIN_MS, count * WAVE_MS_PER_STEP));
  const stagger = total / Math.max(1, count);
  // A deep chain is sequential by nature: every hop waits for the one before.
  // Shrink the hop so the deepest path still fits inside the run.
  const hopBudget = (total * 0.85) / (deepest + 1);
  const hop = Math.min(1, Math.max(0.03, hopBudget / (WAVE_EDGE_MS + WAVE_REVEAL_MS)));
  const edgeMs = WAVE_EDGE_MS * hop;
  const revealMs = WAVE_REVEAL_MS * hop;

  const start = new Float64Array(count);
  const end = new Float64Array(count);
  const revealedAt = new Float64Array(input.nodeCount);
  for (let i = 0; i < count; i++) {
    const slot = i * stagger;
    if (kind[i] === STEP_REVEAL) {
      start[i] = arrivalOf(i) ? Math.max(slot, end[i - 1]) : slot;
      end[i] = start[i] + revealMs;
      revealedAt[target[i]] = start[i];
    } else {
      const step = steps[i];
      const from = step.type === "reveal-node" ? 0 : (input.nodeIndex.get(step.from) ?? 0);
      // Leave once the source is mostly visible, never before.
      start[i] = Math.max(slot, revealedAt[from] + revealMs * 0.6);
      end[i] = start[i] + edgeMs;
    }
  }

  // One beat per level: the nodes that arrive at it and the edges that bring
  // them, plus any revisit edges leaving the level above.
  const beatOf = (i: number) => {
    if (kind[i] === STEP_REVEAL) return level[target[i]];
    if (kind[i] === STEP_DRAW) return level[landsOn[i]];
    const step = steps[i];
    const from = step.type === "reveal-node" ? 0 : (input.nodeIndex.get(step.from) ?? 0);
    return level[from] + 1;
  };
  const levels = deepest + 2;
  const from = new Float64Array(levels).fill(Infinity);
  const until = new Float64Array(levels);
  const nodesAt: number[][] = Array.from({ length: levels }, () => []);
  const edgesAt: number[][] = Array.from({ length: levels }, () => []);
  let stepsEnd = 0;
  for (let i = 0; i < count; i++) {
    const b = Math.max(0, beatOf(i));
    from[b] = Math.min(from[b], start[i]);
    until[b] = Math.max(until[b], end[i]);
    stepsEnd = Math.max(stepsEnd, end[i]);
    if (kind[i] === STEP_REVEAL) nodesAt[b].push(target[i]);
    else edgesAt[b].push(target[i]);
  }
  const beats: ScheduleBeat[] = [];
  for (let b = 0; b < levels; b++) {
    if (!Number.isFinite(from[b])) continue;
    const nodes = Uint32Array.from(nodesAt[b]);
    let caption: string;
    if (b === 0) {
      caption =
        nodes.length === 1
          ? `Start: ${input.nodeLabel(nodes[0])}`
          : `${nodes.length.toLocaleString()} entry points`;
    } else if (nodes.length) {
      caption = `Level ${b} · ${nodes.length.toLocaleString()} node${nodes.length === 1 ? "" : "s"}`;
    } else {
      caption = `Level ${b} · links back`;
    }
    beats.push({
      activeFrom: from[b],
      start: from[b],
      end: until[b],
      frame: input.home,
      caption,
      nodes,
      edges: Uint32Array.from(edgesAt[b]),
    });
  }
  beats.sort((a, b) => a.activeFrom - b.activeFrom);

  return {
    mode: "wave",
    ...encoded,
    start,
    end,
    revealMs,
    beats,
    moves: [],
    stepsEnd,
    duration: stepsEnd + FINALE_MS,
    follow: false,
    home: input.home,
  };
}

export function buildSchedule(input: ScheduleInput): Schedule {
  if (input.mode === "wave") return wave(input);
  const story = narrated(input);
  if (input.mode === "narrated" || story.duration <= NARRATED_LIMIT_MS) return story;
  return wave(input);
}

/** Index of the beat being explained at `t`; -1 in the finale. */
export function beatAt(schedule: Schedule, t: number): number {
  const { beats } = schedule;
  if (beats.length === 0 || t >= schedule.stepsEnd) return -1;
  let low = 0;
  let high = beats.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (beats[mid].activeFrom <= t) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** Index of the step under the playhead, for the transport. */
export function stepAt(schedule: Schedule, t: number): number {
  const { end } = schedule;
  let low = 0;
  let high = end.length - 1;
  let found = end.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (end[mid] > t) {
      found = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return Math.max(0, found);
}

export function cameraAt(schedule: Schedule, t: number): Frame {
  const { moves, beats } = schedule;
  if (!schedule.follow || beats.length === 0) return schedule.home;
  let low = 0;
  let high = moves.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (moves[mid].start <= t) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (found < 0) return beats[0].frame;
  const move = moves[found];
  if (t >= move.end) return move.to;
  const progress = (t - move.start) / (move.end - move.start);
  if (move.track !== undefined && schedule.edgeFollow) {
    // Riding the stroke: centred on its head, eased exactly as it is drawn.
    const [x, y] = schedule.edgeFollow.along(move.track, easeInOutCubic(progress));
    return schedule.edgeFollow.around(x, y);
  }
  return travelFrame(move.from, move.to, progress, schedule.home, move.pullBack);
}

/**
 * Write the diagram's state at `t` into the renderer's arrays.
 *
 * Node state is [alpha, focus, pulse, –] and edge state is [progress, –,
 * focus, –], four floats each. Returns the spotlight strength (0–1).
 */
export function evaluate(
  schedule: Schedule,
  t: number,
  nodeState: Float32Array,
  edgeState: Float32Array,
): number {
  const { kind, target, landsOn, start, end } = schedule;
  const revealMs = schedule.revealMs;
  for (let n = 2; n < nodeState.length; n += 4) nodeState[n] = 0;

  for (let i = 0; i < kind.length; i++) {
    const s = start[i];
    if (kind[i] === STEP_REVEAL) {
      const amount = t <= s ? 0 : Math.min(1, (t - s) / revealMs);
      nodeState[target[i] * 4] = easeOut(amount);
      continue;
    }
    const e = end[i];
    const span = e - s;
    const amount = t <= s ? 0 : t >= e || span <= 0 ? 1 : (t - s) / span;
    edgeState[target[i] * 4] = schedule.tracked[i] ? easeInOutCubic(amount) : easeOut(amount);
    if (kind[i] === STEP_REVISIT && t >= e && t < e + PULSE_TAIL_MS) {
      const slot = landsOn[i] * 4 + 2;
      nodeState[slot] = Math.max(nodeState[slot], (t - e) / PULSE_TAIL_MS || 1e-3);
    }
  }

  // Focus: the current beat fades in as the previous one fades out.
  for (let n = 1; n < nodeState.length; n += 4) nodeState[n] = 0;
  for (let e = 2; e < edgeState.length; e += 4) edgeState[e] = 0;
  if (schedule.mode !== "narrated" || schedule.beats.length < 2) return 0;
  const current = beatAt(schedule, t);
  if (current < 0) return Math.max(0, 1 - (t - schedule.stepsEnd) / FOCUS_FADE_MS);
  const beat = schedule.beats[current];
  const fade = current === 0 ? 1 : Math.min(1, Math.max(0, (t - beat.activeFrom) / FOCUS_FADE_MS));
  if (current > 0 && fade < 1) {
    const previous = schedule.beats[current - 1];
    for (const n of previous.nodes) nodeState[n * 4 + 1] = 1 - fade;
    for (const e of previous.edges) edgeState[e * 4 + 2] = 1 - fade;
  }
  for (const n of beat.nodes) nodeState[n * 4 + 1] = Math.max(nodeState[n * 4 + 1], fade);
  for (const e of beat.edges) edgeState[e * 4 + 2] = Math.max(edgeState[e * 4 + 2], fade);
  return 1;
}
