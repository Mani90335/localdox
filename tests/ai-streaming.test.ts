import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { indexedDB as fakeIndexedDB, IDBKeyRange } from "fake-indexeddb";

import { AskSession, type AskRun, type AskState } from "../src/services/ai/ask-session.ts";
import type { AgentResult } from "../src/services/ai/agent.ts";
import { readSSE } from "../src/services/ai/sse.ts";
import { geminiProvider } from "../src/services/ai/providers/gemini.ts";
import { openaiProvider } from "../src/services/ai/providers/openai.ts";
import { AIError, type StreamFinish } from "../src/services/ai/types.ts";

Object.assign(globalThis, { indexedDB: fakeIndexedDB, IDBKeyRange });

// R06: a request may only change the answer it started, streamed text reaches
// React in batches, and providers report blocked or incomplete answers.

// ---------------------------------------------------------------- helpers

/** A request whose tokens and ending the test drives by hand. */
function controlledRun() {
  let onToken!: (chunk: string) => void;
  let signal!: AbortSignal;
  let resolve!: (r: AgentResult) => void;
  let reject!: (e: unknown) => void;
  const run: AskRun = (s, t) => {
    signal = s;
    onToken = t;
    return new Promise<AgentResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  };
  return {
    run,
    token: (chunk: string) => onToken(chunk),
    get signal() {
      return signal;
    },
    finish: (text: string, finish: AgentResult["finish"] = "stop") =>
      resolve({
        text,
        scopeLabel: "Whole document",
        approxTokens: 1,
        model: "m",
        provider: "p",
        finish,
      }),
    fail: (e: unknown) => reject(e),
  };
}

/** A flush scheduler the test fires explicitly. */
function manualScheduler() {
  const queued = new Set<() => void>();
  return {
    schedule: (flush: () => void) => {
      queued.add(flush);
      return () => queued.delete(flush);
    },
    fire() {
      const all = [...queued];
      queued.clear();
      for (const f of all) f();
    },
    get size() {
      return queued.size;
    },
  };
}

function newSession() {
  const clock = manualScheduler();
  const emitted: AskState[] = [];
  const session = new AskSession((s) => emitted.push(s), clock.schedule);
  return { session, clock, emitted, last: () => emitted[emitted.length - 1] };
}

const abortError = () => new DOMException("aborted", "AbortError");
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- AskSession

