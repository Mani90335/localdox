// Worked steps for Evaluate on exact arithmetic: 10 − 2·(3 + 1)², ½ + ⅓.
// The order of operations, one level per step: brackets, then powers and
// roots, then multiplication and division, then addition and subtraction,
// left to right. Fraction work (a common denominator, a reciprocal, a
// reduction) is shown under the step that does it.
//
// Reads the input as written (the engine's "raw" MathJSON), since its
// canonical form already folds 2 + 3 into 5. Exact by construction (exact.ts).
// Anything beyond rational arithmetic (π, √2, sin, unknowns) returns null, as
// does a single trivial operation (2 + 3): the answer says it all.

import {
  isInteger,
  isZero,
  ONE,
  q,
  qAdd,
  qDiv,
  qLatex,
  qMul,
  qNeg,
  qParse,
  qSub,
  exactSqrt,
  TooLarge,
  withDigitLimit,
  type Q,
} from "./exact.ts";
import type { Step } from "./protocol.ts";

type Json = unknown;
type Op = "+" | "-" | "*" | "/" | "^" | "neg" | "sqrt";

type Node =
  | { k: "num"; v: Q }
  | { k: "op"; op: Op; args: Node[]; implicit?: boolean }
  | { k: "paren"; arg: Node };

class Unsupported extends Error {}

const MAX_PASSES = 40;

export interface ArithmeticWork {
  steps: Step[];
  value: Q;
}

/**
 * The exact value of an arithmetic expression (raw MathJSON) with integers,
 * fractions and integer powers, up to `digits` digits, or null. Exact by
 * construction, unlike the engine's evaluation of large powers, which keeps
 * about 20 significant digits (2^100 would end in zeros).
 */
export function exactArithmetic(raw: Json, digits: number): Q | null {
  if (hasDecimal(raw)) return null;
  try {
    return withDigitLimit(digits, () => {
      let tree = build(raw);
      for (let pass = 0; tree.k !== "num"; pass++) {
        if (pass > 10_000) return null;
        const ready = new Set(readyOps(tree, false).map((r) => r.node));
        if (!ready.size) return null;
        tree = replace(tree, (node) => {
          if (!ready.has(node)) return null;
          const n = node as Extract<Node, { k: "op" }>;
          const args = n.args.map((a) => (a as Extract<Node, { k: "num" }>).v);
          return { k: "num", v: apply(n.op, args).value };
        });
      }
      return tree.v;
    });
  } catch (error) {
    if (error instanceof Unsupported || error instanceof TooLarge || error instanceof RangeError) {
      return null;
    }
    throw error;
  }
}

/** Steps for an arithmetic expression (raw MathJSON), or null. */
export function arithmeticSteps(raw: Json): ArithmeticWork | null {
  try {
    const decimals = hasDecimal(raw);
    let tree = build(raw);
    const show = (value: Q) => (decimals ? decimalLatex(value) : qLatex(value));
    const steps: Step[] = [];
    for (let pass = 0; tree.k !== "num"; pass++) {
      if (pass > MAX_PASSES) return null;
      const ready = readyOps(tree, false);
      if (!ready.length) return null;
      const rank = Math.min(...ready.map((r) => r.rank));
      const chosen = new Set(ready.filter((r) => r.rank === rank).map((r) => r.node));
      const ops = new Set<Op>();
      const work: Step[] = [];
      tree = replace(tree, (node) => {
        if (!chosen.has(node)) return null;
        const n = node as Extract<Node, { k: "op" }>;
        ops.add(n.op);
        const args = n.args.map((a) => (a as Extract<Node, { k: "num" }>).v);
        const result = apply(n.op, args);
        if (!decimals && result.work) work.push(result.work);
        return { k: "num", v: result.value };
      });
      const latex = print(tree, show);
      steps.push({
        text: passText(rank < 10, ops),
        latex,
        substeps: work.length ? work : undefined,
      });
    }
    const value = (tree as Extract<Node, { k: "num" }>).v;
    if (decimals && decimalLatex(value) === null) return null;
    // One plain operation (2 + 3, 12 ÷ 4) is its own explanation.
    if (steps.length < 2 && !steps.some((s) => s.substeps)) return null;
    return { steps, value };
  } catch (error) {
    if (error instanceof Unsupported || error instanceof TooLarge || error instanceof RangeError) {
      return null;
    }
    throw error;
  }
}

