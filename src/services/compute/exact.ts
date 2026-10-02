// Exact rational numbers and polynomials with rational coefficients, for
// worked steps (steps.ts). The solver's own polynomials (polynomial.ts) are
// floating point, which finds roots well but can't print "subtract 1/3 from
// both sides". These are exact by construction: BigInt numerators and
// denominators, so a step never shows a rounded coefficient.

/** A fraction in lowest terms, with a positive denominator. */
export interface Q {
  n: bigint;
  d: bigint;
}

/** Coefficients, lowest degree first, as in polynomial.ts. */
export type QPoly = Q[];

/** Numbers past this many digits make steps unreadable; they're refused. */
const STEP_DIGITS = 40;
let maxDigits = STEP_DIGITS;

export class TooLarge extends Error {}

/** Runs `fn` with a different digit limit: a value (not a step) may be long. */
export function withDigitLimit<T>(digits: number, fn: () => T): T {
  const before = maxDigits;
  maxDigits = digits;
  try {
    return fn();
  } finally {
    maxDigits = before;
  }
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

export function q(n: bigint | number, d: bigint | number = 1n): Q {
  let num = BigInt(n);
  let den = BigInt(d);
  if (den === 0n) throw new RangeError("division by zero");
  if (den < 0n) [num, den] = [-num, -den];
  const g = gcd(num, den) || 1n;
  num /= g;
  den /= g;
  if (num.toString().length > maxDigits || den.toString().length > maxDigits) {
    throw new TooLarge();
  }
  return { n: num, d: den };
}

export const ZERO = q(0);
export const ONE = q(1);

export const qAdd = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
export const qSub = (a: Q, b: Q) => q(a.n * b.d - b.n * a.d, a.d * b.d);
export const qMul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
export const qDiv = (a: Q, b: Q) => q(a.n * b.d, a.d * b.n);
export const qNeg = (a: Q) => q(-a.n, a.d);
export const qEq = (a: Q, b: Q) => a.n === b.n && a.d === b.d;
export const isZero = (a: Q) => a.n === 0n;
export const isInteger = (a: Q) => a.d === 1n;
export const qValue = (a: Q) => Number(a.n) / Number(a.d);

/** a^k for an integer k. */
export function qPow(a: Q, k: number): Q {
  if (Math.abs(k) > 64) throw new TooLarge();
  let out = ONE;
  for (let i = 0; i < Math.abs(k); i++) out = qMul(out, a);
  return k < 0 ? qDiv(ONE, out) : out;
}

/** A decimal or integer literal, exactly: "0.25" → 1/4. */
export function qParse(text: string): Q | null {
  const match = /^(-?)(\d*)(?:\.(\d*))?(?:e([-+]?\d+))?$/i.exec(text.trim());
  if (!match || (!match[2] && !match[3])) return null;
  const [, sign, whole, fraction = "", exponent = "0"] = match;
  const e = Number(exponent);
  if (Math.abs(e) > maxDigits) throw new TooLarge();
  let n = BigInt(`${sign}${whole || "0"}${fraction}`);
  let d = 10n ** BigInt(fraction.length);
  if (e > 0) n *= 10n ** BigInt(e);
  else d *= 10n ** BigInt(-e);
  return q(n, d);
}

/** Integer square root of a perfect square, or null. */
export function exactSqrt(n: bigint): bigint | null {
  if (n < 0n) return null;
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  // Number's square root is only approximate for big n: settle by Newton.
  while (x * x > n) x = (x + n / x) / 2n;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x * x === n ? x : null;
}

/** n = k²·m with m square-free (as far as trial division up to 10⁴ finds). */
export function splitSquare(n: bigint): { outside: bigint; inside: bigint } {
  let outside = 1n;
  let inside = n;
  for (let p = 2n; p * p <= inside && p <= 10_000n; p++) {
    while (inside % (p * p) === 0n) {
      inside /= p * p;
      outside *= p;
    }
  }
  return { outside, inside };
}

// ---- polynomials ---------------------------------------------------------------------

function trim(p: QPoly): QPoly {
  let end = p.length;
  while (end > 0 && isZero(p[end - 1])) end--;
  return end === p.length ? p : p.slice(0, end);
}

export const pDegree = (p: QPoly) => trim(p).length - 1;

export function pAdd(a: QPoly, b: QPoly): QPoly {
  const out: QPoly = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    out.push(qAdd(a[i] ?? ZERO, b[i] ?? ZERO));
  }
  return trim(out);
}

