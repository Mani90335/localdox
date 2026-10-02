import assert from "node:assert/strict";
import { test } from "node:test";
import katex from "katex";
import { ComputeEngine } from "@cortex-js/compute-engine";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import { compute, configureEngine } from "../src/services/compute/engine.ts";
import { pFactoredLatex, q, rationalRoots, splitSquare } from "../src/services/compute/exact.ts";
import type { ComputeAnswer, ComputeOperation, Step } from "../src/services/compute/protocol.ts";
import { resultMarkdown, stepsMarkdown } from "../src/services/compute/result-markdown.ts";
import { macrosFor } from "../src/services/math/latex.ts";

// Worked steps in the basic engine (solve-steps.ts, arithmetic-steps.ts):
// what each method shows, that steps appear only when they reach the checked
// answer, that every step draws, and that copied steps stay Markdown math.

const ce = new ComputeEngine();
configureEngine(ce);
const macros = macrosFor("katex");

function answer(op: ComputeOperation, input: string, variable?: string): ComputeAnswer {
  const result = compute(ce, { op, input, variable });
  assert.equal(result.ok, true, `${op} ${input}: ${JSON.stringify(result)}`);
  return result as ComputeAnswer;
}

function flatten(steps: Step[] = []): Step[] {
  return steps.flatMap((s) => [s, ...flatten(s.substeps)]);
}

/** Every step's text and math, as one string per step, for matching. */
function lines(result: ComputeAnswer): string[] {
  return flatten(result.steps).map((s) => `${s.text} ${s.latex ?? ""}`.trim());
}

function assertDraws(result: ComputeAnswer) {
  for (const step of flatten(result.steps)) {
    if (step.latex) {
      assert.doesNotThrow(
        () => katex.renderToString(`\\displaystyle ${step.latex}`, { throwOnError: true, macros }),
        `${result.input}: ${step.latex}`,
      );
    }
    for (const [, math] of step.text.matchAll(/\$([^$]+)\$/g)) {
      assert.doesNotThrow(() => katex.renderToString(math, { throwOnError: true, macros }), math);
    }
  }
}

test("linear equations: collect, clear fractions, isolate", () => {
  const result = answer("solve", "3(x-2)+4=2x+7");
  assert.deepEqual(lines(result), [
    "Expand and combine like terms on each side. 3x - 2 = 2x + 7",
    "Subtract $2x$ from both sides. x - 2 = 7",
    "Add $2$ to both sides. x = 9",
  ]);
  const fractions = lines(answer("solve", "\\frac{2x-1}{3} = \\frac{x+2}{4}"));
  assert.ok(
    fractions.includes("Multiply both sides by $12$ to clear the fractions. 8x - 4 = 3x + 6"),
  );
  assert.equal(fractions.at(-1), "Divide both sides by $5$. x = 2");
  // Already solved: nothing to show.
  assert.equal(answer("solve", "x = 5").steps, undefined);
  assert.match(lines(answer("solve", "2x+1=2x+3"))[0], /false statement/);
});

test("quadratics: factoring, the square root, the quadratic formula, complex roots", () => {
  const factored = lines(answer("solve", "x^2-5x+6=0"));
  assert.match(factored[0], /multiply to \$6\$ and add to \$-5\$/);
  assert.match(factored[0], /\\left\(x - 2\\right\)\\left\(x - 3\\right\) = 0/);

  const formula = lines(answer("solve", "x^2-2x-1=0"));
  assert.ok(formula.some((l) => l.includes("Simplify the square root: $\\sqrt{8} = 2\\sqrt{2}$")));
  assert.equal(formula.at(-1), "The solutions: x = 1 + \\sqrt{2},\\quad x = 1 - \\sqrt{2}");

  const complex = lines(answer("solve", "x^2+x+1=0"));
  assert.ok(complex.some((l) => /negative, so the solutions are complex/.test(l)));
  assert.equal(
    complex.at(-1),
    "The solutions: x = \\frac{-1 + \\sqrt{3}\\,i}{2},\\quad x = \\frac{-1 - \\sqrt{3}\\,i}{2}",
  );
  assert.equal(
    lines(answer("solve", "x^3-2x-4=0")).at(-1),
    "The solutions: x = 2,\\quad x = -1 + i,\\quad x = -1 - i",
  );
});

