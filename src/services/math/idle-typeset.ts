// Typesetting that only ever uses time the browser isn't using.
//
// The reader's equations share a 12 ms per-task budget (render-budget.ts) so a
// document full of math never builds a long task. Equations shown *beside* the
// document — the Notes panel — must not draw on that budget: every slice they
// took would be one the document's own equations waited for.
//
// So they take nothing from it. First they look in the shared render cache: an
// equation copied out of a document was typeset moments earlier, and costs a
// map lookup. Only a miss (after a reload, or a note typed by hand) is
// typeset, and then only inside `requestIdleCallback`, bounded by the
// deadline the browser grants, one equation at a time. Results go back into
// the shared cache, so the document's own copy of the equation is free too.
//
// KaTeX only. An expression KaTeX can't draw keeps showing its LaTeX source
// rather than pulling MathJax (~1 MB) in for a side panel — unless the
// document already drew it with MathJax, in which case the cache has it.

import { isKatexLoaded, loadKatex } from "./adapters/katex.ts";
import { renderMathIdle } from "./renderer.ts";
import type { MathRenderRequest, RenderedMath } from "./types.ts";

/** The part of `IdleDeadline` this module reads. */
export interface IdleDeadlineLike {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

export type IdleScheduler = (run: (deadline: IdleDeadlineLike) => void) => void;

/**
 * `requestIdleCallback`, or — in Safari, which still lacks it — a short timer
 * that grants a fixed 8 ms slice, well under a frame.
 */
const browserIdle: IdleScheduler = (run) => {
  if (typeof requestIdleCallback === "function") {
    // The timeout only guarantees progress on a page that is never idle; a
    // timed-out callback still does a single equation.
    requestIdleCallback(run, { timeout: 2000 });
    return;
  }
  setTimeout(() => {
    const start = performance.now();
    run({ didTimeout: false, timeRemaining: () => Math.max(0, 8 - (performance.now() - start)) });
  }, 50);
};

/**
 * Left unused at the end of an idle period, for the commit that inserts the
 * markup and whatever the browser does next. One KaTeX expression plus its
 * sanitizing is ~0.25 ms on a fast machine and a few ms on a slow one.
 */
const MARGIN_MS = 4;

interface Job {
  request: MathRenderRequest;
  waiters: Array<(result: RenderedMath | undefined) => void>;
}

export interface IdleTypesetterOptions {
  schedule?: IdleScheduler;
  isLoaded?: () => boolean;
  load?: () => Promise<unknown>;
  render?: (request: MathRenderRequest) => RenderedMath | undefined;
}

export function createIdleTypesetter({
  schedule = browserIdle,
  isLoaded = isKatexLoaded,
  load = loadKatex,
  render = renderMathIdle,
}: IdleTypesetterOptions = {}) {
  // Keyed by what determines the output, so ten copies of `\hbar` are one job.
  const jobs = new Map<string, Job>();
  let scheduled = false;

  const keyOf = (r: MathRenderRequest) =>
    `${r.renderer ?? "auto"}|${r.displayMode ? "d" : "i"}|${r.latex}`;

  const settle = (key: string, job: Job, result: RenderedMath | undefined) => {
    jobs.delete(key);
    for (const waiter of job.waiters) waiter(result);
  };

  const pump = () => {
    if (scheduled || jobs.size === 0) return;
    scheduled = true;
    schedule(run);
  };

  const run = (deadline: IdleDeadlineLike) => {
    scheduled = false;
    // Downloading KaTeX is not typesetting: start it, and typeset in a later
    // idle period once it has landed.
    if (!isLoaded()) {
      load().then(pump, () => {
        for (const [key, job] of jobs) settle(key, job, undefined);
      });
      return;
    }
    let done = 0;
    for (const [key, job] of jobs) {
      // A timed-out callback still makes progress, one equation's worth.
      const room = deadline.timeRemaining() > MARGIN_MS || (deadline.didTimeout && done === 0);
      if (!room) break;
      settle(key, job, render(job.request));
      done++;
    }
    pump();
  };

  return {
    /** Typeset when the browser is idle; `undefined` if KaTeX can't draw it. */
    typeset(request: MathRenderRequest): Promise<RenderedMath | undefined> {
      return new Promise((resolve) => {
        const key = keyOf(request);
        const existing = jobs.get(key);
        if (existing) existing.waiters.push(resolve);
        else jobs.set(key, { request, waiters: [resolve] });
        pump();
      });
    },
    /** Equations waiting for an idle period. */
    get pending() {
      return jobs.size;
    },
  };
}

/** The app's one idle typesetter. */
export const idleTypesetter = createIdleTypesetter();
