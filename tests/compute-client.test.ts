import assert from "node:assert/strict";
import { test } from "node:test";
import { ComputeEngine } from "@cortex-js/compute-engine";
import {
  ComputeError,
  createComputeClient,
  requestKey,
} from "../src/services/compute/compute-client.ts";
import { compute, configureEngine } from "../src/services/compute/engine.ts";
import type { Reply } from "../src/services/compute/compute-client.ts";
import type { ComputeRequest, WorkerRequest } from "../src/services/compute/protocol.ts";

// The Compute tab's worker client: one request at a time, results cached,
// and every way the worker can fail (too slow, crashed, never started, no
// Worker at all) or be stopped (cancelled) ends in a clear rejection that is
// never cached.

const ce = new ComputeEngine();
configureEngine(ce);

type Mode =
  "ok" | "boot-fails" | "hangs" | "crashes" | "slow-boot" | "stages" | "reports-failure" | "stalls";

/** Answers like compute.worker.ts, with the real engine, as tasks. `mode` scripts a failure. */
class FakeWorker extends EventTarget {
  posted: WorkerRequest[] = [];
  terminated = false;
  listeners = 0;
  readonly mode: Mode;
  constructor(mode: Mode = "ok") {
    super();
    this.mode = mode;
    setTimeout(
      () => {
        if (this.terminated) return;
        if (mode === "boot-fails") return this.dispatchEvent(new Event("error"));
        // Like the advanced worker: loading stages, a reported failure, or a stall.
        if (mode === "reports-failure") return this.reply({ type: "failed", message: "No wasm." });
        if (mode === "stalls") return;
        if (mode === "stages") {
          this.reply({ type: "progress", stage: "runtime" });
          this.reply({ type: "progress", stage: "sympy" });
        }
        this.reply({ type: "ready" });
        // Like a module worker: messages wait until the module has evaluated.
        this.booted = true;
        for (const message of this.waiting.splice(0)) this.answer(message);
      },
      mode === "slow-boot" ? 80 : 0,
    );
  }
  private booted = false;
  private waiting: WorkerRequest[] = [];
  postMessage(message: WorkerRequest) {
    this.posted.push(message);
    if (this.booted) this.answer(message);
    else this.waiting.push(message);
  }
  private answer(message: WorkerRequest) {
    if (this.mode === "hangs") return;
    setTimeout(() => {
      if (this.terminated) return;
      if (this.mode === "crashes") this.dispatchEvent(new Event("error"));
      else this.reply({ type: "result", id: message.id, result: compute(ce, message.request) });
    }, 1);
  }
  terminate() {
    this.terminated = true;
  }
  private reply(data: Reply<unknown>) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  override addEventListener(...args: Parameters<EventTarget["addEventListener"]>) {
    this.listeners++;
    super.addEventListener(...args);
  }
  override removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>) {
    this.listeners--;
    super.removeEventListener(...args);
  }
}

function harness(modes: Mode[] = ["ok"], timeoutMs = 1000, maxCacheEntries?: number) {
  const workers: FakeWorker[] = [];
  const client = createComputeClient({
    createWorker: () => {
      const worker = new FakeWorker(modes[workers.length] ?? "ok");
      workers.push(worker);
      return worker;
    },
    timeoutMs,
    maxCacheEntries,
  });
  return { client, workers };
}

const evaluate = (input: string): ComputeRequest => ({ op: "evaluate", input });

function isComputeError(kind: string, message?: RegExp) {
  return (error: unknown) => {
    assert.ok(error instanceof ComputeError, String(error));
    assert.equal(error.kind, kind);
    if (message) assert.match(error.message, message);
    return true;
  };
}

