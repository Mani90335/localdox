// Reading a picked batch of files, a few at a time.
//
// An import used to start every read at once. A batch of 300 files meant 300
// FileReaders in flight, each holding its raw bytes and building a base64
// copy, before the first one was stored. One unreadable file (moved or edited
// after it was picked) rejected the whole batch, and nothing could stop it.
//
// Here at most `concurrency` files, and at most `maxBytes` of estimated
// stored size, are read at once. The first read always starts, however large,
// so a single big file is never stuck. Each file settles on its own: a failure
// is reported for that file and the rest carry on. Aborting stops new reads
// and rejects at once; reads already running finish and are discarded.

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

export interface QueueOptions<I> {
  /** Most items being read at once. */
  concurrency: number;
  /** Most weight being read at once. A lone item may exceed it. */
  maxBytes: number;
  weigh: (item: I) => number;
  signal?: AbortSignal;
  /** After each item settles, with the count settled so far. */
  onSettled?: (done: number, total: number) => void;
}

/**
 * Four reads, 48 MiB in flight. As fast as reading everything at once for
 * 300 small files and for 24 × 5 MiB (documentation/import-queue.md).
 */
export const IMPORT_QUEUE = { concurrency: 4, maxBytes: 48 * 1024 * 1024 } as const;

/** Runs `task` over `items` within the bounds; results are in input order. */
export function runBounded<I, T>(
  items: readonly I[],
  task: (item: I) => Promise<T>,
  options: QueueOptions<I>,
): Promise<Settled<T>[]> {
  const { concurrency, maxBytes, weigh, signal, onSettled } = options;
  return new Promise((resolve, reject) => {
    const results: Settled<T>[] = new Array(items.length);
    let next = 0;
    let active = 0;
    let bytes = 0;
    let done = 0;
    let finished = false;

    const abort = () => {
      if (finished) return;
      finished = true;
      reject(signal?.reason);
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });

    const pump = () => {
      if (finished) return;
      if (done === items.length) {
        finished = true;
        signal?.removeEventListener("abort", abort);
        resolve(results);
        return;
      }
      while (next < items.length && active < concurrency) {
        const weight = weigh(items[next]);
        if (active > 0 && bytes + weight > maxBytes) break;
        const index = next++;
        active++;
        bytes += weight;
        // Through a microtask, so a task that throws synchronously is still
        // one failed item rather than a broken queue.
        Promise.resolve()
          .then(() => task(items[index]))
          .then(
            (value) => (results[index] = { ok: true, value }),
            (error) => (results[index] = { ok: false, error }),
          )
          .then(() => {
            active--;
            bytes -= weight;
            done++;
            if (!finished) onSettled?.(done, items.length);
            pump();
          });
      }
    };
    pump();
  });
}
