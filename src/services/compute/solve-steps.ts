// Worked steps for Solve, in the basic engine: how a textbook would get from
// the equation to its solutions. Two methods, tried in order:
//
// - Isolate the unknown. When it appears once, undo what surrounds it from
//   the outside in: subtract, divide, take a root, a logarithm, an inverse
//   sine… (2(x + 3)² − 5 = 13, 2^x = 8, √(x + 1) = 3, sin x = ½).
// - Polynomial and rational equations with rational coefficients: collect
//   terms, clear fractions, then a linear step, factoring or the quadratic
//   formula, rational roots divided out for higher degrees, and denominators'
//   zeros excluded.
//
// Steps explain an answer; they don't produce it. The solver (engine.ts)
// finds and checks the solutions independently, and shows these steps only
// when they arrive at the same ones (see `matches` there). A method that
// doesn't apply returns null, and the result simply has no steps.

import {
  commonDenominator,
  contentOf,
  deflate,
  exactSqrt,
  factorLatex,
  isInteger,
  isZero,
  ONE,
  pAdd,
  pDegree,
  pDivMod,
  pFactoredLatex,
  pGcd,
  pLatex,
  pMul,
  pScale,
  pSub,
  q,
  qAdd,
  qDiv,
  qEq,
  qLatex,
  qMul,
  qNeg,
  qParse,
  qSub,
  qValue,
  primitive,
  rationalRoots,
  splitSquare,
  TooLarge,
  ZERO,
  type Q,
  type QPoly,
} from "./exact.ts";
import { mentions, type Complex } from "./polynomial.ts";
import type { Step } from "./protocol.ts";

type Json = unknown;

/** What the steps need from the engine, given by engine.ts. */
export interface Toolkit {
  /** The unknown's name in MathJSON, and as LaTeX. */
  variable: string;
  symbol: string;
  /** Canonical MathJSON as LaTeX. */
  latex(json: Json): string;
  /** An exact simplification, or the input itself when simplifying would give a decimal. */
  simplify(json: Json): Json;
  /** The numeric value (other unknowns at sample values), or null. */
  value(json: Json): Complex | null;
  /** θ with fn(θ) = value exactly, a fraction of π, or null. */
  angle(fn: "Sin" | "Cos" | "Tan", value: Json): Json | null;
  /** `json` with the unknown replaced by `value`, simplified. */
  substitute(json: Json, value: Json): Json;
  /** Whether lhs = rhs holds with the unknown at `value`. */
  holds(lhs: Json, rhs: Json, value: Json): boolean;
}

/** A solution the steps arrive at. */
export interface Found {
  latex: string;
  value: Complex;
  /** MathJSON, for checking it against the equation (isolation only). */
  json?: Json;
  /** The exact value, when it is rational. */
  rational?: Q;
}

export interface Worked {
  steps: Step[];
  solutions: Found[];
  /** The equation holds for every value (where it's defined). */
  identity?: boolean;
}

/**
 * Steps for lhs = rhs in the toolkit's unknown, one set per method that
 * applies (none, often). The solver keeps the first whose answer matches.
 */
export function solveSteps(t: Toolkit, lhs: Json, rhs: Json): Worked[] {
  const out: Worked[] = [];
  for (const method of [isolate, polynomial, radical]) {
    try {
      const worked = method(t, lhs, rhs);
      if (worked?.steps.length) out.push({ ...worked, steps: withoutRepeat(worked.steps) });
    } catch (error) {
      if (!(error instanceof TooLarge || error instanceof RangeError)) throw error;
    }
  }
  return out;
}

const or = " \\quad\\text{or}\\quad ";

/** Drops a closing "The solution: x = 9" that only repeats the step before it. */
function withoutRepeat(steps: Step[]): Step[] {
  const last = steps[steps.length - 1];
  const before = steps[steps.length - 2];
  if (last && before && !last.substeps && last.latex !== undefined && before.latex) {
    if (last.latex.replace(/,\\quad /g, or) === before.latex) return steps.slice(0, -1);
    // "x = \log_2(8) = 3" already ends in "x = 3".
    const [name, value] = last.latex.split(" = ");
    if (
      !last.latex.includes("\\quad") &&
      before.latex.startsWith(`${name} = `) &&
      before.latex.endsWith(` = ${value}`)
    ) {
      return steps.slice(0, -1);
    }
  }
  return steps;
}

function equations(left: string, rights: string[]): string {
  return rights.map((right) => `${left} = ${right}`).join(or);
}

// ---- isolating the unknown ---------------------------------------------------------------

function occurrences(json: Json, symbol: string): number {
  if (json === symbol) return 1;
  if (!Array.isArray(json)) return 0;
  return json.reduce<number>((n, part, i) => n + (i > 0 ? occurrences(part, symbol) : 0), 0);
}

const isNumber = (z: Complex | null): z is Complex => z !== null && Number.isFinite(z.re);
const isReal = (z: Complex | null): z is Complex => isNumber(z) && Math.abs(z.im) < 1e-12;

