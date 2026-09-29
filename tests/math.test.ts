// Unit tests for the math pipeline's pure layers.
//
// The node test runner has no DOM, so what is covered here is everything that
// decides *what* gets rendered and *how it is numbered* — source scanning,
// label extraction, the numbering rules, the KaTeX/MathJax routing decision,
// the macro table, and KaTeX's own output including the MathML half that
// accessibility and Copy MathML depend on. The reader-level concerns (the
// actions tray, zoom, the scroll box, theming) are exercised by
// `tests/fixtures/math-physics-corpus.md` in the browser.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  buildEquationRegistry,
  scanMathNodes,
  scanProseReferences,
  slugLabel,
} from "../src/services/math/equation-registry.ts";
import {
  explicitTag,
  extractLabel,
  extractReferences,
  isNumberable,
  isNumberSuppressed,
  katexCanAttempt,
  macrosFor,
  stripRegistryCommands,
} from "../src/services/math/latex.ts";
import {
  clearMathCache,
  engineChain,
  isMathRenderError,
  mathCacheSize,
  peekRenderedMath,
  renderMath,
  renderMathSync,
} from "../src/services/math/renderer.ts";
import {
  MATH_ELEMENT,
  MATH_REF_ELEMENT,
  remarkEquationReferences,
  remarkInlineMathRefs,
  remarkMathNodes,
} from "../src/services/math/remark-math-nodes.ts";
import { extractMathml, loadKatex, renderKatexSync } from "../src/services/math/adapters/katex.ts";

/** A later task: the per-task typesetting budget has been reset. */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const CORPUS = readFileSync(
  path.join(import.meta.dirname, "fixtures", "math-physics-corpus.md"),
  "utf8",
);

/**
 * KaTeX's module is loaded on demand in production — a reader whose document
 * has no math never downloads it — so the synchronous path only exists once it
 * is resident. Awaited once here; every synchronous render below then finds it,
 * exactly as it does in the app after the viewer's own preload.
 */
await loadKatex();

/**
 * Just enough of an mdast/hast node to assert on what the remark passes wrote.
 * The real trees are `unknown` to the plugins by design — they run inside
 * unified, which owns the types — so the tests name only the fields they read.
 */
interface MdastNode {
  type?: string;
  value?: string;
  children?: unknown[];
  data?: { hName?: string; hProperties?: Record<string, unknown>; hChildren?: unknown[] };
}

/** Asserts the synchronous path answered, which it must with KaTeX resident. */
function katexSync(latex: string, displayMode: boolean) {
  const result = renderKatexSync({ latex, displayMode });
  assert.ok(result, `KaTeX returned nothing for: ${latex}`);
  return result;
}

// ---------------------------------------------------------------------------
// 1. Source scanning: which `$` are math and which are not
// ---------------------------------------------------------------------------

test("scans inline and display math, and leaves prices and escapes alone", () => {
  const nodes = scanMathNodes(
    "Inline $a+b$ and display $$c+d$$ but this costs $5 and that $10, and \\$x\\$ is literal.",
  );
  assert.deepEqual(nodes, [
    { latex: "a+b", displayMode: false },
    { latex: "c+d", displayMode: true },
  ]);
});

test("math inside code fences and inline code is not math", () => {
  const nodes = scanMathNodes(
    ["Real: $x$", "", "```latex", "$$E = mc^2$$", "```", "", "Span: `$y$`", ""].join("\n"),
  );
  assert.deepEqual(nodes, [{ latex: "x", displayMode: false }]);
});

test("an unterminated delimiter is text, not an error", () => {
  assert.deepEqual(scanMathNodes("An open $ delimiter and nothing else"), []);
  assert.deepEqual(scanMathNodes("$$never closed"), []);
});

test("inline math rejects a leading or trailing space, as remark-math does", () => {
  assert.deepEqual(scanMathNodes("$ x$"), []);
  assert.deepEqual(scanMathNodes("$x $"), []);
  assert.deepEqual(scanMathNodes("$x$"), [{ latex: "x", displayMode: false }]);
  // Display math has no such rule — `$$ x $$` is ordinary formatting.
  assert.deepEqual(scanMathNodes("$$ x $$"), [{ latex: "x", displayMode: true }]);
});

