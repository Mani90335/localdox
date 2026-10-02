// Turns what the reader typed into LaTeX the engine can read, or says why not.
//
// The engine reads LaTeX. Plain text mostly reads as LaTeX too, but not the
// way it was meant: `sqrt(8)` is 8·q·r·s·t and `sin(x)` is s·i·n·x. So input
// with no LaTeX in it (no backslash, no braces) is converted here, from a
// small, strict grammar. A name the grammar doesn't know is an error, never a
// product of letters. Runs on the main thread (the "Reads as" preview) and in
// the worker, so it stays small and engine-free.

import type { ComputeFailureKind } from "./protocol.ts";

/** Longer input is refused before it reaches the engine. */
export const MAX_INPUT_CHARS = 1000;
/** The advanced engine takes matrices and several statements, so more. */
export const MAX_ADVANCED_CHARS = 4000;

export interface PrepareOptions {
  /**
   * For the advanced engine (SymPy): relations, matrices and lists, commas,
   * primes, Greek names and named functions such as Var(X) or det(A) are
   * accepted, and LaTeX environments pass through.
   */
  advanced?: boolean;
}
/** Deeper bracket nesting is refused (the engine parses recursively). */
export const MAX_NESTING = 32;

export type PreparedInput =
  | { ok: true; latex: string; plain: boolean }
  | { ok: false; kind: ComputeFailureKind; message: string; hint?: string };

const fail = (kind: ComputeFailureKind, message: string, hint?: string): PreparedInput => ({
  ok: false,
  kind,
  message,
  hint,
});

/** Plain-text functions → how each writes its (already converted) argument. */
const FUNCTIONS: Readonly<Record<string, (arg: string) => string>> = {
  sqrt: (a) => `\\sqrt{${a}}`,
  cbrt: (a) => `\\sqrt[3]{${a}}`,
  abs: (a) => `\\left|${a}\\right|`,
  exp: (a) => `\\exp\\left(${a}\\right)`,
  ln: (a) => `\\ln\\left(${a}\\right)`,
  log: (a) => `\\log\\left(${a}\\right)`,
  ...Object.fromEntries(
    [
      "sin",
      "cos",
      "tan",
      "sec",
      "csc",
      "cot",
      "arcsin",
      "arccos",
      "arctan",
      "sinh",
      "cosh",
      "tanh",
    ].map((name) => [name, (a: string) => `\\${name}\\left(${a}\\right)`]),
  ),
  asin: (a) => `\\arcsin\\left(${a}\\right)`,
  acos: (a) => `\\arccos\\left(${a}\\right)`,
  atan: (a) => `\\arctan\\left(${a}\\right)`,
};

const CONSTANTS: Readonly<Record<string, string>> = {
  pi: "\\pi",
  inf: "\\infty",
  infinity: "\\infty",
};

const SYMBOLS: Readonly<Record<string, string>> = {
  π: "\\pi",
  "∞": "\\infty",
  θ: "\\theta",
  α: "\\alpha",
  β: "\\beta",
  λ: "\\lambda",
  μ: "\\mu",
  φ: "\\varphi",
  "×": "*",
  "·": "*",
  "⋅": "*",
  "÷": "/",
  "−": "-",
};

/** Names that, written bare inside LaTeX, would silently become products. */
const BARE_NAMES =
  /(^|[^\\a-zA-Z])(sqrt|cbrt|abs|exp|ln|log|sinh|cosh|tanh|arcsin|arccos|arctan|sin|cos|tan|sec|csc|cot|pi)(?![a-zA-Z])/;

const INEQUALITY = /<|>|≤|≥|≠|!=|\\(?:le|ge|leq|geq|lt|gt|ne|neq|leqslant|geqslant)(?![a-zA-Z])/;

