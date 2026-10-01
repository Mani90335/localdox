// Runs Compute requests off the reader's thread.
//
// - One worker holds the math engine and works on one request at a time, in
//   order. Reading, scrolling and typing never wait for it.
// - Results are cached by request (operation, variable, input), least
//   recently used out. Engine answers are results, including "unsupported"
//   or "syntax" ones, and are cached. Failures of the worker itself (a
//   timeout, a crash, a worker that can't start, a cancellation) reject with
//   ComputeError and are never cached, so the next attempt starts over.
// - The engine stops itself at its own time limit (engine.ts). Work it can't
//   interrupt is stopped here, by terminating the worker; the next request
//   starts a fresh one.
// - Cancelling the request being computed also terminates the worker: the
//   engine is synchronous, so there is no other way to stop it.
//
// No main-thread fallback, as for interactive examples: the usual reason a
// worker can't start (its script isn't cached and the network is gone) would
// stop a main-thread engine the same way, and keeping one would ship the
// engine twice.
import type { ComputeRequest, ComputeResult, WorkerReply, WorkerRequest } from "./protocol.ts";

export type ComputeErrorKind = "timeout" | "crashed" | "load-failed" | "unavailable" | "cancelled";

/** The worker failed, or the request was cancelled. Not a result: never cached. */
export class ComputeError extends Error {
  readonly kind: ComputeErrorKind;
  constructor(kind: ComputeErrorKind, message: string) {
    super(message);
    this.name = "ComputeError";
    this.kind = kind;
  }
}

export type ComputeWorker = Pick<
  Worker,
  "postMessage" | "addEventListener" | "removeEventListener" | "terminate"
>;

export interface ComputeClientOptions {
  /** May throw where workers aren't available. */
  createWorker: () => ComputeWorker;
  timeoutMs?: number;
  maxCacheEntries?: number;
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Called once the engine is loaded and working on this request. */
  onComputing?: () => void;
}

/**
 * Past the engine's own 4 s limit (which it checks between steps), with room
 * for a slow device. Only work the engine can't interrupt gets this far.
 */
export const COMPUTE_TIMEOUT_MS = 8_000;
export const COMPUTE_CACHE_ENTRIES = 100;

type Job = {
  id: number;
  request: ComputeRequest;
  resolve: (result: ComputeResult) => void;
  reject: (error: ComputeError) => void;
  onComputing?: () => void;
};

/** The cache key: a request is its operation, its variable and its input. */
export function requestKey(request: ComputeRequest): string {
  const variable = request.op === "solve" ? (request.variable ?? "").trim() : "";
  return `${request.op}\u0000${variable}\u0000${request.input.trim()}`;
}

