// The Compute tab's math: one request in, one result out, given a Compute
// Engine instance (@cortex-js/compute-engine). Runs in the worker
// (compute.worker.ts) and, unchanged, in the unit tests.
//
// The engine is capable but not always right, so nothing it says is passed
// on unchecked:
//
// - Input is prepared first (input.ts): plain text is converted, anything
//   ambiguous or out of scope is refused with a reason.
// - Only a known set of operations is accepted (arithmetic, powers, roots,
//   logarithms, trigonometry and small calculus problems); advanced forms
//   are labelled unsupported rather than half-handled.
// - Each operation states what it applies to: Evaluate wants numbers, Solve
//   wants an equation in one unknown. A mismatch suggests the right one.
// - Polynomial and rational equations are solved completely (polynomial.ts);
//   other equations use the engine's solver, and every solution it returns is
//   substituted back and dropped if it doesn't hold.
// - "Exact" means exact: a decimal the engine produced from a transcendental
//   function is shown as an approximation, never as an exact result.

import type { ComputeEngine } from "@cortex-js/compute-engine";
import { prepareInput } from "./input.ts";
import { calculus } from "./calculus.ts";
import {
  clusterRoots,
  degree,
  DegreeTooHigh,
  magnitude,
  mentions,
  nearbyFraction,
  rationalForm,
  roots,
  vanishesAt,
  type Complex,
} from "./polynomial.ts";
import { arithmeticSteps, exactArithmetic } from "./arithmetic-steps.ts";
import { qLatex, qValue } from "./exact.ts";
import { solveSteps, type Toolkit, type Worked } from "./solve-steps.ts";
import type {
  AlternativeForm,
  ComputeFailure,
  ComputeFailureKind,
  ComputeOperation,
  ComputeRequest,
  ComputeResult,
  Solution,
} from "./protocol.ts";

type Engine = ComputeEngine;
type Expr = NonNullable<ReturnType<Engine["parse"]>>;
type Json = unknown;

/** The engine's own deadline. It throws past this; the client's limit backs it up. */
export const ENGINE_TIME_LIMIT_MS = 4000;
/** Expressions larger than this (MathJSON nodes) are refused. */
export const MAX_NODES = 2000;
/** A result longer than this (LaTeX characters) isn't shown exactly. */
export const MAX_RESULT_CHARS = 4000;
/** Significant digits in approximations. */
export const APPROX_DIGITS = 12;

/** Applies the limits. Call once per engine. */
export function configureEngine(ce: Engine): void {
  ce.timeLimit = ENGINE_TIME_LIMIT_MS;
}

const fail = (
  op: ComputeOperation,
  kind: ComputeFailureKind,
  message: string,
  extra: Partial<ComputeFailure> = {},
): ComputeFailure => ({ ok: false, op, kind, message, ...extra });

export function compute(ce: Engine, request: ComputeRequest): ComputeResult {
  const { op } = request;
  const prepared = prepareInput(request.input);
  if (!prepared.ok) return fail(op, prepared.kind, prepared.message, { hint: prepared.hint });
  try {
    const calculusResult = calculus(ce, request, prepared.latex);
    if (calculusResult) return calculusResult;
    const expr = ce.parse(prepared.latex);
    if (!expr.isValid) return syntaxFailure(op, expr.json);
    const json = expr.json;
    if (countNodes(json) > MAX_NODES) {
      return fail(op, "too-complex", "This expression is too large to work with here.");
    }
    // Reading 1/0 already gives "complex infinity" (x/0 loses its x), so a
    // division by zero in the input is caught before any operation runs.
    const undefinedInput = undefinedFailure(op, json);
    if (undefinedInput) return undefinedInput;
    const unsupported = unsupportedPart(json);
    if (unsupported) {
      return fail(op, "unsupported", `${unsupported} aren't supported yet.`, {
        hint: "The Compute tab handles arithmetic, fractions, powers and roots, logarithms, trigonometry, polynomials and equations in one unknown.",
      });
    }
    const context: Context = { ce, op, latex: prepared.latex, expr, json };
    switch (op) {
      case "evaluate":
        return evaluate(context);
      case "simplify":
        return simplify(context);
      case "approximate":
        return approximate(context);
      case "solve":
        return solve(context, request.variable);
    }
  } catch (error) {
    if (error instanceof DegreeTooHigh) return fail(op, "too-complex", error.message);
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout/i.test(message)) {
      return fail(
        op,
        "too-complex",
        `Stopped after ${ce.timeLimit / 1000} s: this is more work than the engine can do here.`,
        { hint: "Try smaller numbers, or a numeric value instead of an exact one." },
      );
    }
    return fail(op, "engine-error", "The engine couldn't work this out.", { hint: message });
  }
}

interface Context {
  ce: Engine;
  op: ComputeOperation;
  /** The prepared input, as LaTeX. */
  latex: string;
  expr: Expr;
  json: Json;
}

// ---- operations ---------------------------------------------------------------

function evaluate({ ce, op, latex, expr, json }: Context): ComputeResult {
  if (isEquation(json)) {
    return fail(
      op,
      "wrong-operation",
      "That's an equation. Evaluate works out an expression's value.",
      {
        suggest: "solve",
      },
    );
  }
  const unknowns = expr.unknowns;
  if (unknowns.length) {
    return fail(
      op,
      "wrong-operation",
      `Evaluate needs numbers only, and this contains ${listSymbols(ce, unknowns)}.`,
      { suggest: "simplify", hint: "Simplify works with unknowns." },
    );
  }
  const value = expr.evaluate();
  const undefinedValue = undefinedFailure(op, value.json);
  if (undefinedValue) return undefinedValue;
  return withArithmeticSteps(ce, latex, value, numericAnswer(ce, op, latex, expr, value));
}