/** Prepares input for the engine. Pure; cheap enough to run per keystroke. */
export function prepareInput(
  raw: string,
  { advanced = false }: PrepareOptions = {},
): PreparedInput {
  let text = raw.trim();
  if (!text) return fail("empty", "Type an expression or an equation.");
  const limit = advanced ? MAX_ADVANCED_CHARS : MAX_INPUT_CHARS;
  if (text.length > limit) {
    return fail(
      "too-complex",
      `That's ${text.length.toLocaleString("en-US")} characters; the limit is ${limit.toLocaleString("en-US")}.`,
      "Compute one expression at a time.",
    );
  }
  text = stripDelimiters(text).replace(/\s+/g, " ").trim();
  if (!text) return fail("empty", "Type an expression or an equation.");

  if (nesting(text) > MAX_NESTING) {
    return fail("too-complex", `Brackets are nested more than ${MAX_NESTING} deep.`);
  }
  if (!advanced && /\\begin\{|\\\\|&/.test(text)) {
    return fail(
      "unsupported",
      "Multi-line environments, matrices and alignments aren't supported.",
      "Compute one expression or equation at a time.",
    );
  }
  if (!advanced && INEQUALITY.test(text)) {
    return fail(
      "unsupported",
      "Inequalities aren't supported yet.",
      "Solve the matching equation, then check the intervals between its solutions.",
    );
  }
  if ((text.match(/=/g) ?? []).length > 1) {
    return fail("unsupported", "One equation at a time: this has more than one “=”.");
  }

  const plain = !/[\\{}]/.test(text);
  if (!plain) {
    const bare = BARE_NAMES.exec(withoutTextCommands(text));
    if (bare) {
      const name = bare[2];
      return fail(
        "syntax",
        `In LaTeX, a bare “${name}” reads as the letters ${name.split("").join("·")}.`,
        `Write \\${name}${name === "pi" ? "" : "{…}"} instead.`.replace(
          "\\cbrt{…}",
          "\\sqrt[3]{…}",
        ),
      );
    }
    return { ok: true, latex: text, plain: false };
  }
  try {
    return { ok: true, latex: new PlainText(text, advanced).convert(), plain: true };
  } catch (error) {
    if (error instanceof PlainTextError) return fail(error.kind, error.message, error.hint);
    throw error;
  }
}

/** `$…$`, `$$…$$`, `\(…\)` and `\[…\]` around the whole input. */
function stripDelimiters(text: string): string {
  const match =
    /^\$\$([\s\S]*)\$\$$/.exec(text) ??
    /^\$([\s\S]*)\$$/.exec(text) ??
    /^\\\[([\s\S]*)\\\]$/.exec(text) ??
    /^\\\(([\s\S]*)\\\)$/.exec(text);
  return match ? match[1].trim() : text;
}

function nesting(text: string): number {
  let depth = 0;
  let deepest = 0;
  for (const ch of text) {
    if (ch === "(" || ch === "[" || ch === "{") deepest = Math.max(deepest, ++depth);
    else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
  }
  return deepest;
}

function withoutTextCommands(latex: string): string {
  return latex.replace(/\\(?:text|operatorname|mathrm|textrm)\{[^{}]*\}/g, " ");
}

// ---- plain text ---------------------------------------------------------------

class PlainTextError extends Error {
  readonly kind: ComputeFailureKind;
  readonly hint?: string;
  constructor(kind: ComputeFailureKind, message: string, hint?: string) {
    super(message);
    this.kind = kind;
    this.hint = hint;
  }
}

type Token =
  { type: "number"; text: string } | { type: "name"; text: string } | { type: "op"; text: string };

/** Relations in advanced plain text, longest first. */
const RELATIONS = ["<=", ">=", "!=", "<", ">", "≤", "≥", "≠"];

function tokenize(source: string, advanced: boolean): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === " ") {
      i++;
      continue;
    }
    const symbol = ch === "√" ? "√" : SYMBOLS[ch];
    if (symbol) {
      tokens.push({ type: /^[\\√]/.test(symbol) ? "name" : "op", text: symbol });
      i++;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(i));
    if (number) {
      const text = number[0].startsWith(".") ? `0${number[0]}` : number[0].replace(/\.$/, "");
      tokens.push({ type: "number", text });
      i += number[0].length;
      continue;
    }
    const name = /^[A-Za-z]+/.exec(source.slice(i));
    if (name) {
      tokens.push({ type: "name", text: name[0] });
      i += name[0].length;
      if (/\d/.test(source[i] ?? "")) {
        throw new PlainTextError(
          "syntax",
          `“${name[0]}${source[i]}” is ambiguous.`,
          `Write ${name[0]}*${source[i]} for a product or ${name[0]}^${source[i]} for a power.`,
        );
      }
      continue;
    }
    if (source.startsWith("**", i)) {
      tokens.push({ type: "op", text: "^" });
      i += 2;
      continue;
    }
    const relation = advanced && RELATIONS.find((r) => source.startsWith(r, i));
    if (relation) {
      tokens.push({ type: "op", text: relation });
      i += relation.length;
      continue;
    }
    if (advanced && "[]'".includes(ch)) {
      tokens.push({ type: "op", text: ch });
      i++;
      continue;
    }
    if ("+-*/^=()[]!|,".includes(ch)) {
      tokens.push({ type: "op", text: ch === "[" ? "(" : ch === "]" ? ")" : ch });
      i++;
      continue;
    }
    throw new PlainTextError("syntax", `“${ch}” isn't something the engine can read here.`);
  }
  return tokens;
}

/**
 * A recursive reader for plain text: operators pass through (the engine
 * applies the usual precedence), and only the parts LaTeX writes differently
 * are rewritten — function calls, powers (`^(…)` → `^{…}`) and `*`.
 */