function isolate(t: Toolkit, lhs: Json, rhs: Json): Worked | null {
  const x = t.variable;
  const steps: Step[] = [];
  let left = lhs;
  let rights: Json[] = [rhs];
  if (mentions(rhs, x)) {
    if (mentions(lhs, x)) return null;
    left = rhs;
    rights = [lhs];
    steps.push({
      text: `Swap the sides, so $${t.symbol}$ is on the left.`,
      latex: equations(t.latex(left), [t.latex(lhs)]),
    });
  }
  if (occurrences(left, x) !== 1) return null;
  // Squaring both sides can add solutions that don't satisfy the original.
  let needsCheck = false;
  const show = (json: Json) => t.latex(json);
  const step = (text: string, next: Json, nextRights: Json[]) => {
    // Every case was ruled out: the operation has nothing left to act on.
    if (!nextRights.length) {
      rights = [];
      return;
    }
    left = next;
    rights = nextRights.map((r) => t.simplify(r));
    let latex = rights.length ? equations(show(left), rights.map(show)) : undefined;
    // log₂ 8 = 3, 3² = 9: the operation before its value, for a single equation.
    if (rights.length === 1) {
      const before = show(nextRights[0]);
      if (plain(before) !== plain(show(rights[0])))
        latex = `${show(left)} = ${before} = ${show(rights[0])}`;
    }
    steps.push({ text, latex });
  };

  for (let guard = 0; left !== x; guard++) {
    if (guard > 40 || !Array.isArray(left)) return null;
    if (!rights.length) break;
    const [head, ...args] = left as [string, ...Json[]];
    const inner = args.findIndex((a) => mentions(a, x));
    const others = args.filter((_, i) => i !== inner);
    switch (head) {
      case "Add":
      case "Subtract": {
        const terms = head === "Subtract" ? [args[0], ["Negate", args[1]]] : args;
        const index = terms.findIndex((a) => mentions(a, x));
        const rest = terms.filter((_, i) => i !== index);
        const c = rest.length === 1 ? rest[0] : ["Add", ...rest];
        const value = t.value(c);
        const negative = isReal(value) && value.re < 0;
        const amount = negative ? t.simplify(["Negate", c]) : c;
        step(
          negative
            ? `Add $${show(amount)}$ to both sides.`
            : `Subtract $${show(amount)}$ from both sides.`,
          terms[index],
          rights.map((r) => ["Subtract", r, c]),
        );
        break;
      }
      case "Negate":
        step(
          "Multiply both sides by $-1$.",
          args[0],
          rights.map((r) => ["Negate", r]),
        );
        break;
      case "Multiply": {
        const k = others.length === 1 ? others[0] : ["Multiply", ...others];
        const value = t.value(k);
        const fraction = rationalOf(k);
        if (isReal(value) && Math.abs(value.re + 1) < 1e-15) {
          step(
            "Multiply both sides by $-1$.",
            args[inner],
            rights.map((r) => ["Negate", r]),
          );
        } else if (fraction && !isInteger(fraction) && (fraction.n === 1n || fraction.n === -1n)) {
          // x/3 is (1/3)·x: multiplying by 3 reads better than dividing by 1/3.
          const by = q(fraction.d * fraction.n);
          step(
            `Multiply both sides by $${qLatex(by)}$.`,
            args[inner],
            rights.map((r) => ["Multiply", r, qJson(by)]),
          );
        } else {
          step(
            `Divide both sides by $${show(k)}$.`,
            args[inner],
            rights.map((r) => ["Divide", r, k]),
          );
        }
        break;
      }
      case "Divide": {
        const [num, den] = args;
        if (inner === 0) {
          step(
            `Multiply both sides by $${show(den)}$.`,
            num,
            rights.map((r) => ["Multiply", r, den]),
          );
          break;
        }
        // The unknown is in the denominator: num/den = r gives den = num/r, for r ≠ 0.
        const alive = rights.filter((r) => !isZeroValue(t.value(r)));
        if (!alive.length) {
          steps.push({ text: `$${show(left)}$ is never $0$, since its numerator isn't.` });
          rights = [];
          break;
        }
        const text =
          rights.length === 1 && alive.length
            ? `Multiply both sides by $${show(den)}$, then divide both sides by $${show(rights[0])}$.`
            : `Multiply both sides by $${show(den)}$, then divide by the other side.`;
        if (alive.length < rights.length) {
          steps.push({ text: `$${show(left)}$ is never $0$, so that case has no solution.` });
        }
        step(
          text,
          den,
          alive.map((r) => ["Divide", num, r]),
        );
        break;
      }
      case "Square":
      case "Power": {
        const [base, exponent] = head === "Square" ? [args[0], 2] : args;
        if (mentions(base, x) && !mentions(exponent, x)) {
          const n = rationalOf(exponent);
          if (!n || !isInteger(n) || n.n < 2n || n.n > 12n) return null;
          const k = Number(n.n);
          const root = (r: Json) => (k === 2 ? ["Sqrt", r] : ["Root", r, k]);
          if (k % 2 === 0) {
            const next = rights.flatMap<Json>((r) =>
              isZeroValue(t.value(r)) ? [0] : [root(r), ["Negate", root(r)]],
            );
            step(
              k === 2
                ? "Take the square root of both sides. It can be positive or negative."
                : `Take the ${ordinal(k)} root of both sides. It can be positive or negative.`,
              base,
              next,
            );
          } else {
            step(
              `Take the ${ordinal(k)} root of both sides.`,
              base,
              rights.map((r) => root(r)),
            );
          }
        } else if (!mentions(base, x)) {
          const b = t.value(base);
          if (!isReal(b) || b.re <= 0 || b.re === 1) return null;
          const natural = base === "ExponentialE";
          const alive = positiveOnly(t, rights, steps, `$${show(left)}$ is always positive`);
          step(
            natural
              ? "Take the natural logarithm of both sides."
              : `Take the logarithm base $${show(base)}$ of both sides.`,
            exponent,
            alive.map((r) => (natural ? ["Ln", r] : ["Log", r, base])),
          );
        } else return null;
        break;
      }
      case "Exp": {
        const alive = positiveOnly(t, rights, steps, `$${show(left)}$ is always positive`);
        step(
          "Take the natural logarithm of both sides.",
          args[0],
          alive.map((r) => ["Ln", r]),
        );
        break;
      }
      case "Sqrt":
      case "Root": {
        const k = head === "Sqrt" ? 2 : Number(rationalOf(args[1])?.n ?? 0);
        if (inner !== 0 || k < 2 || k > 12) return null;
        let alive = rights;
        if (k % 2 === 0) {
          alive = rights.filter((r) => {
            const v = t.value(r);
            return !(isReal(v) && v.re < 0);
          });
          if (alive.length < rights.length) {
            steps.push({
              text: `A square root is never negative, so ${alive.length ? "that case has" : "there is"} no solution.`,
            });
          }
          needsCheck = true;
        }
        step(
          k === 2 ? "Square both sides." : `Raise both sides to the power ${k}.`,
          args[0],
          alive.map((r) => ["Power", r, k]),
        );
        break;
      }
      case "Ln":
        step(
          "Raise $e$ to the power of each side: $e^{\\ln u} = u$.",
          args[0],
          rights.map((r) => ["Power", "ExponentialE", r]),
        );
        break;
      case "Log":
      case "Lb":
      case "Lg": {
        if (inner !== 0) return null;
        const base = head === "Lb" ? 2 : head === "Lg" ? 10 : (args[1] ?? 10);
        step(
          `Raise $${show(base)}$ to the power of each side.`,
          args[0],
          rights.map((r) => ["Power", base, r]),
        );
        break;
      }
      case "Sin":
      case "Cos":
      case "Tan": {
        const name = head.toLowerCase();
        const inverse = `\\arc${name}`;
        const next: Json[] = [];
        let outOfRange = false;
        for (const r of rights) {
          const v = t.value(r);
          if (!isReal(v)) return null;
          if (head !== "Tan" && Math.abs(v.re) > 1 + 1e-12) {
            outOfRange = true;
            continue;
          }
          const theta = t.angle(head, r) ?? [`Arc${name}`, r];
          if (head === "Tan") next.push(theta);
          else if (head === "Sin") {
            next.push(theta);
            if (Math.abs(Math.abs(v.re) - 1) > 1e-12) next.push(["Subtract", "Pi", theta]);
          } else {
            next.push(theta);
            if (Math.abs(Math.abs(v.re) - 1) > 1e-12) next.push(["Negate", theta]);
          }
        }
        if (outOfRange) {
          steps.push({
            text: `The ${head === "Sin" ? "sine" : "cosine"} is always between $-1$ and $1$, so ${next.length ? "that case has" : "there is"} no solution.`,
          });
        }
        let text: string;
        if (rights.length === 1 && next.length) {
          const r = show(rights[0]);
          const angle = `${inverse}\\left(${r}\\right) = ${show(t.simplify(next[0]))}`;
          text =
            head === "Tan"
              ? `Take the inverse tangent of both sides: $${angle}$.`
              : next.length === 1
                ? `Within one period, the ${name === "sin" ? "sine" : "cosine"} equals $${r}$ only at $${angle}$.`
                : head === "Sin"
                  ? `Within one period, the sine equals $${r}$ at $${angle}$ and at $\\pi$ minus that.`
                  : `Within one period, the cosine equals $${r}$ at $\\pm${inverse}\\left(${r}\\right)$, where $${angle}$.`;
        } else {
          text =
            head === "Tan"
              ? "Take the inverse tangent of both sides."
              : `Undo the ${name === "sin" ? "sine" : "cosine"}: within one period, each value is reached at two angles.`;
        }
        step(text, args[0], next);
        break;
      }
      case "Abs": {
        const next: Json[] = [];
        for (const r of rights) {
          const v = t.value(r);
          if (!isReal(v)) return null;
          if (v.re < 0) continue;
          next.push(...(v.re === 0 ? [r] : [r, ["Negate", r]]));
        }
        if (next.length === 0 && rights.length) {
          steps.push({ text: "An absolute value is never negative, so there is no solution." });
        }
        step(
          "Remove the absolute value: the inside is the other side, or its negative.",
          args[0],
          next,
        );
        break;
      }
      case "Delimiter":
        left = args[0];
        break;
      default:
        return null;
    }
  }
  if (!steps.length) return null;

  let candidates = rights;
  if (needsCheck && candidates.length) {
    const check: Step[] = [];
    const kept: Json[] = [];
    for (const candidate of candidates) {
      const works = t.holds(lhs, rhs, candidate);
      const sides = `${show(t.substitute(lhs, candidate))} ${works ? "=" : "\\neq"} ${show(t.substitute(rhs, candidate))}`;
      check.push({
        text: works
          ? `$${t.symbol} = ${show(candidate)}$ works.`
          : `$${t.symbol} = ${show(candidate)}$ doesn't work, so it isn't a solution.`,
        latex: sides,
      });
      if (works) kept.push(candidate);
    }
    steps.push({
      text: "Check each answer in the original equation: squaring can add answers that don't work.",
      substeps: check,
    });
    candidates = kept;
  }
  const solutions: Found[] = [];
  for (const candidate of candidates) {
    const value = t.value(candidate);
    if (!isNumber(value)) return null;
    solutions.push({ latex: show(candidate), value, json: candidate });
  }
  if (solutions.length) {
    steps.push({
      text: solutions.length === 1 ? "The solution:" : "The solutions:",
      latex: solutions.map((s) => `${t.symbol} = ${s.latex}`).join(",\\quad "),
    });
  } else if (!steps[steps.length - 1].text.endsWith("there is no solution.")) {
    steps.push({ text: "So there is no solution." });
  }
  return { steps, solutions };
}

