import assert from "node:assert/strict";
import { test } from "node:test";
import katex from "katex";
import { ComputeEngine } from "@cortex-js/compute-engine";
import {
  compute,
  configureEngine,
  ENGINE_TIME_LIMIT_MS,
  formatComplex,
  formatReal,
} from "../src/services/compute/engine.ts";
import { MAX_INPUT_CHARS, prepareInput } from "../src/services/compute/input.ts";
import { clusterRoots, nearbyFraction, roots } from "../src/services/compute/polynomial.ts";
import type {
  ComputeAnswer,
  ComputeFailure,
  ComputeOperation,
  ComputeResult,
} from "../src/services/compute/protocol.ts";
import { resultLatex, resultMarkdown } from "../src/services/compute/result-markdown.ts";
import { macrosFor } from "../src/services/math/latex.ts";

// The Compute tab's math, against the real engine: input preparation, operation
// routing, exact versus approximate results, complete solving of polynomial
// and rational equations, checked solutions for the rest, domain notes, and
// output every renderer in the app can draw.

const ce = new ComputeEngine();
configureEngine(ce);

function run(op: ComputeOperation, input: string, variable?: string): ComputeResult {
  return compute(ce, { op, input, variable });
}

function answer(op: ComputeOperation, input: string, variable?: string): ComputeAnswer {
  const result = run(op, input, variable);
  assert.equal(result.ok, true, `${op} ${input}: ${JSON.stringify(result)}`);
  return result as ComputeAnswer;
}

function failure(op: ComputeOperation, input: string, variable?: string): ComputeFailure {
  const result = run(op, input, variable);
  assert.equal(result.ok, false, `${op} ${input} should fail: ${JSON.stringify(result)}`);
  return result as ComputeFailure;
}

/** The solutions' exact forms (or decimals), in a stable order. */
function solutions(input: string, variable?: string): string[] {
  const result = answer("solve", input, variable);
  return (result.solutions ?? []).map((s) => s.exact ?? `≈${s.approx}`).sort();
}

// ---- input ----------------------------------------------------------------------

test("plain text is converted to LaTeX; LaTeX passes through", () => {
  const latex = (text: string) => {
    const prepared = prepareInput(text);
    assert.ok(prepared.ok, `${text}: ${JSON.stringify(prepared)}`);
    return prepared.latex;
  };
  assert.equal(latex("sqrt(8)"), "\\sqrt{8}");
  assert.equal(latex("2^(x+1)"), "2^{x+1}");
  assert.equal(latex("2^-3"), "2^{-3}");
  assert.equal(latex("2^3^2"), "2^{3^{2}}");
  assert.equal(latex("x**2 - 5x + 6 = 0"), "x^{2}-5x+6=0");
  assert.equal(latex("sin(pi/6)"), "\\sin\\left(\\pi/6\\right)");
  assert.equal(latex("abs(-3) * 2"), "\\left|-3\\right|\\cdot2");
  assert.equal(latex("√2 + π"), "\\sqrt{2}+\\pi");
  assert.equal(latex("3 × 4 − 1"), "3\\cdot4-1");
  assert.equal(latex(".5x"), "0.5x");
  assert.equal(latex("2 pi x"), "2\\pi x");
  // Math delimiters around the whole input are dropped.
  assert.equal(latex("$$\\frac{1}{2}$$"), "\\frac{1}{2}");
  assert.equal(latex("\\(x^2\\)"), "x^{2}");
  assert.equal(latex("\\frac{1}{2}+\\frac{1}{3}"), "\\frac{1}{2}+\\frac{1}{3}");
});