class PlainText {
  private readonly tokens: Token[];
  private readonly advanced: boolean;
  private at = 0;

  constructor(source: string, advanced = false) {
    this.advanced = advanced;
    this.tokens = tokenize(source, advanced);
  }

  convert(): string {
    const latex = this.sequence(false);
    if (this.at < this.tokens.length) {
      throw new PlainTextError("syntax", "There's a “)” without a matching “(”.");
    }
    // Spaces only separate a command from a following letter (\pi x).
    return latex.replace(/ +(?=[^a-zA-Z]|$)/g, "").trim();
  }

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }

  /** Everything up to the end, or to the `)` that closes the current group. */
  private sequence(inGroup: boolean): string {
    let out = "";
    for (;;) {
      const token = this.peek();
      if (!token) {
        if (inGroup) throw new PlainTextError("syntax", "A “(” isn't closed.");
        return out;
      }
      // The caller steps over a group's ")"; a stray one ends the input early.
      if (token.type === "op" && (token.text === ")" || token.text === "]")) return out;
      if (this.advanced && token.type === "op" && (token.text === "," || token.text === "'")) {
        this.at++;
        out += token.text;
        continue;
      }
      if (this.advanced && token.type === "op" && RELATIONS.includes(token.text)) {
        this.at++;
        out += RELATION_LATEX[token.text] ?? token.text;
        continue;
      }
      if (this.advanced && token.type === "name" && token.text.toLowerCase() === "given") {
        this.at++;
        out += "\\mid ";
        continue;
      }
      if (token.type === "op" && token.text === ",") {
        throw new PlainTextError(
          "unsupported",
          "Commas aren't supported: functions here take one argument.",
          "For a logarithm in another base, use LaTeX: \\log_{2}(8).",
        );
      }
      if (token.type === "op" && "+-*/=!|".includes(token.text)) {
        this.at++;
        out += token.text === "*" ? "\\cdot " : token.text;
        continue;
      }
      if (token.type === "op" && token.text === "^") {
        throw new PlainTextError("syntax", "A “^” needs something before it.");
      }
      out += this.power();
    }
  }

  /** An atom, with any `^` after it (right-associative, as in 2^3^2). */
  private power(): string {
    const base = this.atom();
    const next = this.peek();
    if (!(next?.type === "op" && next.text === "^")) return base;
    this.at++;
    let sign = "";
    const after = this.peek();
    if (after?.type === "op" && (after.text === "-" || after.text === "+")) {
      sign = after.text === "-" ? "-" : "";
      this.at++;
    }
    if (!this.peek()) throw new PlainTextError("syntax", "A “^” needs an exponent after it.");
    let exponent = this.power();
    // `^(…)` is already grouped; drop the visible parentheses around it.
    exponent = exponent.replace(/^\\left\(([\s\S]*)\\right\)$/, "$1");
    return `${base}^{${sign}${exponent}}`;
  }

  private atom(): string {
    const token = this.tokens[this.at++];
    if (!token) throw new PlainTextError("syntax", "Something is missing at the end.");
    if (token.type === "number") return token.text;
    if (token.type === "op") {
      if (token.text === "(") {
        const inner = this.sequence(true);
        this.at++; // the ")"
        if (!inner.trim()) throw new PlainTextError("syntax", "There's an empty “()”.");
        return `\\left(${inner}\\right)`;
      }
      // [1, 2, 3] is a list; [[1, 2], [3, 4]] a matrix (advanced only).
      if (token.text === "[") return listOrMatrix(this.group("]"));
      throw new PlainTextError("syntax", `Something is missing before “${token.text}”.`);
    }
    const name = token.text;
    if (name.startsWith("\\")) return `${name} `;
    // √2, √x, √(x+1): the radical takes the atom right after it.
    if (name === "√") {
      if (!this.peek()) throw new PlainTextError("syntax", "“√” needs something after it.");
      return `\\sqrt{${this.atom().replace(/^\\left\(([\s\S]*)\\right\)$/, "$1")}}`;
    }
    if (this.advanced) {
      const special = this.advancedName(name);
      if (special !== null) return special;
    }
    const fn = FUNCTIONS[name.toLowerCase()];
    if (fn) {
      const open = this.peek();
      if (!(open?.type === "op" && open.text === "(")) {
        const power = open?.type === "op" && open.text === "^";
        throw new PlainTextError(
          "syntax",
          power
            ? `Write powers of ${name} after its argument: ${name}(x)^2.`
            : `“${name}” needs its argument in parentheses: ${name}(x).`,
        );
      }
      this.at++;
      const inner = this.sequence(true);
      this.at++;
      if (!inner.trim()) throw new PlainTextError("syntax", `“${name}()” needs an argument.`);
      return fn(inner);
    }
    const constant = CONSTANTS[name.toLowerCase()];
    if (constant) return `${constant} `;
    if (name.length === 1) return `${name} `;
    if (this.advanced && GREEK.has(name.toLowerCase())) return `\\${name} `;
    throw new PlainTextError(
      "unsupported",
      `“${name}” isn't a function or constant the engine knows.`,
      `Variables are single letters. For a product, write ${name.split("").join("*")}.`,
    );
  }

  /** The tokens up to `closer`, which is then stepped over. */
  private group(closer: string): string {
    const inner = this.sequence(true);
    const end = this.tokens[this.at++];
    if (!(end?.type === "op" && end.text === closer)) {
      throw new PlainTextError("syntax", `A “${closer === "]" ? "[" : "("}” isn't closed.`);
    }
    return inner;
  }

  /** Names the advanced engine reads differently, or null for the usual reading. */
  private advancedName(name: string): string | null {
    const lower = name.toLowerCase();
    const next = this.peek();
    const call = next?.type === "op" && next.text === "(";
    const bracket = next?.type === "op" && next.text === "[";
    if (lower === "oo") return "\\infty ";
    // E[X], E(X): an expectation; P(…): a probability.
    if ((name === "E" && (call || bracket)) || (name === "P" && call)) {
      this.at++;
      const inner = this.group(bracket ? "]" : ")");
      return name === "E" ? `E[${inner}]` : `P(${inner})`;
    }
    if (call && lower === "log") {
      this.at++;
      const args = this.group(")");
      const comma = args.lastIndexOf(",");
      return comma < 0
        ? `\\log\\left(${args}\\right)`
        : `\\log_{${args.slice(comma + 1)}}\\left(${args.slice(0, comma)}\\right)`;
    }
    if (
      call &&
      (lower === "binomial" || lower === "binom" || lower === "choose" || lower === "ncr")
    ) {
      this.at++;
      const args = this.group(")");
      const comma = args.indexOf(",");
      if (comma < 0)
        throw new PlainTextError("syntax", `“${name}” takes two arguments: ${name}(n, k).`);
      return `\\binom{${args.slice(0, comma)}}{${args.slice(comma + 1)}}`;
    }
    if (call && lower === "gamma") {
      this.at++;
      return `\\Gamma\\left(${this.group(")")}\\right)`;
    }
    if (call && lower === "zeta") {
      this.at++;
      return `\\zeta\\left(${this.group(")")}\\right)`;
    }
    if (call && OPERATOR_NAMES.has(lower)) {
      this.at++;
      return `\\operatorname{${name}}\\left(${this.group(")")}\\right)`;
    }
    return null;
  }
}