test("isolating the unknown: inverse operations, roots, logarithms, trigonometry", () => {
  assert.deepEqual(lines(answer("solve", "2(x+3)^2-5=13")), [
    "Add $5$ to both sides. 2(x+3)^2 = 18",
    "Divide both sides by $2$. (x+3)^2 = 9",
    "Take the square root of both sides. It can be positive or negative. x+3 = 3 \\quad\\text{or}\\quad x+3 = -3",
    "Subtract $3$ from both sides. x = 0 \\quad\\text{or}\\quad x = -6",
  ]);
  // The engine's own solver finds nothing here; the answer and its steps agree on 3.
  const exponential = answer("solve", "2^x = 8");
  assert.deepEqual(
    exponential.solutions?.map((s) => s.exact),
    ["3"],
  );
  assert.deepEqual(lines(exponential), [
    "Take the logarithm base $2$ of both sides. x = \\log_{2}(8) = 3",
  ]);
  assert.match(lines(answer("solve", "e^{2x-1}=5")).at(-1)!, /x = \\frac\{1\+\\ln\(5\)\}\{2\}/);
  assert.match(
    lines(answer("solve", "\\sin(x)=\\frac{1}{2}"))[0],
    /\\arcsin\\left\(\\frac\{1\}\{2\}\\right\) = \\frac\{\\pi\}\{6\}/,
  );
  // Parameters stay symbols.
  assert.equal(
    lines(answer("solve", "a x+b=c", "x")).at(-1),
    "Divide both sides by $a$. x = \\frac{c-b}{a}",
  );
});

test("extraneous answers are checked and dropped: square roots, denominators", () => {
  const root = answer("solve", "\\sqrt{x}=x-2");
  assert.deepEqual(
    root.solutions?.map((s) => s.exact),
    ["4"],
  );
  const check = flatten(root.steps)
    .filter((s) => /work/.test(s.text))
    .map((s) => s.text);
  assert.ok(
    check.some((t) => t.startsWith("$x = 1$ doesn't work")),
    check.join("\n"),
  );
  assert.ok(check.includes("$x = 4$ works."));

  const rational = lines(answer("solve", "\\frac{x}{x-2}=\\frac{2}{x-2}"));
  assert.match(rational[0], /x \\neq 2/);
  assert.ok(rational.some((l) => /\$x = 2\$ makes a denominator zero/.test(l)));
  assert.equal(rational.at(-1), "So there is no solution.");

  const cancelled = lines(answer("solve", "\\frac{x^2-1}{x-1}=0"));
  assert.match(cancelled[1], /Cancel the common factor \$x - 1\$/);
});

test("steps appear only when they reach the checked answer", () => {
  // No method here for an irreducible cubic or x on both sides of an exponential.
  assert.equal(answer("solve", "x^3+x+1=0").steps, undefined);
  assert.equal(answer("solve", "2^x = x + 3").steps, undefined);
  // An odd root alone would miss the complex roots; the polynomial method finds all three.
  const cube = answer("solve", "x^3 = 8");
  assert.equal(cube.solutions?.length, 3);
  assert.equal(
    lines(cube).at(-1),
    "The solutions: x = 2,\\quad x = -1 + \\sqrt{3}\\,i,\\quad x = -1 - \\sqrt{3}\\,i",
  );
});

test("the answer takes the steps' exact form when it is simpler, or the only one", () => {
  // The engine's own forms here were 1 + √8/2 and a decimal.
  assert.deepEqual(
    answer("solve", "x^2-2x-1=0").solutions?.map((s) => [s.exact, s.approx]),
    [
      ["1 + \\sqrt{2}", "2.41421356237"],
      ["1 - \\sqrt{2}", "-0.414213562373"],
    ],
  );
  assert.deepEqual(
    answer("solve", "\\frac{1}{x}+\\frac{1}{x-1}=1").solutions?.map((s) => s.exact),
    ["\\frac{3 + \\sqrt{5}}{2}", "\\frac{3 - \\sqrt{5}}{2}"],
  );
});

