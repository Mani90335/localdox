# Diagram playback: what runs, how often, and when it stops

Stepped and Flow are the two animated ways to show a Mermaid diagram. This
note explains how their frame loops are paced and why.

## The problem

A diagram animation has two kinds of output:

1. **The picture.** SVG stroke offsets and opacities, or the GPU engine's state
   buffers. These must change every frame (about 60 times a second) or the
   motion stutters.
2. **The controls around it.** The scrubber, the `0:12 / 0:54` clock, the
   "3/16 Gateway → Auth" caption, and the play button. These are React
   components, and a human reads them at a glance.

Until R01 (audit 2026-09-27), both players sent their state to React on every
frame. Each update re-rendered the whole `MermaidExplainer` component, 60
times a second per diagram. A diagram also never stopped. Once it had mounted
it kept animating after the reader scrolled past it, and in background tabs.
Reduced motion turned the camera off, but playback still started on its own.

Measured on the production build with three Stepped diagrams in one document
(1280×800, Chromium, three runs each):

|                                                | before | after   |
| ---------------------------------------------- | ------ | ------- |
| one on screen: frame callbacks/s               | 181    | 61      |
| one on screen: control renders/s               | 180    | 9.7     |
| one on screen: script ms per second            | 26–30  | 7.6–8.9 |
| all off screen: frame callbacks/s              | 180    | 0       |
| all off screen: main-thread task ms per second | 86–111 | 0.8–1.3 |
| reduced motion: starts playing                 | yes    | no      |

## The mental model

Think of a film projector and the counter on its side. The projector must run
at full speed. Nobody needs the counter to update 60 times a second, and
nobody needs the projector running in an empty room.

- **Draw every frame** (the projector): imperative DOM or GPU writes, no React.
- **Publish coarsely** (the counter): React hears about playback at most every
  100 ms (`PUBLISH_MS`). A beat change is published straight away (never more
  often than every 50 ms), so the caption turns over with the picture. Anything
  the reader does (play, pause, seek, step), and the end of a run, is published
  at once.
- **Stop when unseen** (the empty room): off screen or in a background tab, no
  frames run. The play state is kept, so the button still says Pause. Seen
  again, the diagram carries on from the same moment. It does not jump ahead
  by the time it was hidden.

## Architecture

```
MermaidExplainer (React)
 ├─ useStageVisibility(host) ── IntersectionObserver + visibilitychange
 │        └─ player.setVisible(visible)
 └─ ExplainerPlayer (SVG)  ┐
    GpuPlayer (WebGL)      ┘─ both own a PlaybackClock (explainer/clock.ts)
                                 ├─ frame loop → host.draw(t)       every frame
                                 └─ onState(PlayerState) → setState ≤10 Hz + events

AnimatorStage (Flow, mermaid-animator)
 └─ useStageVisibility(container) → animator.pause() / resume()
```

- `src/services/diagrams/explainer/clock.ts`: `PlaybackClock` owns time, play
  state, speed, `stopAt` (where a step forward ends), the requestAnimationFrame
  loop, visibility and publishing. Both players used to carry identical copies
  of this code. They now provide two callbacks: `draw(t, live)` and
  `describeAt(t)` (step and beat indices for the published state).
- `src/services/diagrams/use-stage-visibility.ts`: `useStageVisibility`
  reports whether any part of the stage is in the viewport and the tab is
  visible. `prefersReducedMotion()` is read when a player starts.
- The scrubber fill moves with a `translateX` transform and a 100 ms linear
  transition while playing. Updates arrive every 100 ms, so the bar glides
  rather than steps. A seek or pause sets the duration to 0 and lands at once.
  `translateX` rather than `scaleX`, because scaling squashes the rounded end.

## Reduced motion

With `prefers-reduced-motion: reduce`, Stepped opens paused on the finished
diagram, captioned "The whole picture". Play walks through it from the top.
The camera was already off under
reduced motion (`useCameraPreference`). This is read once, when the player
starts. Changing the system setting takes effect the next time the diagram is
rendered.

Flow is a mode the reader picks explicitly. It keeps playing under reduced
motion, as before.

## Trade-offs and failure behaviour

- **Frame-time clamp.** One frame advances the timeline by at most 100 ms
  (`MAX_FRAME_MS`). A long task, or the first frame back after hiding, can't
  make the animation skip. The cost: on a device below 10 fps the walkthrough
  runs slower than real time rather than dropping beats.
- **Mounted ahead.** `MermaidBlock` mounts a diagram 800 px before it scrolls
  into view. Stepped pauses at t=0 until it is actually seen, so the reader
  sees the walkthrough from the start.
- **Flow's loop.** `mermaid-animator` has no way to stop its frame loop short
  of destroying the animator. Paused, its per-frame callback returns without
  painting, which costs almost nothing. It is not zero frames.
- **No IntersectionObserver.** The stage counts as visible and behaves as it
  did before.
- **Not addressed here (R02).** SVG and scene caches are bounded by entry
  count, not bytes. GPU contexts stay alive while a diagram is mounted.

## Tests

- `tests/playback-clock.test.ts`: publish cadence, beat-change publishing,
  forced publishes, step targets, hidden/visible resume without a jump, frame
  clamp, speed, destroy. It uses a fake frame scheduler. Removing the
  throttle, the beat fast path, the visibility check, the clamp or the resume
  reset each fails a test.
- `tests/e2e/diagram-players.spec.ts`: on the production build, Stepped (SVG
  and GPU) and Flow stop off screen and resume. A background tab runs no player
  frames. Controls render ≤30 times in 2 s while the picture keeps animating.
  Reduced motion opens paused on the whole picture. All five fail on the
  pre-R01 build. The reduced-motion test reads the button's label straight
  away, because a short walkthrough left to play would also end on "Play".