const RELATION_LATEX: Readonly<Record<string, string>> = {
  "<=": "\\le ",
  ">=": "\\ge ",
  "!=": "\\ne ",
  "≤": "\\le ",
  "≥": "\\ge ",
  "≠": "\\ne ",
};

/** Functions written \\operatorname{…}(…) for the advanced engine (normalize.ts reads them). */
const OPERATOR_NAMES = new Set([
  "beta",
  "erf",
  "erfc",
  "var",
  "variance",
  "cov",
  "covariance",
  "corr",
  "correlation",
  "sd",
  "std",
  "stdev",
  "pdf",
  "density",
  "cdf",
  "mgf",
  "median",
  "mean",
  "avg",
  "skewness",
  "skew",
  "kurtosis",
  "entropy",
  "det",
  "inv",
  "inverse",
  "tr",
  "trace",
  "transpose",
  "grad",
  "gradient",
  "re",
  "im",
  "conj",
  "arg",
  "floor",
  "ceil",
  "sign",
  "sgn",
  "max",
  "min",
  "gcd",
  "lcm",
  "mod",
  "diff",
  "derivative",
  "integrate",
  "int",
  "limit",
  "lim",
  "sum",
  "product",
  "prod",
]);

const GREEK = new Set([
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "varepsilon",
  "zeta",
  "eta",
  "theta",
  "vartheta",
  "iota",
  "kappa",
  "lambda",
  "mu",
  "nu",
  "xi",
  "rho",
  "sigma",
  "tau",
  "upsilon",
  "phi",
  "varphi",
  "chi",
  "psi",
  "omega",
]);

/** Splits on commas outside brackets and braces. */
function topLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts;
}

/** [[1,2],[3,4]] is written as a matrix, so it reads (and shows) as one. */
function listOrMatrix(inner: string): string {
  const items = topLevel(inner);
  const rows = items.every((item) => /^\[.*\]$/.test(item))
    ? items.map((item) => topLevel(item.slice(1, -1)))
    : null;
  if (rows && rows.length > 0 && rows.every((row) => row.length === rows[0].length)) {
    return `\\begin{pmatrix}${rows.map((row) => row.join("&")).join("\\\\")}\\end{pmatrix}`;
  }
  return `[${inner}]`;
}
