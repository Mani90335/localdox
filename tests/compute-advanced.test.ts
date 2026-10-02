import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import katex from "katex";
import { parse as parseLatex } from "@cortex-js/compute-engine/latex-syntax";
import { loadPyodide } from "pyodide";
import { mirrorPyodide, pyodideAssets } from "../build/pyodide-packages.ts";
import { prepareInput } from "../src/services/compute/input.ts";
import { needsAdvanced } from "../src/services/compute/advanced/routing.ts";
import {
  newContext,
  normalize,
  preprocessLatex,
} from "../src/services/compute/advanced/normalize.ts";
import { runAdvanced, type Bridge } from "../src/services/compute/advanced/run.ts";
import { parseStatements, splitStatements } from "../src/services/compute/advanced/statements.ts";
import type {
  AdvancedParams,
  AnyOperation,
  ComputeAnswer,
  ComputeFailure,
  ComputeResult,
  Step,
} from "../src/services/compute/protocol.ts";
import { resultLatex, resultMarkdown } from "../src/services/compute/result-markdown.ts";
import { macrosFor } from "../src/services/math/latex.ts";

// The advanced engine (SymPy on Pyodide) end to end, in Node: the same
// statements parser, normalizer, runner and Python bridge the worker uses.
// The first run downloads SymPy's wheel once (build/pyodide-packages.ts).

let bridge: Bridge;
let runPython: (code: string) => unknown;

before(async () => {
  const dir = path.join(tmpdir(), "localdox-pyodide-test");
  await mirrorPyodide(dir);
  const pyodide = await loadPyodide({ indexURL: `${dir}/` });
  await pyodide.loadPackage("sympy", { messageCallback: () => {} });
  pyodide.runPython(await readFile("src/services/compute/advanced/steps.py", "utf8"));
  pyodide.runPython(await readFile("src/services/compute/advanced/bridge.py", "utf8"));
  const run = pyodide.globals.get("run");
  bridge = { run: (request) => run(request) as string };
  runPython = (code) => pyodide.runPython(code);
});

function run(op: AnyOperation, input: string, params?: AdvancedParams): ComputeResult {
  return runAdvanced(bridge, parseLatex, { op, input, params });
}

function answer(op: AnyOperation, input: string, params?: AdvancedParams): ComputeAnswer {
  const result = run(op, input, params);
  assert.equal(result.ok, true, `${op} ${input}: ${JSON.stringify(result)}`);
  return result as ComputeAnswer;
}

function failure(op: AnyOperation, input: string, params?: AdvancedParams): ComputeFailure {
  const result = run(op, input, params);
  assert.equal(result.ok, false, `${op} ${input} should fail: ${JSON.stringify(result)}`);
  return result as ComputeFailure;
}

// ---- text handling (no Python) -----------------------------------------------------------

