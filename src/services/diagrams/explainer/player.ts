/**
 * Plays an explainer plan against a rendered SVG.
 *
 * The player is a pure function of one number: elapsed time. Every frame it
 * renders the plan *from scratch* at time `t` rather than accumulating state,
 * which is what makes stepping, scrubbing and reversing work — going backwards
 * is just a smaller `t`, not an undo log. It also means a dropped frame can
 * never desynchronise the diagram from the timeline.
 *
 * The synchronisation rule the brief cares about falls straight out of this: a
 * node's reveal step *begins* at the timestamp where its incoming edge's draw
 * step ends. Arrival isn't a delay that happens to line up, it is the same
 * instant expressed once.
 *
 * On top of the steps sits a second rhythm, the beat (see beats.ts): one node
 * and what leaves it. The timeline is laid out beat by beat, like a lesson:
 *
 *   rest ─▶ camera glides to the next idea ─▶ it is drawn ─▶ rest ─▶ …
 *   … ─▶ last beat drawn ─▶ hold ─▶ slow pull back to the whole picture
 *
 * The camera always arrives *before* anything is drawn in its new framing, so
 * the reader is never chasing a stroke that has already started off-screen.
 * The current beat is spotlit and everything already explained recedes, so
 * there is never any doubt about what is being talked about.
 */

import type { ExplainerGraph } from "./graph";
import {
  BEAT_PAUSE_MS,
  FINALE_MS,
  OUTRO_HOLD_MS,
  OUTRO_MS,
  PULSE_TAIL_MS,
  REVEAL_MS,
  paceFor,
  stepDuration,
} from "./plan";
import { stepNumber, type ExplainerPlan, type ExplainerStep } from "./plan";
import { canFollow, frameFor, framesEqual, homeFrame } from "./camera";
import type { Frame } from "./camera";
import { travelDuration, travelFrame } from "./camera-path";
import { groupBeats, type Beat } from "./beats";

/** A step placed on the timeline. */
interface ScheduledStep {
  step: ExplainerStep;
  start: number;
  end: number;
}

/** A beat placed on the timeline. */
interface ScheduledBeat extends Beat {
  /**
   * When this beat becomes the one being talked about: the moment the camera
   * sets off towards it, which is after the previous beat's closing rest.
   */
  activeFrom: number;
  /** First stroke of the beat, after the camera has arrived. */
  start: number;
  /** Last step of the beat finishes. */
  end: number;
  frame: Frame;
  caption: string;
}

interface CameraMove {
  start: number;
  end: number;
  from: Frame;
  to: Frame;
  pullBack: boolean;
}

export interface PlayerState {
  time: number;
  duration: number;
  playing: boolean;
  /** Index of the step currently under the playhead. */
  index: number;
  stepCount: number;
  /** Index of the beat being explained; -1 once the finale has begun. */
  beat: number;
  beatCount: number;
}

export interface PlayerOptions {
  /** Let the camera move in on each beat. Off holds the whole diagram. */
  camera: boolean;
  /**
   * Where camera framings go. The stage routes them through its viewport, so
   * a reader who has panned or zoomed by hand keeps their own view.
   */
  onFrame: (frame: Frame) => void;
  /** Put each arrow's step number on it as it is drawn. */
  numbers?: boolean;
}

/** How far along its edge a step-number badge sits: near the arrival end, so
 *  a fan-out's badges spread out with their targets instead of piling up at
 *  the shared source. */
const BADGE_AT = 0.7;
const SVG_NS = "http://www.w3.org/2000/svg";

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

