// Notes panel rendering: equations are typeset only in idle time and never
// charged to the reader's per-task math budget; diagrams copy as their source.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createIdleTypesetter, type IdleDeadlineLike } from "../src/services/math/idle-typeset.ts";
import {
  clearMathCache,
  peekRenderedMath,
  renderMathIdle,
  renderMathSync,
} from "../src/services/math/renderer.ts";
import { loadKatex } from "../src/services/math/adapters/katex.ts";
import type { MathRenderRequest, RenderedMath } from "../src/services/math/types.ts";
import {
  selectionToMarkdown,
  type DomNodeLike,
  type SelectionBounds,
} from "../src/lib/markdown/selection-markdown.ts";

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---- the idle typesetter ------------------------------------------------------

/** Idle periods the test hands out by hand. */
function idlePeriods() {
  const waiting: Array<(deadline: IdleDeadlineLike) => void> = [];
  let left = 0;
  return {
    schedule: (run: (deadline: IdleDeadlineLike) => void) => void waiting.push(run),
    get queued() {
      return waiting.length;
    },
    /** Charge work to the idle period currently running. */
    spend: (ms: number) => void (left -= ms),
    /** Grant one idle period with `ms` to spare (or a timed-out one). */
    grant(ms: number, didTimeout = false) {
      const run = waiting.shift();
      assert.ok(run, "nothing was waiting for an idle period");
      left = ms;
      run({ didTimeout, timeRemaining: () => left });
    },
  };
}

function fakeRender(log: string[], costMs = 0, onCost?: (ms: number) => void) {
  return (request: MathRenderRequest): RenderedMath => {
    log.push(request.latex);
    onCost?.(costMs);
    return {
      html: `<b>${request.latex}</b>`,
      engine: "katex",
      latex: request.latex,
      displayMode: request.displayMode,
    };
  };
}

test("nothing is typeset until the browser grants idle time", async () => {
  const idle = idlePeriods();
  const log: string[] = [];
  const typesetter = createIdleTypesetter({
    schedule: idle.schedule,
    isLoaded: () => true,
    render: fakeRender(log),
  });
  const result = typesetter.typeset({ latex: "x^2", displayMode: false });
  await nextTask();
  assert.deepEqual(log, [], "asking does no work");
  assert.equal(idle.queued, 1);

  idle.grant(20);
  assert.equal((await result)?.html, "<b>x^2</b>");
  assert.deepEqual(log, ["x^2"]);
});

test("an idle period is never overrun: work stops at the deadline and resumes later", async () => {
  const idle = idlePeriods();
  const log: string[] = [];
  const typesetter = createIdleTypesetter({
    schedule: idle.schedule,
    isLoaded: () => true,
    // Each equation costs 3 ms of the period it runs in.
    render: fakeRender(log, 3, idle.spend),
  });
  const all = ["a", "b", "c", "d", "e"].map((latex) =>
    typesetter.typeset({ latex, displayMode: false }),
  );

  // 12 ms granted, a 4 ms margin kept: 12 → 9 → 6 → 3 (stop).
  idle.grant(12);
  assert.deepEqual(log, ["a", "b", "c"]);
  assert.equal(typesetter.pending, 2);
  assert.equal(idle.queued, 1, "the rest wait for the next idle period");

  // A period with no room does nothing — unless it timed out, when it makes
  // exactly one equation of progress.
  idle.grant(2);
  assert.deepEqual(log, ["a", "b", "c"]);
  idle.grant(0, true);
  assert.deepEqual(log, ["a", "b", "c", "d"]);
  idle.grant(50);
  assert.deepEqual(log, ["a", "b", "c", "d", "e"]);
  assert.equal((await Promise.all(all)).length, 5);
});

test("the same equation asked for many times is typeset once", async () => {
  const idle = idlePeriods();
  const log: string[] = [];
  const typesetter = createIdleTypesetter({
    schedule: idle.schedule,
    isLoaded: () => true,
    render: fakeRender(log),
  });
  const copies = Array.from({ length: 10 }, () =>
    typesetter.typeset({ latex: "\\hbar", displayMode: false }),
  );
  idle.grant(20);
  const results = await Promise.all(copies);
  assert.deepEqual(log, ["\\hbar"]);
  assert.ok(results.every((r) => r === results[0]));
});

test("KaTeX is downloaded first, outside any typesetting slice; a failed download settles", async () => {
  const idle = idlePeriods();
  const log: string[] = [];
  let loaded = false;
  const typesetter = createIdleTypesetter({
    schedule: idle.schedule,
    isLoaded: () => loaded,
    load: async () => {
      loaded = true;
    },
    render: fakeRender(log),
  });
  const result = typesetter.typeset({ latex: "y", displayMode: true });
  idle.grant(50);
  assert.deepEqual(log, [], "the first idle period only starts the download");
  await nextTask();
  idle.grant(50);
  assert.equal((await result)?.latex, "y");

  const failing = createIdleTypesetter({
    schedule: idle.schedule,
    isLoaded: () => false,
    load: () => Promise.reject(new Error("offline")),
    render: fakeRender(log),
  });
  const gone = failing.typeset({ latex: "z", displayMode: false });
  idle.grant(50);
  assert.equal(await gone, undefined, "the note keeps showing the source");
});