test("statements: definitions, distributions, assumptions and targets", () => {
  assert.deepEqual(splitStatements("a; b\nc \\; d\n\n"), ["a", "b", "c \\; d"]);
  assert.deepEqual(splitStatements("[[1, 2]; [3, 4]]"), ["[[1, 2]; [3, 4]]"], "inside brackets");
  const parsed = parseStatements(
    "assume x > 0\nassume n positive integer\nX ~ N(0, 4)\nY \\sim \\mathcal{N}(\\mu, \\sigma^2)\nZ ~ Bin(10, 1/2)\nlet A = [[1, 2], [3, 4]]\nf(x) := x^2\nP(X < 1)",
  );
  assert.deepEqual(parsed.assumptions, [
    { names: ["x"], property: "positive" },
    { names: ["n"], property: "positive" },
    { names: ["n"], property: "integer" },
  ]);
  assert.deepEqual(
    parsed.random.map((r) => [r.name, r.distribution, r.params]),
    [
      ["X", "Normal", ["0", "4"]],
      ["Y", "Normal", ["\\mu", "\\sigma^2"]],
      ["Z", "Binomial", ["10", "1/2"]],
    ],
  );
  assert.deepEqual(parsed.definitions, [
    { name: "A", args: [], value: "[[1, 2], [3, 4]]" },
    { name: "f", args: ["x"], value: "x^2" },
  ]);
  assert.deepEqual(parsed.targets, ["P(X < 1)"]);
  assert.throws(() => parseStatements("X ~ Foo(1)"), /isn't a distribution/);
  assert.throws(() => parseStatements("assume x is nice"), /An assumption reads like/);
});

test("routing: what only the advanced engine reads goes there", () => {
  for (const input of [
    "\\int_0^1 x^2 dx",
    "\\frac{d}{dx} x^3",
    "\\lim_{x \\to 0} \\frac{\\sin x}{x}",
    "\\sum_{n=1}^{10} n",
    "X ~ N(0, 1)\nP(X < 1)",
    "let A = [[1, 2], [3, 4]]",
    "[[1, 2], [3, 4]]",
    "y'' + y = 0",
    "x^2 < 4",
    "det([[1, 2], [3, 4]])",
    "\\binom{5}{2}",
    "E[X]",
    "2, 4, 4, 5",
  ]) {
    assert.equal(needsAdvanced(input), true, input);
  }
  for (const input of [
    "1/2 + 1/3",
    "x^2 - 5x + 6 = 0",
    "sqrt(8)",
    "\\frac{1}{2}",
    "sin(pi/6)",
    "e^(i*pi)",
  ]) {
    assert.equal(needsAdvanced(input), false, input);
  }
});

test("advanced plain text: relations, lists, primes, Greek and named functions", () => {
  const latex = (text: string) => {
    const prepared = prepareInput(text, { advanced: true });
    assert.ok(prepared.ok, `${text}: ${JSON.stringify(prepared)}`);
    return prepared.latex;
  };
  assert.equal(latex("P(X <= 1 given X > 0)"), "P(X\\le1\\mid X>0)");
  assert.equal(latex("[[1, 2], [3, 4]]"), "\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}");
  assert.equal(latex("[1, 2, 3]"), "[1,2,3]", "a list stays a list");
  assert.equal(latex("y'' + y = 0"), "y''+y=0");
  assert.equal(latex("Var(X + Y)"), "\\operatorname{Var}\\left(X+Y\\right)");
  assert.equal(latex("binomial(5, 2)"), "\\binom{5}{2}");
  assert.equal(latex("log(8, 2)"), "\\log_{2}\\left(8\\right)");
  assert.equal(latex("gamma(5) + theta"), "\\Gamma\\left(5\\right)+\\theta");
  assert.equal(latex("E[X^2]"), "E[X^{2}]");
  // The basic engine still refuses these.
  assert.equal(prepareInput("x < 1").ok, false);
  assert.equal(prepareInput("log(8, 2)").ok, false);
});

test("normalizing: calls versus products, derivatives, conditions, limits", () => {
  // Numbers come as JSON numbers or ["Number", "…"]; compare them by value.
  const plain = (node: unknown): unknown =>
    Array.isArray(node) ? (node[0] === "Number" ? Number(node[1]) : node.map(plain)) : node;
  const read = (latex: string) => {
    const context = newContext();
    return plain(normalize(parseLatex(preprocessLatex(latex, context)), context));
  };
  assert.deepEqual(read("\\operatorname{Var}(X+Y)"), ["Var", ["Add", "X", "Y"]]);
  assert.deepEqual(read("x(x+1)"), ["Multiply", "x", ["Add", "x", 1]]);
  assert.deepEqual(read("e(x+1)"), ["Multiply", "e", ["Add", "x", 1]], "e·(…), not E[…]");
  assert.deepEqual(read("\\binom{5}{2}"), ["Binomial", 5, 2]);
  assert.deepEqual(read("\\frac{d^2}{dx^2} x^4"), ["D", ["D", ["Power", "x", 4], "x"], "x"]);
  assert.deepEqual(read("P(X<1 \\mid X>0)"), [
    "P",
    ["Given", ["Less", "X", 1], ["Greater", "X", 0]],
  ]);
  assert.deepEqual(read("\\lim_{x \\to 0^+} \\frac{1}{x}"), [
    "Limit",
    ["Divide", 1, "x"],
    "x",
    0,
    "+",
  ]);
  // dy/dx makes y a function of x.
  const context = newContext();
  assert.equal(preprocessLatex("\\frac{d^2y}{dt^2} + y = 0", context), "y'' + y = 0");
  assert.equal(context.independent, "t");
  assert.ok(context.functions.has("y"));
});

// ---- the engine ------------------------------------------------------------------------------

test("calculus: derivatives, integrals, limits, series, sums", () => {
  assert.equal(
    answer("evaluate", "\\frac{d}{dx} x^2\\sin x").exact,
    "x^{2} \\cos{\\left(x \\right)} + 2 x \\sin{\\left(x \\right)}",
  );
  assert.equal(answer("evaluate", "\\frac{d^2}{dx^2} x^4").exact, "12 x^{2}");
  assert.equal(
    answer("evaluate", "\\frac{\\partial^2}{\\partial x\\partial y} x^2y^3").exact,
    "6 x y^{2}",
  );
  assert.equal(answer("evaluate", "\\int x e^x\\,dx").exact, "\\left(x - 1\\right) e^{x}");
  const gauss = answer("evaluate", "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx");
  assert.equal(gauss.exact, "\\sqrt{\\pi}");
  assert.equal(gauss.approx, "1.77245385091");
  assert.equal(answer("evaluate", "\\int_0^1\\int_0^x xy\\,dy\\,dx").exact, "\\frac{1}{8}");
  assert.equal(answer("evaluate", "\\lim_{n\\to\\infty}(1+\\frac{1}{n})^n").exact, "e");
  assert.equal(answer("evaluate", "\\lim_{x\\to 0^+}\\frac{1}{x}").exact, "\\infty");
  assert.match(
    failure("limit", "\\frac{1}{x}", { point: "0" }).message,
    /doesn't exist.*-\\infty.*\\infty/,
  );
  assert.equal(
    answer("evaluate", "\\sum_{n=1}^{\\infty}\\frac{1}{n^2}").exact,
    "\\frac{\\pi^{2}}{6}",
  );
  assert.equal(answer("evaluate", "\\sum_{k=1}^{n} k").exact, "\\frac{n^{2}}{2} + \\frac{n}{2}");
  assert.equal(answer("evaluate", "\\sum_{i=1}^{3} i^2").exact, "14", "i is the index, not √−1");

  const series = answer("series", "e^x", { order: 5 });
  assert.equal(
    series.exact,
    "1 + x + \\frac{x^{2}}{2} + \\frac{x^{3}}{6} + \\frac{x^{4}}{24} + O\\left(x^{5}\\right)",
  );
  const antiderivative = answer("integrate", "\\frac{1}{x}");
  assert.match(antiderivative.notes.join(" "), /add any constant/);
  assert.match(antiderivative.notes.join(" "), /ln\|u\|/);
  assert.equal(
    answer("integrate", "x e^{-x}", { variable: "x", lower: "0", upper: "oo" }).exact,
    "1",
  );
  const noClosedForm = answer("evaluate", "\\int \\sqrt{\\tan x}\\,dx");
  assert.match(noClosedForm.notes.join(" "), /No closed form/);
  assert.equal(answer("approximate", "\\int_0^1 e^{-x^2} dx").approx, "0.746824132812");

  assert.equal(
    answer("gradient", "x^2 y + y^3").exact,
    "\\left[\\begin{matrix}2 x y\\\\x^{2} + 3 y^{2}\\end{matrix}\\right]",
  );
  assert.equal(
    answer("hessian", "x^2 y + y^3").exact,
    "\\left[\\begin{matrix}2 y & 2 x\\\\2 x & 6 y\\end{matrix}\\right]",
  );
  assert.equal(failure("integrate", "x^n").kind, "choose-variable");
});

test("differential equations, with and without initial conditions", () => {
  const general = answer("solve", "y'' + y = 0");
  assert.equal(
    general.exact,
    "y{\\left(x \\right)} = C_{1} \\sin{\\left(x \\right)} + C_{2} \\cos{\\left(x \\right)}",
  );
  assert.match(general.notes.join(" "), /arbitrary constants/);
  assert.equal(
    answer("solve", "y'' + y = 0\ny(0) = 1\ny'(0) = 0").exact,
    "y{\\left(x \\right)} = \\cos{\\left(x \\right)}",
  );
  assert.equal(
    answer("solve", "\\frac{dy}{dx} = y\ny(0) = 2").exact,
    "y{\\left(x \\right)} = 2 e^{x}",
  );
  assert.match(
    answer("solve", "\\frac{d^2y}{dt^2} + 3\\frac{dy}{dt} + 2y = 0").exact!,
    /y\{\\left\(t \\right\)\}/,
  );
});

test("solving: full solution sets, inequalities, systems, parameters", () => {
  assert.equal(
    answer("solve", "\\sin(x) = \\frac{1}{2}").exact,
    "\\left\\{2 n \\pi + \\frac{\\pi}{6}\\; \\middle|\\; n \\in \\mathbb{Z}\\right\\} \\cup \\left\\{2 n \\pi + \\frac{5 \\pi}{6}\\; \\middle|\\; n \\in \\mathbb{Z}\\right\\}",
  );
  // What the basic engine missed.
  assert.equal(answer("solve", "|x| = 3").exact, "\\left\\{-3, 3\\right\\}");
  assert.equal(answer("solve", "2^x = 8").exact, "\\left\\{3\\right\\}");
  assert.equal(answer("solve", "e^x = 5").exact, "\\left\\{\\ln{\\left(5 \\right)}\\right\\}");
  assert.equal(answer("solve", "x^2 < 4").exact, "\\left(-2, 2\\right)");
  assert.equal(
    answer("solve", "x^2 + 1 = 0", { domain: "complex" }).exact,
    "\\left\\{- i, i\\right\\}",
  );
  const system = answer("solve", "x + y = 3\nx - y = 1");
  assert.equal(system.exact, "\\left\\{\\left( 2, \\  1\\right)\\right\\}");
  assert.equal(system.lhs, "\\left(x, y\\right) \\in ");
  const parametric = answer("solve", "a x + b = 0", { variable: "x" });
  assert.equal(parametric.exact, "\\left\\{- \\frac{b}{a}\\right\\}");
  assert.match(parametric.notes.join(" "), /Assumes \$a \\neq 0\$/);
});

test("linear algebra: exact matrices, singularity, eigenspaces, diagonalization", () => {
  assert.equal(answer("determinant", "[[1,2],[3,4]]").exact, "-2");
  assert.equal(
    answer("evaluate", "\\det\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}").exact,
    "a d - b c",
  );
  assert.equal(
    answer("evaluate", "\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}^{-1}").exact,
    "\\left[\\begin{matrix}-2 & 1\\\\\\frac{3}{2} & - \\frac{1}{2}\\end{matrix}\\right]",
    "exact fractions, not 1.5",
  );
  assert.equal(failure("inverse", "[[1,2],[2,4]]").kind, "undefined");
  assert.equal(
    answer("evaluate", "let A = [[2,0],[0,3]]\nA^3").exact,
    "\\left[\\begin{matrix}8 & 0\\\\0 & 27\\end{matrix}\\right]",
  );
  assert.equal(
    answer("evaluate", "[[1,2],[3,4]] * [[5],[6]]").exact,
    "\\left[\\begin{matrix}17\\\\39\\end{matrix}\\right]",
  );
  assert.equal(answer("rank", "[[1,2,3],[2,4,6],[1,0,1]]").exact, "2");
  assert.deepEqual(answer("rref", "[[1,2,3],[2,4,6],[1,0,1]]").notes, ["Pivot columns: 1, 2."]);
  assert.match(answer("nullspace", "[[1,2,3],[2,4,6],[1,0,1]]").exact!, /span/);
  const eigen = answer("eigenvectors", "[[2,0,0],[0,2,0],[0,0,3]]");
  assert.equal(eigen.exact, "\\left\\{2, 3\\right\\}");
  assert.deepEqual(
    eigen.forms?.map((f) => f.label),
    ["λ = 2 (×2)", "λ = 3"],
  );
  assert.equal(answer("charpoly", "[[2,1],[1,2]]").exact, "\\lambda^{2} - 4 \\lambda + 3");
  assert.match(answer("diagonalize", "[[1,1],[0,1]]").notes.join(" "), /Not diagonalizable/);
  assert.equal(failure("eigenvalues", "x + 1").kind, "wrong-operation");
});

test("probability: distributions, events, moments, conditions", () => {
  const normal = answer("evaluate", "X ~ N(0, 4)\nP(-2 < X < 2)");
  assert.equal(normal.approx, "0.682689492137");
  assert.deepEqual(normal.given, ["X \\sim \\mathcal{N}\\left(0, 4\\right)"]);
  assert.match(
    normal.notes.join(" "),
    /mean \$0\$, variance \$4\$/,
    "N(μ, σ²) says how it was read",
  );
  assert.equal(answer("evaluate", "X ~ Bin(10, 1/2)\nP(X >= 8)").exact, "\\frac{7}{128}");
  assert.equal(answer("evaluate", "X ~ Pois(3)\nP(X > 2)").exact, "1 - \\frac{17}{2 e^{3}}");
  assert.equal(
    answer("evaluate", "X \\sim \\mathcal{N}(\\mu, \\sigma^2)\nE[X^2]").exact,
    "\\mu^{2} + \\sigma^{2}",
  );
  assert.equal(answer("evaluate", "X ~ Exp(2)\nVar(X)").exact, "\\frac{1}{4}");
  assert.equal(answer("evaluate", "X ~ U(0,1)\nY ~ U(0,1)\nE[(X+Y)^2]").exact, "\\frac{7}{6}");
  assert.equal(answer("evaluate", "X ~ N(0,1)\nP(X > 1 given X > 0)").approx, "0.317310507863");
  assert.equal(answer("evaluate", "X ~ Exp(1)\npdf(X)").exact, "e^{- x}");
  const decimal = answer("evaluate", "X ~ N(0,1)\nP(X < 1.96)");
  assert.equal(decimal.exact, undefined);
  assert.equal(decimal.approx, "0.975002104852");
  assert.equal(failure("evaluate", "P(x + 1)").kind, "wrong-operation");
  assert.match(failure("evaluate", "X ~ N(0)\nX").message, /takes 2 parameters/);
});

test("statistics, special functions, transforms, complex numbers, assumptions", () => {
  const summary = answer("statistics", "2, 4, 4, 5, 7, 9");
  const rows = Object.fromEntries(summary.forms!.map((f) => [f.label, f.latex]));
  assert.equal(rows.Mean, "\\frac{31}{6} \\approx 5.16666666667");
  assert.equal(rows["Sample variance"], "\\frac{37}{6} \\approx 6.16666666667");
  assert.equal(rows.Mode, "4");
  assert.equal(rows.Q1, "4");
  assert.equal(answer("evaluate", "\\binom{5}{2}").exact, "10");
  assert.equal(answer("evaluate", "\\Gamma(\\frac{1}{2})").exact, "\\sqrt{\\pi}");
  assert.equal(answer("evaluate", "(1+i)^{10}").exact, "32 i");
  assert.equal(answer("evaluate", "(1+i)^{10}").approx, undefined);
  assert.equal(
    answer("laplace", "e^{-2t}\\sin(3t)").exact,
    "\\frac{3}{\\left(s + 2\\right)^{2} + 9}",
  );
  assert.match(answer("inverse-laplace", "\\frac{1}{s^2+1}").exact!, /\\sin.*\\theta/);
  assert.match(answer("fourier", "e^{-x^2}").notes.join(" "), /Convention/);
  assert.equal(answer("residue", "\\frac{1}{z^2+1}", { point: "i" }).exact, "- \\frac{i}{2}");
  assert.equal(answer("evaluate", "assume x > 0\n\\sqrt{x^2}").exact, "x");
  assert.equal(answer("evaluate", "let f(x) = x^2 + 1\nf(3)").exact, "10");
  assert.deepEqual(
    answer("simplify", "\\frac{x^2-1}{x^2+2x+1}").forms?.map((f) => f.label),
    ["Expanded", "Partial fractions"],
  );
});

// ---- worked steps (steps.py) --------------------------------------------------------------

function flatten(steps: Step[] = []): Step[] {
  return steps.flatMap((s) => [s, ...flatten(s.substeps)]);
}

function stepText(result: ComputeAnswer): string {
  return flatten(result.steps)
    .map((s) => `${s.text} ${s.latex ?? ""}`)
    .join("\n");
}

function assertStepsDraw(result: ComputeAnswer) {
  const macros = macrosFor("katex");
  for (const step of flatten(result.steps)) {
    if (step.latex) {
      assert.doesNotThrow(
        () => katex.renderToString(`\\displaystyle ${step.latex}`, { throwOnError: true, macros }),
        step.latex,
      );
    }
    for (const [, math] of step.text.matchAll(/\$([^$]+)\$/g)) {
      assert.doesNotThrow(() => katex.renderToString(math, { throwOnError: true, macros }), math);
    }
  }
}

test("steps: derivatives rule by rule, checked against the result", () => {
  const product = answer("differentiate", "x^2 \\sin(x)");
  assert.match(stepText(product), /Product rule/);
  assert.match(stepText(product), /Power rule/);
  const chain = answer("differentiate", "\\sin(x^2)");
  assert.match(stepText(chain), /Chain rule/);
  const quotient = answer("differentiate", "\\frac{x^2+1}{x-1}");
  assert.match(stepText(quotient), /Quotient rule/);
  const second = answer("differentiate", "x^3 \\sin(x)", { variable: "x", order: 2 });
  assert.match(stepText(second), /The second derivative/);
  // No rule here for a variable power of a variable: no steps, the result still stands.
  const power = answer("differentiate", "x^x");
  assert.equal(power.steps, undefined);
  assert.ok(power.exact);
  for (const result of [product, chain, quotient, second]) assertStepsDraw(result);
});

test("steps: integrals by SymPy's method, antiderivatives checked by differentiating", () => {
  const parts = answer("integrate", "x e^{x}");
  assert.match(stepText(parts), /Integrate by parts/);
  assert.match(stepText(parts), /\+ C/);
  const substitution = answer("integrate", "\\sin^2(x) \\cos(x)");
  assert.match(stepText(substitution), /Substitute \$u = \\sin/);
  const terms = answer("integrate", "3x^2 + 2x - 5");
  assert.match(stepText(terms), /term by term/);
  // Written out and evaluated, an integral gets the same steps.
  assert.match(stepText(answer("evaluate", "\\int x e^{x}\\,dx")), /Integrate by parts/);
  assert.match(stepText(answer("evaluate", "\\frac{d}{dx} x^2 \\sin(x)")), /Product rule/);
  const definite = answer("integrate", "x^2", { variable: "x", lower: "0", upper: "1" });
  assert.match(stepText(definite), /fundamental theorem of calculus/);
  assert.match(stepText(definite), /= \\frac\{1\}\{3\}/);
  // Across a pole the antiderivative's difference is finite, but the integral isn't: no steps.
  const divergent = run("integrate", "\\frac{1}{x^2}", { variable: "x", lower: "-1", upper: "1" });
  if (divergent.ok) assert.equal(divergent.steps, undefined);
  for (const result of [parts, substitution, terms, definite]) assertStepsDraw(result);
});

test("steps: matrices by cofactors and row operations, linear systems by elimination", () => {
  const determinant = answer("determinant", "[[1,2,3],[0,1,4],[5,6,0]]");
  assert.equal(determinant.exact, "1");
  assert.match(stepText(determinant), /Expand along row 2/);
  assert.match(stepText(determinant), /ad - bc/);
  const reduced = answer("rref", "[[1,2,3],[0,1,4],[5,6,0]]");
  assert.match(stepText(reduced), /R_\{3\} \\to R_\{3\} - 5R_\{1\}/);
  const inverse = answer("inverse", "[[1,2],[3,4]]");
  assert.match(stepText(inverse), /beside the identity/);
  assert.match(stepText(inverse), /right half is the inverse/);
  const system = answer("solve", "2x + y = 5\nx - y = 1");
  assert.match(stepText(system), /augmented matrix/);
  assert.match(stepText(system), /x = 2,\\quad y = 1/);
  for (const result of [determinant, reduced, inverse, system]) assertStepsDraw(result);
});

test("input never runs as Python: names and heads are allow-listed on both sides", () => {
  // Rejected before Python sees them.
  assert.equal(failure("evaluate", '__import__("os")').kind, "syntax");
  assert.equal(failure("evaluate", "x.__class__").kind, "syntax");
  // And by the bridge, for a request that slipped past the JavaScript side.
  const direct = (targets: unknown[]) =>
    JSON.parse(bridge.run(JSON.stringify({ op: "evaluate", targets })));
  assert.equal(direct([["Apply", "__import__", "os"]]).kind, "syntax");
  assert.equal(direct([["eval", 1]]).kind, "unsupported");
  assert.equal(direct(["__builtins__"]).kind, "syntax");
  assert.equal(direct([["Number", "1+1"]]).kind, "syntax");
  // Nothing ran: the probe is still unset.
  assert.equal(runPython("'probe' in globals()"), false);
});

test("every result is LaTeX KaTeX draws, and Markdown that carries it", () => {
  const macros = macrosFor("katex");
  const cases: [AnyOperation, string, AdvancedParams?][] = [
    ["evaluate", "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx"],
    ["evaluate", "X ~ N(0,1)\nP(X > 1 given X > 0)"],
    ["solve", "\\sin(x) = \\frac{1}{2}"],
    ["solve", "y'' + y = 0"],
    ["solve", "x + y = 3\nx - y = 1"],
    ["eigenvectors", "[[2,1],[1,2]]"],
    ["diagonalize", "[[1,1],[0,1]]"],
    ["nullspace", "[[1,2,3],[2,4,6],[1,0,1]]"],
    ["statistics", "2, 4, 4, 5"],
    ["series", "\\ln(1+x)", { order: 4 }],
    ["inverse-laplace", "\\frac{1}{s^2+1}"],
    ["limit", "\\frac{\\sin x}{x}", { point: "0" }],
    ["evaluate", "\\int \\sqrt{\\tan x}\\,dx"],
  ];
  for (const [op, input, params] of cases) {
    const result = answer(op, input, params);
    const pieces = [
      resultLatex(result),
      ...(result.given ?? []),
      ...(result.forms ?? []).map((f) => f.latex),
    ];
    for (const latex of pieces) {
      assert.doesNotThrow(
        () => katex.renderToString(latex, { throwOnError: true, displayMode: true, macros }),
        `${op} ${input}: ${latex}`,
      );
    }
    for (const note of result.notes) {
      for (const [, math] of note.matchAll(/\$([^$]+)\$/g)) {
        assert.doesNotThrow(() => katex.renderToString(math, { throwOnError: true, macros }), math);
      }
    }
  }
  const markdown = resultMarkdown(answer("evaluate", "X ~ N(0, 4)\nP(-2 < X < 2)"));
  assert.match(
    markdown,
    /^Given \$X \\sim \\mathcal\{N\}\\left\(0, 4\\right\)\$\.\n\n\$\$\nP\(-2<X<2\) = \\operatorname\{erf\}/,
  );
  assert.match(
    resultMarkdown(answer("determinant", "[[1,2],[3,4]]")),
    /\\det\\left\(.*\\right\) = -2/,
  );
  assert.match(
    resultMarkdown(answer("eigenvectors", "[[2,1],[1,2]]")),
    /\n- λ = 1: \$\\operatorname\{span\}/,
  );
});

test("wheels are checked against the pinned lock file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "localdox-wheels-"));
  const tampered = async () => new Response(Buffer.from("not sympy"));
  await assert.rejects(
    pyodideAssets({ cacheDir: dir, fetch: tampered as typeof fetch }),
    /doesn't match pyodide-lock\.json/,
  );
  // A corrupted cache entry is downloaded again, not trusted.
  const real = await pyodideAssets();
  const wheel = real.files.find((f) => f.name.startsWith("mpmath"))!;
  const bytes = await readFile(wheel.path!);
  await writeFile(path.join(dir, wheel.name), "corrupt");
  let fetched = 0;
  const serve = async (url: string) => {
    fetched++;
    return new Response(
      url.endsWith(wheel.name)
        ? bytes
        : await readFile(real.files.find((f) => url.endsWith(f.name))!.path!),
    );
  };
  const assets = await pyodideAssets({ cacheDir: dir, fetch: serve as unknown as typeof fetch });
  assert.equal(fetched, 2);
  const cached = await readFile(path.join(dir, wheel.name));
  assert.equal(
    createHash("sha256").update(cached).digest("hex"),
    createHash("sha256").update(bytes).digest("hex"),
  );
  // The published lock file lists only what SymPy needs.
  const lock = JSON.parse(assets.files.find((f) => f.name === "pyodide-lock.json")!.text!);
  assert.deepEqual(Object.keys(lock.packages).sort(), ["mpmath", "sympy"]);
});

