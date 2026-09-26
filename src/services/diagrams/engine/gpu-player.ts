/**
 * The stepped-mode transport for GPU diagrams.
 *
 * Same public surface as the SVG `ExplainerPlayer` (play, pause, step, seek,
 * speed, captions, the same `PlayerState`), so MermaidExplainer drives either
 * one with the same controls and keys. Underneath it is much simpler: the
 * schedule is typed arrays, a frame is `evaluate(t)` into the renderer's state
 * buffers followed by one draw, and nothing is tracked between frames.
 */
import { stepNumber, type ExplainerPlan } from "../explainer/plan";
import type { PlayerState } from "../explainer/player";
import { framesEqual, homeFrame, type Frame } from "../explainer/camera";
import { clampInside } from "../explainer/camera-path";
import {
  beatAt,
  buildSchedule,
  cameraAt,
  evaluate,
  stepAt,
  type EdgeFollow,
  type Schedule,
} from "./schedule";
import type { DiagramRenderer } from "./renderer";
import type { Scene } from "./scene";

export interface GpuPlayerOptions {
  camera: boolean;
  onFrame: (frame: Frame) => void;
  /**
   * The narrowest close-up, in diagram units: about a stage's width at a size
   * where labels read. The SVG camera caps close-ups relative to the whole
   * diagram, which on a 10,000-node map still leaves every label a smudge.
   */
  readableSpan: number;
  /** Show each arrow's step number on it. */
  numbers: boolean;
}

/** How much of the close-up the beat itself fills, as in camera.ts. */
const FOCUS_FILL = 0.55;
/** Past this many steps the camera travels faster between beats. */
const BRISK_STEPS = 800;

/**
 * Frame a whole beat: the node it stands on and every node it reaches.
 *
 * A connection is only explained if both its ends are on screen while it is
 * drawn, so the frame always spans them — zooming out as far as that takes
 * (the beat's nodes are spotlit and keep pinned names, so they stay findable
 * at any zoom). A local beat still gets a readable close-up: the frame is
 * never narrower than `span`, a stage's width at reading size.
 */
function readableFrame(scene: Scene, ids: string[], home: Frame, span: number): Frame {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const node = scene.graph.nodes.get(id);
    if (!node) continue;
    minX = Math.min(minX, node.x - node.width / 2);
    maxX = Math.max(maxX, node.x + node.width / 2);
    minY = Math.min(minY, node.y - node.height / 2);
    maxY = Math.max(maxY, node.y + node.height / 2);
  }
  if (!Number.isFinite(minX)) return home;
  const aspect = home.width / home.height;
  let width = Math.max(1, maxX - minX) / FOCUS_FILL;
  let height = Math.max(1, maxY - minY) / FOCUS_FILL;
  if (width / height > aspect) height = width / aspect;
  else width = height * aspect;
  if (width < span) {
    width = span;
    height = width / aspect;
  }
  if (width >= home.width * 0.9 || height >= home.height * 0.9) return home;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return clampInside({ x: cx - width / 2, y: cy - height / 2, width, height }, home);
}

/**
 * Points along edges and readable frames around them, for a camera that
 * rides long connections instead of cutting away from them.
 */
function edgeFollow(scene: Scene, home: Frame, span: number): EdgeFollow {
  const aspect = home.width / home.height;
  return {
    along(edge, fraction) {
      const from = scene.pointOffsets[edge];
      const to = scene.pointOffsets[edge + 1] - 1;
      if (to <= from) return [scene.points[from * 2], scene.points[from * 2 + 1]];
      const target = scene.edgeLength[edge] * Math.min(1, Math.max(0, fraction));
      let low = from;
      let high = to;
      while (high - low > 1) {
        const mid = (low + high) >> 1;
        if (scene.pointDistance[mid] <= target) low = mid;
        else high = mid;
      }
      const span = scene.pointDistance[high] - scene.pointDistance[low] || 1;
      const t = (target - scene.pointDistance[low]) / span;
      return [
        scene.points[low * 2] + (scene.points[high * 2] - scene.points[low * 2]) * t,
        scene.points[low * 2 + 1] + (scene.points[high * 2 + 1] - scene.points[low * 2 + 1]) * t,
      ];
    },
    around(x, y) {
      const width = Math.min(span, home.width);
      const height = width / aspect;
      return clampInside({ x: x - width / 2, y: y - height / 2, width, height }, home);
    },
  };
}

function labelShowsNumber(lines: string[] | undefined, number: string): boolean {
  return stepNumber(lines?.join(" "))?.join(".") === number;
}

export class GpuPlayer {
  private readonly schedule: Schedule;
  private raf = 0;
  private lastTick = 0;
  private time = 0;
  private playing = false;
  private stopAt: number | null = null;
  private speed = 1;
  private appliedFrame: Frame | null = null;
  private destroyed = false;

