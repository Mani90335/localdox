// The import queue: how many reads run at once, what one failure does to the
// rest of the batch, and what cancelling leaves behind.

import assert from "node:assert/strict";
import { test } from "node:test";

import { runBounded } from "../src/lib/workspace/import-queue.ts";

/** A task whose items finish only when the test says so. */
function gated<T>() {
  const pending = new Map<T, { resolve: () => void; reject: (e: unknown) => void }>();
  let active = 0;
  let peak = 0;
  const task = (item: T) =>
    new Promise<T>((resolve, reject) => {
      active++;
      peak = Math.max(peak, active);
      pending.set(item, {
        resolve: () => {
          active--;
          resolve(item);
        },
        reject: (e) => {
          active--;
          reject(e);
        },
      });
    });
  return {
    task,
    pending,
    get peak() {
      return peak;
    },
    started: () => [...pending.keys()],
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("never more than `concurrency` reads at once, and results keep input order", async () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  let active = 0;
  let peak = 0;
  const results = await runBounded(
    items,
    async (i) => {
      active++;
      peak = Math.max(peak, active);
      // Later items finish first, so completion order is not input order.
      await new Promise((resolve) => setTimeout(resolve, (50 - i) % 7));
      active--;
      return i * 2;
    },
    { concurrency: 4, maxBytes: Infinity, weigh: () => 1 },
  );
  assert.equal(peak, 4);
  assert.deepEqual(
    results.map((r) => (r.ok ? r.value : null)),
    items.map((i) => i * 2),
  );
});

test("the byte budget holds back the next read, but a lone large item still runs", async () => {
  const sizes: Record<string, number> = { a: 60, b: 50, c: 10, d: 200 };
  const g = gated<string>();
  const run = runBounded(["a", "b", "c", "d"], g.task, {
    concurrency: 4,
    maxBytes: 100,
    weigh: (item) => sizes[item],
  });
  await tick();
  // a (60) is running; b would make 110.
  assert.deepEqual(g.started(), ["a"]);
  g.pending.get("a")!.resolve();
  await tick();
  // b + c = 60 fits; d would make 260.
  assert.deepEqual(g.started(), ["a", "b", "c"]);
  g.pending.get("b")!.resolve();
  g.pending.get("c")!.resolve();
  await tick();
  // d alone is over budget, but nothing else is running.
  assert.deepEqual(g.started(), ["a", "b", "c", "d"]);
  g.pending.get("d")!.resolve();
  assert.equal(
    (await run).every((r) => r.ok),
    true,
  );
  assert.equal(g.peak, 2);
});

test("one failed read is reported for that item; the others still arrive", async () => {
  const unreadable = new DOMException("The file could not be read.", "NotReadableError");
  const results = await runBounded(
    ["one", "broken", "three", "throws"],
    (name) => {
      if (name === "throws") throw new TypeError("synchronous");
      return name === "broken" ? Promise.reject(unreadable) : Promise.resolve(name.toUpperCase());
    },
    { concurrency: 2, maxBytes: Infinity, weigh: () => 1 },
  );
  assert.deepEqual(results[0], { ok: true, value: "ONE" });
  assert.deepEqual(results[1], { ok: false, error: unreadable });
  assert.deepEqual(results[2], { ok: true, value: "THREE" });
  assert.equal(results[3].ok, false);
  assert.ok(!results[3].ok && results[3].error instanceof TypeError);
});

test("aborting rejects at once and starts nothing more", async () => {
  const g = gated<number>();
  const controller = new AbortController();
  const settled: number[] = [];
  const run = runBounded([1, 2, 3, 4, 5, 6], g.task, {
    concurrency: 2,
    maxBytes: Infinity,
    weigh: () => 1,
    signal: controller.signal,
    onSettled: (done) => settled.push(done),
  });
  await tick();
  g.pending.get(1)!.resolve();
  await tick();
  assert.deepEqual(g.started(), [1, 2, 3]);

  controller.abort();
  await assert.rejects(run, { name: "AbortError" });
  // The reads already running finish, but nothing else starts or reports.
  g.pending.get(2)!.resolve();
  g.pending.get(3)!.resolve();
  await tick();
  assert.deepEqual(g.started(), [1, 2, 3]);
  assert.deepEqual(settled, [1]);
});

test("an already-aborted signal starts no reads", async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runBounded([1, 2], async () => calls++, {
      concurrency: 2,
      maxBytes: Infinity,
      weigh: () => 1,
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
  assert.equal(calls, 0);
});

test("an empty batch resolves to no results", async () => {
  assert.deepEqual(
    await runBounded([], async () => 1, { concurrency: 4, maxBytes: 1, weigh: () => 1 }),
    [],
  );
});

test("progress counts every settled item, failures included", async () => {
  const seen: [number, number][] = [];
  await runBounded([1, 2, 3], async (i) => (i === 2 ? Promise.reject(new Error("x")) : i), {
    concurrency: 1,
    maxBytes: Infinity,
    weigh: () => 1,
    onSettled: (done, total) => seen.push([done, total]),
  });
  assert.deepEqual(seen, [
    [1, 3],
    [2, 3],
    [3, 3],
  ]);
});