test("d/dx applies to the term after it, as on paper", () => {
  const scoped = (latex: string) => preprocessLatex(latex, newContext());
  // The parser alone made this d/dx(x² + 4) = 2x.
  assert.equal(answer("evaluate", "\\frac{d}{dx}\\left(x^{2}\\right)+4").exact, "2 x + 4");
  assert.equal(answer("evaluate", "\\frac{d}{dx}x^{2}+4").exact, "2 x + 4");
  assert.equal(
    answer("evaluate", "\\frac{d}{dx}\\left(x^{2}\\right)+\\frac{d}{dx}\\left(x^{3}\\right)").exact,
    "3 x^{2} + 2 x",
  );
  assert.equal(answer("evaluate", "\\frac{d^{2}}{dx^{2}}\\left(x^{3}\\right)-x").exact, "5 x");
  assert.equal(
    answer("evaluate", "\\frac{\\partial}{\\partial x}\\left(x^{2}y\\right)+1").exact,
    "2 x y + 1",
  );
  // Its term runs to the next + or −: a product, and parentheses, stay inside.
  assert.equal(answer("evaluate", "\\frac{d}{dx}\\left(x^{2}\\right)\\cdot3+1").exact, "6 x + 1");
  assert.equal(answer("evaluate", "\\frac{d}{dx}\\left(x^{2}+4\\right)").exact, "2 x");
  // An integral keeps its dx.
  assert.equal(
    scoped("\\int_0^1\\frac{d}{dx}x^2\\,dx"),
    "\\int_0^1\\left(\\frac{d}{dx}x^2\\right)\\,dx",
  );
  assert.equal(
    answer("evaluate", "\\int_{0}^{1}\\frac{d}{dx}\\left(x^{2}\\right)\\,dx").exact,
    "1",
  );
  // Scoped once, even inside a rewritten \binom.
  assert.equal(scoped("4+\\frac{d}{dx}(x^2)"), "4+\\left(\\frac{d}{dx}(x^2)\\right)");
});

