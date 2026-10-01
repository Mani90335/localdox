// LaTeX (or advanced plain text) → the MathJSON the Python bridge accepts.
//
// The Compute Engine's LaTeX parser does the reading: its standalone
// `latex-syntax` entry (62 KB gzip, not the whole engine), which keeps the
// input's structure as written (the engine's canonical form would already
// have evaluated or reordered it). Numbers arrive as {num: "…"}, strings as
// {str: "…"}. Three things happen around it:
//
// 1. preprocessLatex rewrites notation the parser doesn't know: \binom,
//    d²/dx², partial derivatives, dy/dx, one-sided limits (a^+), \nabla.
// 2. The parser runs; any Error node is a syntax failure, never guessed past.
// 3. normalize resolves what raw MathJSON leaves open, chiefly juxtaposition
//    ("InvisibleOperator"): Var(X) and Γ(5) are function calls, x(x+1) is a
//    product, y(0) is a call when y is a function (a prime, a dy/dx, a
//    `let y(x) = …`). The result uses only heads bridge.py has handlers for.

import type { ComputeFailureKind } from "../protocol.ts";

export type Json = unknown;

export class NormalizeError extends Error {
  readonly kind: ComputeFailureKind;
  readonly hint?: string;
  constructor(kind: ComputeFailureKind, message: string, hint?: string) {
    super(message);
    this.kind = kind;
    this.hint = hint;
  }
}

/** What preprocessing learnt about the input. */
export interface Context {
  /** Names used as functions: y in y'' + y = 0, f in let f(x) = …. */
  functions: Set<string>;
  /** The variable a derivative like dy/dx is taken in. */
  independent?: string;
  /** One-sided limit directions, in the order the limits appear. */
  directions: string[];
}

export function newContext(): Context {
  return { functions: new Set(), directions: [] };
}

// ---- 1. LaTeX rewrites ------------------------------------------------------------------