function positiveOnly(t: Toolkit, rights: Json[], steps: Step[], why: string): Json[] {
  const alive = rights.filter((r) => {
    const v = t.value(r);
    return !(isReal(v) && v.re <= 0);
  });
  if (alive.length < rights.length) {
    steps.push({ text: `${why}, so ${alive.length ? "that case has" : "there is"} no solution.` });
  }
  return alive;
}

function isZeroValue(z: Complex | null): boolean {
  return z !== null && z.re === 0 && z.im === 0;
}

function ordinal(n: number): string {
  return n === 2 ? "square" : n === 3 ? "cube" : `${n}th`;
}

function qJson(value: Q): Json {
  return value.d === 1n ? Number(value.n) : ["Rational", Number(value.n), Number(value.d)];
}

/** An exact rational constant, read from MathJSON, or null. */
function rationalOf(json: Json): Q | null {
  try {
    const form = readExact(json, "\u0000");
    return form && form.den.length === 1 && form.num.length <= 1
      ? qDiv(form.num[0] ?? ZERO, form.den[0])
      : null;
  } catch {
    return null;
  }
}

// ---- polynomial and rational equations -------------------------------------------------

interface ExactForm {
  num: QPoly;
  den: QPoly;
}

/** Canonical MathJSON as an exact rational function of `x`, or null. */
function readExact(json: Json, x: string): ExactForm | null {
  const constant = (value: Q): ExactForm => ({ num: isZero(value) ? [] : [value], den: [ONE] });
  const visit = (node: Json): ExactForm | null => {
    if (node === x) return { num: [ZERO, ONE], den: [ONE] };
    if (typeof node === "number") {
      return Number.isFinite(node) ? constant(qParse(String(node)) ?? q(0)) : null;
    }
    if (node && typeof node === "object" && !Array.isArray(node) && "num" in node) {
      const value = qParse(String((node as { num: string }).num));
      return value ? constant(value) : null;
    }
    if (!Array.isArray(node)) return null;
    const [head, ...args] = node as [string, ...Json[]];
    if (head === "Rational") {
      const [a, b] = args.map((arg) => visit(arg));
      if (!a || !b || pDegree(a.num) > 0 || pDegree(b.num) > 0 || !b.num.length) return null;
      return constant(qDiv(a.num[0] ?? ZERO, b.num[0]));
    }
    const parts = args.map(visit);
    if (parts.some((p) => p === null)) return null;
    const [first, ...rest] = parts as ExactForm[];
    switch (head) {
      case "Delimiter":
        return parts.length === 1 ? first : null;
      case "Negate":
        return { num: pScale(first.num, q(-1)), den: first.den };
      case "Add":
      case "Subtract":
        return rest.reduce<ExactForm>((acc, part) => {
          const scaled = pMul(part.num, acc.den);
          return {
            num: (head === "Add" ? pAdd : pSub)(pMul(acc.num, part.den), scaled),
            den: pMul(acc.den, part.den),
          };
        }, first);
      case "Multiply":
        return rest.reduce<ExactForm>(
          (acc, part) => ({ num: pMul(acc.num, part.num), den: pMul(acc.den, part.den) }),
          first,
        );
      case "Divide": {
        if (!rest[0]?.num.length) throw new RangeError("division by zero");
        return { num: pMul(first.num, rest[0].den), den: pMul(first.den, rest[0].num) };
      }
      case "Square":
      case "Power": {
        const exponent = head === "Square" ? q(2) : constantOf(rest[0]);
        if (!exponent || !isInteger(exponent) || exponent.n > 40n || exponent.n < -40n) return null;
        const k = Number(exponent.n);
        let num: QPoly = [ONE];
        let den: QPoly = [ONE];
        for (let i = 0; i < Math.abs(k); i++) {
          num = pMul(num, first.num);
          den = pMul(den, first.den);
        }
        if (k >= 0) return { num, den };
        if (!num.length) throw new RangeError("division by zero");
        return { num: den, den: num };
      }
      default:
        return null;
    }
  };
  return visit(json);
}