describe("AskSession", () => {
  test("a superseded request cannot touch the newer answer", async () => {
    const { session, clock, last } = newSession();
    const a = controlledRun();
    const b = controlledRun();

    const pa = session.ask(a.run);
    a.token("old ");
    const pb = session.ask(b.run);
    assert.equal(a.signal.aborted, true, "starting B aborts A");
    b.token("new");

    // A's late token, and its settling after abort, arrive while B streams.
    a.token("stale");
    a.fail(abortError());
    assert.equal(await pa, null);
    clock.fire();
    assert.equal(last().status, "streaming", "A's finalisation must not end B");
    assert.equal(last().text, "new");

    b.finish("new");
    const result = await pb;
    assert.equal(result?.text, "new");
    assert.deepEqual(last(), {
      status: "done",
      text: "new",
      error: null,
      scopeLabel: "Whole document",
      notice: null,
    });
  });

  test("an older request's error or success after being superseded is ignored", async () => {
    const { session, last } = newSession();
    const a = controlledRun();
    const b = controlledRun();
    const c = controlledRun();
    const pa = session.ask(a.run);
    const pb = session.ask(b.run);
    // A fails with a real (non-abort) error; B "completes" after C started.
    a.fail(new AIError("network", "Could not reach the AI provider."));
    const pc = session.ask(c.run);
    b.finish("from B");
    assert.equal(await pa, null);
    assert.equal(await pb, null);
    assert.equal(last().status, "streaming");
    assert.equal(last().error, null);
    assert.equal(last().text, "");
    c.fail(new AIError("quota", "limit"));
    await pc;
    assert.equal(last().status, "error");
    assert.equal(last().error, "limit");
  });

  test("Stop keeps the text received so far and ignores the rest", async () => {
    const { session, clock, emitted, last } = newSession();
    const a = controlledRun();
    const pa = session.ask(a.run);
    a.token("Hello");
    a.token(", wor"); // pending, not yet flushed
    session.stop();
    assert.equal(a.signal.aborted, true);
    assert.deepEqual(
      { status: last().status, text: last().text },
      { status: "stopped", text: "Hello, wor" },
    );
    assert.equal(clock.size, 0, "no flush left scheduled");
    const count = emitted.length;
    a.token("ld");
    a.fail(abortError());
    assert.equal(await pa, null);
    clock.fire();
    assert.equal(emitted.length, count, "nothing changes after Stop");
    session.stop(); // a second Stop is a no-op
    assert.equal(emitted.length, count);
  });

  test("an abort surfacing as another error type still reads as stopped", async () => {
    const { session, last } = newSession();
    // e.g. a fetch that rejects with TypeError once its signal aborts.
    const run: AskRun = (signal) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new TypeError("Failed to fetch"))),
      );
    const p = session.ask(run);
    // Abort from outside the session (not via stop()).
    (session as unknown as { controller: AbortController }).controller.abort();
    await p;
    assert.equal(last().status, "stopped");
    assert.equal(last().error, null);
  });

  test("streamed text is delivered in batches, not per token", async () => {
    const { session, clock, emitted, last } = newSession();
    const a = controlledRun();
    const p = session.ask(a.run);
    const tokens = Array.from({ length: 500 }, (_, i) => `t${i} `);
    tokens.forEach((t, i) => {
      a.token(t);
      if (i % 100 === 99) clock.fire(); // five flush intervals elapse
    });
    // streaming + first token shown at once + 5 flushes
    assert.equal(emitted.length, 7);
    assert.equal(emitted[1].text, "t0 ", "the first chunk is not delayed");
    a.finish(tokens.join(""));
    await p;
    assert.equal(emitted.length, 8, "completion delivers the tail in the same update");
    assert.equal(last().text, tokens.join(""));
    assert.equal(last().status, "done");
  });

  test("incomplete endings carry a notice", async () => {
    for (const [finish, pattern] of [
      ["length", /length limit/],
      ["interrupted", /connection closed/],
    ] as const) {
      const { session, last } = newSession();
      const a = controlledRun();
      const p = session.ask(a.run);
      a.token("partial");
      a.finish("partial", finish);
      await p;
      assert.equal(last().status, "done");
      assert.match(last().notice ?? "", pattern);
    }
  });

  test("dispose aborts, goes quiet, and blocks new requests until activated", async () => {
    const { session, clock, emitted, last } = newSession();
    const a = controlledRun();
    const pa = session.ask(a.run);
    a.token("x");
    a.token("y");
    session.dispose();
    assert.equal(a.signal.aborted, true, "unmount cancels the request");
    const count = emitted.length;
    a.token("z");
    a.finish("xyz");
    assert.equal(await pa, null);
    clock.fire();
    assert.equal(emitted.length, count);

    let ran = false;
    assert.equal(
      await session.ask(async () => {
        ran = true;
        throw new Error("unreachable");
      }),
      null,
    );
    assert.equal(ran, false, "no request starts after unmount");

    session.activate(); // StrictMode remount
    const b = controlledRun();
    const pb = session.ask(b.run);
    b.token("again");
    b.finish("again");
    await pb;
    assert.equal(last().text, "again");
  });

  test("reset aborts and clears", async () => {
    const { session, last } = newSession();
    const a = controlledRun();
    session.ask(a.run);
    a.token("abc");
    session.reset();
    assert.equal(a.signal.aborted, true);
    assert.equal(last().status, "idle");
    assert.equal(last().text, "");
  });
});

// ---------------------------------------------------------------- SSE + providers

/** A streaming Response whose SSE lines the test pushes. */
function sseResponse(lines: string[] = [], { close = true } = {}) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const line of lines) c.enqueue(enc.encode(line));
      if (close) c.close();
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    push: (line: string) => controller.enqueue(enc.encode(line)),
    close: () => controller.close(),
  };
}

const data = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

