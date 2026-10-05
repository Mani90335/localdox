// Each engine runs in a fresh process. Run with: npm run bench:compute
import { spawnSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir, cpus } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

const cases = [
  { name: "fractions", op: "evaluate", input: "1/2 + 1/3" },
  { name: "arithmetic", op: "evaluate", input: "(12 + 8) * 3^2 / 5" },
  { name: "trigonometry", op: "evaluate", input: "sin(pi/6)" },
  { name: "quadratic", op: "solve", input: "x^2 - 5x + 6 = 0" },
  { name: "simplify", op: "simplify", input: "(x^2 - 1)/(x - 1)" },
  { name: "derivative", op: "evaluate", input: String.raw`\frac{d}{dx}\left(x^3+2x\right)` },
  { name: "integral", op: "evaluate", input: String.raw`\int x^2\,dx` },
  { name: "definite integral", op: "evaluate", input: String.raw`\int_0^1 x^2\,dx` },
] as const;
const mode = process.argv[2];
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
if (mode === "javascript" || mode === "sympy") {
  global.gc?.();
  const before = process.memoryUsage();
  const started = performance.now();
  let run: (request: (typeof cases)[number]) => { ok: boolean };
  let wasmBytes = 0;
  if (mode === "javascript") {
    const { ComputeEngine } = await import("@cortex-js/compute-engine");
    const { compute, configureEngine } = await import("../src/services/compute/engine.ts");
    const ce = new ComputeEngine();
    configureEngine(ce);
    run = (request) => compute(ce, request);
  } else {
    const { mirrorPyodide } = await import("./compute-reference/pyodide-packages.ts");
    const { loadPyodide } = await import("pyodide");
    const { parse } = await import("@cortex-js/compute-engine/latex-syntax");
    const { runAdvanced } = await import("./compute-reference/run.ts");
    const dir = path.join(tmpdir(), "localdox-compute-benchmark");
    await mirrorPyodide(dir);
    const py = await loadPyodide({ indexURL: `${dir}/` });
    await py.loadPackage("sympy", { messageCallback: () => {} });
    py.runPython(await readFile("scripts/compute-reference/steps.py", "utf8"));
    py.runPython(await readFile("scripts/compute-reference/bridge.py", "utf8"));
    const call = py.globals.get("run");
    run = (request) => runAdvanced({ run: (value) => call(value) as string }, parse, request);
    wasmBytes = py._module.HEAP8.buffer.byteLength;
  }
  const startupMs = performance.now() - started;
  const results = cases.map((request) => {
    const start = performance.now();
    const first = run(request);
    const firstMs = performance.now() - start;
    const timings: number[] = [];
    let supported = first.ok;
    for (let i = 0; i < 25; i++) {
      const start = performance.now();
      supported = run(request).ok && supported;
      timings.push(performance.now() - start);
    }
    return { name: request.name, supported, firstMs, medianMs: median(timings) };
  });
  global.gc?.();
  const after = process.memoryUsage();
  console.log(
    JSON.stringify({
      engine: mode,
      startupMs,
      rssIncreaseBytes: after.rss - before.rss,
      heapIncreaseBytes: after.heapUsed - before.heapUsed,
      wasmBytes,
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      results,
    }),
  );
} else {
  const trials: unknown[] = [];
  for (let i = 0; i < 3; i++)
    for (const engine of ["javascript", "sympy"]) {
      const child = spawnSync(
        process.execPath,
        ["--expose-gc", "--experimental-strip-types", import.meta.filename, engine],
        { encoding: "utf8", maxBuffer: 10_000_000, timeout: 120_000 },
      );
      if (child.error) throw child.error;
      if (child.status !== 0) throw new Error(child.stderr || child.stdout);
      trials.push(JSON.parse(child.stdout.trim().split("\n").at(-1)!));
    }
  const { pyodideAssets } = await import("./compute-reference/pyodide-packages.ts");
  const assets = await pyodideAssets();
  let rawBytes = 0,
    gzipBytes = 0;
  for (const file of assets.files) {
    const bytes = file.text === undefined ? await readFile(file.path!) : Buffer.from(file.text);
    rawBytes += bytes.length;
    gzipBytes += gzipSync(bytes).length;
  }
  const report = {
    measuredAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    cpu: cpus()[0].model,
    methodology:
      "3 fresh processes per engine; 25 warm runs per case; same production computation pipelines including steps; cached local assets; no network or client result cache. RSS includes native/WASM memory; heap alone does not. Retained memory after GC, not peak incremental memory. Node timings are not phone/browser timings.",
    removedRuntime: { rawBytes, gzipBytes },
    trials,
  };
  await mkdir("docs/performance", { recursive: true });
  await writeFile(
    "docs/performance/compute-benchmark.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
}
