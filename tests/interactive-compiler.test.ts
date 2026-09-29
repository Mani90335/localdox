import assert from "node:assert/strict";
import { test } from "node:test";
import babel from "@babel/standalone";
import {
  compileInteractive,
  type CompileReply,
  type CompileRequest,
  type Transform,
} from "../src/services/interactive/compile.ts";
import { CompilerError, createCompiler } from "../src/services/interactive/compiler-client.ts";

// R05: interactive examples compile in a worker, once per source. A compile
// that hangs is stopped; a failed compiler is never cached as a result.

const transform = babel.transform as Transform;

const COUNTER = `type Props = { start?: number };
export default function Counter({ start = 1 }: Props) {
  const [count, setCount] = useState<number>(start);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}`;

/** Answers like compiler.worker.ts, as tasks. `mode` scripts a failure. */
class FakeWorker extends EventTarget {
  posted: CompileRequest[] = [];
  terminated = false;
  listeners = 0;
  readonly mode: "ok" | "boot-fails" | "hangs" | "crashes";
  constructor(mode: FakeWorker["mode"] = "ok") {
    super();
    this.mode = mode;
    setTimeout(() => {
      if (this.terminated) return;
      if (mode === "boot-fails") this.dispatchEvent(new Event("error"));
      else this.reply({ type: "ready" });
    });
  }
  postMessage(request: CompileRequest) {
    this.posted.push(request);
    if (this.mode === "hangs") return;
    setTimeout(() => {
      if (this.terminated) return;
      if (this.mode === "crashes") this.dispatchEvent(new Event("error"));
      else
        this.reply({
          type: "result",
          id: request.id,
          result: compileInteractive(transform, request.source),
        });
    }, 1);
  }
  terminate() {
    this.terminated = true;
  }
  private reply(data: CompileReply) {
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

function harness(modes: FakeWorker["mode"][] = ["ok"], timeoutMs = 1000, maxCacheBytes?: number) {
  const workers: FakeWorker[] = [];
  const compiler = createCompiler({
    createWorker: () => {
      const worker = new FakeWorker(modes[workers.length] ?? "ok");
      workers.push(worker);
      return worker;
    },
    timeoutMs,
    maxCacheBytes,
  });
  return { compiler, workers };
}

test("compileInteractive: TSX to the CommonJS the frame runs; errors are results", () => {
  const ok = compileInteractive(transform, COUNTER);
  assert.equal(ok.ok, true);
  assert.ok(ok.ok && ok.code.includes("exports.default = Counter"));
  assert.ok(ok.ok && ok.code.includes("React.createElement"));
  assert.ok(ok.ok && !ok.code.includes("Props"), "types are stripped");

  const broken = compileInteractive(transform, "export default function A() { return <div>; }");
  assert.equal(broken.ok, false);
  assert.match(!broken.ok ? broken.message : "", /\(1:\d+\)/);

  const imports = compileInteractive(transform, `import React from "react";\n${COUNTER}`);
  assert.equal(imports.ok, false);
  assert.match(!imports.ok ? imports.message : "", /remove import statements/);
});

test("compiles in the worker, once per source, sharing one in flight", async () => {
  const { compiler, workers } = harness();
  const [a, b] = await Promise.all([compiler.compile(COUNTER), compiler.compile(COUNTER)]);
  assert.deepEqual(a, b);
  assert.equal(workers.length, 1);
  assert.equal(workers[0].posted.length, 1);

  // Returning to a document (or undoing an edit) is a cache hit.
  assert.deepEqual(await compiler.compile(COUNTER), a);
  assert.equal(workers[0].posted.length, 1);

  // Compile errors are results, cached like any other.
  const broken = "export default () => <div>;";
  assert.equal((await compiler.compile(broken)).ok, false);
  assert.equal((await compiler.compile(broken)).ok, false);
  assert.equal(workers[0].posted.length, 2);
  compiler.close();
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[0].listeners, 0);
});

test("one compile at a time, in order", async () => {
  const { compiler, workers } = harness();
  const sources = [1, 2, 3].map((n) => COUNTER.replace("start = 1", `start = ${n}`));
  const results = await Promise.all(sources.map((source) => compiler.compile(source)));
  assert.deepEqual(
    workers[0].posted.map((request) => request.source),
    sources,
  );
  results.forEach((result, i) => assert.ok(result.ok && result.code.includes(`start = ${i + 1}`)));
  compiler.close();
});

test("a compile past the time limit is stopped; the next one gets a fresh worker", async () => {
  const { compiler, workers } = harness(["hangs", "ok"], 50);
  await assert.rejects(compiler.compile(COUNTER), (error: unknown) => {
    assert.ok(error instanceof CompilerError);
    assert.match(error.message, /took longer than 0.05 s/);
    return true;
  });
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[0].listeners, 0);

  // The failure isn't cached: the same source compiles on the new worker.
  const result = await compiler.compile(COUNTER);
  assert.equal(result.ok, true);
  assert.equal(workers.length, 2);
  compiler.close();
});