async function drain(gen: AsyncGenerator<string, StreamFinish>) {
  const chunks: string[] = [];
  let step = await gen.next();
  while (!step.done) {
    chunks.push(step.value);
    step = await gen.next();
  }
  return { chunks, finish: step.value };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function serve(...responses: Response[]) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push(String(url));
    init?.signal?.throwIfAborted();
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return next;
  }) as typeof fetch;
  return calls;
}

const req = { messages: [{ role: "user" as const, content: "hi" }], model: "m" };

describe("readSSE", () => {
  test("throws AbortError on abort instead of ending quietly", async () => {
    const s = sseResponse([data(1), data(2)], { close: false });
    const controller = new AbortController();
    const seen: string[] = [];
    await assert.rejects(async () => {
      for await (const d of readSSE(s.response, controller.signal)) {
        seen.push(d);
        controller.abort(); // after the first of two already-buffered events
      }
    }, /abort/i);
    assert.deepEqual(seen, ["1"], "buffered events after the abort are dropped");
  });

  test("keeps a final data line that has no trailing newline", async () => {
    const s = sseResponse(["data: a\n\ndata: b"]);
    const seen: string[] = [];
    for await (const d of readSSE(s.response)) seen.push(d);
    assert.deepEqual(seen, ["a", "b"]);
  });
});

const gemini = (parts: object[], finishReason?: string) =>
  data({
    candidates: [{ content: { parts, role: "model" }, ...(finishReason ? { finishReason } : {}) }],
  });