test("E[…] written with \\left[ (as a math field writes it) keeps what's inside", () => {
  // The parser read E\left[X^2\right] as E alone, and the bridge then crashed.
  assert.equal(answer("evaluate", "X\\sim N\\left(0,1\\right);E\\left[X^{2}\\right]").exact, "1");
  assert.equal(
    answer("evaluate", "X\\sim N\\left(0,1\\right);E\\left\\lbrack X^{2}\\right\\rbrack").exact,
    "1",
  );
  assert.equal(
    answer("evaluate", "X\\sim N\\left(0,1\\right);\\mathbb{E}\\left[X^{2}\\right]+1").exact,
    "2",
  );
  assert.equal(
    answer("evaluate", "X\\sim\\operatorname{Exp}\\left(1\\right);E\\left[X\\mid X>1\\right]")
      .exact,
    "2",
  );
  assert.equal(
    answer("evaluate", "X\\sim N\\left(0,1\\right);P\\left[X<1\\right]").exact,
    answer("evaluate", "X\\sim N\\left(0,1\\right);P\\left(X<1\\right)").exact,
  );
  // Nothing inside: a labelled failure, not a crash.
  assert.equal(failure("evaluate", "X\\sim N\\left(0,1\\right);E\\left[\\right]").kind, "syntax");
});