  private readonly renderer: DiagramRenderer;
  private readonly onState: (state: PlayerState) => void;
  private readonly options: GpuPlayerOptions;

  constructor(
    scene: Scene,
    plan: ExplainerPlan,
    renderer: DiagramRenderer,
    onState: (state: PlayerState) => void,
    options: GpuPlayerOptions,
  ) {
    this.renderer = renderer;
    this.onState = onState;
    this.options = options;
    const home = homeFrame(scene.graph);
    const span = options.readableSpan > 0 ? options.readableSpan : 1200;
    const labels: string[] = new Array(scene.nodeCount);
    for (const [id, i] of scene.nodeIndex) labels[i] = scene.graph.nodes.get(id)?.label ?? "";
    this.schedule = buildSchedule({
      plan,
      nodeCount: scene.nodeCount,
      nodeIndex: scene.nodeIndex,
      edgeIndex: scene.edgeIndex,
      nodeLabel: (i) => labels[i] || "Node",
      edgeLabel: (e) => scene.edgeLines[e]?.join(" ") ?? "",
      home,
      frameFor: (ids) => readableFrame(scene, ids, home, span),
      camera: options.camera,
      // With the camera on, always tour at a readable zoom — a wave over the
      // whole diagram is only worth watching when there is no camera.
      mode: options.camera ? "narrated" : undefined,
      travelScale: plan.steps.length > BRISK_STEPS ? 0.55 : 1,
      edgeFollow: edgeFollow(scene, home, span),
    });
    if (options.numbers) {
      const numbers: (string | undefined)[] = new Array(scene.edgeCount);
      for (const step of plan.steps) {
        if (step.type === "reveal-node" || !step.number) continue;
        const edge = scene.edgeIndex.get(step.edgeId);
        // An arrow whose label already reads as its number needs no badge.
        if (edge !== undefined && !labelShowsNumber(scene.edgeLines[edge], step.number)) {
          numbers[edge] = step.number;
        }
      }
      renderer.setBadges(numbers);
    }
    this.render(0, true);
  }

  get duration(): number {
    return this.schedule.duration;
  }

  get following(): boolean {
    return this.schedule.follow;
  }

  /** "narrated" beat by beat, or "wave" for diagrams too big to narrate. */
  get mode(): Schedule["mode"] {
    return this.schedule.mode;
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.playing = false;
  }

  private render(t: number, immediate: boolean): void {
    if (this.destroyed) return;
    const { renderer } = this;
    renderer.spotlight = evaluate(this.schedule, t, renderer.nodeState, renderer.edgeState);
    const frame = cameraAt(this.schedule, t);
    if (!this.appliedFrame || !framesEqual(this.appliedFrame, frame)) {
      this.options.onFrame(frame);
      this.appliedFrame = frame;
    }
    renderer.markState();
    if (immediate) renderer.render();
  }

  private emit(): void {
    this.onState({
      time: this.time,
      duration: this.duration,
      playing: this.playing,
      index: stepAt(this.schedule, this.time),
      stepCount: this.schedule.kind.length,
      beat: beatAt(this.schedule, this.time),
      beatCount: this.schedule.beats.length,
    });
  }

  private tick = (now: number): void => {
    if (!this.playing || this.destroyed) return;
    const delta = this.lastTick === 0 ? 16 : now - this.lastTick;
    this.lastTick = now;
    const limit = this.stopAt ?? this.duration;
    this.time = Math.min(limit, this.time + delta * this.speed);
    this.render(this.time, true);
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
    if (this.time >= this.duration) {
      this.time = 0;
      this.render(0, false);
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
    this.render(this.time, false);
    this.emit();
  }

  restart(): void {
    this.seek(0);
    this.play();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /** One beat forward (played, not jumped) or back (instant), as in the SVG player. */
  step(direction: 1 | -1): void {
    const { beats } = this.schedule;
    if (beats.length === 0) return;
    if (direction === 1) {
      if (this.playing && this.stopAt !== null) this.seek(this.stopAt);
      else if (this.playing) this.pause();
      const t = this.time;
      if (t >= this.duration) return;
      const current = beatAt(this.schedule, t);
      let target: number;
      if (current < 0) {
        target = this.duration;
      } else {
        const beat = beats[current];
        target = t >= beat.end - 1 ? (beats[current + 1]?.end ?? this.duration) : beat.end;
      }
      this.stopAt = Math.max(target, t);
      this.run();
      return;
    }
    this.pause();
    const t = this.time;
    let target = 0;
    for (const beat of beats) {
      if (beat.end < t - 1) target = Math.max(target, beat.end);
      else break;
    }
    this.seek(target);
  }

  describe(beat: number): string {
    const { beats } = this.schedule;
    if (beat < 0) return beats.length > 1 ? "The whole picture" : "";
    return beats[beat]?.caption ?? "";
  }
}