/** Order-of-operations steps for exact arithmetic, when they reach the same value. */
function withArithmeticSteps(
  ce: Engine,
  latex: string,
  value: Expr,
  result: ComputeResult,
): ComputeResult {
  if (!result.ok) return result;
  const work = arithmeticSteps(ce.parse(latex, { form: "raw" }).json);
  const expected = complexValue(value.N());
  if (!work || !expected || expected.im !== 0) return result;
  const got = qValue(work.value);
  if (Math.abs(got - expected.re) > 1e-12 * Math.max(1, Math.abs(expected.re))) return result;
  return { ...result, steps: work.steps };
}

function simplify({ ce, op, latex, expr, json }: Context): ComputeResult {
  const result = expr.simplify();
  const undefinedValue = undefinedFailure(op, result.json);
  if (undefinedValue) return undefinedValue;
  const notes = domainChange(ce, ce.parse(latex, { form: "raw" }), result);
  const unknowns = expr.unknowns;
  if (!unknowns.length && !isEquation(json)) {
    const answer = numericAnswer(ce, op, latex, expr, result);
    if (answer.ok) answer.notes.push(...notes);
    return answer;
  }

  const exact = shown(ce, result, notes);
  const forms: AlternativeForm[] = [];
  if (unknowns.length === 1 && !isEquation(json)) {
    forms.push(...polynomialForms(ce, expr, unknowns[0], exact));
  }
  if (result.isSame(expr) && !forms.length) {
    notes.push("Already as simple as the engine can make it.");
  }
  return { ok: true, op, input: latex, exact, forms: forms.length ? forms : undefined, notes };
}

/**
 * Simplifying can change where an expression is defined. Cancelling a factor
 * widens it: (x²−1)/(x−1) and x+1 differ at x = 1. Some rewrites narrow it:
 * ln(x²) → 2 ln x holds only for x > 0. Says which, comparing the input as
 * written (`raw`, before even x/x → 1) with the result.
 */
function domainChange(ce: Engine, raw: Expr, result: Expr): string[] {
  const unknowns = raw.unknowns;
  if (!unknowns.length) return [];
  const before = domainConditions(ce, raw.json, unknowns);
  const after = domainConditions(ce, result.json, unknowns);
  const gained = after.filter((c) => !before.some((b) => b.key === c.key));
  const lost = before.filter((c) => !after.some((a) => a.key === c.key));
  if (gained.length) {
    return [`The result assumes ${conditionList(gained)}, so it matches the original only there.`];
  }
  if (lost.length) {
    return [
      `Matches the original where ${conditionList(lost)}; the original isn't defined elsewhere.`,
    ];
  }
  return [];
}

function approximate({ ce, op, latex, expr, json }: Context): ComputeResult {
  if (isEquation(json)) {
    return fail(
      op,
      "wrong-operation",
      "That's an equation. Solve finds its solutions as numbers.",
      {
        suggest: "solve",
      },
    );
  }
  const unknowns = expr.unknowns;
  if (unknowns.length) {
    return fail(
      op,
      "wrong-operation",
      `A numeric value needs numbers only, and this contains ${listSymbols(ce, unknowns)}.`,
      { suggest: "simplify" },
    );
  }
  const value = expr.N();
  const undefinedValue = undefinedFailure(op, value.json);
  if (undefinedValue) return undefinedValue;
  const approx = approximation(value);
  if (!approx) return fail(op, "unsupported", "This doesn't have a numeric value.");
  const notes = [`Rounded to ${APPROX_DIGITS} significant digits.`];
  if (approx.complex) notes.push("Complex: there is no real value.");
  return { ok: true, op, input: latex, approx: approx.latex, notes };
}

/**
 * The answer for a value with no unknowns: an exact form when there is one,
 * and a decimal when it adds something.
 */