/** The `{…}` group starting at `open` (an index of "{"), and the index after it. */
function braceGroup(text: string, open: number): [string, number] | null {
  if (text[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return [text.slice(open + 1, i), i + 1];
  }
  return null;
}

const D = String.raw`(?:\\mathrm\{d\}|\\operatorname\{d\}|d|\\partial)`;
const VARIABLE = String.raw`([A-Za-z](?:_\{?\w+\}?)?|\\[a-zA-Z]+)`;
const POWER = String.raw`(?:\^\{?(\d+)\}?)?`;

/**
 * d/dx, d²/dx², ∂²/∂x∂y, dy/dx, d²y/dx² as \frac: rewritten as repeated
 * \frac{d}{dx} (which the parser knows), or as primes (y'') for an unknown
 * function in a differential equation. Anything else is left as a fraction.
 */
function rewriteDerivative(
  numerator: string,
  denominator: string,
  context: Context,
): string | null {
  const top = new RegExp(String.raw`^\s*(${D})\s*${POWER}\s*(.*)$`).exec(numerator);
  if (!top) return null;
  const partial = top[1] === "\\partial";
  const body = top[3].trim();
  const parts = [
    ...denominator.matchAll(new RegExp(String.raw`\s*${D}\s*${VARIABLE}\s*${POWER}`, "g")),
  ];
  if (
    !parts.length ||
    parts
      .map((p) => p[0])
      .join("")
      .trim() !== denominator.trim()
  )
    return null;
  const variables = parts.flatMap((p) => Array<string>(Number(p[2] ?? 1)).fill(p[1]));
  const order = Number(top[2] ?? 1);
  if (variables.length !== order || order > 20) return null;
  // d²y/dx²: y is an unknown function of x (a differential equation).
  if (!partial && /^[A-Za-z]$/.test(body) && new Set(variables).size === 1) {
    context.functions.add(body);
    context.independent = variables[0].replace(/^\\/, "");
    return `${body}${"'".repeat(order)}`;
  }
  const operators = variables.map((v) => `\\frac{d}{d${v}}`).join("");
  return body ? `${operators}\\left(${body}\\right)` : operators;
}

export function preprocessLatex(latex: string, context: Context): string {
  let out = "";
  let i = 0;
  while (i < latex.length) {
    const rest = latex.slice(i);
    // \binom{n}{k} → binomial(n, k)
    const binom = /^\\[dt]?binom\s*/.exec(rest);
    if (binom) {
      const first = braceGroup(latex, i + binom[0].length);
      const second = first && braceGroup(latex, first[1]);
      if (first && second) {
        out += `\\operatorname{binomial}\\left(${preprocessLatex(first[0], context)},${preprocessLatex(second[0], context)}\\right)`;
        i = second[1];
        continue;
      }
    }
    const frac = /^\\[dt]?frac\s*/.exec(rest);
    if (frac) {
      const numerator = braceGroup(latex, i + frac[0].length);
      const denominator = numerator && braceGroup(latex, numerator[1]);
      if (numerator && denominator) {
        const derivative = rewriteDerivative(numerator[0], denominator[0], context);
        if (derivative !== null) {
          out += derivative;
          i = denominator[1];
          continue;
        }
      }
    }
    // \lim_{x \to a^+} → \lim_{x\to a}, remembering the side.
    const lim = /^\\lim\s*_\s*/.exec(rest);
    if (lim) {
      const sub = braceGroup(latex, i + lim[0].length);
      if (sub) {
        const side = /^(.*?)\s*\^\s*\{?\s*([+-])\s*\}?\s*$/.exec(sub[0]);
        context.directions.push(side ? side[2] : "+-");
        out += `\\lim_{${side ? side[1] : sub[0]}}`;
        i = sub[1];
        continue;
      }
    }
    const word =
      /^\\(nabla|mathbb\{E\}|mathbb\{P\}|Pr|operatorname\{E\}|operatorname\{P\})(?![a-zA-Z])/.exec(
        rest,
      );
    if (word) {
      out += word[1] === "nabla" ? "\\operatorname{grad}" : /E/.test(word[1]) ? "E" : "P";
      i += word[0].length;
      continue;
    }
    out += latex[i];
    i++;
  }
  return out;
}

// ---- 3. raw MathJSON → bridge heads ---------------------------------------------------------

/** Function names as written (lowercase) → the bridge's heads. */
const FUNCTIONS: Readonly<Record<string, string>> = {
  binomial: "Binomial",
  binom: "Binomial",
  choose: "Binomial",
  ncr: "Binomial",
  beta: "Beta",
  erf: "Erf",
  erfc: "Erfc",
  var: "Var",
  variance: "Var",
  cov: "Cov",
  covariance: "Cov",
  corr: "Corr",
  correlation: "Corr",
  sd: "Std",
  std: "Std",
  stdev: "Std",
  pdf: "PDF",
  density: "PDF",
  cdf: "CDF",
  mgf: "MGF",
  median: "Median",
  mean: "Mean",
  avg: "Mean",
  skewness: "Skewness",
  skew: "Skewness",
  kurtosis: "Kurtosis",
  entropy: "Entropy",
  det: "Determinant",
  inv: "Inverse",
  inverse: "Inverse",
  tr: "Trace",
  trace: "Trace",
  transpose: "Transpose",
  grad: "Gradient",
  gradient: "Gradient",
  re: "Real",
  im: "Imaginary",
  conj: "Conjugate",
  arg: "Arg",
  floor: "Floor",
  ceil: "Ceil",
  sign: "Sign",
  sgn: "Sign",
  max: "Max",
  min: "Min",
  gcd: "GCD",
  lcm: "LCM",
  mod: "Mod",
  diff: "diff",
  derivative: "diff",
  integrate: "integrate",
  int: "integrate",
  limit: "limit",
  lim: "limit",
  sum: "sum",
  product: "product",
  prod: "product",
};

/** Heads the parser produces that the bridge takes as they are. */
const PASS = new Set([
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
  "Factorial2",
  "Exp",
  "Ln",
  "Log",
  "Lb",
  "Lg",
  "Sin",
  "Cos",
  "Tan",
  "Sec",
  "Csc",
  "Cot",
  "Arcsin",
  "Arccos",
  "Arctan",
  "Arcsec",
  "Arccsc",
  "Arccot",
  "Sinh",
  "Cosh",
  "Tanh",
  "Sech",
  "Csch",
  "Coth",
  "Arsinh",
  "Arcosh",
  "Artanh",
  "Floor",
  "Ceil",
  "Sign",
  "Real",
  "Imaginary",
  "Arg",
  "Max",
  "Min",
  "GCD",
  "LCM",
  "Mod",
  "Gamma",
  "Erf",
  "Erfc",
  "Zeta",
  "Binomial",
  "Beta",
  "Equal",
  "NotEqual",
  "Less",
  "LessEqual",
  "Greater",
  "GreaterEqual",
  "List",
  "Determinant",
  "Inverse",
  "Transpose",
  "Trace",
  "D",
  "Prime",
  "P",
  "E",
]);

/** Heads with a better name for the "not supported" message. */
const UNSUPPORTED: Readonly<Record<string, string>> = {
  Element: "Set membership (∈)",
  Interval: "Intervals",
  Set: "Sets",
  And: "Logical operators",
  Or: "Logical operators",
  Not: "Logical operators",
  Union: "Set operations",
  Intersection: "Set operations",
  When: "This notation",
  OverVector: "Vector arrows",
};

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

function isArray(node: Json): node is Json[] {
  return Array.isArray(node);
}

/** The bridge's name for a parser symbol: decorations dropped, "E_doublestruck" → "E". */
function symbolName(name: string): string {
  const base = name.replace(/_(?:bold|calligraphic|doublestruck|blackboard|upright|italic)$/, "");
  if (!NAME.test(base))
    throw new NormalizeError("syntax", `“${name}” isn't a name the engine accepts.`);
  return base;
}

/**
 * The head a name takes when it meets "(…)": a user function, or a known one.
 * Case matters for one-letter names: E and P are expectation and probability,
 * but e(x+1) is e·(x+1); Γ (\Gamma) is the gamma function, γ a variable.
 */
function functionHead(name: unknown, context: Context): string | null {
  if (typeof name !== "string") return null;
  const base = name.replace(/_(?:doublestruck|calligraphic|bold)$/, "");
  if (context.functions.has(base)) return `Apply:${base}`;
  if (base === "E") return "E";
  if (base === "P" || base === "Pr") return "P";
  if (base === "Gamma") return "Gamma";
  return FUNCTIONS[base.toLowerCase()] ?? null;
}

/** The arguments inside a ["Delimiter", …] (a parenthesised group). */
function delimited(node: Json): Json[] | null {
  if (!isArray(node) || node[0] !== "Delimiter") return null;
  const inner = node[1];
  if (inner === undefined) return [];
  if (isArray(inner) && inner[0] === "Sequence") return inner.slice(1);
  return [inner];
}

/** A parser string: {str: "…"}, or '…' in the engine's own raw form. */
function text(value: unknown): string {
  if (typeof value === "string") return value.replace(/^'|'$/g, "");
  if (value && typeof value === "object" && typeof (value as { str?: unknown }).str === "string") {
    return (value as { str: string }).str;
  }
  return "";
}

function errorOf(node: Json): { code: string; near?: string } | null {
  if (!isArray(node)) return null;
  if (node[0] === "Error") {
    const strip = text;
    const near = isArray(node[2]) && node[2][0] === "LatexString" ? strip(node[2][1]) : "";
    return { code: strip(node[1]), near: near || undefined };
  }
  for (const part of node.slice(1)) {
    const found = errorOf(part);
    if (found) return found;
  }
  return null;
}

/** Throws the parser's first error as a syntax failure. */
export function assertParsed(json: Json): void {
  const error = errorOf(json);
  if (!error) return;
  const near = error.near ? ` near “${error.near}”` : "";
  const messages: Record<string, string> = {
    "unexpected-command": `The engine doesn't know the command${near}.`,
    "expected-closing-delimiter": "A bracket or brace isn't closed.",
    "unexpected-delimiter": `Unexpected bracket${near}. For a condition in P(…), write \\mid or “given”.`,
    missing: "Something is missing, for example after “^” or “_”.",
  };
  throw new NormalizeError(
    "syntax",
    messages[error.code] ?? `The engine couldn't read this${near}.`,
    "Check the input, or build it with the math keyboard.",
  );
}

/** Collects names used with a prime (y'), before normalizing. */
export function collectFunctions(json: Json, context: Context): void {
  if (!isArray(json)) return;
  if (json[0] === "Prime" && typeof json[1] === "string")
    context.functions.add(symbolName(json[1]));
  // y'(0) reads as ["D", ["y", 0], "x"]: a head that is a plain name is a function.
  if (typeof json[0] === "string" && /^[a-z]$/.test(json[0])) context.functions.add(json[0]);
  json.forEach((part) => collectFunctions(part, context));
}

export function normalize(node: Json, context: Context): Json {
  if (typeof node === "number") return node;
  if (typeof node === "string") {
    if (node === "Nothing") return node;
    return symbolName(node);
  }
  if (node && typeof node === "object" && !isArray(node)) {
    const num = (node as { num?: unknown }).num;
    if (typeof num === "string") return ["Number", num];
    throw new NormalizeError("syntax", "The engine couldn't read part of this.");
  }
  if (!isArray(node) || !node.length) {
    throw new NormalizeError("syntax", "The engine couldn't read part of this.");
  }
  const [head, ...args] = node;
  const all = () => args.map((a) => normalize(a, context));

  if (typeof head !== "string")
    throw new NormalizeError("unsupported", "Functions applied to expressions aren't supported.");
  switch (head) {
    case "Delimiter": {
      const items = delimited(node) ?? [];
      if (!items.length) throw new NormalizeError("syntax", "There's an empty “()”.");
      return items.length === 1
        ? normalize(items[0], context)
        : ["Tuple", ...items.map((i) => normalize(i, context))];
    }
    case "Sequence":
      return ["List", ...all()];
    case "InvisibleOperator":
      return juxtaposition(args, context);
    case "At": {
      if (functionHead(args[0], context) === "E") return ["E", normalize(args[1], context)];
      throw new NormalizeError("unsupported", "Indexing with […] isn't supported yet.");
    }
    case "Divides":
      // P(A \mid B): a condition.
      return ["Given", ...all()];
    case "Superstar":
    case "OverBar":
      return ["Conjugate", ...all()];
    case "Abs": {
      const inner = args[0];
      if (isArray(inner) && inner[0] === "Matrix")
        return ["Determinant", normalize(inner, context)];
      return ["Abs", ...all()];
    }
    case "Matrix": {
      const rows = isArray(args[0]) && args[0][0] === "List" ? args[0].slice(1) : [];
      return ["Matrix", ...rows.map((row) => normalize(row, context))];
    }
    case "Integrate":
      return integrate(args, context);
    case "Sum":
    case "Product":
      return [head, normalize(args[0], context), limits(args[1], context)];
    case "Limit": {
      const fn = args[0];
      const direction = context.directions.shift() ?? "+-";
      if (isArray(fn) && fn[0] === "Function") {
        return [
          "Limit",
          normalize(fn[1], context),
          symbolName(String(fn[2])),
          normalize(args[1], context),
          direction,
        ];
      }
      throw new NormalizeError("syntax", "Write a limit as \\lim_{x \\to a} f(x).");
    }
    case "PseudoInverse":
      throw new NormalizeError("syntax", "Write a one-sided limit as \\lim_{x \\to 0^+}.");
  }
  if (head === "Prime") return ["Prime", normalize(args[0], context), ...args.slice(1)];
  if (PASS.has(head)) return [head, ...all()];
  if (context.functions.has(head)) return ["Apply", head, ...all()];
  const named = functionHead(head, context);
  if (named)
    return call(
      named,
      args.map((a) => normalize(a, context)),
      context,
    );
  throw new NormalizeError(
    "unsupported",
    `${UNSUPPORTED[head] ?? `“${head}”`} isn't supported yet.`,
  );
}

/** f(x), Var(X), Γ(5) next to each other: calls where a function meets "(…)", else a product. */
function juxtaposition(items: Json[], context: Context): Json {
  const factors: Json[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const next = items[i + 1];
    const named = functionHead(item, context);
    const args = next !== undefined ? delimited(next) : null;
    // β(a, b) is the beta function; β(x + 1) a product.
    if (named && args && !(named === "Beta" && args.length !== 2)) {
      factors.push(
        call(
          named,
          args.map((a) => normalize(a, context)),
          context,
        ),
      );
      i++;
      continue;
    }
    factors.push(normalize(item, context));
  }
  return factors.length === 1 ? factors[0] : ["Multiply", ...factors];
}

/** A named call, with the calculus helpers (diff, integrate…) spelled out. */
function call(head: string, args: Json[], context: Context): Json {
  if (head.startsWith("Apply:")) return ["Apply", head.slice(6), ...args];
  const variable = (node: Json, what: string) => {
    if (typeof node !== "string")
      throw new NormalizeError("syntax", `${what} needs a variable name.`);
    return node;
  };
  switch (head) {
    case "diff": {
      const [f, x, n] = args;
      if (x === undefined) return ["D", f];
      const order = typeof n === "number" ? Math.min(Math.max(n, 1), 20) : 1;
      return ["D", f, ...Array<string>(order).fill(variable(x, "diff(f, x)"))];
    }
    case "integrate": {
      const [f, x, a, b] = args;
      return [
        "Integrate",
        f,
        [
          "Limits",
          x === undefined ? "Nothing" : variable(x, "integrate(f, x)"),
          ...(a !== undefined && b !== undefined ? [a, b] : []),
        ],
      ];
    }
    case "limit": {
      const [f, x, a] = args;
      if (a === undefined) throw new NormalizeError("syntax", "Write limit(f, x, a).");
      return ["Limit", f, variable(x, "limit(f, x, a)"), a, "+-"];
    }
    case "sum":
    case "product": {
      const [f, n, a, b] = args;
      if (b === undefined) throw new NormalizeError("syntax", `Write ${head}(f, n, start, end).`);
      return [
        head === "sum" ? "Sum" : "Product",
        f,
        ["Limits", variable(n, `${head}(f, n, a, b)`), a, b],
      ];
    }
  }
  return [head, ...args];
}

function limits(spec: Json, context: Context): Json {
  if (typeof spec === "string") return ["Limits", symbolName(spec)];
  if (isArray(spec) && (spec[0] === "Tuple" || spec[0] === "Limits" || spec[0] === "Triple")) {
    const [variable, ...bounds] = spec.slice(1);
    return [
      "Limits",
      typeof variable === "string"
        ? variable === "Nothing"
          ? variable
          : symbolName(variable)
        : "Nothing",
      ...bounds.filter((b) => b !== "Nothing").map((b) => normalize(b, context)),
    ];
  }
  throw new NormalizeError("syntax", "The engine couldn't read the variable or bounds here.");
}

/**
 * ∫ body d… with its specs. The raw parser gives \int_0^1\int_0^x f\,dy\,dx
 * as an outer integral without a variable and an inner one with a stray "x":
 * the stray variable belongs to the outer integral.
 */
function integrate(args: Json[], context: Context): Json {
  let [body, ...specs] = args;
  const outer = specs[0];
  if (
    specs.length === 1 &&
    isArray(outer) &&
    outer[1] === "Nothing" &&
    isArray(body) &&
    body[0] === "Integrate" &&
    typeof body[body.length - 1] === "string" &&
    body.length > 3
  ) {
    const stray = body[body.length - 1] as string;
    body = body.slice(0, -1);
    specs = [[outer[0], stray, ...outer.slice(2)]];
  }
  return ["Integrate", normalize(body, context), ...specs.map((spec) => limits(spec, context))];
}