describe("Gemini stream endings", () => {
  test("a normal answer ends with stop and skips thought parts", async () => {
    serve(
      sseResponse([
        gemini([{ text: "thinking…", thought: true }]),
        gemini([{ text: "Hello" }]),
        gemini([{ text: " there" }], "STOP"),
      ]).response,
    );
    const { chunks, finish } = await drain(geminiProvider.streamChat(req, "k"));
    assert.deepEqual(chunks, ["Hello", " there"]);
    assert.deepEqual(finish, { reason: "stop" });
  });

  test("MAX_TOKENS keeps the text and reports length", async () => {
    serve(sseResponse([gemini([{ text: "Half an ans" }], "MAX_TOKENS")]).response);
    const { chunks, finish } = await drain(geminiProvider.streamChat(req, "k"));
    assert.deepEqual(chunks, ["Half an ans"]);
    assert.deepEqual(finish, { reason: "length" });
  });

  test("a stream that closes without a finish reason is interrupted", async () => {
    serve(sseResponse([gemini([{ text: "Partial" }])]).response);
    assert.deepEqual((await drain(geminiProvider.streamChat(req, "k"))).finish, {
      reason: "interrupted",
    });
  });

  for (const reason of ["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "SPII", "BLOCKLIST"]) {
    test(`finishReason ${reason} is a blocked error`, async () => {
      serve(sseResponse([gemini([{ text: "Some" }]), gemini([], reason)]).response);
      await assert.rejects(drain(geminiProvider.streamChat(req, "k")), (e: AIError) => {
        assert.equal(e.kind, "blocked");
        assert.match(e.message, new RegExp(reason.toLowerCase().replace(/_/g, " ")));
        return true;
      });
    });
  }

  test("a blocked prompt is a blocked error, not an empty answer", async () => {
    serve(sseResponse([data({ promptFeedback: { blockReason: "SAFETY" } })]).response);
    await assert.rejects(drain(geminiProvider.streamChat(req, "k")), (e: AIError) => {
      assert.equal(e.kind, "blocked");
      assert.match(e.message, /declined this request \(safety\)/);
      return true;
    });
  });

  test("an empty answer is an error", async () => {
    serve(sseResponse([gemini([], "STOP")]).response);
    await assert.rejects(drain(geminiProvider.streamChat(req, "k")), /empty answer/);
  });

  test("an error event mid-stream is surfaced", async () => {
    serve(
      sseResponse([
        gemini([{ text: "a" }]),
        data({ error: { code: 500, message: "Internal error" } }),
      ]).response,
    );
    await assert.rejects(drain(geminiProvider.streamChat(req, "k")), /Gemini: Internal error/);
  });
});

const openai = (content: string | null, finish_reason: string | null = null) =>
  data({ choices: [{ index: 0, delta: content === null ? {} : { content }, finish_reason }] });

describe("OpenAI stream endings", () => {
  test("stop then [DONE]", async () => {
    serve(
      sseResponse([openai("Hi"), openai(" you"), openai(null, "stop"), "data: [DONE]\n\n"])
        .response,
    );
    const { chunks, finish } = await drain(openaiProvider.streamChat(req, "k"));
    assert.deepEqual(chunks, ["Hi", " you"]);
    assert.deepEqual(finish, { reason: "stop" });
  });

  test("length is reported", async () => {
    serve(sseResponse([openai("Cut"), openai(null, "length"), "data: [DONE]\n\n"]).response);
    assert.deepEqual((await drain(openaiProvider.streamChat(req, "k"))).finish, {
      reason: "length",
    });
  });

  test("content_filter is a blocked error", async () => {
    serve(sseResponse([openai("x"), openai(null, "content_filter"), "data: [DONE]\n\n"]).response);
    await assert.rejects(
      drain(openaiProvider.streamChat(req, "k")),
      (e: AIError) => e.kind === "blocked",
    );
  });

  test("closing without [DONE] or a finish reason is interrupted", async () => {
    serve(sseResponse([openai("Part")]).response);
    assert.deepEqual((await drain(openaiProvider.streamChat(req, "k"))).finish, {
      reason: "interrupted",
    });
  });
});

// ---------------------------------------------------------------- agent

describe("runAgent cancellation", () => {
  let runAgent: typeof import("../src/services/ai/agent.ts").runAgent;
  let keys: typeof import("../src/services/ai/keys.ts");

  beforeEach(async () => {
    ({ runAgent } = await import("../src/services/ai/agent.ts"));
    keys = await import("../src/services/ai/keys.ts");
    // Both providers keyed: a failure on one could fall back to the other.
    await keys.setKey("openai", "sk-test");
    await keys.setKey("gemini", "g-test");
  });

  afterEach(async () => {
    await keys.removeKey("openai");
    await keys.removeKey("gemini");
  });

  const input = (signal: AbortSignal, onToken?: (c: string) => void) => ({
    freeform: "Summarise",
    rawContext: { selection: null, section: null, document: { name: "a.md", content: "text" } },
    config: { defaultModel: "gpt-4o-mini" },
    signal,
    onToken,
  });

  test("aborting mid-stream rejects with AbortError and never falls back", async () => {
    const s = sseResponse([openai("Hello")], { close: false });
    const calls = serve(s.response, sseResponse([gemini([{ text: "fallback" }], "STOP")]).response);
    const controller = new AbortController();
    const tokens: string[] = [];
    const p = runAgent(
      input(controller.signal, (c) => {
        tokens.push(c);
        controller.abort();
      }),
    );
    await assert.rejects(p, (e: Error) => e.name === "AbortError");
    assert.deepEqual(tokens, ["Hello"]);
    assert.equal(calls.length, 1, "no request to the fallback provider");
  });

  test("an abort that surfaces as a fetch TypeError is still a cancellation", async () => {
    const calls: string[] = [];
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push(url);
      return new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new TypeError("Failed to fetch"))),
      );
    }) as typeof fetch;
    const controller = new AbortController();
    const p = runAgent(input(controller.signal));
    await tick();
    await tick();
    while (calls.length === 0) await tick();
    controller.abort();
    await assert.rejects(p, (e: Error) => e.name === "AbortError");
    assert.equal(calls.length, 1);
  });

  test("the finish reason reaches the result, and quota still falls back", async () => {
    serve(
      new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 }),
      sseResponse([gemini([{ text: "From Gemini" }], "MAX_TOKENS")]).response,
    );
    const result = await runAgent(input(new AbortController().signal));
    assert.equal(result.provider, "gemini");
    assert.equal(result.text, "From Gemini");
    assert.equal(result.finish, "length");
  });

  test("a blocked answer is not retried with another provider", async () => {
    const calls = serve(
      sseResponse([openai("x"), openai(null, "content_filter")]).response,
      sseResponse([gemini([{ text: "other" }], "STOP")]).response,
    );
    await assert.rejects(
      runAgent(input(new AbortController().signal)),
      (e: AIError) => e.kind === "blocked",
    );
    assert.equal(calls.length, 1);
  });
});