// ---- the renderer's idle path ---------------------------------------------------

const equation = (i: number) =>
  `\\sum_{k=0}^{${i}} \\frac{k^{${(i % 7) + 1}}}{${i + 1}!} = \\int_0^{${i}} g_{${i}}(t)\\,dt`;

test("idle typesetting renders through the shared cache and never spends the reader's budget", async () => {
  await loadKatex();
  clearMathCache();
  await nextTask();

  // Far more typesetting in one task than the reader's 12 ms budget allows.
  const started = performance.now();
  let drawn = 0;
  while (performance.now() - started < 40) {
    assert.ok(renderMathIdle({ latex: equation(drawn), displayMode: true }));
    drawn++;
  }
  assert.ok(drawn > 1);
  // Same task: the reader's synchronous path still has its whole budget.
  assert.ok(
    renderMathSync({ latex: equation(drawn + 1), displayMode: true }),
    "notes took nothing from the document's math budget",
  );
  // And what notes drew is in the cache the document reads.
  assert.equal(
    peekRenderedMath(equation(0), true)?.html,
    renderMathIdle({ latex: equation(0), displayMode: true })?.html,
  );
  // Sanitized like everything else the renderer caches.
  assert.doesNotMatch(peekRenderedMath(equation(0), true)!.html, /<script/i);
});

test("an expression KaTeX can't draw is left as source, not sent to MathJax", async () => {
  await loadKatex();
  assert.equal(renderMathIdle({ latex: "\\frac{1}{", displayMode: false }), undefined);
  assert.equal(
    renderMathIdle({ latex: "x", displayMode: false, renderer: "mathjax" }),
    undefined,
    "a MathJax preference is only served from the cache",
  );
});

// ---- diagrams in a copied selection -------------------------------------------------

type FakeNode = DomNodeLike & { childNodes: FakeNode[]; parentNode: FakeNode | null };

const text = (data: string): FakeNode => ({
  nodeType: 3,
  nodeName: "#text",
  childNodes: [],
  parentNode: null,
  textContent: data,
});

function el(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: Array<FakeNode | string>
) {
  const node: FakeNode = {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    childNodes: [],
    parentNode: null,
    get textContent() {
      return this.childNodes.map((c) => c.textContent ?? "").join("");
    },
    getAttribute: (name) => attrs[name] ?? null,
  };
  for (const child of children) {
    const kid = typeof child === "string" ? text(child) : child;
    kid.parentNode = node;
    node.childNodes.push(kid);
  }
  return node;
}

const select = (
  start: FakeNode,
  startOffset: number,
  end: FakeNode,
  endOffset: number,
  common: FakeNode,
): SelectionBounds => ({
  startContainer: start,
  startOffset,
  endContainer: end,
  endOffset,
  commonAncestorContainer: common,
});

test("a selection touching a diagram copies the diagram's source as a fence", () => {
  const MERMAID = "graph TD\n  A[Start] --> B[End]";
  // What the page holds: an SVG of labels plus Mermaid's injected stylesheet.
  const label = text("Start");
  const diagram = el(
    "div",
    { class: "contents" },
    el(
      "div",
      { class: "docs-mermaid" },
      el("svg", { id: "mermaid-x1" }, el("style", {}, "#mermaid-x1{fill:red}"), el("g", {}, label)),
    ),
  );
  const intro = text("Flow overview.");
  const root = el("div", {}, el("p", {}, intro), diagram, el("p", {}, "After."));
  const sources = new Map<DomNodeLike, { lang: string; source: string }>([
    [diagram, { lang: "mermaid", source: MERMAID }],
  ]);
  const diagramOf = (node: DomNodeLike) => sources.get(node);

  // From the paragraph into a node label: paragraph, then the whole diagram.
  assert.equal(
    selectionToMarkdown(select(intro, 0, label, 3, root), root, diagramOf),
    "Flow overview.\n\n```mermaid\ngraph TD\n  A[Start] --> B[End]\n```",
  );
  // A few characters of one label: still the whole diagram.
  assert.equal(
    selectionToMarkdown(select(label, 1, label, 3, label.parentNode!), root, diagramOf),
    "```mermaid\ngraph TD\n  A[Start] --> B[End]\n```",
  );
  // Without a lookup (no registry), a diagram copies as nothing — never its CSS.
  assert.equal(selectionToMarkdown(select(intro, 0, label, 3, root), root), "Flow overview.");
});

test("a mind map's JSON travels in a mindmap fence", () => {
  const map = el("div", { class: "contents" }, el("div", {}, "Root", el("span", {}, "Child")));
  const root = el("div", {}, map);
  const json = '{"Root":{"Child":{}}}';
  assert.equal(
    selectionToMarkdown(select(root, 0, root, 1, root), root, (node) =>
      node === map ? { lang: "mindmap", source: json } : undefined,
    ),
    "```mindmap\n" + json + "\n```",
  );
});