test("a crashed worker fails its compile only; the rest go on", async () => {
  const { compiler, workers } = harness(["crashes", "ok"]);
  const other = COUNTER.replace("start = 1", "start = 2");
  const [first, second] = await Promise.allSettled([
    compiler.compile(COUNTER),
    compiler.compile(other),
  ]);
  assert.equal(first.status, "rejected");
  assert.ok(first.status === "rejected" && first.reason instanceof CompilerError);
  assert.equal(second.status, "fulfilled");
  assert.equal(workers[0].terminated, true);
  assert.equal(workers.length, 2);
  compiler.close();
});

test("a worker that can't start fails what's waiting; the next compile tries again", async () => {
  const { compiler, workers } = harness(["boot-fails", "ok"]);
  const other = COUNTER.replace("start = 1", "start = 2");
  const settled = await Promise.allSettled([compiler.compile(COUNTER), compiler.compile(other)]);
  for (const result of settled) {
    assert.equal(result.status, "rejected");
    assert.ok(result.status === "rejected" && result.reason instanceof CompilerError);
    assert.match(result.status === "rejected" ? result.reason.message : "", /Couldn't load/);
  }
  assert.equal(workers.length, 1, "one failed start, not one per waiting compile");
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[0].listeners, 0);

  // Not cached: asking again (back online, say) starts a new worker.
  assert.equal((await compiler.compile(COUNTER)).ok, true);
  assert.equal(workers.length, 2);
  compiler.close();

  // Where the Worker constructor itself throws, the compile says why.
  const noWorkers = createCompiler({
    createWorker: () => {
      throw new Error("Workers unavailable");
    },
  });
  await assert.rejects(noWorkers.compile(COUNTER), /need a browser that can run Web Workers/);
});

test("the cache is bounded by bytes, least recently used out", async () => {
  const { compiler, workers } = harness(["ok"], 1000, 64 * 1024);
  const padded = (n: number) => `${COUNTER}\n// ${String(n).repeat(4000)}`;
  for (let n = 0; n < 12; n++) await compiler.compile(padded(n));
  const { entries, bytes } = compiler.stats();
  assert.ok(bytes <= 64 * 1024, `${bytes} bytes held`);
  assert.ok(entries < 12);
  // The newest is still cached, the oldest compiled again.
  const posted = workers[0].posted.length;
  await compiler.compile(padded(11));
  assert.equal(workers[0].posted.length, posted);
  await compiler.compile(padded(0));
  assert.equal(workers[0].posted.length, posted + 1);
  compiler.close();
});

test("close settles everything waiting", async () => {
  const { compiler } = harness(["hangs"]);
  const waiting = [compiler.compile(COUNTER), compiler.compile(`${COUNTER}\n`)];
  compiler.close();
  for (const result of await Promise.allSettled(waiting)) {
    assert.equal(result.status, "rejected");
    assert.ok(result.status === "rejected" && result.reason instanceof CompilerError);
  }
});