test("an escaped dollar inside math does not close it", () => {
  assert.deepEqual(scanMathNodes("$a \\$ b$"), [{ latex: "a \\$ b", displayMode: false }]);
});

// ---------------------------------------------------------------------------
// 2. Labels, tags and references
// ---------------------------------------------------------------------------

test("extracts a label, a tag and references from source", () => {
  assert.equal(extractLabel("E = mc^2 \\label{eq:energy}"), "eq:energy");
  assert.equal(extractLabel("E = mc^2"), undefined);
  assert.equal(explicitTag("\\Delta S \\geq 0 \\tag{2nd law}"), "2nd law");
  assert.deepEqual(extractReferences("see \\eqref{eq:a} and \\ref{eq:b}"), ["eq:a", "eq:b"]);
  assert.deepEqual(scanProseReferences("as {{eq:maxwell}} and {{ eq:efe }} show"), [
    "eq:maxwell",
    "eq:efe",
  ]);
});

test("registry commands are stripped from engine input but never from the source", () => {
  const source = "E = mc^2 \\label{eq:energy} \\nonumber";
  assert.equal(stripRegistryCommands(source).trim(), "E = mc^2");
  // The caller still holds the original — this is a pure function.
  assert.match(source, /\\label\{eq:energy\}/);
  assert.equal(isNumberSuppressed(source), true);
});

test("slugLabel makes a label safe for an id, and never empty", () => {
  assert.equal(slugLabel("eq:maxwell"), "eq-maxwell");
  assert.equal(slugLabel("Eq 3.1 (final)"), "eq-3-1-final");
  assert.equal(slugLabel("!!!"), "eq");
});

// ---------------------------------------------------------------------------
// 3. Numbering rules
// ---------------------------------------------------------------------------

test("only display statements are numbered", () => {
  // A relation, so a statement.
  assert.equal(isNumberable("E = mc^2", true), true);
  assert.equal(isNumberable("a \\leq b", true), true);
  assert.equal(isNumberable("x \\to \\infty", true), true);
  // An environment of relations.
  assert.equal(isNumberable("\\begin{aligned} a &= b \\end{aligned}", true), true);
  // A lone symbol on display is not a statement.
  assert.equal(isNumberable("\\mathcal{H}", true), false);
  // Inline math is never numbered.
  assert.equal(isNumberable("E = mc^2", false), false);
  // An author opting out.
  assert.equal(isNumberable("x = y \\nonumber", true), false);
  // A label makes it numberable whatever it contains.
  assert.equal(isNumberable("\\mathcal{H} \\label{eq:h}", true), true);
});

test("numbers run in document order and are stable across a rebuild", () => {
  const source = [
    "$$ a = 1 \\label{eq:one} $$",
    "inline $x$ between them",
    "$$ b = 2 $$",
    "$$ \\mathcal{H} $$",
    "$$ c = 3 \\label{eq:three} $$",
  ].join("\n\n");

  const registry = buildEquationRegistry(source);
  assert.equal(registry.byLabel("eq:one")?.number, "1");
  assert.equal(registry.byLabel("eq:three")?.number, "3");
  // The unnumbered display symbol takes no number and does not advance the
  // counter, so `eq:three` is 3 rather than 4.
  assert.equal(registry.entries.filter((e) => e.number).length, 3);
  // Inline math is in the registry but never numbered.
  const inline = registry.entries.find((e) => !e.displayMode);
  assert.ok(inline);
  assert.equal(inline.number, undefined);

  // Rebuilding from the same source gives the same numbers — the property the
  // whole registry exists for, since the renderer may change under it.
  const again = buildEquationRegistry(source);
  assert.deepEqual(
    again.entries.map((e) => e.number),
    registry.entries.map((e) => e.number),
  );
});

test("an explicit tag does not consume a number", () => {
  const registry = buildEquationRegistry(
    ["$$ a = 1 $$", "$$ b = 2 \\tag{2a} $$", "$$ c = 3 $$"].join("\n\n"),
  );
  assert.deepEqual(
    registry.entries.map((e) => e.number),
    ["1", "2a", "2"],
  );
});