function constantOf(form: ExactForm | undefined): Q | null {
  if (!form || pDegree(form.den) !== 0 || pDegree(form.num) > 0) return null;
  return qDiv(form.num[0] ?? ZERO, form.den[0]);
}

/** Without spaces and \left/\right, for "is this already written that way?". */
function plain(latex: string): string {
  return latex.replace(/\\left|\\right|\s+|\{|\}/g, "");
}

function polynomial(t: Toolkit, lhs: Json, rhs: Json): Worked | null {
  const x = t.symbol;
  const left = readExact(lhs, t.variable);
  const right = readExact(rhs, t.variable);
  if (!left || !right) return null;
  if (pDegree(left.den) > 0 || pDegree(right.den) > 0) return rational(t, left, right);
  const l = pScale(left.num, qDiv(ONE, left.den[0]));
  const r = pScale(right.num, qDiv(ONE, right.den[0]));
  const steps: Step[] = [];
  const collected = `${pLatex(l, x)} = ${pLatex(r, x)}`;
  if (plain(collected) !== plain(`${t.latex(lhs)} = ${t.latex(rhs)}`)) {
    steps.push({ text: "Expand and combine like terms on each side.", latex: collected });
  }
  const rest = polynomialSteps(x, l, r);
  if (!rest) return null;
  return { ...rest, steps: [...steps, ...rest.steps] };
}

/** Steps for l(x) = r(x), both polynomials with rational coefficients. */
function polynomialSteps(x: string, l: QPoly, r: QPoly): Worked | null {
  const steps: Step[] = [];
  let p = pSub(l, r);
  const degree = pDegree(p);
  if (degree < 1) {
    const identity = degree < 0;
    steps.push({
      text: identity
        ? `Both sides are the same, so every $${x}$ is a solution.`
        : "The unknown cancels, leaving a false statement: there is no solution.",
      latex: identity ? undefined : `${qLatex(p[0])} = 0`,
    });
    return { steps, solutions: [], identity };
  }
  if (degree === 1) return linearSteps(x, l, r);

  if (pDegree(r) >= 0) {
    // To the side where the highest power stays positive.
    const right = p[p.length - 1].n < 0n;
    if (right) p = pScale(p, q(-1));
    steps.push({
      text: `Move every term to the ${right ? "right" : "left"} side.`,
      latex: right ? `0 = ${pLatex(p, x)}` : `${pLatex(p, x)} = 0`,
    });
  }
  const cleaned = primitive(p);
  const factor = qDiv(cleaned[cleaned.length - 1], p[p.length - 1]);
  if (!qEq(factor, ONE)) {
    const multiply = isInteger(factor) || factor.n === 1n || factor.n === -1n;
    steps.push({
      text: multiply
        ? factor.n === 1n && factor.d !== 1n
          ? `Divide both sides by $${factor.d}$.`
          : `Multiply both sides by $${qLatex(factor)}$.`
        : `Multiply both sides by $${qLatex(factor)}$ to remove the fractions.`,
      latex: `${pLatex(cleaned, x)} = 0`,
    });
    p = cleaned;
  }
  if (degree === 2) {
    const quadratic = quadraticSteps(x, p);
    return { steps: [...steps, ...quadratic.steps], solutions: quadratic.solutions };
  }
  return higherSteps(x, p, steps);
}