export const pScale = (a: QPoly, k: Q) => trim(a.map((c) => qMul(c, k)));
export const pSub = (a: QPoly, b: QPoly) => pAdd(a, pScale(b, q(-1)));

export function pMul(a: QPoly, b: QPoly): QPoly {
  if (!a.length || !b.length) return [];
  const out: QPoly = Array.from({ length: a.length + b.length - 1 }, () => ZERO);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j] = qAdd(out[i + j], qMul(a[i], b[j]));
  }
  if (out.length > 41) throw new TooLarge();
  return trim(out);
}

export function pEval(p: QPoly, x: Q): Q {
  let out = ZERO;
  for (let i = p.length - 1; i >= 0; i--) out = qAdd(qMul(out, x), p[i]);
  return out;
}

/** p / (x − r) when r is a root: the quotient, by synthetic division. */
export function deflate(p: QPoly, r: Q): QPoly {
  const n = p.length - 1;
  const out: QPoly = new Array(n);
  let carry = ZERO;
  for (let i = n; i >= 1; i--) {
    carry = qAdd(qMul(carry, r), p[i]);
    out[i - 1] = carry;
  }
  return trim(out);
}

/** a = quotient·b + remainder, with deg remainder < deg b. */
export function pDivMod(a: QPoly, b: QPoly): { quotient: QPoly; remainder: QPoly } {
  const divisor = trim(b);
  if (!divisor.length) throw new RangeError("division by zero");
  let remainder = trim(a);
  const quotient: QPoly = Array.from(
    { length: Math.max(remainder.length - divisor.length + 1, 0) },
    () => ZERO,
  );
  const lead = divisor[divisor.length - 1];
  while (remainder.length >= divisor.length) {
    const shift = remainder.length - divisor.length;
    const factor = qDiv(remainder[remainder.length - 1], lead);
    quotient[shift] = factor;
    const next = remainder.slice();
    for (let i = 0; i < divisor.length; i++) {
      next[shift + i] = qSub(next[shift + i], qMul(factor, divisor[i]));
    }
    next.pop(); // The leading term cancels exactly.
    remainder = trim(next);
  }
  return { quotient: trim(quotient), remainder };
}

/** The monic greatest common divisor (1 for coprime polynomials). */
export function pGcd(a: QPoly, b: QPoly): QPoly {
  let x = trim(a);
  let y = trim(b);
  while (y.length) [x, y] = [y, pDivMod(x, y).remainder];
  if (!x.length) return [ONE];
  return pScale(x, qDiv(ONE, x[x.length - 1]));
}

/** p scaled to integer coefficients with no common factor and a positive leading one. */
export function primitive(p: QPoly): QPoly {
  const poly = trim(p);
  if (!poly.length) return poly;
  let scaled = pScale(poly, q(commonDenominator(poly)));
  const content = contentOf(scaled);
  if (content > 1n) scaled = pScale(scaled, q(1n, content));
  return scaled[scaled.length - 1].n < 0n ? pScale(scaled, q(-1)) : scaled;
}

/** The least common multiple of the coefficients' denominators. */
export function commonDenominator(p: QPoly): bigint {
  return p.reduce((l, c) => (l * c.d) / gcd(l, c.d), 1n);
}

/** The greatest common divisor of integer coefficients' numerators. */
export function contentOf(p: QPoly): bigint {
  return p.reduce((g, c) => gcd(g, c.n), 0n);
}

/**
 * Rational roots by the rational root theorem: ±p/q, p dividing the constant
 * term and q the leading coefficient (after clearing denominators). Bounded:
 * coefficients with too many divisors to try return what was found so far.
 */