test("numbering off keeps labels resolvable but assigns no numbers", () => {
  const registry = buildEquationRegistry("$$ a = 1 \\label{eq:one} $$", { numbering: false });
  assert.equal(registry.byLabel("eq:one")?.number, undefined);
  assert.equal(registry.byLabel("eq:one")?.domId, "eq-eq-one");
});

test("undefined labels are reported, defined ones are not", () => {
  const registry = buildEquationRegistry(
    [
      "$$ a = 1 \\label{eq:one} $$",
      "See {{eq:one}} and {{eq:missing}}.",
      "$$ \\eqref{eq:ghost} $$",
    ].join("\n\n"),
  );
  assert.deepEqual(registry.danglingReferences.sort(), ["eq:ghost", "eq:missing"]);
});

test("repeated identical equations each get their own entry and number", () => {
  const registry = buildEquationRegistry(["$$ x = 1 $$", "$$ x = 1 $$"].join("\n\n"));
  assert.equal(registry.entries.length, 2);
  assert.deepEqual(
    registry.entries.map((e) => e.number),
    ["1", "2"],
  );
  // `resolve` walks occurrences, so the second copy finds the second entry.
  assert.equal(registry.resolve("x = 1", true, 0)?.number, "1");
  assert.equal(registry.resolve("x = 1", true, 1)?.number, "2");
});

// ---------------------------------------------------------------------------
// 4. Engine routing
// ---------------------------------------------------------------------------

test("KaTeX is attempted for ordinary LaTeX, including heavy physics notation", () => {
  for (const latex of [
    "e^{i\\pi} + 1 = 0",
    "\\frac{\\partial^2 u}{\\partial x \\partial y}",
    "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
    "\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}",
    "\\begin{cases} 1 & x > 0 \\\\ 0 & x \\leq 0 \\end{cases}",
    // Verified supported by the installed KaTeX in display mode — see the
    // `\begin{…}` note in `KATEX_UNSUPPORTED`.
    "\\begin{align} a &= b \\end{align}",
    "\\begin{gather} a = b \\end{gather}",
    "\\begin{split} a &= b \\end{split}",
    "\\begin{alignat}{2} a &= b \\end{alignat}",
    "\\langle \\psi | \\hat{H} | \\psi \\rangle",
    "G_{\\mu\\nu} + \\Lambda g_{\\mu\\nu} = \\frac{8\\pi G}{c^4} T_{\\mu\\nu}",
    "\\mathbb{R} \\mathfrak{g} \\boldsymbol{\\sigma} \\operatorname{Tr}",
    "T^{\\mu\\nu}{}_{\\rho\\sigma}",
  ]) {
    assert.equal(katexCanAttempt(latex), true, latex);
  }
});

test("constructs KaTeX cannot parse route straight to the fallback", () => {
  for (const latex of [
    "\\begin{multline} a + b \\\\ + c \\end{multline}",
    "\\begin{eqnarray} a &=& b \\end{eqnarray}",
    "\\begin{flalign} a &= b \\end{flalign}",
    "\\begin{subequations} a = b \\end{subequations}",
    "\\begin{tikzcd} A \\arrow[r] & B \\end{tikzcd}",
    "\\dv{f}{x}",
    "\\ce{H2O}",
    "\\newcommand{\\foo}{bar}",
    "\\begin{tabular}{cc} a & b \\end{tabular}",
  ]) {
    assert.equal(katexCanAttempt(latex), false, latex);
  }
});

test("the engine chain keeps KaTeX first and always ends somewhere useful", () => {
  assert.deepEqual(engineChain("auto"), ["katex", "mathjax"]);
  assert.deepEqual(engineChain(), ["katex", "mathjax"]);
  // An explicit choice still falls back rather than showing a broken equation.
  assert.deepEqual(engineChain("katex"), ["katex", "mathjax"]);
  assert.deepEqual(engineChain("temml"), ["temml", "mathjax"]);
  // MathJax has no successor — there is nothing better to try.
  assert.deepEqual(engineChain("mathjax"), ["mathjax"]);
});

