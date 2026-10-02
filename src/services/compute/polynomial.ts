// Polynomial and rational equations, solved completely.
//
// The engine's own `solve` misses solutions of perfectly ordinary equations:
// nothing for x³ + x + 1 = 0 (no tidy closed form) or (x² − 1)/(x − 1) = 0,
// and its `Together` combines 1/x + 1/(x − 1) incorrectly. For these, the
// equation is rewritten here as one fraction num(x)/den(x) = 0 with numeric
// coefficients, and every root of `num` is found numerically (a degree-n
// polynomial has exactly n, counted with multiplicity, complex included).
// Roots where `den` vanishes are excluded: the equation is undefined there.
// The engine is still asked for exact forms; see engine.ts.

/** Coefficients, lowest degree first: [c0, c1, c2] is c0 + c1·x + c2·x². */
export type Poly = number[];

export interface Complex {
  re: number;
  im: number;
}

export interface RationalForm {
  num: Poly;
  den: Poly;
}

/** Past this degree, a rational form is refused as too complex. */
export const MAX_DEGREE = 40;

export class DegreeTooHigh extends Error {
  constructor() {
    super(`The equation's degree is over ${MAX_DEGREE}.`);
    this.name = "DegreeTooHigh";
  }
}

// ---- polynomial arithmetic --------------------------------------------------------

/** Drops trailing zero coefficients (an empty list is the zero polynomial). */
function trim(p: Poly): Poly {
  let end = p.length;
  while (end > 0 && p[end - 1] === 0) end--;
  return end === p.length ? p : p.slice(0, end);
}

export function degree(p: Poly): number {
  return trim(p).length - 1;
}

function add(a: Poly, b: Poly): Poly {
  const out: Poly = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) out.push((a[i] ?? 0) + (b[i] ?? 0));
  return trim(out);
}

function scale(a: Poly, k: number): Poly {
  return trim(a.map((c) => c * k));
}

function multiply(a: Poly, b: Poly): Poly {
  if (!a.length || !b.length) return [];
  const out: Poly = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  if (out.length - 1 > MAX_DEGREE) throw new DegreeTooHigh();
  return trim(out);
}

// ---- reading an equation as num/den -----------------------------------------------

type Json = unknown;

/**
 * Reads canonical MathJSON as a rational function of `variable`, or returns
 * null when it isn't one (a sine of x, a square root of x, x in an exponent…).
 * `constant` gives the real value of a subexpression without the variable,
 * or null (complex, or not a number).
 */
export function rationalForm(
  json: Json,
  variable: string,
  constant: (json: Json) => number | null,
): RationalForm | null {
  const visit = (node: Json): RationalForm | null => {
    if (node === variable) return { num: [0, 1], den: [1] };
    if (!mentions(node, variable)) {
      const value = constant(node);
      return value === null || !Number.isFinite(value) ? null : { num: trim([value]), den: [1] };
    }
    if (!Array.isArray(node)) return null;
    const [head, ...args] = node as [string, ...Json[]];
    switch (head) {
      case "Add":
      case "Subtract":
      case "Negate":
      case "Multiply":
      case "Divide": {
        const parts = args.map(visit);
        if (parts.some((p) => p === null)) return null;
        const [first, ...rest] = parts as RationalForm[];
        if (head === "Negate") return { num: scale(first.num, -1), den: first.den };
        return rest.reduce<RationalForm>((acc, part) => {
          if (head === "Multiply") {
            return { num: multiply(acc.num, part.num), den: multiply(acc.den, part.den) };
          }
          if (head === "Divide") {
            if (!part.num.length) throw new RangeError("division by zero");
            return { num: multiply(acc.num, part.den), den: multiply(acc.den, part.num) };
          }
          const sign = head === "Subtract" ? -1 : 1;
          return {
            num: add(multiply(acc.num, part.den), scale(multiply(part.num, acc.den), sign)),
            den: multiply(acc.den, part.den),
          };
        }, first);
      }
      case "Square":
        return power(visit(args[0]), 2);
      case "Power": {
        if (mentions(args[1], variable)) return null;
        const exponent = constant(args[1]);
        if (exponent === null || !Number.isInteger(exponent)) return null;
        if (Math.abs(exponent) > MAX_DEGREE) throw new DegreeTooHigh();
        return power(visit(args[0]), exponent);
      }
      case "Delimiter":
        return args.length === 1 ? visit(args[0]) : null;
      default:
        return null;
    }
  };
  return visit(json);
}