export function rationalRoots(p: QPoly): Q[] {
  let poly = trim(p);
  const found: Q[] = [];
  while (poly.length > 1 && isZero(poly[0])) {
    found.push(ZERO);
    poly = poly.slice(1);
  }
  if (poly.length < 2) return found;
  const scale = commonDenominator(poly);
  const ints = poly.map((c) => (c.n * scale) / c.d);
  const constant = ints[0] < 0n ? -ints[0] : ints[0];
  const lead = ints[ints.length - 1] < 0n ? -ints[ints.length - 1] : ints[ints.length - 1];
  if (constant > 10n ** 12n || lead > 10n ** 12n) return found;
  const ps = divisors(constant);
  const qs = divisors(lead);
  if (ps.length * qs.length > 4000) return found;
  for (const a of ps) {
    for (const b of qs) {
      for (const sign of [1n, -1n]) {
        const r = q(sign * a, b);
        if (found.some((f) => qEq(f, r))) continue;
        // A root may be repeated: divide it out as often as it divides.
        while (poly.length > 1 && isZero(pEval(poly, r))) {
          found.push(r);
          poly = deflate(poly, r);
        }
      }
    }
  }
  return found;
}

function divisors(n: bigint): bigint[] {
  const out: bigint[] = [];
  for (let i = 1n; i * i <= n; i++) {
    if (n % i === 0n) {
      out.push(i);
      if (i * i !== n) out.push(n / i);
    }
    if (i > 1_000_000n) break;
  }
  return out;
}

// ---- LaTeX -----------------------------------------------------------------------------

export function qLatex(a: Q): string {
  if (a.d === 1n) return a.n.toString();
  const sign = a.n < 0n ? "-" : "";
  return `${sign}\\frac{${(a.n < 0n ? -a.n : a.n).toString()}}{${a.d.toString()}}`;
}

/** A coefficient before a power of x: "", "-", "3", "\frac{1}{2}". */
function coefficientLatex(c: Q): string {
  if (qEq(c, ONE)) return "";
  if (qEq(c, q(-1))) return "-";
  return qLatex(c);
}

/** The linear factor (b·x − a) for the root a/b: "x", "x - 3", "2x + 1". */
export function factorLatex(root: Q, symbol: string): string {
  if (isZero(root)) return symbol;
  const lead = root.d === 1n ? "" : root.d.toString();
  return `${lead}${symbol} ${root.n > 0n ? "-" : "+"} ${(root.n < 0n ? -root.n : root.n).toString()}`;
}

/**
 * p as a product of linear factors with integer coefficients when it splits
 * over the rationals, 2(x - 1)(3x + 2); otherwise expanded.
 */
export function pFactoredLatex(p: QPoly, symbol: string): string {
  const poly = trim(p);
  const degree = poly.length - 1;
  if (degree < 1) return pLatex(poly, symbol);
  const found = rationalRoots(poly);
  if (found.length !== degree) return pLatex(poly, symbol);
  if (degree === 1 && qEq(poly[1], ONE)) return pLatex(poly, symbol);
  let lead = poly[degree];
  const groups: { root: Q; count: number }[] = [];
  for (const root of found) {
    const group = groups.find((g) => qEq(g.root, root));
    if (group) group.count++;
    else groups.push({ root, count: 1 });
    lead = qDiv(lead, q(root.d));
  }
  const factors = groups.map(({ root, count }) => {
    const factor = factorLatex(root, symbol);
    const wrapped = isZero(root) ? factor : `\\left(${factor}\\right)`;
    return count > 1 ? `${wrapped}^{${count}}` : wrapped;
  });
  return `${coefficientLatex(lead)}${factors.join("")}`;
}

/** p as LaTeX in `symbol`, highest power first: 2x^{2}-\frac{1}{3}x+5. */
export function pLatex(p: QPoly, symbol: string): string {
  const poly = trim(p);
  if (!poly.length) return "0";
  let out = "";
  for (let i = poly.length - 1; i >= 0; i--) {
    const c = poly[i];
    if (isZero(c)) continue;
    const power = i === 0 ? "" : i === 1 ? symbol : `${symbol}^{${i}}`;
    let term = i === 0 ? qLatex(c) : `${coefficientLatex(c)}${power}`;
    if (out) {
      if (term.startsWith("-")) term = ` - ${term.slice(1)}`;
      else term = ` + ${term}`;
    }
    out += term;
  }
  return out;
}