test("computes in the worker; answers are cached by operation, variable and input", async () => {
  const { client, workers } = harness();
  const first = await client.run(evaluate("1/2 + 1/3"));
  assert.ok(first.ok && first.exact === "\\frac{5}{6}");
  assert.equal(workers.length, 1);
  assert.equal(workers[0].posted.length, 1);

  // The same request (surrounding spaces aside) is a cache hit.
  assert.deepEqual(await client.run(evaluate("  1/2 + 1/3 ")), first);
  assert.equal(workers[0].posted.length, 1);
  // Another operation or variable on the same input is a new request.
  await client.run({ op: "approximate", input: "1/2 + 1/3" });
  await client.run({ op: "solve", input: "x^2 = y", variable: "x" });
  await client.run({ op: "solve", input: "x^2 = y", variable: "y" });
  assert.equal(workers[0].posted.length, 4);
  assert.notEqual(
    requestKey({ op: "solve", input: "a", variable: "x" }),
    requestKey({ op: "solve", input: "a", variable: "y" }),
  );
  assert.equal(
    requestKey({ op: "evaluate", input: "a", variable: "x" }),
    requestKey({ op: "evaluate", input: "a" }),
    "only Solve reads the variable",
  );

  // An engine failure ("unsupported") is an answer, and cached like one.
  const integral = evaluate("\\int_0^1 x\\,dx");
  assert.equal((await client.run(integral)).ok, false);
  assert.equal((await client.run(integral)).ok, false);
  assert.equal(workers[0].posted.length, 5);

  client.close();
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[0].listeners, 0);
});

test("one request at a time, in order", async () => {
  const { client, workers } = harness();
  const inputs = ["1+1", "2+2", "3+3"];
  const results = await Promise.all(inputs.map((input) => client.run(evaluate(input))));
  assert.deepEqual(
    workers[0].posted.map((message) => message.request.input),
    inputs,
  );
  assert.deepEqual(
    results.map((r) => r.ok && r.exact),
    ["2", "4", "6"],
  );
  client.close();
});

test("a request past the time limit is stopped; the next one gets a fresh worker", async () => {
  const { client, workers } = harness(["hangs", "ok"], 50);
  await assert.rejects(client.run(evaluate("2+2")), isComputeError("timeout", /0.05 s/));
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[0].listeners, 0);

  // The failure isn't cached: the same request is computed on the new worker.
  const result = await client.run(evaluate("2+2"));
  assert.ok(result.ok && result.exact === "4");
  assert.equal(workers.length, 2);
  client.close();
});

test("the time limit covers computing, not loading the engine", async () => {
  const { client, workers } = harness(["slow-boot"], 50);
  let computing = 0;
  const result = await client.run(evaluate("6*7"), { onComputing: () => computing++ });
  assert.ok(result.ok && result.exact === "42");
  assert.equal(computing, 1, "told once the engine is working on it");
  assert.equal(workers.length, 1);
  client.close();
});

test("a crashed worker fails its request only; the rest go on", async () => {
  const { client, workers } = harness(["crashes", "ok"]);
  const [first, second] = await Promise.allSettled([
    client.run(evaluate("1+1")),
    client.run(evaluate("2+2")),
  ]);
  assert.equal(first.status, "rejected");
  assert.ok(first.status === "rejected" && first.reason instanceof ComputeError);
  assert.equal(first.status === "rejected" && first.reason.kind, "crashed");
  assert.equal(second.status, "fulfilled");
  assert.equal(workers[0].terminated, true);
  assert.equal(workers.length, 2);
  client.close();
});

test("a worker that can't start fails what's waiting once; the next request tries again", async () => {
  const { client, workers } = harness(["boot-fails", "ok"]);
  const settled = await Promise.allSettled([
    client.run(evaluate("1+1")),
    client.run(evaluate("2+2")),
  ]);
  for (const result of settled) {
    assert.equal(result.status, "rejected");
    assert.ok(result.status === "rejected" && result.reason instanceof ComputeError);
    assert.equal(result.status === "rejected" && result.reason.kind, "load-failed");
  }
  assert.equal(workers.length, 1, "one failed start, not one per waiting request");
  assert.equal(workers[0].listeners, 0);

  // Not cached: asking again (back online, say) starts a new worker.
  assert.equal((await client.run(evaluate("1+1"))).ok, true);
  assert.equal(workers.length, 2);
  client.close();

  // Where the Worker constructor itself throws, the request says why.
  const noWorkers = createComputeClient({
    createWorker: () => {
      throw new Error("Workers unavailable");
    },
  });
  await assert.rejects(
    noWorkers.run(evaluate("1+1")),
    isComputeError("unavailable", /Web Workers/),
  );
});