// ---- reading ------------------------------------------------------------------------------

function hasDecimal(json: Json): boolean {
  if (typeof json === "number") return !Number.isInteger(json);
  if (json && typeof json === "object" && "num" in json) {
    return /[.eE]/.test(String((json as { num: string }).num));
  }
  return Array.isArray(json) && json.some(hasDecimal);
}

function literal(json: Json): Q | null {
  if (typeof json === "number") return Number.isFinite(json) ? qParse(String(json)) : null;
  if (json && typeof json === "object" && !Array.isArray(json) && "num" in json) {
    return qParse(String((json as { num: string }).num));
  }
  return null;
}

function build(json: Json): Node {
  const value = literal(json);
  if (value) return { k: "num", v: value };
  if (!Array.isArray(json) || typeof json[0] !== "string") throw new Unsupported();
  const [head, ...args] = json as [string, ...Json[]];
  const parts = () => args.map(build);
  switch (head) {
    case "Delimiter": {
      if (args.length !== 1) throw new Unsupported();
      const inner = build(args[0]);
      return inner.k === "num" ? inner : { k: "paren", arg: inner };
    }
    case "Negate": {
      const inner = build(args[0]);
      return inner.k === "num"
        ? { k: "num", v: qNeg(inner.v) }
        : { k: "op", op: "neg", args: [inner] };
    }
    case "Add":
    case "Subtract":
    case "Multiply":
    case "InvisibleOperator": {
      const op: Op = head === "Add" ? "+" : head === "Subtract" ? "-" : "*";
      const [first, ...rest] = parts();
      if (!rest.length) throw new Unsupported();
      // Left to right: a + b + c is (a + b) + c.
      return rest.reduce<Node>(
        (acc, part) => ({ k: "op", op, args: [acc, part], implicit: head === "InvisibleOperator" }),
        first,
      );
    }
    case "Divide": {
      const [a, b] = parts();
      // ½ written as a fraction in lowest terms is a number, not an operation.
      if (a.k === "num" && b.k === "num" && isInteger(a.v) && isInteger(b.v) && !isZero(b.v)) {
        const v = qDiv(a.v, b.v);
        if (v.d === (b.v.n < 0n ? -b.v.n : b.v.n) && v.d !== 1n) return { k: "num", v };
      }
      return { k: "op", op: "/", args: [a, b] };
    }
    case "Rational": {
      const [a, b] = parts();
      if (a.k !== "num" || b.k !== "num") throw new Unsupported();
      return { k: "num", v: qDiv(a.v, b.v) };
    }
    case "Power":
    case "Square": {
      const [base, exponent] =
        head === "Square" ? [build(args[0]), { k: "num", v: q(2) } as Node] : parts();
      return { k: "op", op: "^", args: [base, exponent] };
    }
    case "Sqrt":
      return { k: "op", op: "sqrt", args: parts() };
    default:
      throw new Unsupported();
  }
}

// ---- evaluating ----------------------------------------------------------------------------

interface Ready {
  node: Node;
  /** Lower goes first: inside brackets (0–9) before outside (10–19). */
  rank: number;
}

const LEVEL: Record<Op, number> = { "^": 1, sqrt: 1, neg: 2, "*": 3, "/": 3, "+": 4, "-": 4 };

function readyOps(node: Node, inParen: boolean): Ready[] {
  if (node.k === "num") return [];
  if (node.k === "paren") return readyOps(node.arg, true);
  if (node.args.every((a) => a.k === "num")) {
    return [{ node, rank: (inParen ? 0 : 10) + LEVEL[node.op] }];
  }
  return node.args.flatMap((a) => readyOps(a, inParen));
}

