// The advanced math engine: SymPy, run by Pyodide (CPython compiled to
// WebAssembly), off the reader's thread. About 10 MB on first use, from this
// app's own server (see build/vite-pyodide.ts), then from the cache.
//
// The page sends {type: "init", base} first, with where Pyodide is published.
// Loading reports its stages as "progress" messages, and a failure as
// "failed": a rejected promise in a worker never reaches the page as an error.
import { parse as parseLatex } from "@cortex-js/compute-engine/latex-syntax";
import bridgeSource from "./bridge.py?raw";
import { runAdvanced, type Bridge } from "./run";
import type { AdvancedRequest, ComputeResult } from "../protocol";

interface Pyodide {
  loadPackage(names: string | string[], options?: Record<string, unknown>): Promise<unknown>;
  runPython(code: string): unknown;
  globals: { get(name: string): (request: string) => string };
}

const post = (message: unknown) => self.postMessage(message);

// Streaming compilation requires the server to send `application/wasm`. Not
// every host does (Vite's preview server sends octet-stream), and Pyodide
// then hangs on a warning rather than failing. Compiling from the bytes
// works whatever the header; only this worker is affected.
for (const name of ["compileStreaming", "instantiateStreaming"] as const) {
  const streaming = WebAssembly[name] as (...args: unknown[]) => Promise<unknown>;
  (WebAssembly as unknown as Record<string, unknown>)[name] = async (
    source: Response | PromiseLike<Response>,
    ...rest: unknown[]
  ) => {
    const response = await source;
    try {
      return await streaming.call(WebAssembly, response.clone(), ...rest);
    } catch {
      const bytes = await response.arrayBuffer();
      return name === "compileStreaming"
        ? WebAssembly.compile(bytes)
        : WebAssembly.instantiate(bytes, rest[0] as WebAssembly.Imports);
    }
  };
}

let engine: Promise<Bridge> | null = null;

async function start(base: string): Promise<Bridge> {
  post({ type: "progress", stage: "runtime" });
  const { loadPyodide } = (await import(/* @vite-ignore */ `${base}pyodide.mjs`)) as {
    loadPyodide(options: { indexURL: string }): Promise<Pyodide>;
  };
  const pyodide = await loadPyodide({ indexURL: base });
  post({ type: "progress", stage: "sympy" });
  await pyodide.loadPackage("sympy", { messageCallback: () => {}, errorCallback: () => {} });
  pyodide.runPython(bridgeSource);
  const run = pyodide.globals.get("run");
  post({ type: "ready" });
  return { run: (request) => run(request) };
}

self.onmessage = async (event: MessageEvent) => {
  const data = event.data;
  if (data?.type === "init") {
    engine = start(String(data.base));
    engine.catch((error: unknown) =>
      post({
        type: "failed",
        message: `Couldn't load the advanced math engine: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
    return;
  }
  const { id, request } = data as { id: number; request: AdvancedRequest };
  let result: ComputeResult;
  try {
    result = runAdvanced(await engine!, parseLatex, request);
  } catch (error) {
    // A Python exception the bridge didn't anticipate: a result, not a crash.
    const detail =
      error instanceof Error ? error.message.split("\n").filter(Boolean).pop() : undefined;
    result = {
      ok: false,
      op: request.op,
      kind: "engine-error",
      message: "The engine couldn't work this out.",
      hint: detail?.slice(0, 300),
    };
  }
  post({ type: "result", id, result });
};