export class ExplainerPlayer {
  private readonly schedule: ScheduledStep[] = [];
  private readonly beats: ScheduledBeat[] = [];
  private readonly moves: CameraMove[] = [];
  private readonly follow: boolean;
  private readonly pace: number;
  /** Framing of the whole diagram; the viewport's "fit". */
  readonly home: Frame;
  /** When the last stroke finishes; after it comes the finale. */
  private readonly stepsEnd: number;
  private readonly total: number;
  /**
   * Edges by id.
   *
   * `render` used to resolve each edge step with `edges.find(...)`, a linear
   * scan, inside a loop over every step — which made drawing one frame
   * quadratic in the size of the diagram. A 2,000-edge ERD spent millions of
   * array probes per frame and took the tab with it. The map turns that into a
   * hash lookup.
   */
  private readonly edgesById = new Map<string, ExplainerGraph["edges"][number]>();
  /**
   * Which elements the last painted frame actually touched.
   *
   * Repainting every node on every tick is the other half of the old cost: a
   * node whose opacity is already 1 does not need its style rewritten sixty
   * times a second, and each redundant write invalidates style for the whole
   * subtree. Tracking what is currently non-default lets a frame touch only
   * what changed between the previous `t` and this one.
   */
  private readonly paintedNodes = new Set<string>();
  private readonly paintedEdges = new Set<string>();
  private readonly pulsingNodes = new Set<string>();
  /** Step-number badges by edge id, when numbering is on. */
  private readonly badges = new Map<string, SVGGElement>();
  /**
   * How far the "everything before this is finished" pass has already run.
   *
   * Without it, settling walks every completed step on every frame — which is
   * cheap per step but linear in the diagram, so a long run drifts back into
   * exactly the per-frame cost this rewrite removed. Forward playback only
   * settles what newly passed the playhead; a backwards seek rewinds it.
   */
  private settledThrough = 0;
  /** The beat whose elements currently carry the spotlight; -1 for none. */
  private litBeat = -1;
  private raf = 0;
  private lastTick = 0;
  private time = 0;
  private playing = false;
  /** Where a step-forward stops; null while playing straight through. */
  private stopAt: number | null = null;
  private speed = 1;
  private appliedFrame: Frame | null = null;

  constructor(
    private readonly graph: ExplainerGraph,
    private readonly plan: ExplainerPlan,
    private readonly onState: (state: PlayerState) => void,
    private readonly options: PlayerOptions,
  ) {
    for (const edge of graph.edges) this.edgesById.set(edge.id, edge);
    this.pace = paceFor(plan.steps.length);
    this.follow = options.camera && canFollow(graph);
    this.home = homeFrame(graph);

    // Lay the timeline out beat by beat: a rest, the camera's move if the
    // framing changes, then the beat's own steps back to back.
    let cursor = 0;
    let previousFrame: Frame | null = null;
    const pause = BEAT_PAUSE_MS * this.pace;
    for (const beat of groupBeats(plan.steps)) {
      const frame = this.follow ? frameFor(graph, beat.nodeIds) : this.home;
      let activeFrom = cursor;
      if (previousFrame) {
        cursor += pause;
        activeFrom = cursor;
        if (!framesEqual(previousFrame, frame)) {
          // Camera time is not scaled by pace: a hurried camera is the one
          // thing guaranteed to make a large diagram feel chaotic.
          const duration = travelDuration(previousFrame, frame, this.home);
          this.moves.push({
            start: cursor,
            end: cursor + duration,
            from: previousFrame,
            to: frame,
            pullBack: true,
          });
          cursor += duration;
        }
      }
      const start = cursor;
      for (let index = beat.first; index <= beat.last; index++) {
        const step = plan.steps[index];
        const length = stepDuration(step) * this.pace;
        this.schedule.push({ step, start: cursor, end: cursor + length });
        cursor += length;
      }
      this.beats.push({
        ...beat,
        activeFrom,
        start,
        end: cursor,
        frame,
        caption: this.captionFor(beat, this.beats.length === 0),
      });
      previousFrame = frame;
    }
    this.stepsEnd = cursor;

    // The closing wide shot. With no camera there is nothing to pull back, but
    // the spotlight still lifts, and that deserves a moment on screen.
    if (previousFrame && this.follow && !framesEqual(previousFrame, this.home)) {
      cursor += OUTRO_HOLD_MS;
      this.moves.push({
        start: cursor,
        end: cursor + OUTRO_MS,
        from: previousFrame,
        to: this.home,
        pullBack: false,
      });
      cursor += OUTRO_MS;
    } else if (this.beats.length > 1) {
      cursor += FINALE_MS;
    }
    this.total = cursor;
    this.prepare();
  }