/** A copy of the tree with nodes replaced, and brackets around a number dropped. */
function replace(node: Node, swap: (node: Node) => Node | null): Node {
  const swapped = swap(node);
  if (swapped) return swapped;
  if (node.k === "num") return node;
  if (node.k === "paren") {
    const inner = replace(node.arg, swap);
    return inner.k === "num" ? inner : { k: "paren", arg: inner };
  }
  return { ...node, args: node.args.map((a) => replace(a, swap)) };
}

function apply(op: Op, [a, b]: Q[]): { value: Q; work?: Step } {
  const fractions = a.d !== 1n || (b !== undefined && b.d !== 1n);
  switch (op) {
    case "+":
    case "-": {
      const value = op === "+" ? qAdd(a, b) : qSub(a, b);
      if (!fractions) return { value };
      const sign = op === "+" ? "+" : "-";
      const common = (a.d * b.d) / gcd(a.d, b.d);
      const over = (x: Q) => {
        const n = x.n * (common / x.d);
        return n < 0n ? `-\\frac{${-n}}{${common}}` : `\\frac{${n}}{${common}}`;
      };
      const first = `${qLatex(a)} ${sign} ${wrapNegative(b)}`;
      if (a.d === b.d)
        return {
          value,
          work: {
            text: "Same denominator: combine the numerators.",
            latex: `${first} = ${qLatex(value)}`,
          },
        };
      return {
        value,
        work: {
          text: `Write both over the common denominator $${common}$.`,
          latex: `${first} = ${over(a)} ${sign} ${b.n < 0n ? `\\left(${over(b)}\\right)` : over(b)} = ${qLatex(value)}`,
        },
      };
    }
    case "*": {
      const value = qMul(a, b);
      if (!fractions) return { value };
      return {
        value,
        work: {
          text: "Multiply the numerators, and the denominators.",
          latex: `${qLatex(a)} \\times ${wrapNegative(b)} = \\frac{${a.n} \\times ${paren(b.n)}}{${a.d} \\times ${b.d}} = ${qLatex(value)}`,
        },
      };
    }
    case "/": {
      if (isZero(b)) throw new RangeError("division by zero");
      const value = qDiv(a, b);
      if (b.d !== 1n || a.d !== 1n) {
        const reciprocal = qDiv(ONE, b);
        return {
          value,
          work: {
            text: "Dividing by a number is multiplying by its reciprocal.",
            latex: `${qLatex(a)} \\div ${wrapNegative(b)} = ${qLatex(a)} \\times ${wrapNegative(reciprocal)} = ${qLatex(value)}`,
          },
        };
      }
      const g = gcd(a.n, b.n);
      if (value.d !== 1n && g > 1n) {
        return {
          value,
          work: {
            text: `Simplify the fraction: divide the top and the bottom by $${g}$.`,
            latex: `\\frac{${a.n}}{${b.n}} = ${qLatex(value)}`,
          },
        };
      }
      return { value };
    }
    case "^": {
      // The digit limit stops a huge power long before this many multiplications.
      if (!isInteger(b) || b.n > 100_000n || b.n < -100_000n) throw new Unsupported();
      const k = Number(b.n);
      if (k === 0 && isZero(a)) throw new Unsupported();
      let power = ONE;
      for (let i = 0; i < Math.abs(k); i++) power = qMul(power, a);
      const value = k < 0 ? qDiv(ONE, power) : power;
      if (k < 0) {
        return {
          value,
          work: {
            text: "A negative power is the reciprocal of the positive power.",
            latex: `${powerBase(a)}^{${k}} = \\frac{1}{${powerBase(a)}^{${-k}}} = ${qLatex(value)}`,
          },
        };
      }
      if (a.d !== 1n) {
        return {
          value,
          work: {
            text: "Raise the numerator and the denominator to the power.",
            latex: `${powerBase(a)}^{${k}} = \\frac{${paren(a.n)}^{${k}}}{${a.d}^{${k}}} = ${qLatex(value)}`,
          },
        };
      }
      return { value };
    }
    case "sqrt": {
      if (a.n < 0n) throw new Unsupported();
      const top = exactSqrt(a.n);
      const bottom = exactSqrt(a.d);
      if (top === null || bottom === null) throw new Unsupported();
      return { value: q(top, bottom) };
    }
    case "neg":
      return { value: qNeg(a) };
  }
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

const paren = (n: bigint) => (n < 0n ? `\\left(${n}\\right)` : `${n}`);
const wrapNegative = (v: Q) => (v.n < 0n ? `\\left(${qLatex(v)}\\right)` : qLatex(v));
const powerBase = (v: Q) => (v.n < 0n || v.d !== 1n ? `\\left(${qLatex(v)}\\right)` : qLatex(v));

function passText(inBrackets: boolean, ops: Set<Op>): string {
  if (inBrackets) return "Work out the brackets first.";
  const has = (...list: Op[]) => list.some((op) => ops.has(op));
  if (has("^", "sqrt")) {
    return has("sqrt") && !has("^")
      ? "Work out the roots."
      : has("sqrt")
        ? "Work out powers and roots."
        : "Work out the powers.";
  }
  if (has("neg")) return "Apply the minus sign.";
  if (has("*", "/")) {
    if (!has("/")) return "Multiply.";
    if (!has("*")) return "Divide.";
    return "Multiply and divide, left to right.";
  }
  if (!has("-")) return "Add.";
  if (!has("+")) return "Subtract.";
  return "Add and subtract, left to right.";
}

// ---- printing ------------------------------------------------------------------------------

/** Exact decimal LaTeX for a terminating fraction, or null. */
function decimalLatex(v: Q): string | null {
  let d = v.d;
  let twos = 0;
  let fives = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    twos++;
  }
  while (d % 5n === 0n) {
    d /= 5n;
    fives++;
  }
  if (d !== 1n) return null;
  const places = Math.max(twos, fives);
  const scaled = (v.n * 10n ** BigInt(places)) / v.d;
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places);
  const fraction = places ? `.${digits.slice(digits.length - places)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** Binding strength, for brackets: higher binds tighter. */
function strength(node: Node): number {
  if (node.k === "paren") return 9;
  if (node.k === "num") return node.v.n < 0n ? 2 : node.v.d !== 1n ? 5 : 9;
  return { "+": 1, "-": 1, neg: 2, "*": 3, "/": 5, "^": 6, sqrt: 9 }[node.op];
}

function print(node: Node, show: (v: Q) => string | null): string {
  const text = (n: Node): string => {
    if (n.k === "num") {
      const shown = show(n.v);
      if (shown === null) throw new Unsupported();
      return shown;
    }
    if (n.k === "paren") return `\\left(${text(n.arg)}\\right)`;
    const [a, b] = n.args;
    const wrap = (child: Node, min: number) =>
      strength(child) < min ? `\\left(${text(child)}\\right)` : text(child);
    switch (n.op) {
      case "+":
        return `${wrap(a, 1)} + ${wrap(b, 3)}`;
      case "-":
        return `${wrap(a, 1)} - ${wrap(b, 3)}`;
      case "*":
        return n.implicit && b.k === "paren"
          ? `${wrap(a, 3)}${text(b)}`
          : `${wrap(a, 3)} \\times ${wrap(b, 4)}`;
      case "/": {
        // A fraction of fractions reads better as a division.
        const nested = [a, b].some(
          (c) => (c.k === "num" && c.v.d !== 1n) || (c.k === "op" && c.op === "/"),
        );
        return nested ? `${wrap(a, 3)} \\div ${wrap(b, 4)}` : `\\frac{${text(a)}}{${text(b)}}`;
      }
      case "^":
        return `${wrap(a, 9)}^{${text(b)}}`;
      case "neg":
        // −3² is −(3²): once the power is worked out, −(9) shows the sign still to apply.
        return a.k === "num" ? `-\\left(${text(a)}\\right)` : `-${wrap(a, 3)}`;
      case "sqrt":
        return `\\sqrt{${text(a)}}`;
    }
  };
  return text(node);
}
