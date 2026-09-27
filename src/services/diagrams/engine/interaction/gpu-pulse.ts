/**
 * Flash a node briefly to confirm "this is the search result" — the GPU
 * path's equivalent of the SVG path's amber match outline.
 *
 * `DiagramRenderer.nodeState`'s third slot is a `pulse` value the fragment
 * shader already turns into a brightness dip-and-recover as it rises from 0
 * to 1 (`renderer.ts`'s `pulse = 1.0 - 0.45 * sin(pi * v_state.z)`),
 * independent of the spotlight/focus machinery — built for revisiting an
 * already-drawn node during Stepped playback, but exactly the "found it"
 * flash a search jump needs too, with no shader changes.
 */

import type { DiagramRenderer } from "../renderer";
import type { Scene } from "../scene";

const PULSE_MS = 900;

/** Cancels the flash in progress, if any, so overlapping jumps don't fight. */
export function createPulser(renderer: DiagramRenderer, scene: Scene) {
  let raf = 0;
  let activeIndex: number | null = null;

  function stop(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (activeIndex !== null) {
      renderer.nodeState[activeIndex * 4 + 2] = 0;
      activeIndex = null;
    }
  }

  function pulse(nodeId: string): void {
    stop();
    const index = scene.nodeIndex.get(nodeId);
    if (index === undefined) return;
    activeIndex = index;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / PULSE_MS);
      renderer.nodeState[index * 4 + 2] = t < 1 ? t : 0;
      renderer.markState();
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        raf = 0;
        activeIndex = null;
      }
    };
    raf = requestAnimationFrame(step);
  }

  return { pulse, stop };
}
