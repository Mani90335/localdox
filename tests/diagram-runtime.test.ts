// R02: Mermaid jobs run one at a time with their own configuration, the
// diagram caches are bounded by bytes, and diagrams Mermaid would lay out on
// the main thread for seconds are held as source until the reader asks. The
// browser half (real Mermaid renders racing, the held stage) is covered by
// tests/e2e/diagram-runtime.spec.ts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { BoundedPromiseCache } from "../src/lib/bounded-promise-cache.ts";
import { createMermaidQueue } from "../src/services/diagrams/mermaid-runtime.ts";
import {
  MAIN_THREAD_CHARACTER_LIMIT,
  MAIN_THREAD_LINE_LIMIT,
  MINDMAP_NODE_LIMIT,
  preflightDiagram,
} from "../src/services/diagrams/preflight.ts";
import {
  allowHeavyRender,
  clearOversizedVerdicts,
  decideDiagramRender,
  heldBack,
} from "../src/services/diagrams/render-decision.ts";
import { instantiateEngine } from "../src/services/diagrams/engine/layout.ts";
import { modelFromParsed } from "../src/services/diagrams/engine/flowchart.ts";
import { buildScene, sceneBytes } from "../src/services/diagrams/engine/scene.ts";
import { syntheticFlowchart } from "../bench/generate.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Mermaid's shape where it matters: `initialize` replaces one global
 * configuration, and a render reads it again after an await, as Mermaid's
 * diagram renderers call getConfig() while drawing.
 */
function fakeMermaid() {
  let config: Record<string, unknown> = {};
  let active = 0;
  let maxActive = 0;
  const initialized: Record<string, unknown>[] = [];
  return {
    initialized,
    get maxActive() {
      return maxActive;
    },
    initialize(next: Record<string, unknown>) {
      initialized.push(next);
      config = next;
    },
    async render(name: string) {
      active++;
      maxActive = Math.max(maxActive, active);
      const before = config.theme;
      await tick();
      await tick();
      const during = config.theme;
      active--;
      return { name, before, during };
    },
  };
}

test("jobs run one at a time, in order, each drawn with its own configuration", async () => {
  const mermaid = fakeMermaid();
  const withMermaid = createMermaidQueue(async () => mermaid);
  const order: string[] = [];
  const job = (name: string, theme: string) =>
    withMermaid(
      async (m) => {
        order.push(name);
        return m.render(name);
      },
      { config: { theme } },
    );

  const results = await Promise.all([job("a", "dark"), job("b", "default"), job("c", "neutral")]);

  assert.deepEqual(order, ["a", "b", "c"]);
  assert.equal(mermaid.maxActive, 1);
  assert.deepEqual(
    results.map((r) => [r.before, r.during]),
    [
      ["dark", "dark"],
      ["default", "default"],
      ["neutral", "neutral"],
    ],
  );
  // startOnLoad is always off: the app renders on demand.
  assert.ok(mermaid.initialized.every((c) => c.startOnLoad === false));
});

test("without the queue, the same interleaving draws with another caller's settings", async () => {
  // The defect the queue exists for, reproduced against the fake: initialize
  // then render, twice, without waiting.
  const mermaid = fakeMermaid();
  mermaid.initialize({ theme: "dark" });
  const first = mermaid.render("a");
  mermaid.initialize({ theme: "default" });
  const second = mermaid.render("b");
  const [a] = await Promise.all([first, second]);
  assert.equal(a.before, "dark");
  assert.equal(a.during, "default");
});

test("a failed job doesn't block the next, and a job without config leaves it alone", async () => {
  const mermaid = fakeMermaid();
  const withMermaid = createMermaidQueue(async () => mermaid);
  const failed = withMermaid(
    async () => {
      throw new Error("syntax");
    },
    { config: { theme: "dark" } },
  );
  const next = withMermaid(async () => "ran");
  await assert.rejects(failed, /syntax/);
  assert.equal(await next, "ran");
  assert.equal(mermaid.initialized.length, 1);
});

test("a job queued behind a slow one waits for it to finish", async () => {
  const mermaid = fakeMermaid();
  const withMermaid = createMermaidQueue(async () => mermaid);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const events: string[] = [];
  const slow = withMermaid(async () => {
    events.push("slow:start");
    await gate;
    events.push("slow:end");
  });
  const fast = withMermaid(async () => void events.push("fast"));
  await tick();
  await tick();
  assert.deepEqual(events, ["slow:start"]);
  release();
  await Promise.all([slow, fast]);
  assert.deepEqual(events, ["slow:start", "slow:end", "fast"]);
});

const mindmap = (nodes: number) =>
  "mindmap\n  root((root))\n" + Array.from({ length: nodes - 2 }, (_, i) => `    n${i}`).join("\n");