function power(base: RationalForm | null, exponent: number): RationalForm | null {
  if (!base) return null;
  let num: Poly = [1];
  let den: Poly = [1];
  for (let i = 0; i < Math.abs(exponent); i++) {
    num = multiply(num, base.num);
    den = multiply(den, base.den);
  }
  if (exponent >= 0) return { num, den };
  if (!num.length) throw new RangeError("division by zero");
  return { num: den, den: num };
}

/** Whether the MathJSON mentions `symbol` anywhere. */
export function mentions(json: Json, symbol: string): boolean {
  if (json === symbol) return true;
  return Array.isArray(json) && json.some((part, i) => i > 0 && mentions(part, symbol));
}

// ---- complex numbers ---------------------------------------------------------------

const c = (re: number, im = 0): Complex => ({ re, im });
const cAdd = (a: Complex, b: Complex) => c(a.re + b.re, a.im + b.im);
const cSub = (a: Complex, b: Complex) => c(a.re - b.re, a.im - b.im);
const cMul = (a: Complex, b: Complex) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
function cDiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}
export const magnitude = (a: Complex) => Math.hypot(a.re, a.im);

/** p(z) by Horner's rule. */
export function evaluate(p: Poly, z: Complex): Complex {
  let out = c(0);
  for (let i = p.length - 1; i >= 0; i--) out = cAdd(cMul(out, z), c(p[i]));
  return out;
}

function derivative(p: Poly): Poly {
  return p.slice(1).map((coefficient, i) => coefficient * (i + 1));
}

// ---- roots ---------------------------------------------------------------------------

/**
 * Every root of `p`, with multiplicity, by the Aberth–Ehrlich method: all
 * roots are refined together, each pushed away from the others, so they
 * don't converge on the same one. Cubic convergence for simple roots;
 * repeated roots converge more slowly and are regrouped by `clusterRoots`.
 */
export function roots(p: Poly): Complex[] {
  const poly = trim(p);
  const n = poly.length - 1;
  if (n < 1) return [];
  // Zero roots first: they're exact, and dividing them out keeps the rest well scaled.
  let zeros = 0;
  while (poly[zeros] === 0) zeros++;
  const reduced = poly.slice(zeros);
  const m = reduced.length - 1;
  const found: Complex[] = Array.from({ length: zeros }, () => c(0));
  if (m === 0) return found;
  const lead = reduced[m];
  const monic = reduced.map((coefficient) => coefficient / lead);
  const slope = derivative(monic);
  // Cauchy's bound: every root lies within this radius.
  const radius = 1 + Math.max(...monic.slice(0, m).map(Math.abs));
  const z: Complex[] = Array.from({ length: m }, (_, k) => {
    const angle = (2 * Math.PI * k) / m + 0.4;
    return c(radius * 0.5 * Math.cos(angle), radius * 0.5 * Math.sin(angle));
  });
  for (let iteration = 0; iteration < 500; iteration++) {
    let largest = 0;
    for (let i = 0; i < m; i++) {
      const value = evaluate(monic, z[i]);
      if (magnitude(value) === 0) continue;
      const ratio = cDiv(value, evaluate(slope, z[i]));
      let repel = c(0);
      for (let j = 0; j < m; j++) {
        if (j !== i) repel = cAdd(repel, cDiv(c(1), cSub(z[i], z[j])));
      }
      const offset = cDiv(ratio, cSub(c(1), cMul(ratio, repel)));
      if (!Number.isFinite(offset.re) || !Number.isFinite(offset.im)) continue;
      z[i] = cSub(z[i], offset);
      largest = Math.max(largest, magnitude(offset) / Math.max(1, magnitude(z[i])));
    }
    if (largest < 1e-15) break;
  }
  return [...found, ...z.map(clean)];
}