test("ambiguous or out-of-scope input is refused with a reason, never guessed", () => {
  const refused = (text: string, kind: string, message: RegExp) => {
    const prepared = prepareInput(text);
    assert.equal(prepared.ok, false, text);
    assert.ok(!prepared.ok);
    assert.equal(prepared.kind, kind, text);
    assert.match(prepared.message, message, text);
  };
  // Letters run together would silently be a product a·b·c.
  refused("abc + 1", "unsupported", /“abc” isn't a function/);
  refused("x2", "syntax", /ambiguous/);
  // A bare function name in LaTeX reads as letters.
  refused("\\frac{sin(x)}{2}", "syntax", /bare “sin”/);
  refused("sin x", "syntax", /needs its argument in parentheses/);
  refused("sin^2(x)", "syntax", /after its argument/);
  refused("x < 3", "unsupported", /Inequalities/);
  refused("x \\leq 3", "unsupported", /Inequalities/);
  refused("a = b = c", "unsupported", /One equation at a time/);
  refused("\\begin{pmatrix}1&2\\end{pmatrix}", "unsupported", /matrices/);
  refused("log(8, 2)", "unsupported", /Commas/);
  refused("(1 + 2", "syntax", /isn't closed/);
  refused("1 + 2)", "syntax", /without a matching/);
  refused("2 # 3", "syntax", /“#”/);
  refused("   ", "empty", /Type an expression/);
  refused("1+".repeat(MAX_INPUT_CHARS), "too-complex", /limit is 1,000/);
  refused("(".repeat(40) + "1" + ")".repeat(40), "too-complex", /nested/);
});

// ---- routing --------------------------------------------------------------------

test("each operation says when another one fits the input", () => {
  const equation = failure("evaluate", "x^2 = 4");
  assert.equal(equation.kind, "wrong-operation");
  assert.equal(equation.suggest, "solve");
  const unknown = failure("evaluate", "x + 1");
  assert.equal(unknown.suggest, "simplify");
  assert.match(unknown.message, /\$x\$/);
  assert.equal(failure("approximate", "2y").suggest, "simplify");
  assert.equal(failure("approximate", "y = 2").suggest, "solve");

  const several = failure("solve", "a x + b = 0");
  assert.equal(several.kind, "choose-variable");
  assert.deepEqual(several.variables, ["a", "b", "x"]);
  const absent = failure("solve", "y^2 = 9", "x");
  assert.equal(absent.kind, "choose-variable");
  assert.deepEqual(absent.variables, ["y"]);
});

test("invalid syntax and unsupported operations are labelled, not computed", () => {
  assert.equal(failure("evaluate", "x+").kind, "syntax");
  assert.match(failure("evaluate", "\\frac{1}{").message, /isn't closed/);
  assert.match(failure("evaluate", "\\foo{x}").message, /command/);
  const unsupported = (input: string, label: RegExp) => {
    const result = failure("evaluate", input);
    assert.equal(result.kind, "unsupported", input);
    assert.match(result.message, label, input);
  };
  unsupported("\\int_0^1 x\\,dx", /Integrals/);
  unsupported("\\sum_{n=1}^{10} n", /Sums/);
  unsupported("\\frac{d}{dx} x^2", /Derivatives/);
  unsupported("5 \\mod 3", /Remainders/);
});

test("undefined values and engine timeouts are failures with a reason", () => {
  assert.match(failure("evaluate", "1/0").message, /divides by zero/);
  assert.match(failure("evaluate", "0/0").message, /isn't a number/);
  assert.equal(failure("solve", "x/0 = 1").kind, "undefined");
  // The engine's own deadline, scaled down for the test.
  const quick = new ComputeEngine();
  quick.timeLimit = 50;
  const slow = compute(quick, { op: "evaluate", input: "100000!" });
  assert.ok(ENGINE_TIME_LIMIT_MS >= 1000);
  assert.equal(slow.ok, false);
  assert.equal(!slow.ok && slow.kind, "too-complex");
  assert.match(!slow.ok ? slow.message : "", /Stopped after 0.05 s/);
  assert.equal(failure("solve", "x^41 = 1").kind, "too-complex");
});

// ---- exact versus approximate -----------------------------------------------------

test("exact results stay exact; decimals are approximations, labelled as such", () => {
  const fraction = answer("evaluate", "1/2 + 1/3");
  assert.equal(fraction.exact, "\\frac{5}{6}");
  assert.equal(fraction.approx, "0.833333333333");

  const integer = answer("evaluate", "2^10");
  assert.equal(integer.exact, "1024");
  assert.equal(integer.approx, undefined, "a decimal adds nothing to an integer");

  const surd = answer("evaluate", "sqrt(8)");
  assert.equal(surd.exact, "\\sqrt{8}");
  assert.equal(surd.approx, "2.82842712475");

  assert.equal(answer("evaluate", "\\sin(\\pi/6)").exact, "\\frac{1}{2}");
  assert.equal(answer("evaluate", "\\sqrt[3]{27}").exact, "3");
  assert.equal(answer("evaluate", "\\log_2(8)").exact, "3");
  assert.equal(answer("evaluate", "e^(i pi)").exact, "-1");

  // sin(1) has no closed form: the engine's decimal isn't called exact.
  const transcendental = answer("evaluate", "sin(1)");
  assert.equal(transcendental.exact, "\\sin(1)");
  assert.equal(transcendental.approx, "0.841470984808");

  // Decimals in the input make the result a decimal too.
  const decimal = answer("evaluate", "1/3 + 0.5");
  assert.equal(decimal.exact, undefined);
  assert.equal(decimal.approx, "0.833333333333");
  assert.match(decimal.notes.join(" "), /No exact form/);

  const complex = answer("evaluate", "sqrt(-4)");
  assert.equal(complex.exact, "2i");
  assert.match(complex.notes.join(" "), /no real value/);

  // A large integer is written out, not as digits·10ⁿ.
  const factorial = answer("evaluate", "30!");
  assert.equal(factorial.exact, "265252859812191058636308480000000");
  assert.equal(factorial.approx, "2.65252859812\\times10^{32}");

  const huge = answer("approximate", "1000!");
  assert.equal(huge.approx, "4.02387260077\\times10^{2567}");
  assert.equal(huge.exact, undefined);
});

test("numeric approximation rounds to 12 significant digits, complex included", () => {
  assert.equal(answer("approximate", "pi").approx, "3.14159265359");
  assert.equal(answer("approximate", "sqrt(-2)").approx, "1.41421356237i");
  assert.equal(formatReal(1.23e-9), "1.23\\times10^{-9}");
  assert.equal(formatReal(-0.5), "-0.5");
  assert.equal(formatComplex({ re: 1, im: -1 }), "1-i");
  assert.equal(formatComplex({ re: -1, im: 1.2e-16 }), "-1", "noise beside a real part");
});

// ---- simplify ---------------------------------------------------------------------

test("polynomials simplify, with expanded and verified factored forms", () => {
  const product = answer("simplify", "(x+1)(x-1)");
  assert.equal(product.exact, "x^2-1");
  assert.deepEqual(product.forms, [
    { label: "Factored", latex: "\\left(x-1\\right)\\left(x+1\\right)" },
  ]);

  const square = answer("simplify", "(x+1)^2");
  assert.deepEqual(
    square.forms?.map((f) => [f.label, f.latex]),
    [
      ["Expanded", "x^2+2x+1"],
      ["Factored", "\\left(x+1\\right)^{2}"],
    ],
  );
  assert.equal(
    answer("simplify", "2x^2 - x - 1").forms?.[0].latex,
    "\\left(x-1\\right)\\left(2x+1\\right)",
  );
  // x³ − 1 has irrational factors: no factored form rather than a wrong one.
  assert.equal(answer("simplify", "x^3 - 1").forms, undefined);
});

test("simplifying says where the result and the input agree", () => {
  const cancelled = answer("simplify", "(x^2-1)/(x-1)");
  assert.equal(cancelled.exact, "x+1");
  assert.match(cancelled.notes.join(" "), /Matches the original where \$x-1 \\neq 0\$/);
  assert.match(answer("simplify", "x/x").notes.join(" "), /\$x \\neq 0\$/);
  // ln(x²) → 2 ln x is only true for x > 0.
  const narrowed = answer("simplify", "\\ln(x^2)");
  assert.match(narrowed.notes.join(" "), /assumes \$x > 0\$/);
  // x² ≥ 0 always holds, so it isn't worth a note.
  assert.deepEqual(answer("simplify", "\\sqrt{x^2}").notes, []);
});

// ---- solve ------------------------------------------------------------------------

test("polynomial equations are solved completely, complex and repeated roots included", () => {
  assert.deepEqual(solutions("2x + 3 = 7"), ["2"]);
  assert.deepEqual(solutions("x^2 - 5x + 6 = 0"), ["2", "3"]);
  assert.deepEqual(solutions("x^2 = 2"), ["-\\sqrt{2}", "\\sqrt{2}"]);
  assert.deepEqual(solutions("x^2 + 1 = 0"), ["-i", "i"]);
  assert.deepEqual(solutions("x^2 - 4"), ["-2", "2"], "an expression is solved = 0");

  // No closed form: every root, as decimals, and the list is complete.
  const cubic = answer("solve", "x^3 + x + 1 = 0");
  assert.equal(cubic.complete, true);
  assert.equal(cubic.solutions?.length, 3);
  assert.equal(cubic.solutions?.filter((s) => !s.complex).length, 1);
  assert.equal(cubic.solutions?.[0].approx, "-0.682327803828");
  assert.match(cubic.notes.join(" "), /complex/);

  const repeated = answer("solve", "(x-1)^2 = 0");
  assert.deepEqual(repeated.solutions, [
    { exact: "1", approx: undefined, multiplicity: 2, complex: false },
  ]);
  const quintuple = answer("solve", "(x-2)^5 = 0");
  assert.deepEqual(
    quintuple.solutions?.map((s) => [s.exact, s.multiplicity]),
    [["2", 5]],
  );
});

test("rational equations exclude values where they are undefined", () => {
  const hole = answer("solve", "(x^2-1)/(x-1) = 0");
  assert.deepEqual(
    hole.solutions?.map((s) => s.exact),
    ["-1"],
  );
  assert.match(hole.notes.join(" "), /Left out \$x = 1\$: the equation is undefined there/);

  // The engine's own Together gets this one wrong; the rational form doesn't.
  assert.deepEqual(solutions("1/x + 1/(x-1) = 0"), ["\\frac{1}{2}"]);

  const none = answer("solve", "x/(x-2) = 2/(x-2)");
  assert.deepEqual(none.solutions, []);
  assert.match(none.notes.join(" "), /every candidate makes the equation undefined/);

  assert.match(answer("solve", "x = x + 1").notes.join(" "), /No solution/);
  assert.equal(answer("solve", "1/x = 0").solutions?.length, 0);
  assert.equal(answer("solve", "x = x").exact, "\\text{every } x");
  assert.equal(answer("solve", "2 + 2 = 4").exact, "\\text{True}");
  assert.equal(answer("solve", "2 + 2 = 5").exact, "\\text{False}");
});

test("other equations use the engine's solver, checked and caveated", () => {
  const trig = answer("solve", "sin(x) = 1/2");
  assert.equal(trig.complete, false);
  // The engine answers in decimals; exact multiples of π are recovered and verified.
  assert.deepEqual(
    trig.solutions?.map((s) => s.exact),
    ["\\frac{\\pi}{6}", "\\frac{5\\pi}{6}"],
  );
  assert.match(trig.notes.join(" "), /one period/);
  assert.deepEqual(solutions("\\cos(x) = 0"), ["-\\frac{\\pi}{2}", "\\frac{\\pi}{2}"]);

  assert.deepEqual(solutions("ln(x) = 2"), ["e^{2}"]);
  assert.deepEqual(solutions("sqrt(x+1) = 3"), ["8"]);
  assert.match(answer("solve", "|x| = 3").notes.join(" "), /May be incomplete/);

  // Nothing found is not "no solution".
  const exponential = answer("solve", "2^x = 8");
  assert.deepEqual(exponential.solutions, []);
  assert.equal(exponential.complete, false);
  assert.match(exponential.notes.join(" "), /doesn't prove there are none/);

  // Other unknowns as constants, with the assumption the answer needs.
  const linear = answer("solve", "a x + b = 0", "x");
  assert.deepEqual(
    linear.solutions?.map((s) => s.exact),
    ["-\\frac{b}{a}"],
  );
  assert.match(linear.notes.join(" "), /Treats \$a\$, \$b\$ as constants/);
  assert.match(linear.notes.join(" "), /Assumes \$a \\neq 0\$/);

  assert.deepEqual(solutions("\\theta^2 = 4"), ["-2", "2"]);
  assert.equal(answer("solve", "θ^2 = 4", "θ").variable, "\\theta");
});

// ---- the root finder ----------------------------------------------------------------

test("roots: every root of a polynomial, with multiplicity", () => {
  const values = (coefficients: number[]) =>
    clusterRoots(coefficients, roots(coefficients)).map(({ value, multiplicity }) => [
      Math.round(value.re * 1e9) / 1e9,
      Math.round(value.im * 1e9) / 1e9,
      multiplicity,
    ]);
  assert.deepEqual(
    values([-6, 11, -6, 1]).sort((a, b) => a[0] - b[0]),
    [
      [1, 0, 1],
      [2, 0, 1],
      [3, 0, 1],
    ],
  );
  assert.deepEqual(values([1, -4, 6, -4, 1]), [[1, 0, 4]]);
  assert.deepEqual(values([0, 0, 1]), [[0, 0, 2]]);
  assert.deepEqual(
    values([1, 0, 2, 0, 1]).sort((a, b) => a[1] - b[1]),
    [
      [0, -1, 2],
      [0, 1, 2],
    ],
  );
  // Wilkinson's polynomial of degree 10: roots 1…10.
  let wilkinson = [1];
  for (let r = 1; r <= 10; r++) {
    const next = new Array(wilkinson.length + 1).fill(0);
    wilkinson.forEach((c, i) => {
      next[i + 1] += c;
      next[i] -= r * c;
    });
    wilkinson = next;
  }
  assert.deepEqual(
    values(wilkinson)
      .map(([re]) => Math.round(re))
      .sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.deepEqual(nearbyFraction(-2 / 3), [-2, 3]);
  assert.equal(nearbyFraction(Math.SQRT2), null);
});

// ---- output -------------------------------------------------------------------------

test("every result is LaTeX the app's renderer can draw, and Markdown that carries it", () => {
  const cases: [ComputeOperation, string, string?][] = [
    ["evaluate", "1/2+1/3"],
    ["evaluate", "e^(i pi)"],
    ["evaluate", "sqrt(-4)"],
    ["evaluate", "100!"],
    ["simplify", "(x^2-1)/(x-1)"],
    ["simplify", "(x+1)^2"],
    ["simplify", "\\ln(x^2)"],
    ["approximate", "1000!"],
    ["solve", "x^3 + x + 1 = 0"],
    ["solve", "sin(x) = 1/2"],
    ["solve", "(x-1)^2 = 0"],
    ["solve", "x = x"],
    ["solve", "a x + b = 0", "x"],
    ["solve", "2^x = 8"],
  ];
  const macros = macrosFor("katex");
  for (const [op, input, variable] of cases) {
    const result = answer(op, input, variable);
    const latex = resultLatex(result);
    assert.doesNotThrow(
      () => katex.renderToString(latex, { throwOnError: true, displayMode: true, macros }),
      `${op} ${input}: ${latex}`,
    );
    for (const note of result.notes) {
      for (const [, math] of note.matchAll(/\$([^$]+)\$/g)) {
        assert.doesNotThrow(() => katex.renderToString(math, { throwOnError: true, macros }), math);
      }
    }
    assert.doesNotMatch(latex, /\\imaginaryI|\\exponentialE|\\error/, latex);
  }

  assert.equal(
    resultMarkdown(answer("evaluate", "1/2+1/3")),
    "$$\n1/2+1/3 = \\frac{5}{6} \\approx 0.833333333333\n$$",
  );
  assert.equal(
    resultMarkdown(answer("solve", "x^2 - 5x + 6 = 0")),
    "$$\nx^{2}-5x+6=0 \\quad\\Longrightarrow\\quad x = 3,\\quad x = 2\n$$",
  );
  const simplified = resultMarkdown(answer("simplify", "(x^2-1)/(x-1)"));
  assert.match(simplified, /= x\+1\n\$\$\n\nMatches the original where/);
  assert.match(resultLatex(answer("solve", "(x-1)^2 = 0")), /x = 1 \\ \(\\times 2\)$/);
});