test("arithmetic: the order of operations, with the fraction work beneath", () => {
  assert.deepEqual(lines(answer("evaluate", "10-2\\cdot(3+1)^2")), [
    "Work out the brackets first. 10 - 2 \\times 4^{2}",
    "Work out the powers. 10 - 2 \\times 16",
    "Multiply. 10 - 32",
    "Subtract. -22",
  ]);
  assert.deepEqual(lines(answer("evaluate", "\\frac{1}{2}+\\frac{1}{3}")), [
    "Add. \\frac{5}{6}",
    "Write both over the common denominator $6$. \\frac{1}{2} + \\frac{1}{3} = \\frac{3}{6} + \\frac{2}{6} = \\frac{5}{6}",
  ]);
  assert.deepEqual(lines(answer("evaluate", "-3^2")), [
    "Work out the powers. -\\left(9\\right)",
    "Apply the minus sign. -9",
  ]);
  assert.equal(lines(answer("evaluate", "0.5+0.25\\times 2")).at(-1), "Add. 1");
  // One plain operation, or anything beyond exact arithmetic: no steps.
  for (const input of ["2+3", "\\pi+1", "\\sqrt{2}", "100!"]) {
    assert.equal(answer("evaluate", input).steps, undefined, input);
  }
});

test("every step draws, and copied steps are Markdown math in a list", () => {
  const cases: [ComputeOperation, string, string?][] = [
    ["solve", "3(x-2)+4=2x+7"],
    ["solve", "x^2-2x-1=0"],
    ["solve", "x^2+4=0"],
    ["solve", "x^4-5x^2+4=0"],
    ["solve", "\\frac{1}{x}+\\frac{1}{x-1}=1"],
    ["solve", "\\sqrt{x+5}=x-1"],
    ["solve", "\\cos(x)=0"],
    ["solve", "|x-1|=3"],
    ["solve", "a x+b=c", "x"],
    ["evaluate", "\\frac{3}{4}\\div\\frac{1}{2}"],
    ["evaluate", "2^{-2}"],
  ];
  for (const [op, input, variable] of cases) {
    const result = answer(op, input, variable);
    assert.ok(result.steps?.length, `${op} ${input} has steps`);
    assertDraws(result);
  }

  const result = answer("solve", "\\sqrt{x}=x-2");
  assert.ok(!resultMarkdown(result).includes("**Steps**"), "steps only when asked");
  const markdown = resultMarkdown(result, { steps: true });
  assert.ok(markdown.includes("**Steps**"));
  const tree = unified().use(remarkParse).use(remarkMath).parse(stepsMarkdown(result.steps!));
  // Every step's math is a display block inside its list item, nested steps included.
  const found: string[] = [];
  const visit = (node: { type: string; value?: string; children?: unknown[] }, inList: boolean) => {
    if (node.type === "math") {
      assert.ok(inList, `math outside a list item: ${node.value}`);
      found.push(node.value!);
    }
    for (const child of node.children ?? []) {
      visit(child as typeof node, inList || node.type === "listItem");
    }
  };
  visit(tree as never, false);
  assert.deepEqual(
    found,
    flatten(result.steps).flatMap((s) => (s.latex ? [s.latex] : [])),
  );
});

test("exact helpers: rational roots, square parts, factored forms", () => {
  assert.deepEqual(
    rationalRoots([q(-6), q(11), q(-6), q(1)]).map((r) => r.n),
    [1n, 2n, 3n],
  );
  assert.deepEqual(splitSquare(72n), { outside: 6n, inside: 2n });
  assert.equal(
    pFactoredLatex([q(-2), q(3), q(2)], "x"),
    "\\left(2x - 1\\right)\\left(x + 2\\right)",
  );
  assert.equal(pFactoredLatex([q(1), q(0), q(1)], "x"), "x^{2} + 1");
});