/** Rounds away noise: an imaginary part 1e-17 is a real root. */
function clean(z: Complex): Complex {
  const size = Math.max(1, magnitude(z));
  return c(Math.abs(z.re) < 1e-12 * size ? 0 : z.re, Math.abs(z.im) < 1e-9 * size ? 0 : z.im);
}

/**
 * Roots closer than this (relative) may be one repeated root: an m-fold root
 * comes back as m points spread around it, about ε^(1/m) apart (≈4e-3 for
 * a 5-fold root). A false grouping costs nothing: the check below splits it.
 */
const NEIGHBOURS = 1e-2;

/**
 * Groups a repeated root's points into one root with its multiplicity.
 *
 * Points within `NEIGHBOURS` of each other are a candidate group of size m.
 * It is one m-fold root only if p and its first m − 1 derivatives all vanish
 * there; that point is found by Newton's method on the (m − 1)th derivative,
 * where the root is simple. Otherwise the points are distinct roots that
 * happen to be close, and stay separate.
 */
export function clusterRoots(
  p: Poly,
  found: Complex[],
): { value: Complex; multiplicity: number }[] {
  const groups: Complex[][] = [];
  for (const z of found) {
    const near = (w: Complex) =>
      magnitude(cSub(w, z)) <= NEIGHBOURS * Math.max(1, magnitude(w), magnitude(z));
    const touching = groups.filter((members) => members.some(near));
    const merged = [z, ...touching.flat()];
    for (const group of touching) groups.splice(groups.indexOf(group), 1);
    groups.push(merged);
  }
  const out: { value: Complex; multiplicity: number }[] = [];
  for (const members of groups) {
    const m = members.length;
    if (m === 1) {
      out.push({ value: clean(members[0]), multiplicity: 1 });
      continue;
    }
    const derivatives: Poly[] = [trim(p)];
    for (let k = 1; k < m; k++) derivatives.push(derivative(derivatives[k - 1]));
    const simple = derivatives[m - 1];
    const slope = derivative(simple);
    let z = c(
      members.reduce((sum, w) => sum + w.re, 0) / m,
      members.reduce((sum, w) => sum + w.im, 0) / m,
    );
    for (let i = 0; i < 20 && slope.length; i++) {
      const step = cDiv(evaluate(simple, z), evaluate(slope, z));
      if (!Number.isFinite(step.re) || !Number.isFinite(step.im)) break;
      z = cSub(z, step);
      if (magnitude(step) <= 1e-16 * Math.max(1, magnitude(z))) break;
    }
    if (derivatives.every((d) => vanishesAt(d, z, 1e-10))) {
      out.push({ value: clean(z), multiplicity: m });
    } else {
      for (const w of members) out.push({ value: clean(w), multiplicity: 1 });
    }
  }
  return out;
}

/**
 * Whether `p` vanishes at `z`, relative to the size of its terms there (so a
 * polynomial with large coefficients isn't judged by an absolute epsilon).
 */
export function vanishesAt(p: Poly, z: Complex, tolerance = 1e-7): boolean {
  if (!p.length) return true;
  const size = Math.max(1, magnitude(z));
  let terms = 0;
  for (let i = 0; i < p.length; i++) terms += Math.abs(p[i]) * size ** i;
  return magnitude(evaluate(p, z)) <= tolerance * Math.max(terms, Number.MIN_VALUE);
}

/**
 * The fraction p/q (q ≤ `maxDenominator`) within 1e-9 of `x`, by continued
 * fractions, or null. Only a candidate: engine.ts verifies it exactly.
 */
export function nearbyFraction(x: number, maxDenominator = 1000): [number, number] | null {
  if (!Number.isFinite(x)) return null;
  const sign = x < 0 ? -1 : 1;
  let value = Math.abs(x);
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  for (let i = 0; i < 32; i++) {
    const a = Math.floor(value);
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
    if (k1 > maxDenominator) return null;
    if (Math.abs(sign * (h1 / k1) - x) <= 1e-9 * Math.max(1, Math.abs(x))) return [sign * h1, k1];
    const rest = value - a;
    if (rest < 1e-15) break;
    value = 1 / rest;
  }
  return null;
}
