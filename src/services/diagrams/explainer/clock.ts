/**
 * The transport both Stepped players share: time, play/pause, speed, the
 * frame loop, and what React is told about it.
 *
 * The players draw imperatively every frame (inline styles on the SVG, or
 * state buffers on the GPU). React only renders the controls around them: the
 * scrubber, the clock, the caption and the play button. None of those need
 * sixty updates a second, and each update was a full component render, so
 * three diagrams on a page cost 180 renders a second before any of them was
 * even on screen.
 *
 * So the clock keeps two rates. Drawing runs every frame. Publishing runs at
 * most every `PUBLISH_MS`, or as soon as the beat changes (so the caption
 * turns over with the picture), and immediately for anything the reader did:
 * play, pause, seek, the end of a run.
 *
 * It also stops the frame loop while the stage can't be seen (scrolled away,
 * or a background tab) and picks up where it left off when it can. Time only
 * advances by what was actually shown, so a diagram never skips ahead while
 * nobody was watching.
 */

import type { PlayerState } from "./player";

/** The slowest the controls update while playing: 10 times a second. */
export const PUBLISH_MS = 100;
/** A beat change publishes at once, but never more often than this. */
const BEAT_PUBLISH_MS = 50;
/**
 * The longest step one frame may take. A frame after a long task, or the
 * first after the stage reappears, would otherwise jump the timeline.
 */
export const MAX_FRAME_MS = 100;

/** What the clock drives: a player that can draw itself at any time. */
export interface ClockHost {
  /** Draw at `t`. `live` is true inside the frame loop. */
  draw(t: number, live: boolean): void;
  /** Everything but time and play state, for the published snapshot. */
  describeAt(t: number): Pick<PlayerState, "index" | "stepCount" | "beat" | "beatCount">;
}

/** The browser's frame loop, injectable for tests. */
export interface FrameScheduler {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

const browserFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export class PlaybackClock {
  private raf = 0;
  private lastTick = 0;
  private time = 0;
  private playing = false;
  /** Where a step-forward stops; null while playing straight through. */
  private stopAt: number | null = null;
  private speed = 1;
  private visible = true;
  private destroyed = false;
  private published: PlayerState | null = null;
  private publishedAt = -Infinity;
  private readonly host: ClockHost;
  private readonly duration: number;
  private readonly onState: (state: PlayerState) => void;
  private readonly frames: FrameScheduler;

  constructor(
    host: ClockHost,
    duration: number,
    onState: (state: PlayerState) => void,
    frames: FrameScheduler = browserFrames,
  ) {
    this.host = host;
    this.duration = duration;
    this.onState = onState;
    this.frames = frames;
  }

  get now(): number {
    return this.time;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get stoppingAt(): number | null {
    return this.stopAt;
  }

  /** Play from here to `stopAt`, or to the end when it is null. */
  run(stopAt: number | null = null): void {
    this.stopAt = stopAt;
    this.playing = true;
    this.lastTick = 0;
    this.schedule();
    this.publish(true);
  }

  play(): void {
    if (this.playing && this.stopAt === null) return;
    // Replay from the top rather than sitting at the end.
    if (this.time >= this.duration) {
      this.time = 0;
      this.host.draw(0, false);
    }
    this.run();
  }

  pause(): void {
    this.stopAt = null;
    if (!this.playing) return;
    this.playing = false;
    this.cancel();
    this.publish(true);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(time: number): void {
    this.time = Math.min(this.duration, Math.max(0, time));
    this.lastTick = 0;
    this.host.draw(this.time, false);
    this.publish(true);
  }

  restart(): void {
    this.seek(0);
    this.play();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /**
   * Whether the stage can be seen. Hidden keeps the reader's play state (the
   * button still says Pause) but runs no frames; shown resumes from the same
   * moment.
   */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.lastTick = 0;
    if (visible) this.schedule();
    else this.cancel();
  }

  destroy(): void {
    this.destroyed = true;
    this.playing = false;
    this.cancel();
  }

  private schedule(): void {
    this.cancel();
    if (!this.playing || !this.visible || this.destroyed) return;
    this.raf = this.frames.request(this.tick);
  }

  private cancel(): void {
    if (this.raf) this.frames.cancel(this.raf);
    this.raf = 0;
  }

  private tick = (now: number): void => {
    this.raf = 0;
    if (!this.playing || !this.visible || this.destroyed) return;
    const delta =
      this.lastTick === 0 ? 16 : Math.min(MAX_FRAME_MS, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    const limit = this.stopAt ?? this.duration;
    this.time = Math.min(limit, this.time + delta * this.speed);
    this.host.draw(this.time, true);
    if (this.time >= limit) {
      this.playing = false;
      this.stopAt = null;
      this.publish(true);
      return;
    }
    this.publish(false, now);
    this.raf = this.frames.request(this.tick);
  };

  private publish(force: boolean, now?: number): void {
    if (this.destroyed) return;
    const state: PlayerState = {
      time: this.time,
      duration: this.duration,
      playing: this.playing,
      ...this.host.describeAt(this.time),
    };
    if (!force && now !== undefined) {
      const since = now - this.publishedAt;
      const newBeat = this.published?.beat !== state.beat;
      if (since < (newBeat ? BEAT_PUBLISH_MS : PUBLISH_MS)) return;
    }
    // Forced publishes (the reader acted) reset the cadence from the next frame.
    this.publishedAt = now ?? -Infinity;
    this.published = state;
    this.onState(state);
  }
}
