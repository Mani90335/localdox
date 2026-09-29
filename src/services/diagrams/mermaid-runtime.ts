/**
 * The one door to Mermaid: every job that configures it runs alone.
 *
 * Mermaid is a single global. `initialize()` replaces the configuration, and a
 * render reads it again after its first `await`: the diagram's renderer calls
 * `getConfig()` while it draws. Mermaid queues its own renders, but not the
 * `initialize()` in front of each one, and not `getDiagramFromText()`. So two
 * callers with different settings overwrote each other mid-render. A normal
 * diagram rendered next to a large one (performance mode, `htmlLabels: false`)
 * or next to a GPU stage reading its theme came out with plain-text labels, and
 * the render cache kept that wrong SVG under the normal key.
 *
 * Here a job is: load Mermaid, apply its configuration, do the work, and only
 * then let the next job start. The work is main-thread layout either way, so
 * running one at a time costs no throughput.
 *
 * Never call `withMermaid` from inside a job: the inner call waits for the
 * outer one to finish, which waits for the inner one.
 */

export type MermaidApi = typeof import("mermaid").default;
type MermaidConfig = Parameters<MermaidApi["initialize"]>[0];

export interface MermaidJobOptions {
  /** Applied with `initialize()` before the job. Omit when the job configures Mermaid itself. */
  config?: MermaidConfig;
  /** Names the job's User Timing entry: `mermaid:<label>`. */
  label?: string;
}

interface Configurable {
  initialize(config: MermaidConfig): void;
}

/**
 * A FIFO queue over one Mermaid-like instance. The loader is injectable so the
 * ordering can be tested without a DOM.
 */
export function createMermaidQueue<M extends Configurable>(load: () => Promise<M>) {
  let tail: Promise<unknown> = Promise.resolve();

  return function withMermaid<T>(
    job: (mermaid: M) => Promise<T> | T,
    { config, label = "job" }: MermaidJobOptions = {},
  ): Promise<T> {
    const queuedAt = now();
    const run = tail.then(async () => {
      const startedAt = now();
      try {
        const mermaid = await load();
        if (config) mermaid.initialize({ startOnLoad: false, ...config });
        return await job(mermaid);
      } finally {
        measure(label, queuedAt, startedAt);
      }
    });
    // A failed job must not stop the ones behind it.
    tail = run.catch(() => undefined);
    return run;
  };
}

export const withMermaid = createMermaidQueue<MermaidApi>(() =>
  import("mermaid").then((module) => module.default),
);

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/**
 * One User Timing entry per job, from start to finish, with the time it waited
 * in the queue. It shows up in the DevTools Performance panel's Timings track
 * and in `performance.getEntriesByName("mermaid:render")`.
 */
function measure(label: string, queuedAt: number, startedAt: number): void {
  if (typeof performance === "undefined" || typeof performance.measure !== "function") return;
  try {
    performance.measure(`mermaid:${label}`, {
      start: startedAt,
      end: now(),
      detail: { waitedMs: Math.round(startedAt - queuedAt) },
    });
  } catch {
    // Instrumentation must never fail a render.
  }
}