test("preflight: mindmaps are held past the node limit, counting content lines only", () => {
  assert.equal(preflightDiagram(mindmap(MINDMAP_NODE_LIMIT)), null);
  const held = preflightDiagram(mindmap(MINDMAP_NODE_LIMIT + 1));
  assert.ok(held);
  assert.equal(held.unit, "nodes");
  assert.equal(held.count, MINDMAP_NODE_LIMIT + 1);
  assert.match(held.reason, /mindmap/);

  // Blank lines and %% comments aren't nodes.
  const padded = mindmap(MINDMAP_NODE_LIMIT).replace(/\n/g, "\n\n  %% note\n");
  assert.equal(preflightDiagram(padded), null);
  // Front matter before the header is skipped when finding the kind.
  const titled = `---\ntitle: Big\n---\n${mindmap(MINDMAP_NODE_LIMIT + 50)}`;
  assert.equal(preflightDiagram(titled)?.unit, "nodes");
});

test("preflight: other main-thread kinds are held past the line or character limit", () => {
  const sequence = (lines: number) =>
    "sequenceDiagram\n" +
    Array.from({ length: lines - 1 }, (_, i) => `  A->>B: message ${i}`).join("\n");
  assert.equal(preflightDiagram(sequence(MAIN_THREAD_LINE_LIMIT)), null);
  assert.equal(preflightDiagram(sequence(MAIN_THREAD_LINE_LIMIT + 1))?.unit, "lines");

  const wide = `pie\n  "${"x".repeat(MAIN_THREAD_CHARACTER_LIMIT)}" : 1`;
  assert.equal(preflightDiagram(wide)?.unit, "characters");
  // An ordinary mindmap or pie is never held.
  assert.equal(preflightDiagram(mindmap(40)), null);
});

test("preflight: kinds the GPU engine draws are never held, however large", () => {
  // Past every main-thread limit: 12,000 edge lines.
  const flowchart = syntheticFlowchart(12_000);
  assert.equal(preflightDiagram(flowchart), null);
  clearOversizedVerdicts();
  assert.equal(decideDiagramRender(flowchart).renderer, "gpu");
});

test("decision: a held diagram stays held until the reader chooses to draw it", () => {
  clearOversizedVerdicts();
  const big = mindmap(600);
  const decision = decideDiagramRender(big);
  assert.equal(decision.renderer, "held");
  assert.equal(decision.preflight?.count, 600);
  assert.ok(heldBack(big));

  allowHeavyRender(big);
  assert.equal(heldBack(big), null);
  assert.notEqual(decideDiagramRender(big).renderer, "held");
  // An export passes the fence untrimmed; the choice still applies.
  assert.equal(heldBack(`\n${big}\n\n`), null);
  // The choice is per source: an edited diagram is judged again.
  assert.equal(decideDiagramRender(`${big}\n    extra`).renderer, "held");

  clearOversizedVerdicts();
  assert.equal(decideDiagramRender(big).renderer, "held");
});

test("sceneBytes grows with the diagram and counts at least the typed arrays", async () => {
  const wasm = await instantiateEngine(
    readFileSync(new URL("../src/services/diagrams/engine/diagram_layout.wasm", import.meta.url)),
  );
  const scene = (nodes: number) => {
    const utf8 = new TextEncoder().encode(syntheticFlowchart(nodes));
    const model = modelFromParsed(wasm.parse(utf8), utf8);
    assert.ok(model);
    return buildScene(model, (text) => text.length * 7, wasm.layout);
  };
  const small = scene(200);
  const large = scene(4_000);
  let typed = 0;
  for (const value of Object.values(large)) {
    if (ArrayBuffer.isView(value)) typed += value.byteLength;
  }
  assert.ok(sceneBytes(large) > typed);
  // Roughly proportional: 20× the nodes is at least 10× the estimate.
  assert.ok(
    sceneBytes(large) > sceneBytes(small) * 10,
    `${sceneBytes(large)} vs ${sceneBytes(small)}`,
  );
});

test("a byte-weighted cache drops old diagrams by size, not by count", async () => {
  const cache = new BoundedPromiseCache<string, { svg: string }>({
    maxEntries: 64,
    maxWeight: 1_000,
    weigh: (value) => value.svg.length * 2,
  });
  // Ten small diagrams fit where the old count limit (6) would have evicted.
  for (let i = 0; i < 10; i++) await cache.get(`small${i}`, async () => ({ svg: "x".repeat(40) }));
  assert.equal(cache.size, 10);
  assert.equal(cache.weight, 800);
  // One large diagram pushes out the oldest ones, and stays itself even though
  // it alone is over the budget.
  await cache.get("large", async () => ({ svg: "x".repeat(600) }));
  await tick();
  assert.ok(cache.has("large"));
  assert.equal(cache.size, 1);
  assert.equal(cache.weight, 1_200);
});