test("macro tables are per-engine, and defer to what an engine does better", () => {
  const katex = macrosFor("katex");
  const mathjax = macrosFor("mathjax");
  const temml = macrosFor("temml");

  // KaTeX and Temml have no physics/braket packages, so the macros are what
  // make a document written in that notation render at all.
  for (const name of ["\\ket", "\\bra", "\\braket", "\\comm", "\\expval", "\\grad", "\\Tr"]) {
    assert.ok(name in katex, `${name} missing from KaTeX macros`);
    assert.ok(name in temml, `${name} missing from Temml macros`);
  }

  // MathJax loads the real `physics` and `braket` packages, whose versions size
  // delimiters to their content and take optional derivative orders. A macro
  // here would shadow them, so these are deliberately absent.
  for (const name of ["\\ket", "\\bra", "\\comm", "\\grad", "\\Tr", "\\abs", "\\norm"]) {
    assert.equal(name in mathjax, false, `${name} should defer to MathJax's own package`);
  }
  // What no package supplies is still defined for every engine.
  for (const name of ["\\kB", "\\eV", "\\Lagr", "\\Ham", "\\unit"]) {
    assert.ok(name in mathjax, `${name} missing from MathJax macros`);
    assert.ok(name in katex, `${name} missing from KaTeX macros`);
  }

  // KaTeX defines `\hbar` and `\vec` itself, better than a macro would.
  assert.equal("\\hbar" in katex, false);
  assert.equal("\\vec" in katex, false);
  assert.equal("\\hbar" in mathjax, true);
});

// ---------------------------------------------------------------------------
// 5. KaTeX output: the fast path, and the MathML that accessibility needs
// ---------------------------------------------------------------------------