function linearSteps(x: string, l: QPoly, r: QPoly): Worked {
  const steps: Step[] = [];
  const scale = commonDenominator([...l, ...r]);
  if (scale > 1n) {
    l = pScale(l, q(scale));
    r = pScale(r, q(scale));
    steps.push({
      text: `Multiply both sides by $${scale}$ to clear the fractions.`,
      latex: `${pLatex(l, x)} = ${pLatex(r, x)}`,
    });
  }
  if (pDegree(l) < 1) {
    [l, r] = [r, l];
    steps.push({
      text: `Swap the sides, so $${x}$ is on the left.`,
      latex: `${pLatex(l, x)} = ${pLatex(r, x)}`,
    });
  }
  const [b1 = ZERO, a1 = ZERO] = l;
  const [b2 = ZERO, a2 = ZERO] = r;
  // Unknowns to the left, constants to the right.
  if (!isZero(a2)) {
    const term = pLatex([ZERO, a2], x);
    l = pSub(l, [ZERO, a2]);
    r = pSub(r, [ZERO, a2]);
    steps.push({
      text:
        a2.n < 0n
          ? `Add $${pLatex([ZERO, qNeg(a2)], x)}$ to both sides.`
          : `Subtract $${term}$ from both sides.`,
      latex: `${pLatex(l, x)} = ${pLatex(r, x)}`,
    });
  }
  if (!isZero(b1)) {
    l = pSub(l, [b1]);
    r = pSub(r, [b1]);
    steps.push({
      text:
        b1.n < 0n
          ? `Add $${qLatex(qNeg(b1))}$ to both sides.`
          : `Subtract $${qLatex(b1)}$ from both sides.`,
      latex: `${pLatex(l, x)} = ${pLatex(r, x)}`,
    });
  }
  const a = qSub(a1, a2);
  const value = qDiv(qSub(b2, b1), a);
  if (!qEq(a, ONE)) {
    steps.push({
      text: qEq(a, q(-1)) ? "Multiply both sides by $-1$." : `Divide both sides by $${qLatex(a)}$.`,
      latex: `${x} = ${qLatex(value)}`,
    });
  }
  // x = 5 is already solved: nothing to show.
  if (steps.length) steps.push({ text: "The solution:", latex: `${x} = ${qLatex(value)}` });
  return {
    steps,
    solutions: [{ latex: qLatex(value), value: { re: qValue(value), im: 0 }, rational: value }],
  };
}

/** a·x² + b·x + c = 0 with integer coefficients and no common factor. */
function quadraticSteps(x: string, p: QPoly): Worked {
  const [c = ZERO, b = ZERO, a] = p;
  const steps: Step[] = [];
  const real = (value: Q): Found => ({
    latex: qLatex(value),
    value: { re: qValue(value), im: 0 },
    rational: value,
  });

  if (isZero(c)) {
    const root = qNeg(qDiv(b, a));
    const linear = pLatex([b, a], x);
    steps.push({
      text: `Factor out $${x}$.`,
      latex: `${x}\\left(${linear}\\right) = 0`,
    });
    if (isZero(b)) {
      steps.push({ text: "The solution:", latex: `${x} = 0` });
      return { steps, solutions: [real(ZERO)] };
    }
    steps.push({
      text: "A product is zero when one of its factors is.",
      latex: `${x} = 0${or}${linear} = 0`,
    });
    steps.push({ text: "The solutions:", latex: `${x} = 0,\\quad ${x} = ${qLatex(root)}` });
    return { steps, solutions: [real(ZERO), real(root)] };
  }

  if (isZero(b)) {
    const square = qNeg(qDiv(c, a));
    steps.push({
      text: qEq(a, ONE)
        ? `Move the constant to the right side.`
        : `Move the constant to the right side and divide by $${qLatex(a)}$.`,
      latex: `${x}^{2} = ${qLatex(square)}`,
    });
    const root = sqrtOf(square);
    steps.push({
      text:
        square.n < 0n
          ? "Take the square root of both sides. The number under it is negative, so the solutions are complex."
          : "Take the square root of both sides. It can be positive or negative.",
      latex: `${x} = \\pm ${root.latex}`,
    });
    const plus = { re: square.n < 0n ? 0 : root.size, im: square.n < 0n ? root.size : 0 };
    const minus = { re: -plus.re, im: -plus.im };
    steps.push({
      text: "The solutions:",
      latex: `${x} = ${root.latex},\\quad ${x} = -${root.latex}`,
    });
    return {
      steps,
      solutions: [
        { latex: root.latex, value: plus },
        { latex: `-${root.latex}`, value: minus },
      ],
    };
  }

  const discriminant = qSub(qMul(b, b), qMul(q(4), qMul(a, c)));
  const root = exactSqrt(discriminant.n);
  if (root !== null) {
    // Rational roots: the quadratic factors over the integers.
    const r1 = qDiv(qAdd(qNeg(b), q(root)), qMul(q(2), a));
    const r2 = qDiv(qSub(qNeg(b), q(root)), qMul(q(2), a));
    const factored = pFactoredLatex(p, x);
    steps.push({
      text: qEq(a, ONE)
        ? `Factor: find two numbers that multiply to $${qLatex(c)}$ and add to $${qLatex(b)}$. They are $${qLatex(qNeg(r1))}$ and $${qLatex(qNeg(r2))}$.`
        : "Factor the left side.",
      latex: `${factored} = 0`,
    });
    if (qEq(r1, r2)) {
      steps.push({
        text: "A square is zero only when what is squared is zero.",
        latex: `${factorLatex(r1, x)} = 0`,
      });
      steps.push({ text: "The solution (a repeated root):", latex: `${x} = ${qLatex(r1)}` });
      return { steps, solutions: [real(r1)] };
    }
    const [first, second] = [r1, r2].sort((u, v) => qValue(u) - qValue(v));
    steps.push({
      text: "A product is zero when one of its factors is.",
      latex: `${factorLatex(first, x)} = 0${or}${factorLatex(second, x)} = 0`,
    });
    steps.push({
      text: "The solutions:",
      latex: `${x} = ${qLatex(first)},\\quad ${x} = ${qLatex(second)}`,
    });
    return { steps, solutions: [real(first), real(second)] };
  }

  // The quadratic formula, with the square root simplified and the fraction reduced.
  const wrap = (value: Q) => (value.n < 0n ? `\\left(${qLatex(value)}\\right)` : qLatex(value));
  steps.push({
    text: `Use the quadratic formula, with $a = ${qLatex(a)}$, $b = ${qLatex(b)}$, $c = ${qLatex(c)}$.`,
    latex: `${x} = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}`,
  });
  steps.push({
    text: "Put those numbers into the formula.",
    latex: `${x} = \\frac{-${wrap(b)} \\pm \\sqrt{${wrap(b)}^{2} - 4 \\cdot ${wrap(a)} \\cdot ${wrap(c)}}}{2 \\cdot ${wrap(a)}}`,
  });
  const top = qNeg(b);
  const bottom = qMul(q(2), a);
  steps.push({
    text: `Work out the number inside the square root: $b^{2} - 4ac = ${qLatex(discriminant)}$.`,
    latex: `${x} = \\frac{${qLatex(top)} \\pm \\sqrt{${qLatex(discriminant)}}}{${qLatex(bottom)}}`,
  });
  const negative = discriminant.n < 0n;
  const size = negative ? -discriminant.n : discriminant.n;
  const { outside, inside } = splitSquare(size);
  const radical = radicalLatex(outside, inside, negative);
  if (negative || outside > 1n) {
    steps.push({
      text: negative
        ? `The number inside the square root is negative. Use $i$, where $i^2=-1$: $\\sqrt{${qLatex(discriminant)}} = ${radical}$.`
        : `Simplify the square root: $\\sqrt{${size}} = ${radical}$.`,
      latex: `${x} = \\frac{${qLatex(top)} \\pm ${radical}}{${qLatex(bottom)}}`,
    });
  }
  // Divide top and bottom by what −b, the root's coefficient and 2a share.
  const g = [top.n, outside, bottom.n].reduce((m, n) => gcdBig(m, n));
  const sign = bottom.n < 0n ? -1n : 1n;
  const t2 = (top.n / g) * sign;
  const k2 = outside / g;
  const d2 = (bottom.n / g) * sign;
  const shownRadical = radicalLatex(k2, inside, negative);
  const over = (sign: "+" | "-") => {
    const head = t2 === 0n ? (sign === "-" ? "-" : "") : `${t2} ${sign} `;
    const body = `${head}${shownRadical}`;
    return d2 === 1n ? body : `\\frac{${body}}{${d2}}`;
  };
  if (g > 1n || sign < 0n) {
    steps.push({
      text: g > 1n ? `Divide the top and the bottom by $${g}$.` : "Tidy the signs.",
      latex:
        d2 === 1n
          ? `${x} = ${t2 === 0n ? "" : `${t2} `}\\pm ${shownRadical}`
          : `${x} = \\frac{${t2 === 0n ? "" : `${t2} `}\\pm ${shownRadical}}{${d2}}`,
    });
  }
  const magnitude = (Number(k2) * Math.sqrt(Number(inside))) / Number(d2);
  const centre = Number(t2) / Number(d2);
  const plus = negative ? { re: centre, im: magnitude } : { re: centre + magnitude, im: 0 };
  const minus = negative ? { re: centre, im: -magnitude } : { re: centre - magnitude, im: 0 };
  steps.push({
    text: "The solutions:",
    latex: `${x} = ${over("+")},\\quad ${x} = ${over("-")}`,
  });
  return {
    steps,
    solutions: [
      { latex: over("+"), value: plus },
      { latex: over("-"), value: minus },
    ],
  };
}