  /** The full run length at 1x, in milliseconds. */
  get duration(): number {
    return this.total;
  }

  /** Whether the camera moves for this diagram (the setting and its size). */
  get following(): boolean {
    return this.follow;
  }

  /**
   * Put the diagram into its pre-roll state and take ownership of visibility.
   *
   * Setting `data-explainer` here rather than at mount is deliberate: until
   * this runs, the CSS that hides things does not apply, so a diagram that
   * never reaches the player is never left blank.
   */
  private prepare(): void {
    const { svg } = this.graph;
    const stage = svg.parentElement;
    stage?.setAttribute("data-explainer", "");
    stage?.style.setProperty("--explainer-reveal", `${Math.round(REVEAL_MS * this.pace)}ms`);

    for (const node of this.graph.nodes.values()) {
      node.el.classList.add("explainer-node", "explainer-hidden");
    }

    for (const edge of this.graph.edges) {
      const { path } = edge;
      // Stash the arrowhead: a marker renders at full size regardless of how
      // little of the path is drawn, so an undrawn edge would show its arrow
      // hanging in space at the destination.
      const marker = path.getAttribute("marker-end");
      if (marker) path.dataset.explainerMarker = marker;
      path.style.strokeDasharray = `${edge.length} ${edge.length}`;
      path.style.strokeDashoffset = `${edge.length}`;
      path.removeAttribute("marker-end");
      path.classList.add("explainer-edge");
      edge.label?.classList.add("explainer-label", "explainer-hidden");
    }
    if (this.options.numbers) this.createBadges();

    this.render(0);
  }

  /**
   * One small numbered pill per arrow, hidden until its stroke passes it.
   *
   * An arrow whose own label already starts with that number (the author wrote
   * `-->|2. Pay|`) gets none: the label is the badge.
   */
  private createBadges(): void {
    for (const step of this.plan.steps) {
      if (step.type === "reveal-node" || !step.number) continue;
      const edge = this.edgesById.get(step.edgeId);
      if (!edge || edge.length <= 0) continue;
      const authored = stepNumber(edge.text);
      if (authored && authored.join(".") === step.number) continue;
      let point: DOMPoint;
      try {
        point = edge.path.getPointAtLength(edge.length * BADGE_AT);
      } catch {
        continue;
      }
      const badge = document.createElementNS(SVG_NS, "g");
      badge.setAttribute("class", "explainer-badge");
      badge.setAttribute("transform", `translate(${point.x}, ${point.y})`);
      const width = Math.max(18, step.number.length * 6.5 + 9);
      const pill = document.createElementNS(SVG_NS, "rect");
      pill.setAttribute("x", `${-width / 2}`);
      pill.setAttribute("y", "-9");
      pill.setAttribute("width", `${width}`);
      pill.setAttribute("height", "18");
      pill.setAttribute("rx", "9");
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dy", "0.35em");
      text.textContent = step.number;
      badge.append(pill, text);
      // Beside its own path, so it shares the edge's coordinate space.
      edge.path.parentNode?.appendChild(badge);
      this.badges.set(edge.id, badge);
    }
  }

