// Compiles interactive examples off the reader's thread, once per source.
//
// - One worker holds Babel and compiles one example at a time, in order.
// - Results are cached by source text, bounded by bytes, least recently used
//   out; an example compiling now is shared, not compiled twice. Compile
//   errors are results and are cached too. Failures of the compiler itself
//   (a timeout, a crash, a worker that can't start) reject, and the cache
//   forgets them, so the next attempt starts over.
// - A compile that runs past the time limit is stopped by terminating the
//   worker. The next compile starts a fresh one.
//
// There is deliberately no main-thread fallback. The usual reason the worker
// can't start (its script isn't cached and the network is gone) would stop a
// main-thread Babel just the same, and keeping one would ship Babel twice: a
// worker bundle can't share a chunk with the page.
import { BoundedPromiseCache } from "../../lib/bounded-promise-cache.ts";
import type { CompileReply, CompileRequest, CompileResult } from "./compile.ts";

/** The compiler itself failed (timed out, crashed, couldn't start). */
export class CompilerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompilerError";
  }
}

export type CompilerWorker = Pick<
  Worker,
  "postMessage" | "addEventListener" | "removeEventListener" | "terminate"
>;

export interface CompilerOptions {
  /** May throw where workers aren't available. */
  createWorker: () => CompilerWorker;
  timeoutMs?: number;
  maxCacheBytes?: number;
}

/** Far longer than any real example takes (a 600-line one: ~20 ms on a laptop). */
export const COMPILE_TIMEOUT_MS = 10_000;
/** Source and output are held; a typical example is a few KB of each. */
export const COMPILE_CACHE_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 256;

type Cached = { result: CompileResult; bytes: number };
type Job = {
  id: number;
  source: string;
  resolve: (result: CompileResult) => void;
  reject: (error: unknown) => void;
};

/** UTF-16 bytes of the strings an entry keeps alive. */
function weigh(source: string, result: CompileResult): number {
  const output = result.ok
    ? result.code.length
    : result.message.length + (result.stack?.length ?? 0);
  return (source.length + output) * 2;
}

export function createCompiler(options: CompilerOptions) {
  const timeoutMs = options.timeoutMs ?? COMPILE_TIMEOUT_MS;
  const cache = new BoundedPromiseCache<string, Cached>({
    maxEntries: MAX_ENTRIES,
    maxWeight: options.maxCacheBytes ?? COMPILE_CACHE_BYTES,
    weigh: (entry) => entry.bytes,
  });
  const queue: Job[] = [];
  let current: Job | null = null;
  let worker: CompilerWorker | null = null;
  /** The current worker has loaded Babel. */
  let ready = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextId = 0;
  let workersStarted = 0;
  let posted = 0;

  const onMessage = (event: MessageEvent<CompileReply>) => {
    const data = event.data;
    if (data?.type === "ready") {
      ready = true;
      armTimer();
      return;
    }
    if (data?.type !== "result" || !current || data.id !== current.id) return;
    const result = data.result;
    finish((job) => job.resolve(result));
  };

  const onError = () => {
    const started = ready;
    stopWorker();
    if (started) {
      finish((job) => job.reject(new CompilerError("The compiler stopped unexpectedly.")));
    } else {
      // Never loaded: everything waiting would fail the same way. Whatever
      // asks next gets a fresh attempt (back online, say).
      failAll(new CompilerError("Couldn't load the compiler for live examples."));
    }
  };

  // The limit covers compiling, not downloading Babel: it starts once the
  // worker is ready.
  function armTimer() {
    if (!current || !ready || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      stopWorker();
      finish((job) =>
        job.reject(
          new CompilerError(`Compiling took longer than ${timeoutMs / 1000} s and was stopped.`),
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

  function failAll(error: CompilerError) {
    const jobs = [current, ...queue];
    current = null;
    queue.length = 0;
    for (const job of jobs) job?.reject(error);
  }

  function pump() {
    if (current || queue.length === 0) return;
    if (!worker) {
      try {
        worker = options.createWorker();
        workersStarted++;
      } catch {
        failAll(new CompilerError("Live examples need a browser that can run Web Workers."));
        return;
      }
      worker.addEventListener("message", onMessage as EventListener);
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onError);
    }
    const job = queue.shift()!;
    current = job;
    const request: CompileRequest = { id: job.id, source: job.source };
    worker.postMessage(request);
    posted++;
    armTimer();
  }

  return {
    /** Resolves with the compiled code or the compile error; rejects with
     *  CompilerError only when the compiler itself failed. */
    compile(source: string): Promise<CompileResult> {
      return cache
        .get(
          source,
          () =>
            new Promise<Cached>((resolve, reject) => {
              queue.push({
                id: ++nextId,
                source,
                resolve: (result) => resolve({ result, bytes: weigh(source, result) }),
                reject,
              });
              pump();
            }),
        )
        .then((entry) => entry.result);
    },
    /** For tests and debugging. */
    stats() {
      return {
        entries: cache.size,
        bytes: cache.weight,
        workersStarted,
        posted,
        queued: queue.length,
      };
    },
    close() {
      stopWorker();
      failAll(new CompilerError("The compiler was closed."));
      cache.clear();
    },
  };
}

export type Compiler = ReturnType<typeof createCompiler>;