function gcdBig(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

/** k·√m, times i when `imaginary`: "2\sqrt{3}", "\sqrt{3}\,i", "2i", "i", "1". */
function radicalLatex(k: bigint, m: bigint, imaginary: boolean): string {
  const root = m === 1n ? "" : `\\sqrt{${m}}`;
  const coefficient = k === 1n && (root || imaginary) ? "" : k.toString();
  if (!imaginary) return `${coefficient}${root}`;
  return root ? `${coefficient}${root}\\,i` : `${coefficient}i`;
}

/** √value as LaTeX, simplified (√12 = 2√3, √(−4) = 2i, √(1/2) = √2/2), and its size. */
function sqrtOf(value: Q): { latex: string; size: number } {
  const negative = value.n < 0n;
  const n = negative ? -value.n : value.n;
  // √(n/d) = √(n·d)/d, then reduced: √(1/2) = √2/2, √(9/4) = 3/2.
  const { outside, inside } = splitSquare(n * value.d);
  const g = gcdBig(outside, value.d);
  const top = radicalLatex(outside / g, inside, negative);
  const d = value.d / g;
  const size = Math.sqrt(qValue({ n, d: value.d }));
  return { latex: d === 1n ? top : `\\frac{${top}}{${d}}`, size };
}

/** Degree 3 and up: divide out rational roots until a quadratic (or less) is left. */
function higherSteps(x: string, p: QPoly, steps: Step[]): Worked | null {
  const roots = rationalRoots(p);
  if (!roots.length) return null;
  let rest = p;
  const factors: Q[] = [];
  for (const root of roots) {
    if (pDegree(rest) <= 2) break;
    factors.push(root);
    rest = deflate(rest, root);
  }
  if (pDegree(rest) > 2) return null;
  const tried = factors.map((root) => `$${x} = ${qLatex(root)}$`).join(", ");
  steps.push({
    text: `Look for rational roots $\\pm\\frac{p}{q}$, $p$ dividing the constant term and $q$ the leading coefficient. ${tried} ${factors.length === 1 ? "makes" : "make"} the left side zero.`,
    substeps: factors.map((root) => ({
      text: `$${x} = ${qLatex(root)}$:`,
      latex: `${pLatexAt(p, root)} = 0`,
    })),
  });
  const restLatex = pLatex(rest, x);
  const product = [
    ...groupRoots(factors).map(({ root, count }) =>
      count > 1
        ? `\\left(${factorLatex(root, x)}\\right)^{${count}}`
        : isZero(root)
          ? x
          : `\\left(${factorLatex(root, x)}\\right)`,
    ),
    pDegree(rest) > 0
      ? `\\left(${restLatex}\\right)`
      : rest[0] && !qEq(rest[0], ONE)
        ? qLatex(rest[0])
        : "",
  ].join("");
  steps.push({
    text: `Each root $r$ gives a factor $(${x} - r)$; divide ${factors.length === 1 ? "it" : "them"} out (synthetic division).`,
    latex: `${product} = 0`,
  });
  const solutions: Found[] = [];
  const pushReal = (root: Q) => {
    if (!solutions.some((s) => s.value.re === qValue(root) && s.value.im === 0)) {
      solutions.push({ latex: qLatex(root), value: { re: qValue(root), im: 0 }, rational: root });
    }
  };
  factors.forEach(pushReal);
  if (pDegree(rest) >= 1) {
    const remaining =
      pDegree(rest) === 2 ? quadraticSteps(x, primitive(rest)) : linearSteps(x, rest, []);
    steps.push({
      text: `Solve the remaining factor: $${restLatex} = 0$.`,
      substeps: remaining.steps.slice(0, -1),
    });
    for (const found of remaining.solutions) {
      if (!solutions.some((s) => close(s.value, found.value))) solutions.push(found);
    }
  }
  steps.push({
    text: "The solutions:",
    latex: solutions.map((s) => `${x} = ${s.latex}`).join(",\\quad "),
  });
  return { steps, solutions };
}

function close(a: Complex, b: Complex): boolean {
  return Math.hypot(a.re - b.re, a.im - b.im) < 1e-9 * Math.max(1, Math.hypot(b.re, b.im));
}

function groupRoots(roots: Q[]): { root: Q; count: number }[] {
  const groups: { root: Q; count: number }[] = [];
  for (const root of roots) {
    const group = groups.find((g) => qEq(g.root, root));
    if (group) group.count++;
    else groups.push({ root, count: 1 });
  }
  return groups;
}

/** p(root) written out: 2^{3} - 2 \cdot 2 - 4 for x³ − 2x − 4 at 2. */
function pLatexAt(p: QPoly, root: Q): string {
  const value = root.n < 0n || root.d !== 1n ? `\\left(${qLatex(root)}\\right)` : qLatex(root);
  const terms: string[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const c = p[i];
    if (isZero(c)) continue;
    const power = i === 0 ? "" : i === 1 ? value : `${value}^{${i}}`;
    const size = c.n < 0n ? qNeg(c) : c;
    const coefficient = i === 0 ? qLatex(size) : qEq(size, ONE) ? "" : `${qLatex(size)} \\cdot `;
    const term = `${coefficient}${power}`;
    terms.push(terms.length ? `${c.n < 0n ? "-" : "+"} ${term}` : `${c.n < 0n ? "-" : ""}${term}`);
  }
  return terms.join(" ");
}

/** Equations with the unknown in a denominator: exclude its zeros, clear, solve, check. */
function rational(t: Toolkit, left: ExactForm, right: ExactForm): Worked | null {
  const x = t.symbol;
  // The excluded values come from the denominators as written, before any cancelling.
  const written = primitive(pMul(left.den, right.den));
  const excluded = groupRoots(rationalRoots(written)).map((g) => g.root);
  const steps: Step[] = [];
  const splits = rationalRoots(written).length === pDegree(written);
  steps.push({
    text: splits
      ? `A denominator can't be zero, so ${excluded.map((root) => `$${x} \\neq ${qLatex(root)}$`).join(" and ")}.`
      : `A denominator can't be zero: $${pLatex(written, x)} \\neq 0$.`,
  });
  const reduce = (form: ExactForm) => {
    const g = pGcd(form.num, form.den);
    return {
      form: { num: pDivMod(form.num, g).quotient, den: pDivMod(form.den, g).quotient },
      common: pDegree(g) > 0 ? g : null,
    };
  };
  const { form: l, common: leftCommon } = reduce(left);
  const { form: r, common: rightCommon } = reduce(right);
  const fraction = (form: ExactForm) => {
    const den = primitive(form.den);
    const scale = qDiv(den[den.length - 1], form.den[form.den.length - 1]);
    const num = pScale(form.num, scale);
    return pDegree(den) < 1 && qEq(den[0], ONE)
      ? pLatex(num, x)
      : `\\frac{${pLatex(num, x)}}{${pFactoredLatex(den, x)}}`;
  };
  const cancelled = [leftCommon, rightCommon].filter((g): g is QPoly => g !== null);
  if (cancelled.length) {
    const factors = cancelled.map((g) => `$${pFactoredLatex(primitive(g), x)}$`).join(" and ");
    steps.push({
      text: `Cancel the common factor ${factors}: it isn't zero where the equation is defined.`,
      latex: `${fraction(l)} = ${fraction(r)}`,
    });
  }
  const shared = pGcd(l.den, r.den);
  let lcd = primitive(pDivMod(pMul(l.den, r.den), shared).quotient);
  const multiply = (form: ExactForm) => pMul(form.num, pDivMod(lcd, form.den).quotient);
  let newLeft = multiply(l);
  let newRight = multiply(r);
  // 1/(x − 1) = 1/2: multiply by 2(x − 1), not x − 1 and then 2.
  const numbers = q(commonDenominator([...newLeft, ...newRight]));
  if (!qEq(numbers, ONE) && pDegree(lcd) > 0) {
    lcd = pScale(lcd, numbers);
    newLeft = pScale(newLeft, numbers);
    newRight = pScale(newRight, numbers);
  }
  if (pDegree(lcd) > 0) {
    steps.push({
      text: `Multiply both sides by $${pFactoredLatex(lcd, x)}$ to clear the fractions.`,
      latex: `${pLatex(newLeft, x)} = ${pLatex(newRight, x)}`,
    });
  }
  const rest = polynomialSteps(x, newLeft, newRight);
  if (!rest) return null;
  if (rest.identity) {
    return { steps: [...steps, ...rest.steps], solutions: [], identity: true };
  }
  const body = rest.steps.slice(0, -1);
  const kept = rest.solutions.filter(
    (s) => !excluded.some((root) => close(s.value, { re: qValue(root), im: 0 })),
  );
  const rejected = rest.solutions.filter((s) => !kept.includes(s));
  const check: Step = rejected.length
    ? {
        text: `${rejected.map((s) => `$${x} = ${s.latex}$`).join(" and ")} ${rejected.length === 1 ? "makes" : "make"} a denominator zero, so ${rejected.length === 1 ? "it isn't a solution" : "they aren't solutions"}.`,
      }
    : {
        text:
          rest.solutions.length === 1
            ? "It doesn't make a denominator zero, so it stands."
            : "None of them makes a denominator zero, so all of them stand.",
      };
  if (!rest.solutions.length) {
    return { steps: [...steps, ...rest.steps], solutions: [] };
  }
  const final: Step = kept.length
    ? {
        text: kept.length === 1 ? "The solution:" : "The solutions:",
        latex: kept.map((s) => `${x} = ${s.latex}`).join(",\\quad "),
      }
    : { text: "So there is no solution." };
  return { steps: [...steps, ...body, check, final], solutions: kept };
}

// ---- one square root, beside polynomial terms ---------------------------------------------

function sqrtCount(json: Json, x: string): number {
  if (!Array.isArray(json)) return 0;
  const here = json[0] === "Sqrt" && mentions(json[1], x) ? 1 : 0;
  return json.reduce<number>((n, part, i) => n + (i > 0 ? sqrtCount(part, x) : 0), here);
}

/**
 * √u = P with P (and u) polynomials, the root possibly beside other terms
 * (√x + 2 = x): isolate the root, square both sides, solve, and keep only the
 * answers where P ≥ 0, since squaring also solves −√u = P.
 */
function radical(t: Toolkit, lhs: Json, rhs: Json): Worked | null {
  const x = t.variable;
  const X = t.symbol;
  if (sqrtCount(lhs, x) + sqrtCount(rhs, x) !== 1) return null;
  const [side, other] = sqrtCount(lhs, x) ? [lhs, rhs] : [rhs, lhs];
  const terms = Array.isArray(side) && side[0] === "Add" ? side.slice(1) : [side];
  const index = terms.findIndex((term) => sqrtCount(term, x) === 1);
  const term = terms[index] as Json[];
  let k: Q = ONE;
  let inside: Json;
  if (term[0] === "Sqrt") inside = term[1];
  else if (term[0] === "Multiply") {
    const factors = term.slice(1);
    const root = factors.find((f) => Array.isArray(f) && f[0] === "Sqrt") as Json[] | undefined;
    const rest = factors.filter((f) => f !== root);
    const coefficient = rest.length === 1 ? rationalOf(rest[0]) : rationalOf(["Multiply", ...rest]);
    if (!root || !coefficient || isZero(coefficient)) return null;
    k = coefficient;
    inside = root[1];
  } else return null;
  const others = terms.filter((_, i) => i !== index);
  const u = readExact(inside, x);
  const restForm = readExact(others.length ? ["Add", ...others] : 0, x);
  const otherForm = readExact(other, x);
  for (const form of [u, restForm, otherForm]) {
    if (!form || pDegree(form.den) > 0) return null;
  }
  const poly = (form: ExactForm | null) => pScale(form!.num, qDiv(ONE, form!.den[0]));
  const uPoly = poly(u);
  const p = pScale(pSub(poly(otherForm), poly(restForm)), qDiv(ONE, k));
  const root = `\\sqrt{${pLatex(uPoly, X)}}`;
  const steps: Step[] = [];
  if (others.length || side !== lhs || !qEq(k, ONE)) {
    steps.push({
      text: qEq(k, ONE)
        ? "Get the square root alone on one side."
        : `Get the square root alone on one side, dividing by $${qLatex(k)}$.`,
      latex: `${root} = ${pLatex(p, X)}`,
    });
  }
  const squared = pMul(p, p);
  const base = pLatex(p, X);
  steps.push({
    text: "Square both sides.",
    latex: `${pLatex(uPoly, X)} = ${base === X ? `${X}^{2}` : `\\left(${base}\\right)^{2} = ${pLatex(squared, X)}`}`,
  });
  const rest = polynomialSteps(X, uPoly, squared);
  if (!rest || rest.identity) return null;
  steps.push(...rest.steps.slice(0, -1));
  const kept: Found[] = [];
  const check: Step[] = [];
  for (const candidate of rest.solutions) {
    const real = candidate.value.im === 0;
    // Every candidate has u = P², so √u = |P|: it works exactly when P ≥ 0.
    const at = candidate.rational;
    const right = at
      ? qValue(pEvalExact(p, at))
      : p.reduce((sum, c, i) => sum + qValue(c) * candidate.value.re ** i, 0);
    const works = real && right >= -1e-9;
    let latex: string | undefined;
    if (at) {
      const u = qLatex(pEvalExact(uPoly, at));
      const pAt = pEvalExact(p, at);
      latex = works
        ? `\\sqrt{${u}} = ${qLatex(pAt)}`
        : `\\sqrt{${u}} = ${qLatex(qNeg(pAt))} \\neq ${qLatex(pAt)}`;
    }
    check.push({
      text: works
        ? `$${X} = ${candidate.latex}$ works.`
        : real
          ? `$${X} = ${candidate.latex}$ doesn't work: it makes $${pLatex(p, X)}$ negative, and a square root never is.`
          : `$${X} = ${candidate.latex}$ isn't real, so it can't be a square root's value.`,
      latex,
    });
    if (works) kept.push(candidate);
  }
  steps.push({
    text: "Check each answer: squaring also solves the equation with the root's sign flipped.",
    substeps: check,
  });
  steps.push(
    kept.length
      ? {
          text: kept.length === 1 ? "The solution:" : "The solutions:",
          latex: kept.map((s) => `${X} = ${s.latex}`).join(",\\quad "),
        }
      : { text: "So there is no solution." },
  );
  return { steps, solutions: kept };
}

function pEvalExact(p: QPoly, at: Q): Q {
  let out = ZERO;
  for (let i = p.length - 1; i >= 0; i--) out = qAdd(qMul(out, at), p[i]);
  return out;
}
