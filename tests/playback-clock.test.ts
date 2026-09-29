// R01: the Stepped players' shared transport. Drawing runs every frame;
// React hears about it ~10 times a second, at beat changes, and at once for
// anything the reader did. An unseen stage runs no frames and resumes from
// the same moment.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_FRAME_MS,
  PUBLISH_MS,
  PlaybackClock,
  type ClockHost,
  type FrameScheduler,
} from "../src/services/diagrams/explainer/clock.ts";
import type { PlayerState } from "../src/services/diagrams/explainer/player.ts";

/** A frame loop driven by the test: `frame(now)` runs what was requested. */
class FakeFrames implements FrameScheduler {
  private next = 1;
  pending = new Map<number, (now: number) => void>();
  request(callback: (now: number) => void): number {
    const handle = this.next++;
    this.pending.set(handle, callback);
    return handle;
  }
  cancel(handle: number): void {
    this.pending.delete(handle);
  }
  frame(now: number): void {
    const due = [...this.pending.values()];
    this.pending.clear();
    for (const callback of due) callback(now);
  }
}

/** A host with one beat per `beatMs` and a record of every draw. */
function setup(duration = 10_000, beatMs = 2_000) {
  const frames = new FakeFrames();
  const draws: { t: number; live: boolean }[] = [];
  const states: PlayerState[] = [];
  const host: ClockHost = {
    draw: (t, live) => draws.push({ t, live }),
    describeAt: (t) => ({
      index: 0,
      stepCount: 5,
      beat: t >= duration ? -1 : Math.floor(t / beatMs),
      beatCount: Math.ceil(duration / beatMs),
    }),
  };
  const clock = new PlaybackClock(host, duration, (state) => states.push(state), frames);
  /** Run `count` frames at 60 fps from `start`; returns the next frame's time. */
  const play = (count: number, start: number) => {
    let now = start;
    for (let i = 0; i < count; i++) {
      frames.frame(now);
      now += 1000 / 60;
    }
    return now;
  };
  return { clock, frames, draws, states, play };
}

test("drawing runs every frame; React is told about ten times a second", () => {
  const { clock, draws, states, play } = setup(60_000, 60_000);
  clock.play();
  states.length = 0;
  play(120, 1_000); // two seconds
  assert.equal(draws.length, 120);
  // 2 s at one publish per PUBLISH_MS, give or take the first frame.
  assert.ok(states.length >= 18 && states.length <= 21, `published ${states.length} times`);
  for (let i = 1; i < states.length; i++) {
    assert.ok(states[i].time - states[i - 1].time >= PUBLISH_MS - 17);
  }
});

test("a new beat is published in the frame it starts, not up to 100 ms later", () => {
  const { clock, states, play } = setup(10_000, 500);
  clock.play();
  play(120, 0);
  const beats = states.map((state) => state.beat);
  for (let beat = 1; beat < 4; beat++) {
    const first = states.find((state) => state.beat === beat);
    assert.ok(first, `beat ${beat} was published`);
    // The first publish of a beat is within one frame (+ the 50 ms floor) of
    // its start at beat × 500 ms.
    assert.ok(first.time - beat * 500 < 17 + 50, `beat ${beat} published at ${first.time}`);
  }
  assert.deepEqual([...new Set(beats)], [0, 1, 2, 3]);
});

test("reader actions and the end of a run publish at once", () => {
  const { clock, states, play } = setup(1_000);
  clock.play();
  assert.equal(states.at(-1)?.playing, true);
  let now = play(3, 0);
  clock.pause();
  assert.deepEqual(
    { playing: states.at(-1)?.playing, time: Math.round(states.at(-1)!.time) },
    { playing: false, time: 49 }, // 16 + 2 × 16.7 ms
  );
  clock.seek(400);
  assert.equal(states.at(-1)?.time, 400);
  clock.play();
  now = play(200, now);
  const last = states.at(-1)!;
  assert.equal(last.playing, false);
  assert.equal(last.time, 1_000);
  assert.equal(last.beat, -1);
});

test("a step forward stops exactly at its target and says so", () => {
  const { clock, states, frames, play } = setup(10_000);
  clock.run(700);
  play(100, 0);
  assert.equal(clock.now, 700);
  assert.equal(clock.isPlaying, false);
  assert.equal(frames.pending.size, 0);
  assert.deepEqual(
    { time: states.at(-1)!.time, playing: states.at(-1)!.playing },
    {
      time: 700,
      playing: false,
    },
  );
});

test("an unseen stage runs no frames and resumes from the same moment", () => {
  const { clock, frames, draws, states, play } = setup(60_000);
  clock.play();
  let now = play(30, 0);
  const at = clock.now;
  clock.setVisible(false);
  assert.equal(frames.pending.size, 0, "the pending frame is cancelled");
  const drawn = draws.length;
  const published = states.length;
  frames.frame(now + 5_000);
  assert.equal(draws.length, drawn);
  assert.equal(states.length, published, "nothing re-renders while hidden");
  assert.equal(clock.now, at);
  assert.equal(clock.isPlaying, true, "the reader's play state is kept");

  // Thirty seconds later it is seen again: it carries on from `at`, it does
  // not jump by the time it spent hidden.
  now += 30_000;
  clock.setVisible(true);
  play(1, now);
  assert.ok(clock.now - at <= 17, `advanced ${clock.now - at} ms`);
});

test("play while hidden waits for the stage to be seen", () => {
  const { clock, frames, draws, states } = setup();
  clock.setVisible(false);
  clock.play();
  assert.equal(states.at(-1)?.playing, true);
  assert.equal(frames.pending.size, 0);
  clock.setVisible(true);
  assert.equal(frames.pending.size, 1);
  frames.frame(100);
  assert.equal(draws.length, 1);
});

test("a long frame advances the timeline by at most MAX_FRAME_MS", () => {
  const { clock, play } = setup(60_000);
  clock.play();
  play(2, 0); // first frame counts 16 ms, second ~16.7
  const at = clock.now;
  play(1, 5_000); // a 5 s stall
  assert.equal(clock.now - at, MAX_FRAME_MS);
});

test("speed scales time, not the publish rate", () => {
  const { clock, states, play } = setup(600_000, 600_000);
  clock.setSpeed(8);
  clock.play();
  states.length = 0;
  play(60, 0);
  assert.ok(states.length <= 11, `published ${states.length} times`);
  assert.ok(clock.now > 7_000);
});

test("destroy cancels the frame loop for good", () => {
  const { clock, frames, draws } = setup();
  clock.play();
  clock.destroy();
  assert.equal(frames.pending.size, 0);
  clock.setVisible(false);
  clock.setVisible(true);
  clock.play();
  frames.frame(0);
  assert.equal(draws.length, 0);
});
