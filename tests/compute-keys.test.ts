import assert from "node:assert/strict";
import { test } from "node:test";
import { ComputeEngine } from "@cortex-js/compute-engine";
import { parse as parseLatex } from "@cortex-js/compute-engine/latex-syntax";
import { compute, configureEngine } from "../src/services/compute/engine.ts";
import { needsAdvanced } from "../src/services/compute/advanced/routing.ts";
import { newContext, preprocessLatex } from "../src/services/compute/advanced/normalize.ts";
import { prepareInput } from "../src/services/compute/input.ts";
import { asMath } from "../src/components/docs/notes/compute-input.ts";
import { EDIT_KEYS, LAYOUTS, hasEmptyBox } from "../src/components/docs/notes/math-keys.ts";

// The Compute keypad (notes/math-keys.ts) against the engines: every template
// key, its boxes filled in, writes LaTeX the engine it goes to can read. The
// basic engine is run; what routes to the advanced engine (SymPy) is parsed
// as its worker parses it (compute-advanced.test.ts runs
// SymPy itself).

const ce = new ComputeEngine();
configureEngine(ce);

const keys = LAYOUTS.flatMap((layout) => layout.rows.flat());
const MATRIX = "\\begin{pmatrix}1 & 2\\\\ 3 & 4\\end{pmatrix}";
const matrixKeys = new Set(LAYOUTS.find((l) => l.id === "matrices")!.rows.flat());

/** A template with its boxes filled: the selection or box as 2, what came before as 3. */
function filled(latex: string, box = "2", before = "3"): string {
  return latex.replace(/#@/g, before).replace(/#[0?]/g, box);
}

test("every template key writes LaTeX its engine reads", () => {
  const templates = keys.filter((k) => k.action.kind === "insert" && /#[0?@]/.test(k.action.latex));
  assert.ok(templates.length > 40, `${templates.length} templates`);
  for (const key of templates) {
    // gcd and lcm take two numbers or more; the comma sends them to SymPy.
    // A probability is of an event (the variable is defined in a statement before it).
    const box = /common/.test(key.name) ? "4,6" : key.name === "Probability" ? "X<1" : "2";
    // Matrix keys act on a matrix: transpose it, invert it, take its determinant.
    const matrix = matrixKeys.has(key) && !/pmatrix/.test(key.name + key.face);
    const latex = filled(
      (key.action as { latex: string }).latex,
      matrix ? MATRIX : box,
      matrix ? MATRIX : "3",
    );
    if (needsAdvanced(latex)) {
      const json = JSON.stringify(parseLatex(preprocessLatex(latex, newContext())));
      assert.ok(!json.includes('"Error"'), `${key.name}: ${latex} parses as ${json}`);
      continue;
    }
    // A subscript makes a name (x₂), not a number: reading it is enough.
    if (key.name === "Subscript") continue;
    const result = compute(ce, { op: "simplify", input: latex });
    assert.ok(
      result.ok || (result.kind !== "syntax" && result.kind !== "unsupported"),
      `${key.name}: ${latex} → ${JSON.stringify(result)}`,
    );
  }
});

test("keys the basic engine can't do route to the advanced one", () => {
  for (const name of [
    "Derivative",
    "Integral",
    "Limit",
    "Sum",
    "2 by 2 matrix",
    "Binomial coefficient",
    "Expectation",
    "Probability",
  ]) {
    const key = keys.find((k) => k.name === name)!;
    assert.equal(needsAdvanced(filled((key.action as { latex: string }).latex)), true, name);
  }
  assert.equal(needsAdvanced("3\\le 2"), true);
  assert.equal(needsAdvanced("X\\sim N\\left(0,1\\right);P\\left(X<1\\right)"), true);
});

test("every key has a name and a face, and names are unique within a set", () => {
  for (const layout of LAYOUTS) {
    const names = layout.rows.flat().map((k) => k.name);
    assert.equal(new Set(names).size, names.length, `${layout.id}: ${names.join(", ")}`);
    for (const row of layout.rows) {
      const width = row.reduce((sum, k) => sum + (k.span ?? 1), 0);
      assert.ok(width <= layout.columns, `${layout.id}: a row ${width} wide in ${layout.columns}`);
    }
  }
  for (const key of [...keys, ...EDIT_KEYS]) {
    assert.ok(key.name.trim() && key.face.trim(), JSON.stringify(key));
  }
});

test("an empty box is noticed, so it is never computed as nothing", () => {
  // The basic engine reads \placeholder{} as nothing at all: □ + 1 is 1.
  assert.equal(hasEmptyBox("\\frac{1}{\\placeholder{}}"), true);
  assert.equal(hasEmptyBox("\\frac{1}{2}"), false);
});

test("text moves to the math field statement by statement, or stays text", () => {
  // Plain text is read as the engine reads it: sqrt(8) is a root.
  assert.equal(asMath("sqrt(8) + 1/2"), "\\sqrt{8}+1/2");
  assert.equal(asMath("x^2 = 2"), "x^{2}=2");
  // Lines become statements.
  assert.equal(asMath("x^2 = 2\nsqrt(x)"), "x^{2}=2;\\sqrt{x}");
  // Distributions are read by the advanced engine's own statement parser,
  // not converted here: that input stays text.
  assert.equal(asMath("X ~ N(0, 1)\nP(X < 1.96)"), null);
  // LaTeX passes through.
  assert.equal(asMath("\\frac{1}{2}"), "\\frac{1}{2}");
  // What can't be read stays text, rather than reaching the field as letters.
  assert.equal(asMath("sqrt("), null);
});