export function createComputeClient(options: ComputeClientOptions) {
  const timeoutMs = options.timeoutMs ?? COMPUTE_TIMEOUT_MS;
  const maxEntries = options.maxCacheEntries ?? COMPUTE_CACHE_ENTRIES;
  const cache = new Map<string, ComputeResult>();
  const queue: Job[] = [];
  let current: Job | null = null;
  let worker: ComputeWorker | null = null;
  /** The current worker has loaded the engine. */
  let ready = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextId = 0;
  let workersStarted = 0;
  let posted = 0;

  const onMessage = (event: MessageEvent<WorkerReply>) => {
    const data = event.data;
    if (data?.type === "ready") {
      ready = true;
      started();
      return;
    }
    if (data?.type !== "result" || !current || data.id !== current.id) return;
    const { result } = data;
    remember(requestKey(current.request), result);
    finish((job) => job.resolve(result));
  };

  const onError = () => {
    const loaded = ready;
    stopWorker();
    if (loaded) {
      finish((job) =>
        job.reject(new ComputeError("crashed", "The math engine stopped unexpectedly. Try again.")),
      );
    } else {
      // Never loaded: everything waiting would fail the same way. Whatever
      // asks next gets a fresh attempt (back online, say).
      failAll(
        new ComputeError(
          "load-failed",
          "Couldn't load the math engine. It downloads on first use, so check the connection and try again.",
        ),
      );
    }
  };

  function remember(key: string, result: ComputeResult) {
    cache.delete(key);
    cache.set(key, result);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
  }

  // The limit covers computing, not downloading the engine: it starts once
  // the worker is ready.
  function started() {
    if (!current || !ready || timer !== undefined) return;
    current.onComputing?.();
    timer = setTimeout(() => {
      timer = undefined;
      stopWorker();
      finish((job) =>
        job.reject(
          new ComputeError(
            "timeout",
            `Stopped after ${timeoutMs / 1000} s: this is more than the engine can do here.`,
          ),
        ),
      );
    }, timeoutMs);
  }

  function stopWorker() {
    clearTimeout(timer);
    timer = undefined;
    if (!worker) return;
    worker.removeEventListener("message", onMessage as EventListener);
    worker.removeEventListener("error", onError);
    worker.removeEventListener("messageerror", onError);
    worker.terminate();
    worker = null;
    ready = false;
  }

  function finish(settle: (job: Job) => void) {
    clearTimeout(timer);
    timer = undefined;
    const job = current;
    current = null;
    if (job) settle(job);
    pump();
  }

  function failAll(error: ComputeError) {
    const jobs = [current, ...queue];
    current = null;
    queue.length = 0;
    for (const job of jobs) job?.reject(error);
  }

  /** Whether a worker is running (or was just started). */
  function ensureWorker(): boolean {
    if (worker) return true;
    try {
      worker = options.createWorker();
      workersStarted++;
    } catch {
      return false;
    }
    worker.addEventListener("message", onMessage as EventListener);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onError);
    return true;
  }

  function pump() {
    if (current || queue.length === 0) return;
    if (!ensureWorker() || !worker) {
      failAll(new ComputeError("unavailable", "Compute needs a browser that can run Web Workers."));
      return;
    }
    const job = queue.shift()!;
    current = job;
    const message: WorkerRequest = { id: job.id, request: job.request };
    worker.postMessage(message);
    posted++;
    started();
  }

  function cancel(job: Job) {
    const error = new ComputeError("cancelled", "Cancelled.");
    if (current === job) {
      // The engine can't be interrupted mid-step; a fresh worker serves the rest.
      stopWorker();
      finish((it) => it.reject(error));
      return;
    }
    const index = queue.indexOf(job);
    if (index >= 0) {
      queue.splice(index, 1);
      job.reject(error);
    }
  }

  return {
    /**
     * Resolves with the engine's answer (which may itself be a failure such
     * as "unsupported"); rejects with ComputeError only when the worker failed
     * or the request was cancelled.
     */
    run(request: ComputeRequest, { signal, onComputing }: RunOptions = {}): Promise<ComputeResult> {
      const key = requestKey(request);
      const hit = cache.get(key);
      if (hit) {
        remember(key, hit);
        return Promise.resolve(hit);
      }
      if (signal?.aborted) return Promise.reject(new ComputeError("cancelled", "Cancelled."));
      return new Promise<ComputeResult>((resolve, reject) => {
        const job: Job = { id: ++nextId, request, resolve, reject, onComputing };
        if (signal) {
          const abort = () => cancel(job);
          signal.addEventListener("abort", abort, { once: true });
          const settled = () => signal.removeEventListener("abort", abort);
          job.resolve = (result) => (settled(), resolve(result));
          job.reject = (error) => (settled(), reject(error));
        }
        queue.push(job);
        pump();
      });
    },
    /** Starts the worker ahead of the first request, so it's loaded by then. */
    warm() {
      // A failure here is reported by the first request.
      ensureWorker();
    },
    /** For tests and debugging. */
    stats() {
      return { entries: cache.size, ready, workersStarted, posted, queued: queue.length };
    },
    close() {
      stopWorker();
      failAll(new ComputeError("cancelled", "The math engine was closed."));
      cache.clear();
    },
  };
}

export type ComputeClient = ReturnType<typeof createComputeClient>;