test("cancelling: a queued request never runs; the running one stops its worker", async () => {
  const { client, workers } = harness(["hangs", "ok"], 5000);
  const running = new AbortController();
  const queued = new AbortController();
  const first = client.run(evaluate("1+1"), { signal: running.signal });
  const second = client.run(evaluate("2+2"), { signal: queued.signal });
  const third = client.run(evaluate("3+3"));

  queued.abort();
  await assert.rejects(second, isComputeError("cancelled"));
  await new Promise((resolve) => setTimeout(resolve, 5));
  running.abort();
  await assert.rejects(first, isComputeError("cancelled"));
  assert.equal(workers[0].terminated, true, "the engine can't be interrupted otherwise");

  // The rest runs on a fresh worker; the cancelled request was never posted.
  const result = await third;
  assert.ok(result.ok && result.exact === "6");
  assert.deepEqual(
    workers.flatMap((w) => w.posted.map((m) => m.request.input)),
    ["1+1", "3+3"],
  );

  // A cancellation isn't cached, and an already-aborted signal never queues.
  assert.equal((await client.run(evaluate("1+1"))).ok, true);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(client.run(evaluate("4+4"), { signal: aborted.signal }), /Cancelled/);
  assert.equal(client.stats().queued, 0);
  client.close();
});

test("warm() loads the engine ahead of the first request", async () => {
  const { client, workers } = harness();
  client.warm();
  client.warm();
  assert.equal(workers.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(client.stats().ready, true);
  await client.run(evaluate("2*3"));
  assert.equal(workers.length, 1, "the warmed worker served it");
  client.close();
});

test("the cache is bounded, least recently used out", async () => {
  const { client, workers } = harness(["ok"], 1000, 3);
  for (const n of [1, 2, 3, 4]) await client.run(evaluate(`${n}+${n}`));
  assert.equal(client.stats().entries, 3);
  await client.run(evaluate("4+4"));
  assert.equal(workers[0].posted.length, 4, "the newest is still cached");
  await client.run(evaluate("1+1"));
  assert.equal(workers[0].posted.length, 5, "the oldest was evicted");
  client.close();
});

test("loading stages reach the request waiting for them", async () => {
  const { client } = harness(["stages"]);
  const stages: string[] = [];
  await client.run(evaluate("1+1"), { onProgress: (stage) => stages.push(stage) });
  assert.deepEqual(stages, ["runtime", "sympy"]);
  client.close();
});

test("a worker that reports a failed load fails what's waiting, once, with its reason", async () => {
  const { client, workers } = harness(["reports-failure", "ok"]);
  const settled = await Promise.allSettled([
    client.run(evaluate("1+1")),
    client.run(evaluate("2+2")),
  ]);
  for (const result of settled) {
    assert.equal(result.status, "rejected");
    assert.ok(result.status === "rejected" && result.reason instanceof ComputeError);
    assert.equal(result.status === "rejected" && result.reason.kind, "load-failed");
    assert.equal(result.status === "rejected" && result.reason.message, "No wasm.");
  }
  assert.equal(workers[0].terminated, true);
  // The next request starts a new worker.
  assert.equal((await client.run(evaluate("1+1"))).ok, true);
  client.close();
});

test("a load that stalls past its limit fails instead of spinning", async () => {
  const workers: FakeWorker[] = [];
  const client = createComputeClient({
    createWorker: () => {
      const worker = new FakeWorker(workers.length ? "ok" : "stalls");
      workers.push(worker);
      return worker;
    },
    loadTimeoutMs: 40,
    name: "advanced math engine",
  });
  await assert.rejects(
    client.run(evaluate("1+1")),
    isComputeError("load-failed", /Loading the advanced math engine took over 0 s/),
  );
  assert.equal(workers[0].terminated, true);
  assert.equal((await client.run(evaluate("1+1"))).ok, true, "a fresh worker loads in time");
  client.close();
});

test("a custom cache key decides what counts as the same request", async () => {
  const workers: FakeWorker[] = [];
  const client = createComputeClient<ComputeRequest & { tag: string }>({
    createWorker: () => {
      const worker = new FakeWorker("ok");
      workers.push(worker);
      return worker;
    },
    key: (request) => `${request.op}|${request.input}|${request.tag}`,
  });
  await client.run({ ...evaluate("1+1"), tag: "a" });
  await client.run({ ...evaluate("1+1"), tag: "a" });
  await client.run({ ...evaluate("1+1"), tag: "b" });
  assert.equal(workers[0].posted.length, 2);
  client.close();
});