test("KaTeX renders synchronously with both HTML and MathML", () => {
  const result = katexSync("e^{i\\pi} + 1 = 0", true);
  assert.equal(result.engine, "katex");
  assert.equal(result.displayMode, true);
  // The source is echoed back untouched — what Copy LaTeX hands over.
  assert.equal(result.latex, "e^{i\\pi} + 1 = 0");
  assert.match(result.html, /class="katex/);
  // `output: "htmlAndMathml"` — the MathML half must be there for screen
  // readers and for Copy MathML.
  assert.ok(result.mathml, "no MathML in KaTeX output");
  assert.match(result.mathml, /^<math/);
  assert.match(result.mathml, /<\/math>$/);
  assert.equal(extractMathml(result.html), result.mathml);
});

test("KaTeX renders the physics macros this reader defines", () => {
  for (const latex of [
    "\\ket{\\psi}",
    "\\bra{\\phi}",
    "\\braket{\\phi}{\\psi}",
    "\\comm{\\hat{x}}{\\hat{p}} = i\\hbar",
    "\\expval{\\hat{H}}",
    "\\Tr(\\rho)",
    "\\grad \\cdot \\vb{E}",
    "\\abs{x} + \\norm{v}",
    "\\R \\to \\C",
  ]) {
    const result = katexSync(latex, false);
    assert.match(result.html, /class="katex/, latex);
  }
});

test("\\label and \\nonumber do not break the engine", () => {
  // They are ours, not KaTeX's — stripping them is what keeps a labelled
  // equation from rendering as a parse error.
  const result = katexSync("E = mc^2 \\label{eq:energy} \\nonumber", true);
  assert.match(result.html, /class="katex/);
  assert.equal(result.latex, "E = mc^2 \\label{eq:energy} \\nonumber");
});

test("malformed LaTeX throws rather than producing error markup", () => {
  // Throwing is what drives the fallback chain: the reader must not see KaTeX's
  // red output before MathJax has had a chance.
  for (const latex of ["\\frac{1}{2", "\\thisCommandDoesNotExist{x}", "\\begin{pmatrix} a"]) {
    assert.throws(() => renderKatexSync({ latex, displayMode: true }), undefined, latex);
  }
});

test("trust-gated commands produce no link and no URL", () => {
  // `trust: false` in the adapter. KaTeX does not throw for `\href` — it
  // renders the command name as inert text — so what matters is that no anchor
  // and no URL reach the document from untrusted markdown.
  for (const latex of [
    "\\href{https://example.com}{x}",
    "\\url{https://example.com}",
    "\\includegraphics{http://example.com/x.png}",
  ]) {
    const { html, mathml } = katexSync(latex, false);
    for (const markup of [html, mathml ?? ""]) {
      assert.doesNotMatch(markup, /<a[\s>]/, latex);
      assert.doesNotMatch(markup, /href=/, latex);
      assert.doesNotMatch(markup, /<img[\s>]/, latex);
      // The URL may survive inside the `<annotation>` element, which is the
      // verbatim LaTeX source and is not a navigable link. Nowhere else.
      const outsideAnnotation = markup.replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, "");
      assert.doesNotMatch(outsideAnnotation, /example\.com/, latex);
    }
  }
});

// ---------------------------------------------------------------------------
// 6. The corpus itself
// ---------------------------------------------------------------------------

test("the corpus parses, numbers and resolves every reference it declares", () => {
  const registry = buildEquationRegistry(CORPUS);

  // Enough math to be a real exercise of the pipeline.
  assert.ok(registry.entries.length > 100, `only ${registry.entries.length} math nodes found`);

  // Every label the corpus declares resolves, and each has a number.
  for (const label of [
    "eq:maxwell",
    "eq:schrodinger",
    "eq:efe",
    "eq:lorentz",
    "eq:density",
    "eq:canonical",
    "eq:christoffel",
    "eq:sm-lagrangian",
    "eq:newton-2",
    "eq:energy-momentum",
  ]) {
    const entry = registry.byLabel(label);
    assert.ok(entry, `${label} not in registry`);
    assert.ok(entry.number, `${label} has no number`);
    assert.equal(entry.domId, `eq-${slugLabel(label)}`);
  }

  // The one deliberately dangling reference, and only that one.
  assert.deepEqual(registry.danglingReferences, ["eq:does-not-exist"]);

  // Numbers are unique and sequential where the counter assigned them.
  const auto = registry.entries
    .map((e) => e.number)
    .filter((n): n is string => Boolean(n) && /^\d+$/.test(n))
    .map(Number);
  assert.deepEqual(
    auto,
    [...auto].sort((a, b) => a - b),
  );
  assert.equal(new Set(auto).size, auto.length);
});

test("the corpus keeps fenced math out of the registry", () => {
  const registry = buildEquationRegistry(CORPUS);
  // `$$ E = mc^2 $$` appears inside a ```latex fence and in an inline code
  // span; neither is math.
  assert.equal(
    registry.entries.some((e) => e.latex.trim() === "E = mc^2"),
    false,
  );
});

test("every corpus equation either renders on KaTeX or is a declared fallback case", () => {
  const registry = buildEquationRegistry(CORPUS);

  /**
   * Section 15 exists to be broken, and section 13's `multline` is a declared
   * MathJax case. Everything else must render on the fast engine.
   */
  const INTENTIONALLY_BROKEN = [
    /thisCommandDoesNotExist/,
    /unknownmacro/,
    /\\href\{/,
    /\\begin\{pmatrix\}[\s\S]*\\end\{bmatrix\}/,
    /\\sqrt\[\]\{\}/,
    // `\frac{1}{2` and `\frac{1}{` — an unclosed second argument.
    /\\frac\{1\}\{[^}]*$/,
  ];
  const expectedToFail = (latex: string) =>
    !katexCanAttempt(latex) || INTENTIONALLY_BROKEN.some((pattern) => pattern.test(latex.trim()));

  const unexpected: string[] = [];
  let rendered = 0;

  for (const entry of registry.entries) {
    // `\ref`/`\eqref` never reach an engine from inline math: the remark pass
    // hoists them into their own reference nodes, resolved by the registry. So
    // the engine input is the expression with the references removed, which is
    // what this mirrors.
    const engineInput = entry.displayMode
      ? entry.latex
      : entry.latex.replace(/\\(?:eqref|ref)\s*\{[^}]+\}/g, "").trim();
    if (!engineInput) continue; // a reference and nothing else — no math at all

    try {
      renderKatexSync({ latex: engineInput, displayMode: entry.displayMode });
      rendered += 1;
    } catch {
      if (!expectedToFail(entry.latex)) unexpected.push(entry.latex);
    }
  }

  assert.deepEqual(unexpected, [], "these should have rendered on KaTeX");
  // The fast engine must be carrying the overwhelming majority of the corpus —
  // that is the performance claim the architecture rests on.
  assert.ok(
    rendered / registry.entries.length > 0.9,
    `only ${rendered}/${registry.entries.length} rendered on KaTeX`,
  );
});

test("KaTeX-rendered corpus equations all carry MathML", () => {
  const registry = buildEquationRegistry(CORPUS);
  for (const entry of registry.entries) {
    let html: string;
    let mathml: string | undefined;
    try {
      const result = katexSync(entry.latex, entry.displayMode);
      html = result.html;
      mathml = result.mathml;
    } catch {
      continue; // a fallback case; MathJax supplies its own MathML
    }
    assert.ok(mathml, `no MathML for: ${entry.latex.slice(0, 60)}`);
    // The visual half is hidden from assistive technology, so the MathML is
    // what is actually announced. Both halves must be present.
    assert.match(html, /aria-hidden="true"/);
  }
});

// ---------------------------------------------------------------------------
// 7. The renderer: cache behaviour and the fallback's error shape
// ---------------------------------------------------------------------------

test("renderMathSync takes the fast path and caches it", async () => {
  clearMathCache();
  assert.equal(mathCacheSize(), 0);

  const first = renderMathSync({ latex: "a^2 + b^2 = c^2", displayMode: true });
  assert.ok(first, "KaTeX-renderable math should render synchronously");
  assert.equal(first.engine, "katex");
  assert.equal(mathCacheSize(), 1);

  // A second ask for the same expression is the cached object, not a re-render.
  const second = renderMathSync({ latex: "a^2 + b^2 = c^2", displayMode: true });
  assert.equal(second, first);
  assert.equal(mathCacheSize(), 1);

  // `peek` sees it too — the path the hook uses to settle without a placeholder.
  assert.equal(peekRenderedMath("a^2 + b^2 = c^2", true), first);
  // Inline and display are separate entries: different markup, same source.
  assert.equal(peekRenderedMath("a^2 + b^2 = c^2", false), undefined);
  assert.ok(renderMathSync({ latex: "a^2 + b^2 = c^2", displayMode: false }));
  assert.equal(mathCacheSize(), 2);

  // The async entry point returns the same cached object rather than redoing it.
  assert.equal(await renderMath({ latex: "a^2 + b^2 = c^2", displayMode: true }), first);
});

test("renderMathSync declines what needs the fallback, without caching a failure", () => {
  clearMathCache();
  // An environment KaTeX has no parser for: no synchronous answer, and nothing
  // cached, so the async path is free to try MathJax.
  assert.equal(
    renderMathSync({ latex: "\\begin{multline} a \\\\ b \\end{multline}", displayMode: true }),
    undefined,
  );
  // Malformed LaTeX: likewise undefined rather than a cached error.
  assert.equal(renderMathSync({ latex: "\\frac{1}{", displayMode: true }), undefined);
  assert.equal(mathCacheSize(), 0);

  // A non-KaTeX preference is never answered synchronously, even for math
  // KaTeX could draw — the reader asked for a different engine.
  assert.equal(
    renderMathSync({ latex: "x = y", displayMode: true, renderer: "mathjax" }),
    undefined,
  );
  assert.equal(renderMathSync({ latex: "x = y", displayMode: true, renderer: "temml" }), undefined);
  // But an explicit "katex" preference is.
  assert.ok(renderMathSync({ latex: "x = y", displayMode: true, renderer: "katex" }));
});

test("the cache keys on renderer preference, so a switch cannot serve stale markup", () => {
  clearMathCache();
  renderMathSync({ latex: "x = y", displayMode: true, renderer: "auto" });
  assert.ok(peekRenderedMath("x = y", true, "auto"));
  assert.equal(peekRenderedMath("x = y", true, "katex"), undefined);
  assert.equal(peekRenderedMath("x = y", true, "mathjax"), undefined);
});

test("a failed render rejects with the engines it tried, not a bare Error", async () => {
  clearMathCache();
  // MathJax cannot load outside a browser, so `auto` exhausts its chain here —
  // which is exactly the shape the error UI renders.
  await assert.rejects(
    () => renderMath({ latex: "\\frac{1}{", displayMode: true }),
    (error: unknown) => {
      assert.ok(isMathRenderError(error), "expected a MathRenderError");
      assert.equal(error.latex, "\\frac{1}{");
      assert.equal(error.displayMode, true);
      assert.ok(error.attempted.includes("katex"));
      assert.ok(error.message.length > 0);
      return true;
    },
  );
  assert.equal(isMathRenderError(new Error("plain")), false);
});

test("concurrent asks for one expression share a single render", async () => {
  clearMathCache();
  const [a, b, c] = await Promise.all([
    renderMath({ latex: "\\sum_{n=1}^{\\infty} \\frac{1}{n^2}", displayMode: true }),
    renderMath({ latex: "\\sum_{n=1}^{\\infty} \\frac{1}{n^2}", displayMode: true }),
    renderMath({ latex: "\\sum_{n=1}^{\\infty} \\frac{1}{n^2}", displayMode: true }),
  ]);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(mathCacheSize(), 1);
});

test("the corpus renders once, then every repeat is a cache hit", async () => {
  clearMathCache();
  const registry = buildEquationRegistry(CORPUS);
  const renderable = registry.entries.filter((entry) => katexCanAttempt(entry.latex));

  // Through the async path, which typesets in budgeted slices (the synchronous
  // path declines once a task has spent its budget).
  const started = performance.now();
  const cold = await Promise.allSettled(
    renderable.map((entry) => renderMath({ latex: entry.latex, displayMode: entry.displayMode })),
  );
  const coldMs = performance.now() - started;

  // A whole physics document's worth of math, rendered cold. Generous enough
  // not to be flaky on a loaded machine, tight enough to catch a regression
  // that puts the slow engine on the default path.
  assert.ok(
    coldMs < 2000,
    `cold render of ${renderable.length} equations took ${coldMs.toFixed(0)}ms`,
  );

  // The second pass is all cache hits, synchronously and in one task: a hit
  // spends no budget. This is what makes a repeated equation and a re-render
  // free.
  const warmStart = performance.now();
  renderable.forEach((entry, i) => {
    const first = cold[i];
    if (first.status !== "fulfilled") return; // the corpus's deliberate failures
    assert.equal(
      renderMathSync({ latex: entry.latex, displayMode: entry.displayMode }),
      first.value,
    );
  });
  const warmMs = performance.now() - warmStart;
  assert.ok(
    warmMs < coldMs,
    `warm pass (${warmMs.toFixed(1)}ms) should beat cold (${coldMs.toFixed(1)}ms)`,
  );
});

// ---------------------------------------------------------------------------
// 8. The remark passes: LaTeX survives, references are hoisted
// ---------------------------------------------------------------------------

test("math nodes carry their original LaTeX into the hast element", () => {
  const tree = {
    type: "root",
    children: [
      { type: "math", value: "E = mc^2 \\label{eq:e}" },
      { type: "inlineMath", value: "\\hbar" },
    ],
  };
  remarkMathNodes()(tree);

  const [display, inline] = tree.children as MdastNode[];
  assert.equal(display.data.hName, MATH_ELEMENT);
  // Verbatim, `\label` included — this is what Copy LaTeX hands over.
  assert.equal(display.data.hProperties["data-latex"], "E = mc^2 \\label{eq:e}");
  assert.equal(display.data.hProperties["data-display"], "true");
  // No children, or the raw source would print beside the typeset equation.
  assert.deepEqual(display.data.hChildren, []);

  assert.equal(inline.data.hProperties["data-latex"], "\\hbar");
  assert.equal(inline.data.hProperties["data-display"], "false");
});

test("references are hoisted out of inline math, leaving the rest to typeset", () => {
  const tree = {
    type: "root",
    children: [{ type: "inlineMath", value: "E = \\eqref{eq:energy} + 1" }],
  };
  remarkInlineMathRefs()(tree);

  const kids = tree.children as MdastNode[];
  assert.equal(kids.length, 3);
  // The expression either side of the reference still goes to an engine...
  assert.equal(kids[0].type, "inlineMath");
  assert.equal(kids[0].value, "E = ");
  // ...and the reference becomes its own element, resolved by the registry.
  assert.equal(kids[1].data.hName, MATH_REF_ELEMENT);
  assert.equal(kids[1].data.hProperties["data-label"], "eq:energy");
  assert.equal(kids[1].data.hProperties["data-paren"], "true");
  assert.equal(kids[2].value, " + 1");
});

test("\\ref gives a bare number where \\eqref parenthesises it", () => {
  const tree = { type: "root", children: [{ type: "inlineMath", value: "\\ref{eq:a}" }] };
  remarkInlineMathRefs()(tree);
  const [only] = tree.children as MdastNode[];
  assert.equal(only.data.hProperties["data-paren"], "false");
  // A reference and nothing else leaves no math node at all — there is nothing
  // for an engine to draw.
  assert.equal(tree.children.length, 1);
});

test("display math keeps its references inline, for the engine to lay out", () => {
  const tree = { type: "root", children: [{ type: "math", value: "a = \\eqref{eq:b}" }] };
  remarkInlineMathRefs()(tree);
  assert.equal(tree.children.length, 1);
  assert.equal((tree.children[0] as MdastNode).type, "math");
});

test("the prose reference form becomes a reference element", () => {
  const tree = {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", value: "As {{eq:maxwell}} shows, {{eq:efe}} follows." }],
      },
    ],
  };
  remarkEquationReferences()(tree);

  const kids = (tree.children[0] as MdastNode).children as MdastNode[];
  assert.equal(kids.length, 5);
  assert.equal(kids[0].value, "As ");
  assert.equal(kids[1].data.hProperties["data-label"], "eq:maxwell");
  assert.equal(kids[2].value, " shows, ");
  assert.equal(kids[3].data.hProperties["data-label"], "eq:efe");
  assert.equal(kids[4].value, " follows.");
});

