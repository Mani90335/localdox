// R05: typesetting is bounded per browser task, and the render cache by bytes.
//
// A document with 2,000 equations used to typeset every waiting equation in
// one ~960 ms task and commit them in another ~820 ms one. These tests pin the
// scheduling (render-budget.ts) with a fake clock, then the renderer's use of
// it and its byte-bounded cache with real KaTeX.

import assert from "node:assert/strict";
import { test } from "node:test";

import { type Clock, SlicedQueue, TaskBudget } from "../src/services/math/render-budget.ts";
import {
  clearMathCache,
  MATH_CACHE_BYTES,
  MATH_TASK_BUDGET_MS,
  mathRenderStats,
  peekRenderedMath,
  renderMath,
  renderMathSync,
} from "../src/services/math/renderer.ts";
import { loadKatex } from "../src/services/math/adapters/katex.ts";

/** A clock the test advances by hand, with "later" tasks it runs one by one. */
function fakeClock() {
  let time = 0;
  const tasks: Array<() => void> = [];
  const clock: Clock = { now: () => time, later: (fn) => void tasks.push(fn) };
  return {
    clock,
    advance: (ms: number) => void (time += ms),
    pendingTasks: () => tasks.length,
    /** Run the oldest scheduled task, as the event loop would. */
    runTask: () => tasks.shift()?.(),
  };
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// The budget and the queue
// ---------------------------------------------------------------------------

test("a task's budget is spent by measured work and restored in the next task", () => {
  const { clock, advance, runTask } = fakeClock();
  const budget = new TaskBudget(12, clock);
  assert.ok(budget.available());
  budget.measure(() => advance(5));
  assert.ok(budget.available(), "5 of 12 ms spent");
  budget.measure(() => advance(7));
  assert.equal(budget.available(), false, "12 of 12 ms spent");
  runTask(); // the reset the first charge scheduled
  assert.ok(budget.available());
});

test("work that throws is still charged", () => {
  const { clock, advance } = fakeClock();
  const budget = new TaskBudget(12, clock);
  assert.throws(() =>
    budget.measure(() => {
      advance(20);
      throw new Error("parse error");
    }),
  );
  assert.equal(budget.available(), false);
});

test("the queue runs jobs in order, as many per task as the budget allows", async () => {
  const { clock, advance, runTask, pendingTasks } = fakeClock();
  const budget = new TaskBudget(12, clock);
  const queue = new SlicedQueue(budget, clock);
  const order: number[] = [];
  const done = Array.from({ length: 7 }, (_, i) =>
    queue.run(() => {
      advance(5);
      order.push(i);
      return i;
    }),
  );

  assert.deepEqual(order, [], "nothing runs in the caller's task");
  // 5 ms each against 12 ms: the third job crosses the budget, so three a task.
  runTask();
  assert.deepEqual(order, [0, 1, 2]);
  assert.equal(queue.size, 4);
  runTask(); // the budget's own reset
  runTask();
  assert.deepEqual(order, [0, 1, 2, 3, 4, 5]);
  while (pendingTasks() > 0) runTask();
  assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(await Promise.all(done), [0, 1, 2, 3, 4, 5, 6]);
});

test("one job longer than the budget still runs, alone, and the queue drains", async () => {
  const { clock, advance, runTask, pendingTasks } = fakeClock();
  const queue = new SlicedQueue(new TaskBudget(12, clock), clock);
  const order: string[] = [];
  const done = [
    queue.run(() => (advance(40), order.push("huge"))),
    queue.run(() => (advance(1), order.push("small"))),
  ];
  runTask();
  assert.deepEqual(order, ["huge"]);
  while (pendingTasks() > 0) runTask();
  assert.deepEqual(order, ["huge", "small"]);
  await Promise.all(done);
});

test("a failing job rejects its own promise and doesn't stop the queue", async () => {
  const { clock, runTask, pendingTasks } = fakeClock();
  const queue = new SlicedQueue(new TaskBudget(12, clock), clock);
  const failed = queue.run(() => {
    throw new Error("bad LaTeX");
  });
  const next = queue.run(() => "drawn");
  while (pendingTasks() > 0) runTask();
  await assert.rejects(failed, /bad LaTeX/);
  assert.equal(await next, "drawn");
});

// ---------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------

/** Distinct equations, each worth typesetting. */
const equation = (i: number) =>
  `\\sum_{k=0}^{${i}} \\frac{k^{${(i % 7) + 1}}}{${i + 1}!} = \\int_0^{${i}} f_{${i}}(t)\\,dt`;

test("the synchronous path stops typesetting once the task's budget is spent", async () => {
  await loadKatex();
  clearMathCache();
  await nextTask();

  // Draw distinct equations in one task until the renderer declines one.
  let drawn = 0;
  while (renderMathSync({ latex: equation(drawn), displayMode: true })) {
    drawn++;
    assert.ok(drawn < 5000, "the budget never ran out");
  }
  assert.ok(drawn >= 1, "a fresh task draws at least one equation");
  // Still the same task: the next one is declined as well…
  assert.equal(renderMathSync({ latex: equation(drawn + 1), displayMode: true }), undefined);
  // …but what is already drawn is a cache hit, which costs no budget.
  assert.ok(renderMathSync({ latex: equation(0), displayMode: true }));

  // A later task has a budget again.
  await nextTask();
  assert.ok(renderMathSync({ latex: equation(drawn), displayMode: true }));
});

test("many waiting equations are typeset over several tasks, not in one burst", async () => {
  await loadKatex();
  clearMathCache();
  await nextTask();

  const count = 600;
  const started = performance.now();
  const all = Promise.all(
    Array.from({ length: count }, (_, i) => renderMath({ latex: equation(i), displayMode: true })),
  );
  // Before the change every one resolved in the microtasks of a single task.
  // Wait for the first slice to have run, then check it left work for later.
  while (mathRenderStats().entries === 0) await nextTask();
  const afterFirstSlice = mathRenderStats();
  assert.ok(afterFirstSlice.queued > 0, "all of them were typeset in one task");
  assert.ok(afterFirstSlice.entries < count);

  const results = await all;
  assert.equal(results.length, count);
  assert.equal(mathRenderStats().queued, 0);
  assert.equal(mathRenderStats().entries, count);
  // Sanity: the budget is small next to the whole job, or this test proves nothing.
  assert.ok(performance.now() - started > MATH_TASK_BUDGET_MS);
});

/** A matrix big enough that a few dozen of them exceed the cache's byte budget. */
const matrix = (seed: number) =>
  `\\begin{pmatrix}${Array.from({ length: 30 }, (_, r) =>
    Array.from({ length: 30 }, (_, c) => `a_{${seed},${r * 30 + c}}`).join("&"),
  ).join("\\\\")}\\end{pmatrix}`;

test("the cache is bounded by bytes and keeps what was used recently", async () => {
  await loadKatex();
  clearMathCache();

  const first = await renderMath({ latex: matrix(0), displayMode: true });
  const entryBytes = mathRenderStats().bytes;
  assert.ok(entryBytes > 100_000, `a 30×30 matrix is ${entryBytes} bytes of markup`);
  const second = await renderMath({ latex: matrix(1), displayMode: true });

  // Well past the budget, touching the first matrix as we go.
  const needed = Math.ceil((MATH_CACHE_BYTES * 1.5) / entryBytes);
  for (let seed = 2; seed < 2 + needed; seed++) {
    await renderMath({ latex: matrix(seed), displayMode: true });
    assert.equal(peekRenderedMath(matrix(0), true), first);
  }

  const { bytes, entries } = mathRenderStats();
  assert.ok(bytes <= MATH_CACHE_BYTES, `${bytes} bytes held`);
  assert.ok(entries < needed, `${entries} entries held`);
  // Least recently used out: the untouched second matrix went, the first stayed.
  assert.equal(peekRenderedMath(matrix(1), true), undefined);
  assert.notEqual(second, undefined);
  assert.equal(peekRenderedMath(matrix(0), true), first);
  // And the newest is resident.
  assert.ok(peekRenderedMath(matrix(needed + 1), true));
});

test("clearing the cache releases its bytes", async () => {
  await loadKatex();
  await renderMath({ latex: "x^2", displayMode: false });
  assert.ok(mathRenderStats().bytes > 0);
  clearMathCache();
  assert.deepEqual(
    { entries: mathRenderStats().entries, bytes: mathRenderStats().bytes },
    { entries: 0, bytes: 0 },
  );
});