  /** Restore the SVG to a plain static diagram and drop the clock. */
  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.playing = false;
    this.spotlight(-1);
    this.paintedNodes.clear();
    this.paintedEdges.clear();
    this.pulsingNodes.clear();
    this.settledThrough = 0;
    const { svg } = this.graph;
    const stage = svg.parentElement;
    stage?.removeAttribute("data-explainer");
    stage?.style.removeProperty("--explainer-reveal");
    for (const node of this.graph.nodes.values()) {
      node.el.classList.remove(
        "explainer-node",
        "explainer-hidden",
        "explainer-shown",
        "explainer-pulse",
        "explainer-focus",
      );
      node.el.style.opacity = "";
    }
    for (const edge of this.graph.edges) {
      const { path } = edge;
      path.style.strokeDasharray = "";
      path.style.strokeDashoffset = "";
      path.classList.remove("explainer-edge", "explainer-focus");
      const marker = path.dataset.explainerMarker;
      if (marker) {
        path.setAttribute("marker-end", marker);
        delete path.dataset.explainerMarker;
      }
      edge.label?.classList.remove("explainer-label", "explainer-hidden", "explainer-focus");
      if (edge.label) edge.label.style.opacity = "";
    }
    for (const badge of this.badges.values()) badge.remove();
    this.badges.clear();
    this.options.onFrame(this.home);
  }

  /**
   * Draw the diagram as it stands at time `t`.
   *
   * Every element's state is derived from `t` alone. Steps before the playhead
   * are complete, the step under it is interpolated, everything after is in its
   * pre-roll state.
   */
  private render(t: number): void {
    // Everything before the playhead is finished, everything after is still in
    // its pre-roll state, and only the steps *straddling* `t` are in motion.
    // Finding that window by binary search means a frame costs O(log n + k) in
    // the number of steps actually animating, rather than O(steps × edges).
    const active = this.activeRange(t);
    const revealMs = REVEAL_MS * this.pace;

    const shown = new Set<string>();
    const pulsing = new Set<string>();

    for (let index = active.first; index <= active.last; index++) {
      const entry = this.schedule[index];
      if (!entry) continue;
      const { step, start, end } = entry;
      const span = end - start;
      const progress = span <= 0 ? 1 : (t - start) / span;

      if (step.type === "reveal-node") {
        // The settle beat is padding after the fade, so the node is fully
        // opaque before the next edge starts moving.
        const fade = span <= 0 ? 1 : (t - start) / revealMs;
        if (fade > 0) shown.add(step.nodeId);
        this.paintNode(step.nodeId, Math.min(1, Math.max(0, fade)));
        continue;
      }

      const edge = this.edgesById.get(step.edgeId);
      if (!edge) continue;
      const clamped = Math.min(1, Math.max(0, progress));
      this.paintEdge(edge, easeOut(clamped));
      if (step.type === "draw-edge-revisit" && clamped >= 1 && t < end + PULSE_TAIL_MS) {
        pulsing.add(step.to);
      }
    }

    // Steps wholly behind the playhead are complete. Painting them once as
    // they pass — and then leaving them alone — is what removes the per-frame
    // walk over the whole diagram.
    this.settleCompleted(active.first, shown);
    // Anything still ahead of the playhead must be returned to its pre-roll
    // state, but only if this frame moved backwards past it (a seek or a step
    // back); forward playback never needs it.
    this.resetPending(active.last, t);
    this.syncPulse(pulsing);
    this.spotlight(this.beatAt(t));
    this.paintCamera(t);
  }

  /**
   * The span of steps overlapping `t`, plus the short pulse tail after a
   * revisit edge lands.
   *
   * The schedule is sorted and contiguous, so the first step whose `end`
   * exceeds `t` is a binary search; from there we walk forward only while
   * steps are still in flight, which is a handful even on a huge diagram.
   */
  private activeRange(t: number): { first: number; last: number } {
    if (this.schedule.length === 0) return { first: 0, last: -1 };

    let low = 0;
    let high = this.schedule.length - 1;
    let first = this.schedule.length;
    while (low <= high) {
      const mid = (low + high) >> 1;
      // The pulse tail keeps a finished revisit "active" a little longer, so
      // it is included in the search rather than handled as a special case.
      if (this.schedule[mid].end + PULSE_TAIL_MS > t) {
        first = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    if (first >= this.schedule.length) {
      return { first: this.schedule.length, last: this.schedule.length - 1 };
    }

    let last = first;
    while (last + 1 < this.schedule.length && this.schedule[last + 1].start <= t) last++;
    return { first, last };
  }

  /**
   * Bring everything before the active window to its finished state.
   *
   * Only the elements not already marked as painted are touched, so a step
   * that completed twenty frames ago costs nothing now.
   */
  private settleCompleted(activeFirst: number, shown: Set<string>): void {
    // A seek backwards leaves the cursor ahead of the playhead; drop it back so
    // the steps between are settled again on the way forward.
    if (activeFirst < this.settledThrough) this.settledThrough = activeFirst;
    for (let index = this.settledThrough; index < activeFirst; index++) {
      const { step } = this.schedule[index];
      if (step.type === "reveal-node") {
        shown.add(step.nodeId);
        if (!this.paintedNodes.has(step.nodeId)) this.paintNode(step.nodeId, 1);
        continue;
      }
      const edge = this.edgesById.get(step.edgeId);
      if (edge && !this.paintedEdges.has(edge.id)) this.paintEdge(edge, 1);
    }
    this.settledThrough = Math.max(this.settledThrough, activeFirst);
  }

  /**
   * Return steps ahead of the playhead to pre-roll, for a backwards seek.
   *
   * Forward playback leaves nothing to undo, so the common case exits without
   * touching the DOM at all.
   */
  private resetPending(activeLast: number, t: number): void {
    if (this.paintedNodes.size === 0 && this.paintedEdges.size === 0) return;
    for (let index = activeLast + 1; index < this.schedule.length; index++) {
      const { step, start } = this.schedule[index];
      if (start > t + PULSE_TAIL_MS && !this.hasPainted(step)) break;
      if (step.type === "reveal-node") {
        if (this.paintedNodes.has(step.nodeId)) this.paintNode(step.nodeId, 0);
        continue;
      }
      const edge = this.edgesById.get(step.edgeId);
      if (edge && this.paintedEdges.has(edge.id)) this.paintEdge(edge, 0);
    }
  }

  private hasPainted(step: ExplainerStep): boolean {
    return step.type === "reveal-node"
      ? this.paintedNodes.has(step.nodeId)
      : this.paintedEdges.has(step.edgeId);
  }

  /** Move the pulse class to exactly the nodes that should carry it. */
  private syncPulse(pulsing: Set<string>): void {
    for (const nodeId of this.pulsingNodes) {
      if (pulsing.has(nodeId)) continue;
      this.graph.nodes.get(nodeId)?.el.classList.remove("explainer-pulse");
    }
    for (const nodeId of pulsing) {
      if (this.pulsingNodes.has(nodeId)) continue;
      this.graph.nodes.get(nodeId)?.el.classList.add("explainer-pulse");
    }
    this.pulsingNodes.clear();
    for (const nodeId of pulsing) this.pulsingNodes.add(nodeId);
  }

  /**
   * Light the current beat and let everything else recede.
   *
   * Only the lit beat's own elements carry a class; the dimming of everything
   * else is one attribute on the stage and a CSS rule. Changing beats
   * therefore touches a handful of elements, never the whole diagram, and CSS
   * transitions do the cross-fade.
   */
  private spotlight(beat: number): void {
    if (beat === this.litBeat) return;
    const stage = this.graph.svg.parentElement;
    if (this.litBeat >= 0) this.markBeat(this.beats[this.litBeat], false);
    if (beat >= 0 && this.beats.length > 1) {
      this.markBeat(this.beats[beat], true);
      stage?.setAttribute("data-explainer-spotlight", "");
    } else {
      stage?.removeAttribute("data-explainer-spotlight");
    }
    this.litBeat = beat >= 0 && this.beats.length > 1 ? beat : -1;
  }

  private markBeat(beat: ScheduledBeat | undefined, on: boolean): void {
    if (!beat) return;
    for (const id of beat.nodeIds)
      this.graph.nodes.get(id)?.el.classList.toggle("explainer-focus", on);
    for (const id of beat.edgeIds) {
      const edge = this.edgesById.get(id);
      edge?.path.classList.toggle("explainer-focus", on);
      edge?.label?.classList.toggle("explainer-focus", on);
      this.badges.get(id)?.classList.toggle("explainer-focus", on);
    }
  }

  /** The beat being explained at `t`; -1 in the finale. */
  private beatAt(t: number): number {
    if (this.beats.length === 0 || t >= this.stepsEnd) return -1;
    let low = 0;
    let high = this.beats.length - 1;
    let found = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.beats[mid].activeFrom <= t) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found;
  }

  /**
   * Reveal is opacity only, deliberately.
   *
   * An earlier version also scaled the node up from 0.94, which needed
   * `transform-box: view-box` to scale about the node's own centre. That was a
   * trap: `view-box` re-anchors the element's transform reference box to the
   * SVG viewport and stops honouring the `transform` *attribute* Mermaid uses
   * to position each node — every node collapsed onto the same origin, leaving
   * one pile of overlapping boxes and a row of orphaned arrows. A fade alone
   * carries the sequence perfectly well and cannot move anything.
   */
  private paintNode(nodeId: string, amount: number): void {
    const node = this.graph.nodes.get(nodeId);
    if (!node) return;
    node.el.style.opacity = `${easeOut(amount)}`;
    node.el.classList.toggle("explainer-hidden", amount <= 0);
    node.el.classList.toggle("explainer-shown", amount >= 1);
    // Track only what is off its pre-roll default, so `resetPending` knows
    // exactly which elements still need undoing after a backwards seek.
    if (amount <= 0) this.paintedNodes.delete(nodeId);
    else this.paintedNodes.add(nodeId);
  }

  private paintEdge(edge: ExplainerGraph["edges"][number], amount: number): void {
    const { path } = edge;
    this.badges.get(edge.id)?.classList.toggle("explainer-badge-shown", amount >= BADGE_AT);
    path.style.strokeDashoffset = `${edge.length * (1 - amount)}`;
    if (amount <= 0) this.paintedEdges.delete(edge.id);
    else this.paintedEdges.add(edge.id);
    // The arrowhead comes back only once the stroke has actually landed, so
    // the arrow appears to arrive rather than to have been waiting.
    const marker = path.dataset.explainerMarker;
    if (marker) {
      if (amount >= 0.999) path.setAttribute("marker-end", marker);
      else path.removeAttribute("marker-end");
    }
    if (edge.label) {
      // Labels fade in over the back half of the draw, so they don't announce
      // an edge that hasn't been made yet.
      const labelAmount = Math.min(1, Math.max(0, (amount - 0.5) * 2));
      edge.label.style.opacity = `${labelAmount}`;
      edge.label.classList.toggle("explainer-hidden", labelAmount <= 0);
    }
  }

  /** The camera's framing at `t`, from the precomputed moves. */
  private cameraAt(t: number): Frame {
    if (!this.follow || this.beats.length === 0) return this.home;
    let low = 0;
    let high = this.moves.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.moves[mid].start <= t) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    // Before the first move the camera is already on the first beat: the
    // canvas is empty at t=0, so there is nothing to establish first.
    if (found < 0) return this.beats[0].frame;
    const move = this.moves[found];
    if (t >= move.end) return move.to;
    const progress = (t - move.start) / (move.end - move.start);
    return travelFrame(move.from, move.to, progress, this.home, move.pullBack);
  }

  private paintCamera(t: number): void {
    const frame = this.cameraAt(t);
    if (this.appliedFrame && framesEqual(this.appliedFrame, frame)) return;
    this.options.onFrame(frame);
    this.appliedFrame = frame;
  }

  private indexAt(t: number): number {
    for (let i = 0; i < this.schedule.length; i++) {
      if (t < this.schedule[i].end) return i;
    }
    return this.schedule.length - 1;
  }

  private emit(): void {
    this.onState({
      time: this.time,
      duration: this.duration,
      playing: this.playing,
      index: this.indexAt(this.time),
      stepCount: this.schedule.length,
      beat: this.beatAt(this.time),
      beatCount: this.beats.length,
    });
  }

  private tick = (now: number): void => {
    if (!this.playing) return;
    const delta = this.lastTick === 0 ? 16 : now - this.lastTick;
    this.lastTick = now;
    const limit = this.stopAt ?? this.duration;
    this.time = Math.min(limit, this.time + delta * this.speed);
    this.render(this.time);
    if (this.time >= limit) {
      this.playing = false;
      this.stopAt = null;
      this.emit();
      return;
    }
    this.emit();
    this.raf = requestAnimationFrame(this.tick);
  };

  private run(): void {
    this.playing = true;
    this.lastTick = 0;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
    this.emit();
  }

  play(): void {
    if (this.playing && this.stopAt === null) return;
    this.stopAt = null;
    // Replay from the top rather than sitting at the end.
    if (this.time >= this.duration) {
      this.time = 0;
      this.render(0);
    }
    this.run();
  }

  pause(): void {
    this.stopAt = null;
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(time: number): void {
    this.time = Math.min(this.duration, Math.max(0, time));
    this.lastTick = 0;
    this.render(this.time);
    this.emit();
  }

  restart(): void {
    this.seek(0);
    this.play();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /**
   * Move one beat, the way a presenter clicks to the next slide.
   *
   * Forward *plays* the next beat (the camera's move, then the drawing) and
   * stops once it has landed, rather than jumping to the end state. Seeing the
   * arrow travel is the explanation, and a cut straight to the finished frame
   * throws it away. Pressing again while a beat is still playing finishes it at
   * once and plays the one after, so an impatient reader is never held back.
   *
   * Back is instant: it returns to the moment the previous beat finished,
   * paused, so forward from there replays the beat just undone.
   */
  step(direction: 1 | -1): void {
    if (this.beats.length === 0) return;
    if (direction === 1) {
      if (this.playing && this.stopAt !== null) this.seek(this.stopAt);
      else if (this.playing) this.pause();
      const t = this.time;
      if (t >= this.duration) return;
      const current = this.beatAt(t);
      let target: number;
      if (current < 0) {
        target = this.duration;
      } else {
        const beat = this.beats[current];
        target = t >= beat.end - 1 ? (this.beats[current + 1]?.end ?? this.duration) : beat.end;
      }
      this.stopAt = target;
      this.run();
      return;
    }

    this.pause();
    const t = this.time;
    let target = 0;
    for (const beat of this.beats) {
      if (beat.end < t - 1) target = beat.end;
      else break;
    }
    this.seek(target);
  }

  /** A short human description of the beat, for the caption. */
  describe(beat: number): string {
    if (beat < 0) return this.beats.length > 1 ? "The whole picture" : "";
    return this.beats[beat]?.caption ?? "";
  }

  private labelOf(nodeId: string): string {
    return this.graph.nodes.get(nodeId)?.label || "Node";
  }

  /**
   * What the narrator would say for a beat.
   *
   * "Gateway → Auth, Orders, Search" names the idea, not the strokes; a single
   * hop also carries the edge's own label, since that is often the whole point
   * ("Client → API · HTTPS").
   */
  private captionFor(beat: Beat, first: boolean): string {
    if (beat.edgeIds.length === 0) {
      const names = beat.nodeIds.map((id) => this.labelOf(id));
      if (names.length > 1) return `Introducing ${listOf(names)}`;
      return first ? `Start: ${names[0] ?? ""}` : (names[0] ?? "");
    }
    const edges = beat.edgeIds
      .map((id) => this.edgesById.get(id))
      .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge));
    const from = this.labelOf(beat.owner ?? edges[0]?.source ?? "");
    if (edges.length === 1) {
      const edge = edges[0];
      const label = edge.label?.textContent?.trim();
      return `${from} → ${this.labelOf(edge.target)}${label ? ` · ${label}` : ""}`;
    }
    return `${from} → ${listOf(edges.map((edge) => this.labelOf(edge.target)))}`;
  }
}

/** "A, B and 3 more", short enough for a one-line caption. */
function listOf(names: string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 3) return unique.join(", ");
  return `${unique.slice(0, 3).join(", ")} +${unique.length - 3} more`;
}