// ---------------------------------------------------------------------------
// 9. Bundle discipline
// ---------------------------------------------------------------------------

test("no engine is imported at module scope by the renderer", () => {
  // The guarantee behind "do not sacrifice normal Markdown performance": a
  // reader whose document has no math must download no math engine. That holds
  // only while every engine sits behind a dynamic `import()`, so the source is
  // asserted directly — a static import added later would pull ~250 kB of KaTeX
  // (or ~460 kB of Temml) into the reader's chunk, and nothing else would fail.
  const sources = {
    "renderer.ts": readFileSync(
      path.join(import.meta.dirname, "..", "src", "services", "math", "renderer.ts"),
      "utf8",
    ),
    "adapters/katex.ts": readFileSync(
      path.join(import.meta.dirname, "..", "src", "services", "math", "adapters", "katex.ts"),
      "utf8",
    ),
    "adapters/temml.ts": readFileSync(
      path.join(import.meta.dirname, "..", "src", "services", "math", "adapters", "temml.ts"),
      "utf8",
    ),
    "adapters/mathjax.ts": readFileSync(
      path.join(import.meta.dirname, "..", "src", "services", "math", "adapters", "mathjax.ts"),
      "utf8",
    ),
  };

  const staticImport = /^\s*import\s+(?!type\b)[^\n]*?from\s*["']([^"']+)["']/gm;
  for (const [name, source] of Object.entries(sources)) {
    staticImport.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = staticImport.exec(source))) {
      const specifier = match[1];
      assert.ok(
        !/^(katex|temml|mathjax|mathjax-full)(\/|$)/.test(specifier),
        `${name} statically imports "${specifier}" — it must be a dynamic import()`,
      );
    }
  }

  // And the dynamic forms are present, so the engines are reachable at all.
  assert.match(sources["adapters/katex.ts"], /import\("katex"\)/);
  assert.match(sources["adapters/temml.ts"], /import\("temml"\)/);
  // MathJax is a script tag rather than an import — it is a self-executing
  // bundle that configures itself from `window.MathJax`.
  assert.match(sources["adapters/mathjax.ts"], /createElement\("script"\)/);
});

test("MathJax is never reached unless an engine chain asks for it", async () => {
  // `auto` and `katex` both start on KaTeX; MathJax appears only as a fallback.
  for (const preference of ["auto", "katex", "temml"] as const) {
    assert.notEqual(engineChain(preference)[0], "mathjax", preference);
  }
  // Which means a document whose math KaTeX can draw never loads MathJax at
  // all: `renderMathSync` answers from KaTeX and the async path is never
  // entered.
  clearMathCache();
  await nextTask(); // a fresh typesetting budget (see math-render-budget.test.ts)
  assert.ok(renderMathSync({ latex: "E = mc^2", displayMode: true }));
});