function numericAnswer(
  ce: Engine,
  op: ComputeOperation,
  latex: string,
  expr: Expr,
  value: Expr,
): ComputeResult {
  const notes: string[] = [];
  let exactExpr: Expr | undefined = value;
  if (!isExactValue(value)) {
    // A decimal from sin(1) or ln 2 isn't exact; the unevaluated form is.
    const symbolic = expr.simplify();
    exactExpr = isExactValue(symbolic) || !isNumberLiteral(symbolic) ? symbolic : undefined;
    if (exactExpr && hasDecimal(exactExpr.json)) exactExpr = undefined;
    if (!exactExpr) notes.push("No exact form: the input has decimals, or the engine has none.");
  }
  // The engine works a large power to about 20 significant digits and still
  // calls it exact: 2^100 would end in zeros. Exact arithmetic doesn't round.
  const raw = ce.parse(latex, { form: "raw" }).json;
  const arithmetic = exactArithmetic(raw, MAX_RESULT_CHARS);
  let exact = arithmetic ? qLatex(arithmetic) : exactExpr ? shown(ce, exactExpr, notes) : undefined;
  if (!arithmetic && exact && exactExpr && mentionsHead(raw, "Power")) {
    // Past exact arithmetic's reach, digits·10^n from a power may be rounded.
    if (/\\cdot10\^\{/.test(latexOf(exactExpr))) {
      exact = undefined;
      notes.push("The exact result is too long to work out here; the decimal is rounded.");
    }
  }
  const approx = approximation(isNumberLiteral(value) ? value : expr.N());
  if (approx?.complex) notes.push("Complex: there is no real value.");
  return {
    ok: true,
    op,
    input: latex,
    exact,
    approx: approx && approx.latex !== exact ? approx.latex : undefined,
    notes,
  };
}

// ---- solve ------------------------------------------------------------------------

/** Sample values for other symbols, when checking a solution that contains them. */
const PARAMETER_SAMPLES = [1.37, 2.11, 0.73, 3.29, 1.91, 2.63];

function solve({ ce, op, latex, expr, json }: Context, requested?: string): ComputeResult {
  const notes: string[] = [];
  let lhs: Json;
  let rhs: Json;
  if (isEquation(json)) {
    [, lhs, rhs] = json as [string, Json, Json];
  } else {
    lhs = json;
    rhs = 0;
    notes.push(`Solved $${latex} = 0$.`);
  }
  const unknowns = [...expr.unknowns].sort();
  const wanted = normalizeVariable(requested);
  let variable: string;
  if (wanted) {
    if (!unknowns.includes(wanted)) {
      return fail(
        op,
        "choose-variable",
        unknowns.length
          ? `${listSymbols(ce, [wanted])} isn't in this equation.`
          : "There's no unknown to solve for.",
        { variables: unknowns },
      );
    }
    variable = wanted;
  } else if (unknowns.length === 1) {
    variable = unknowns[0];
  } else if (unknowns.length === 0) {
    const difference = ce.box(["Subtract", lhs, rhs] as never).evaluate();
    const holds = difference.isSame(0);
    return {
      ok: true,
      op,
      input: latex,
      exact: holds ? "\\text{True}" : "\\text{False}",
      notes: [
        holds
          ? "There's no unknown: both sides are equal."
          : "There's no unknown, and the two sides aren't equal.",
      ],
    };
  } else {
    return fail(
      op,
      "choose-variable",
      "This has more than one unknown. Which one should be solved for?",
      {
        variables: unknowns,
      },
    );
  }

  const f = ce.box(["Subtract", lhs, rhs] as never);
  const parameters = unknowns.filter((name) => name !== variable);
  const symbol = symbolLatex(ce, variable);
  if (!parameters.length) {
    let form;
    try {
      form = rationalForm(f.json, variable, (part) => realValue(ce, part));
    } catch (error) {
      if (error instanceof RangeError) {
        return fail(op, "undefined", "Undefined: the equation divides by zero.");
      }
      throw error;
    }
    if (form) {
      const worked = solveSteps(toolkit(ce, variable, {}), lhs, rhs);
      return solveRational(ce, op, latex, f, variable, form, notes, worked);
    }
  }

  // The engine's own solver, for everything else. Its answers are checked.
  const equation = isEquation(json) ? expr : ce.box(["Equal", lhs, 0] as never);
  const found = equation.solve(variable);
  if (found !== null && !Array.isArray(found)) {
    return fail(op, "unsupported", "Systems of equations aren't supported yet.");
  }
  const samples = Object.fromEntries(parameters.map((name, i) => [name, PARAMETER_SAMPLES[i % 6]]));
  const solutions: Solution[] = [];
  const seen: Complex[] = [];
  const candidates = [...((found ?? []) as unknown as Expr[])];
  // Isolating the unknown solves some equations the engine's solver doesn't
  // (2^x = 8); its answers are checked below like the engine's own.
  const worked = solveSteps(toolkit(ce, variable, samples), lhs, rhs);
  for (const method of worked) {
    for (const s of method.solutions)
      if (s.json !== undefined) candidates.push(ce.box(s.json as never));
  }
  for (const solution of candidates) {
    const value = complexValue(solution.subs(samples).N());
    const shownAs = `$${symbol} = ${portableLatex(latexOf(solution))}$`;
    if (!value || !Number.isFinite(value.re) || !Number.isFinite(value.im)) {
      notes.push(`Left out ${shownAs}: it isn't a finite number.`);
      continue;
    }
    if (!satisfies(ce, lhs, rhs, { ...samples, [variable]: solution.subs(samples) })) {
      notes.push(`Left out ${shownAs}: it doesn't satisfy the equation.`);
      continue;
    }
    if (
      seen.some((other) => magnitude({ re: other.re - value.re, im: other.im - value.im }) < 1e-9)
    ) {
      continue;
    }
    seen.push(value);
    const exact = hasDecimal(solution.json)
      ? parameters.length
        ? undefined
        : exactRealLatex(ce, f, variable, value)
      : portableLatex(latexOf(solution));
    const approx = parameters.length ? undefined : formatComplex(value);
    solutions.push({
      exact,
      approx: approx && approx !== exact ? approx : undefined,
      multiplicity: 1,
      complex: !parameters.length && value.im !== 0,
    });
  }
  if (parameters.length) {
    notes.push(`Treats ${listSymbols(ce, parameters)} as constants.`);
    const assumptions = new Map<string, Condition>();
    for (const solution of (found ?? []) as unknown as Expr[]) {
      for (const condition of domainConditions(ce, solution.json, parameters)) {
        assumptions.set(condition.key, condition);
      }
    }
    if (assumptions.size) notes.push(`Assumes ${conditionList([...assumptions.values()])}.`);
  }
  const method = chooseMethod(worked, seen, false);
  if (!parameters.length) {
    adoptExactForms(solutions, new Map(solutions.map((s, i) => [s, seen[i]])), method);
  }
  if (TRIG.some((name) => mentionsHead(json, name))) {
    notes.push(
      "Trigonometric: only solutions within one period are listed. Add whole multiples of the period ($2\\pi$ for sine and cosine, $\\pi$ for tangent) for the rest.",
    );
  }
  notes.push(
    solutions.length
      ? "May be incomplete: the engine doesn't always find every solution of an equation like this."
      : "No solutions found. That doesn't prove there are none: the engine solves polynomial and rational equations completely, and only some others.",
  );
  if (solutions.some((s) => s.exact === undefined)) {
    notes.push("Shown as decimals where the engine gave no exact form.");
  }
  return {
    ok: true,
    op,
    input: latex,
    variable: symbol,
    solutions,
    complete: false,
    notes,
    steps: method?.steps,
  };
}

/** A polynomial or rational equation: every root of the numerator, checked. */
function solveRational(
  ce: Engine,
  op: ComputeOperation,
  latex: string,
  f: Expr,
  variable: string,
  form: { num: number[]; den: number[] },
  notes: string[],
  worked: Worked[],
): ComputeResult {
  const symbol = symbolLatex(ce, variable);
  const poles = degree(form.den) > 0 ? clusterRoots(form.den, roots(form.den)) : [];
  const describe = (z: Complex) => exactRealLatex(ce, f, variable, z) ?? formatComplex(z);
  const excluded = (z: Complex) => poles.length > 0 && vanishesAt(form.den, z, 1e-9);

  if (degree(form.num) < 0) {
    // 0 = 0 after clearing denominators: every value works, except the poles.
    const except = poles.map((pole) => `${symbol} \\neq ${describe(pole.value)}`);
    return {
      ok: true,
      op,
      input: latex,
      variable: symbol,
      exact: `\\text{every } ${symbol}${except.length ? `,\\ ${except.join(",\\ ")}` : ""}`,
      solutions: [],
      complete: true,
      notes: [...notes, "Both sides are equal for every value where they are defined."],
      steps: chooseSteps(worked, [], true),
    };
  }
  if (degree(form.num) === 0) {
    return {
      ok: true,
      op,
      input: latex,
      variable: symbol,
      solutions: [],
      complete: true,
      notes: [...notes, "No solution: the equation reduces to a false statement."],
      steps: chooseSteps(worked, [], false),
    };
  }

  const engineSolutions = engineExactSolutions(ce, f, variable);
  const solutions: Solution[] = [];
  const kept: Complex[] = [];
  const values = new Map<Solution, Complex>();
  for (const { value, multiplicity } of clusterRoots(form.num, roots(form.num))) {
    if (excluded(value)) {
      notes.push(`Left out $${symbol} = ${describe(value)}$: the equation is undefined there.`);
      continue;
    }
    kept.push(value);
    const exact =
      exactRealLatex(ce, f, variable, value) ??
      engineSolutions.find((candidate) => close(candidate.value, value))?.latex;
    const approx = formatComplex(value);
    const solution = {
      exact,
      approx: approx !== exact ? approx : undefined,
      multiplicity,
      complex: value.im !== 0,
    };
    values.set(solution, value);
    solutions.push(solution);
  }
  const method = chooseMethod(worked, kept, false);
  adoptExactForms(solutions, values, method);
  solutions.sort((a, b) => Number(a.complex) - Number(b.complex));
  const real = solutions.filter((s) => !s.complex).length;
  if (solutions.length && real === 0) notes.push("No real solutions; the complex ones are listed.");
  else if (real < solutions.length) notes.push("Includes complex solutions.");
  if (!solutions.length) notes.push("No solution: every candidate makes the equation undefined.");
  if (solutions.some((s) => s.exact === undefined)) {
    notes.push("Shown as decimals where no exact form was found.");
  }
  return {
    ok: true,
    op,
    input: latex,
    variable: symbol,
    solutions,
    complete: true,
    notes,
    steps: method?.steps,
  };
}

/**
 * The first worked method that arrives at exactly the solutions found (the
 * same set, compared numerically), or none: steps that disagree with the
 * checked answer would teach something wrong.
 */
function chooseMethod(worked: Worked[], values: Complex[], identity: boolean) {
  const agrees = (method: Worked) =>
    Boolean(method.identity) === identity &&
    method.solutions.every((s) => values.some((v) => close(s.value, v))) &&
    values.every((v) => method.solutions.some((s) => close(s.value, v)));
  return worked.find(agrees);
}

function chooseSteps(worked: Worked[], values: Complex[], identity: boolean) {
  return chooseMethod(worked, values, identity)?.steps;
}

/**
 * The steps' exact form for a solution when the answer has none (a decimal
 * root of a quadratic) or a longer one (1 + √8/2 for 1 + √2). Both name the
 * same number: the steps were chosen because their values match.
 */
function adoptExactForms(
  solutions: Solution[],
  values: Map<Solution, Complex>,
  method: Worked | undefined,
) {
  if (!method) return;
  for (const solution of solutions) {
    const value = values.get(solution);
    const found = value && method.solutions.find((s) => close(s.value, value));
    if (!found || (solution.exact && solution.exact.length <= found.latex.length)) continue;
    solution.exact = found.latex;
    const approx = formatComplex(value);
    solution.approx = approx !== found.latex ? approx : undefined;
  }
}

/** What the worked steps need from the engine (solve-steps.ts). */
function toolkit(ce: Engine, variable: string, samples: Record<string, number>): Toolkit {
  const box = (json: Json) => ce.box(json as never);
  const simplify = (json: Json): Json => {
    const expr = box(json);
    const simpler = expr.simplify();
    // ln 5 "simplifies" to 1.609…: keep the exact form.
    return hasDecimal(simpler.json) && !hasDecimal(expr.json) ? expr.json : simpler.json;
  };
  const value = (json: Json) => complexValue(box(json).subs(samples).N());
  return {
    variable,
    symbol: symbolLatex(ce, variable),
    latex: (json) => portableLatex(latexOf(box(json))),
    simplify,
    value,
    angle(fn, target) {
      const v = value(target);
      if (!v || v.im !== 0) return null;
      const principal = { Sin: Math.asin, Cos: Math.acos, Tan: Math.atan }[fn](v.re);
      const fraction = nearbyFraction(principal / Math.PI, 24);
      if (!fraction) return null;
      const [p, q] = fraction;
      const candidate: Json =
        p === 0
          ? 0
          : q === 1
            ? p === 1
              ? "Pi"
              : ["Multiply", p, "Pi"]
            : ["Multiply", ["Rational", p, q], "Pi"];
      try {
        return box([fn, candidate]).evaluate().isSame(box(target).evaluate()) ? candidate : null;
      } catch {
        return null;
      }
    },
    substitute: (json, at) => simplify(box(json).subs({ [variable]: box(at) }).json),
    holds: (lhs, rhs, at) =>
      satisfies(ce, lhs, rhs, { ...samples, [variable]: box(at).subs(samples) }),
  };
}

/** The engine's exact solutions, with values, to put names to numeric roots. */
function engineExactSolutions(ce: Engine, f: Expr, variable: string) {
  try {
    const found = ce.box(["Equal", f.json, 0] as never).solve(variable);
    if (!Array.isArray(found)) return [];
    return (found as unknown as Expr[])
      .filter((solution) => !hasDecimal(solution.json))
      .map((solution) => ({
        latex: portableLatex(latexOf(solution)),
        value: complexValue(solution.N()),
      }))
      .filter((entry): entry is { latex: string; value: Complex } => entry.value !== null);
  } catch {
    // Exact names are a bonus; the numeric roots stand without them.
    return [];
  }
}

/**
 * A real root's exact form, when one is within reach and, substituted into
 * the equation, gives exactly zero in the engine's exact arithmetic: a
 * fraction, or (for trigonometric equations) a fraction of π.
 */
function exactRealLatex(ce: Engine, f: Expr, variable: string, z: Complex): string | undefined {
  if (z.im !== 0) return undefined;
  const candidates: Json[] = [];
  const fraction = nearbyFraction(z.re, 10_000);
  if (fraction) candidates.push(fraction[1] === 1 ? fraction[0] : ["Rational", ...fraction]);
  if (TRIG.some((name) => mentionsHead(f.json, name))) {
    const ofPi = nearbyFraction(z.re / Math.PI, 24);
    if (ofPi && ofPi[0] !== 0) candidates.push(["Multiply", ["Rational", ...ofPi], "Pi"]);
  }
  for (const json of candidates) {
    const candidate = ce.box(json as never);
    try {
      if (
        f
          .subs({ [variable]: candidate })
          .evaluate()
          .isSame(0)
      ) {
        return portableLatex(latexOf(candidate));
      }
    } catch {
      // Not verifiable: try the next candidate, or no exact form.
    }
  }
  return undefined;
}

function close(a: Complex, b: Complex): boolean {
  return magnitude({ re: a.re - b.re, im: a.im - b.im }) <= 1e-6 * Math.max(1, magnitude(b));
}

/** Whether lhs = rhs holds, numerically, with `values` substituted. */
function satisfies(ce: Engine, lhs: Json, rhs: Json, values: Record<string, unknown>): boolean {
  const left = complexValue(
    ce
      .box(lhs as never)
      .subs(values as never)
      .N(),
  );
  const right = complexValue(
    ce
      .box(rhs as never)
      .subs(values as never)
      .N(),
  );
  if (!left || !right) return false;
  const gap = magnitude({ re: left.re - right.re, im: left.im - right.im });
  if (!Number.isFinite(gap)) return false;
  return gap <= 1e-8 * Math.max(1, magnitude(left), magnitude(right));
}

// ---- simplify: alternative forms ----------------------------------------------------

/**
 * For a polynomial in one unknown: its expanded form and, when every root is
 * rational and verified, its factored form. Each must differ from the main
 * result and agree with the input at sample points before it is shown.
 */
function polynomialForms(ce: Engine, expr: Expr, variable: string, main: string | undefined) {
  const forms: AlternativeForm[] = [];
  let form;
  try {
    form = rationalForm(expr.json, variable, (part) => realValue(ce, part));
  } catch {
    return forms;
  }
  if (!form || degree(form.den) !== 0 || degree(form.num) < 2) return forms;
  const add = (label: string, latex: string | undefined) => {
    if (!latex || latex === main || forms.some((f) => f.latex === latex)) return;
    if (!sameFunction(ce, expr, ce.parse(latex), variable)) return;
    forms.push({ label, latex });
  };
  add("Expanded", portableLatex(latexOf(ce.box(["Expand", expr.json] as never).evaluate())));
  add(
    "Factored",
    factoredLatex(
      ce,
      expr,
      variable,
      form.num.map((c) => c / form!.den[0]),
    ),
  );
  return forms;
}

/** a·(x − r₁)^m₁·… with integer factors (2x − 1 rather than x − ½), or undefined. */
function factoredLatex(ce: Engine, expr: Expr, variable: string, poly: number[]) {
  const symbol = symbolLatex(ce, variable);
  const found = clusterRoots(poly, roots(poly));
  let lead = poly[poly.length - 1];
  const factors: string[] = [];
  for (const { value, multiplicity } of found) {
    if (value.im !== 0) return undefined;
    const fraction = nearbyFraction(value.re, 1000);
    if (!fraction) return undefined;
    const [p, q] = fraction;
    // The factor (q·x − p); the leading coefficient gives back q per power.
    lead /= q ** multiplicity;
    const linear =
      p === 0 ? symbol : `${q === 1 ? "" : q}${symbol}${p > 0 ? "-" : "+"}${Math.abs(p)}`;
    const wrapped = p === 0 ? linear : `\\left(${linear}\\right)`;
    factors.push(multiplicity > 1 ? `${wrapped}^{${multiplicity}}` : wrapped);
  }
  if (factors.length < 1) return undefined;
  const leadFraction = nearbyFraction(lead, 1000);
  if (!leadFraction) return undefined;
  const [lp, lq] = leadFraction;
  const coefficient =
    lq === 1
      ? lp === 1
        ? ""
        : lp === -1
          ? "-"
          : String(lp)
      : `${lp < 0 ? "-" : ""}\\frac{${Math.abs(lp)}}{${lq}}`;
  const latex = `${coefficient}${factors.join("")}`;
  // Exact check: the factored form minus the input is identically zero.
  try {
    const gap = ce
      .box(["Expand", ["Subtract", ce.parse(latex).json, expr.json]] as never)
      .evaluate();
    if (!gap.isSame(0)) return undefined;
  } catch {
    return undefined;
  }
  return latex;
}

/** Whether two expressions agree at a few sample values of `variable`. */
function sameFunction(ce: Engine, a: Expr, b: Expr, variable: string): boolean {
  for (const t of [0.37, 1.73, -2.11]) {
    const x = complexValue(a.subs({ [variable]: t }).N());
    const y = complexValue(b.subs({ [variable]: t }).N());
    if (!x || !y) return false;
    if (magnitude({ re: x.re - y.re, im: x.im - y.im }) > 1e-9 * Math.max(1, magnitude(x))) {
      return false;
    }
  }
  return true;
}

// ---- domain -------------------------------------------------------------------------

/** "x − 1 ≠ 0": a condition for an expression to be defined. */
export interface Condition {
  /** For comparing conditions written differently (canonical form + relation). */
  key: string;
  latex: string;
}

const RELATIONS = { ne: "\\neq", gt: ">", ge: "\\geq" } as const;

/** Values tried when deciding whether a condition can fail at all. */
const DOMAIN_SAMPLES = [-3.7, -1.3, -0.4, 0, 0.6, 1.9, 4.2];

/**
 * Where an expression is defined, as conditions on its unknowns: denominators
 * ≠ 0, logarithm arguments > 0, even-root arguments ≥ 0 (for a real result).
 * A > or ≥ condition that holds at every sample of a single unknown (x² ≥ 0)
 * says nothing and is dropped.
 */
export function domainConditions(ce: Engine, json: Json, unknowns: readonly string[]): Condition[] {
  const found = new Map<string, Condition>();
  const involves = (node: Json) => unknowns.some((name) => mentions(node, name));
  const add = (node: Json, relation: keyof typeof RELATIONS) => {
    const canonical = ce.box(node as never);
    if (
      relation !== "ne" &&
      unknowns.length === 1 &&
      alwaysHolds(canonical, unknowns[0], relation)
    ) {
      return;
    }
    const key = `${canonical.latex}|${relation}`;
    const shown = portableLatex(canonical.latex);
    if (!found.has(key)) found.set(key, { key, latex: `${shown} ${RELATIONS[relation]} 0` });
  };
  const visit = (node: Json) => {
    if (!Array.isArray(node)) return;
    const [head, ...args] = node as [string, ...Json[]];
    if (head === "Divide" && involves(args[1])) add(args[1], "ne");
    if (head === "Power" && involves(args[0]) && isNegative(args[1])) add(args[0], "ne");
    if ((head === "Ln" || head === "Log" || head === "Lb" || head === "Lg") && involves(args[0])) {
      add(args[0], "gt");
    }
    if (head === "Sqrt" && involves(args[0])) add(args[0], "ge");
    if (head === "Root" && involves(args[0]) && typeof args[1] === "number" && args[1] % 2 === 0) {
      add(args[0], "ge");
    }
    args.forEach(visit);
  };
  visit(json);
  return [...found.values()];
}

function alwaysHolds(expr: Expr, variable: string, relation: "gt" | "ge"): boolean {
  return DOMAIN_SAMPLES.every((t) => {
    const value = complexValue(expr.subs({ [variable]: t }).N());
    if (!value || value.im !== 0) return false;
    return relation === "gt" ? value.re > 0 : value.re >= 0;
  });
}

function conditionList(conditions: Condition[]): string {
  return conditions.map((c) => `$${c.latex}$`).join(" and ");
}

function isNegative(json: Json): boolean {
  if (typeof json === "number") return json < 0;
  return (
    Array.isArray(json) && (json[0] === "Negate" || (json[0] === "Rational" && Number(json[1]) < 0))
  );
}

// ---- what's supported -------------------------------------------------------------

const TRIG = ["Sin", "Cos", "Tan", "Sec", "Csc", "Cot"];

const SUPPORTED = new Set([
  "Add",
  "Subtract",
  "Negate",
  "Multiply",
  "Divide",
  "Power",
  "Square",
  "Sqrt",
  "Root",
  "Rational",
  "Complex",
  "Abs",
  "Factorial",
  "Exp",
  "Ln",
  "Log",
  "Lb",
  "Lg",
  ...TRIG,
  "Arcsin",
  "Arccos",
  "Arctan",
  "Sinh",
  "Cosh",
  "Tanh",
  "Floor",
  "Ceil",
  "Equal",
  "Delimiter",
]);

const UNSUPPORTED_NAMES: Readonly<Record<string, string>> = {
  Integrate: "Integrals",
  Sum: "Sums (Σ)",
  Product: "Products (∏)",
  D: "Derivatives",
  Derivative: "Derivatives",
  Limit: "Limits",
  Matrix: "Matrices",
  List: "Lists and vectors",
  Tuple: "Lists of several expressions",
  Sequence: "Several expressions at once",
  Less: "Inequalities",
  Greater: "Inequalities",
  LessEqual: "Inequalities",
  GreaterEqual: "Inequalities",
  NotEqual: "Inequalities",
  Set: "Sets",
  And: "Logical operators",
  Or: "Logical operators",
  Not: "Logical operators",
  Mod: "Remainders (mod)",
  GCD: "Greatest common divisors",
  LCM: "Least common multiples",
  Max: "max and min",
  Min: "max and min",
};

/** The first operation outside the supported set, named for the reader. */
function unsupportedPart(json: Json, top = true): string | null {
  if (!Array.isArray(json)) return null;
  const [head, ...args] = json as [Json, ...Json[]];
  if (typeof head !== "string") return "Functions applied to expressions";
  if (head === "Equal" && !top) return "Equations inside expressions";
  if (!SUPPORTED.has(head)) return UNSUPPORTED_NAMES[head] ?? `Operations like “${head}”`;
  for (const arg of args) {
    const found = unsupportedPart(arg, false);
    if (found) return found;
  }
  return null;
}

// ---- reading engine output ----------------------------------------------------------

function syntaxFailure(op: ComputeOperation, json: Json): ComputeFailure {
  const error = firstError(json);
  const code = error?.code ?? "";
  const near = error?.near ? ` near “${error.near}”` : "";
  const messages: Record<string, string> = {
    "unexpected-operator": `Something is missing${near}.`,
    "expected-closing-delimiter": "A bracket or brace isn't closed.",
    "expected-open-delimiter": "A closing bracket has no opening one.",
    "unbalanced-environment": "An environment isn't closed.",
    missing: "Something is missing, for example after “^” or “_”.",
    "unexpected-command": `The engine doesn't know the command${near}.`,
    "unexpected-token": `Unexpected input${near}.`,
    "expected-expression": `An expression is missing${near}.`,
  };
  return fail(op, "syntax", messages[code] ?? `The engine couldn't read this${near}.`, {
    hint: "Check the input, or open the math keyboard to build it.",
  });
}

function firstError(json: Json): { code: string; near?: string } | null {
  if (!Array.isArray(json)) return null;
  if (json[0] === "Error") {
    const strip = (value: unknown) =>
      typeof value === "string" ? value.replace(/^'|'$/g, "") : "";
    const code = strip(json[1]);
    const near = Array.isArray(json[2]) && json[2][0] === "LatexString" ? strip(json[2][1]) : "";
    return { code, near: near || undefined };
  }
  for (const part of json.slice(1)) {
    const found = firstError(part);
    if (found) return found;
  }
  return null;
}

function undefinedFailure(op: ComputeOperation, json: Json): ComputeFailure | null {
  if (mentionsSymbol(json, "ComplexInfinity")) {
    return fail(op, "undefined", "Undefined: it divides by zero.");
  }
  if (mentionsSymbol(json, "NaN")) {
    return fail(op, "undefined", "Undefined: the result isn't a number (like 0/0).");
  }
  return null;
}

function mentionsSymbol(json: Json, symbol: string): boolean {
  if (json === symbol) return true;
  return Array.isArray(json) && json.some((part) => mentionsSymbol(part, symbol));
}

function mentionsHead(json: Json, head: string): boolean {
  return Array.isArray(json) && (json[0] === head || json.some((part) => mentionsHead(part, head)));
}

function isEquation(json: Json): boolean {
  return Array.isArray(json) && json[0] === "Equal";
}

function countNodes(json: Json): number {
  return Array.isArray(json) ? json.reduce<number>((n, part) => n + countNodes(part), 0) + 1 : 1;
}

/** Whether a number literal carries a decimal (inexact) value. */
function hasDecimal(json: Json): boolean {
  if (typeof json === "number") return !Number.isInteger(json);
  if (json && typeof json === "object" && "num" in json) {
    return /[.eE]/.test(String((json as { num: string }).num).replace(/e\+?\d+$/, ""));
  }
  return Array.isArray(json) && json.some(hasDecimal);
}

/** An exact number: an integer, a fraction, or a surd; not a computed decimal. */
function isExactValue(value: Expr): boolean {
  if (!isNumberLiteral(value)) return !hasDecimal(value.json);
  const exactness = (value as unknown as { isExact?: boolean }).isExact;
  if (exactness === false) return false;
  return exactness === true || value.isRational === true;
}

/** The LaTeX to show for an exact result, or undefined (with a note) when it's too long. */
function shown(ce: Engine, value: Expr, notes: string[]): string | undefined {
  // The engine writes a large integer as digits·10^n (100! = 9332…864·10^{24}).
  const latex = portableLatex(latexOf(value)).replace(
    /^(-?\d+)\\cdot10\^\{(\d+)\}$/,
    (whole, digits: string, zeros: string) =>
      Number(zeros) <= MAX_RESULT_CHARS ? digits + "0".repeat(Number(zeros)) : whole,
  );
  if (latex.length <= MAX_RESULT_CHARS) return latex;
  notes.push(
    `The exact result is too long to show (${latex.length.toLocaleString("en-US")} characters).`,
  );
  return undefined;
}

function latexOf(value: Expr): string {
  return value.toLatex({ digitGroupSeparator: "" });
}

/**
 * The engine writes a few commands of its own (\imaginaryI, \exponentialE…).
 * Results are inserted into documents and drawn by KaTeX, MathJax or Temml,
 * so they are rewritten as standard LaTeX.
 */
export function portableLatex(latex: string): string {
  return (
    latex
      .replace(/\(\\imaginaryI\)/g, "i")
      .replace(/\\imaginaryI\b/g, "i")
      .replace(/\\exponentialE\b/g, "e")
      .replace(/\\differentialD\b/g, "\\mathrm{d}")
      .replace(/\\tilde\\infty\b/g, "\\tilde{\\infty}")
      .replace(/\\lt\b/g, "<")
      .replace(/\\gt\b/g, ">")
      // \frac{-b}{a} → -\frac{b}{a}, for a one-term numerator at the start of a term.
      .replace(/(^|[=,(]\s*)\\frac\{-([^{}+-]+)\}/g, "$1-\\frac{$2}")
      // -(\frac{\sqrt{2}}{2}) → -\frac{\sqrt{2}}{2}: a fraction needs no brackets after a sign.
      .replace(/-\((\\frac\{(?:[^{}]|\{[^{}]*\})*\}\{(?:[^{}]|\{[^{}]*\})*\})\)/g, "-$1")
  );
}

function symbolLatex(ce: Engine, name: string): string {
  return portableLatex(ce.box(name).latex);
}

function listSymbols(ce: Engine, names: readonly string[]): string {
  return names.map((name) => `$${symbolLatex(ce, name)}$`).join(", ");
}

function normalizeVariable(raw: string | undefined): string | null {
  const name = raw
    ?.trim()
    .replace(/^\$|\$$/g, "")
    .replace(/^\\/, "");
  if (!name) return null;
  const greek: Record<string, string> = {
    θ: "theta",
    α: "alpha",
    β: "beta",
    λ: "lambda",
    μ: "mu",
    φ: "varphi",
  };
  return greek[name] ?? name;
}

/** A subexpression's real value, or null when it isn't a real number. */
function realValue(ce: Engine, json: Json): number | null {
  if (typeof json === "number") return json;
  const value = complexValue(ce.box(json as never).N());
  return value && value.im === 0 ? value.re : null;
}

/** Whether the engine holds this as a plain number (not a symbol or an expression). */
function isNumberLiteral(value: Expr): boolean {
  return (value as unknown as { isNumberLiteral?: boolean }).isNumberLiteral === true;
}

function complexValue(value: Expr): Complex | null {
  if (!isNumberLiteral(value)) return null;
  const re = value.re;
  const im = value.im;
  if (Number.isNaN(re) || Number.isNaN(im)) return null;
  if (!Number.isFinite(re) && Number.isFinite(Number(value.toString()))) {
    return { re: Number(value.toString()), im };
  }
  return { re, im };
}

// ---- approximations -----------------------------------------------------------------

/** The decimal value of a number, as LaTeX, to `APPROX_DIGITS` significant digits. */
function approximation(value: Expr): { latex: string; complex: boolean } | null {
  if (!isNumberLiteral(value)) return null;
  const z = complexValue(value);
  if (!z) return null;
  if (!Number.isFinite(z.re) && z.im === 0 && value.isFinite !== false) {
    // Beyond double precision (1000!): read the engine's own digits.
    const latex = scientificFromDigits(value.toString());
    return latex ? { latex, complex: false } : null;
  }
  return { latex: formatComplex(z), complex: tidy(z).im !== 0 };
}

/** Drops a part that is noise next to the other (e^{iπ} = −1 + 1.2e−16 i). */
function tidy(z: Complex): Complex {
  const size = magnitude(z);
  return {
    re: Math.abs(z.re) < 1e-12 * size ? 0 : z.re,
    im: Math.abs(z.im) < 1e-12 * size ? 0 : z.im,
  };
}

export function formatReal(x: number): string {
  if (x === Infinity) return "\\infty";
  if (x === -Infinity) return "-\\infty";
  if (x === 0) return "0";
  const text = String(Number(x.toPrecision(APPROX_DIGITS)));
  const scientific = /^(-?[\d.]+)e([+-]\d+)$/.exec(text);
  return scientific ? `${scientific[1]}\\times10^{${Number(scientific[2])}}` : text;
}

export function formatComplex(value: Complex): string {
  const z = tidy(value);
  if (z.im === 0) return formatReal(z.re);
  const im = Math.abs(z.im) === 1 ? "" : formatReal(Math.abs(z.im));
  const imaginary = `${im}${im.includes("\\times") ? "\\," : ""}i`;
  if (z.re === 0) return `${z.im < 0 ? "-" : ""}${imaginary}`;
  return `${formatReal(z.re)}${z.im < 0 ? "-" : "+"}${imaginary}`;
}

/** "4023872600…" (a 2,568-digit integer) → "4.02387260077\times10^{2567}". */
function scientificFromDigits(text: string): string | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text.trim());
  if (!match) return null;
  const [, sign, whole, fraction = "", exponent = "0"] = match;
  const digits = (whole + fraction).replace(/^0+/, "");
  if (!digits) return "0";
  const leadingZeros = (whole + fraction).length - digits.length;
  const power = whole.length - 1 - leadingZeros + Number(exponent);
  const mantissa = Number(`${digits[0]}.${digits.slice(1, APPROX_DIGITS)}`);
  return `${sign}${mantissa}\\times10^{${power}}`;
}
