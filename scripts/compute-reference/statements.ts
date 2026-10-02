// Splits advanced input into statements, one per line (or `;`), and sorts
// them by what they declare. Graduate-level work rarely fits one expression:
//
//   X ~ N(0, 4)               a random variable (and its distribution)
//   let A = [[1, 2], [3, 4]]  a definition (also `A := …`); `let f(x) = …` too
//   assume x > 0              an assumption about a symbol
//   y'' + y = 0               what to compute: every other line
//   y(0) = 1                  (for Solve, conditions are equations too)
//
// Pure text handling. The math in each statement is parsed later
// (normalize.ts); here only the statement's shape is recognized.

import type { ComputeFailureKind } from "../../src/services/compute/protocol.ts";

export type Property =
  | "positive"
  | "negative"
  | "nonnegative"
  | "nonpositive"
  | "nonzero"
  | "real"
  | "integer"
  | "complex";

export interface Statements {
  assumptions: { names: string[]; property: Property }[];
  random: { name: string; distribution: string; params: string[] }[];
  definitions: { name: string; args: string[]; value: string }[];
  targets: string[];
}

export class StatementError extends Error {
  readonly kind: ComputeFailureKind;
  readonly hint?: string;
  constructor(kind: ComputeFailureKind, message: string, hint?: string) {
    super(message);
    this.kind = kind;
    this.hint = hint;
  }
}

/** Distribution names as written → the engine's names. */
const DISTRIBUTIONS: Readonly<Record<string, string>> = Object.fromEntries(
  (
    [
      ["Normal", ["n", "normal", "gaussian", "gauss"]],
      ["LogNormal", ["lognormal", "logn"]],
      ["Uniform", ["u", "unif", "uniform"]],
      ["Exponential", ["exp", "expo", "exponential"]],
      ["Gamma", ["gamma"]],
      ["Beta", ["beta"]],
      ["ChiSquared", ["chi2", "chisq", "chisquared", "chi^2", "chi^{2}"]],
      ["StudentT", ["t", "studentt", "student"]],
      ["Cauchy", ["cauchy"]],
      ["Laplace", ["laplace"]],
      ["Weibull", ["weibull"]],
      ["Pareto", ["pareto"]],
      ["Erlang", ["erlang"]],
      ["Bernoulli", ["bern", "bernoulli"]],
      ["Binomial", ["b", "bin", "binom", "binomial"]],
      ["Poisson", ["pois", "poi", "poisson"]],
      ["Geometric", ["geom", "geo", "geometric"]],
      ["NegativeBinomial", ["nb", "negbin", "negativebinomial"]],
      ["Hypergeometric", ["hypergeom", "hypergeometric", "hg"]],
      ["DiscreteUniform", ["du", "discreteuniform", "dunif"]],
    ] as const
  ).flatMap(([name, aliases]) => aliases.map((alias) => [alias, name])),
);

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const IDENT = String.raw`(?:\\?[A-Za-z][A-Za-z0-9_]*)`;

/** Splits on newlines and `;` outside brackets; `\;` (a LaTeX space) never splits. */
export function splitStatements(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
    const separator = ch === "\n" || (ch === ";" && input[i - 1] !== "\\");
    if (separator && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Splits `a, b, c` on top-level commas. */
export function splitArguments(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export function parseStatements(input: string): Statements {
  const result: Statements = { assumptions: [], random: [], definitions: [], targets: [] };
  for (const statement of splitStatements(input)) {
    if (/^assume\b/i.test(statement)) {
      result.assumptions.push(...parseAssumption(statement.replace(/^assume\s*/i, "")));
      continue;
    }
    const random = new RegExp(`^(${IDENT})\\s*(?:~|\\\\sim\\b)\\s*(.+)$`).exec(statement);
    if (random) {
      result.random.push(parseDistribution(random[1], random[2]));
      continue;
    }
    const definition =
      /^let\s+(.+?)\s*=\s*([\s\S]+)$/i.exec(statement) ??
      /^(.+?)\s*(?::=|\\coloneqq|≔)\s*([\s\S]+)$/.exec(statement);
    if (definition) {
      result.definitions.push(parseDefinition(definition[1], definition[2]));
      continue;
    }
    result.targets.push(statement);
  }
  return result;
}

function plainName(raw: string, what: string): string {
  const name = raw
    .trim()
    .replace(/^\\/, "")
    .replace(/^mathbf\{(\w+)\}$/, "$1");
  if (!NAME.test(name))
    throw new StatementError("syntax", `“${raw.trim()}” isn't a name ${what} can have.`);
  return name;
}

function parseAssumption(text: string): Statements["assumptions"] {
  const relation = /^(.+?)\s*(>=|≥|\\geq?|>|<=|≤|\\leq?|<|!=|≠|\\neq?)\s*0$/.exec(text.trim());
  if (relation) {
    const names = relation[1].split(",").map((n) => plainName(n, "an assumption"));
    const op = relation[2];
    const property: Property =
      op === ">"
        ? "positive"
        : op === "<"
          ? "negative"
          : /^(>=|≥|\\geq?)$/.test(op)
            ? "nonnegative"
            : /^(<=|≤|\\leq?)$/.test(op)
              ? "nonpositive"
              : "nonzero";
    return [{ names, property }];
  }
  const words =
    /^(.+?)\s+((?:positive|negative|nonnegative|nonpositive|nonzero|real|integer|complex)(?:\s+(?:positive|negative|nonnegative|nonpositive|nonzero|real|integer|complex))*)$/i.exec(
      text.trim(),
    );
  if (!words) {
    throw new StatementError(
      "syntax",
      "An assumption reads like “assume x > 0” or “assume n positive integer”.",
    );
  }
  const names = words[1].split(",").map((n) => plainName(n, "an assumption"));
  return words[2]
    .toLowerCase()
    .split(/\s+/)
    .map((property) => ({ names, property: property as Property }));
}

function parseDistribution(rawName: string, text: string): Statements["random"][number] {
  const name = plainName(rawName, "a random variable");
  const match =
    /^(?:\\mathcal\{(\w+)\}|\\operatorname\{(\w+)\}|\\mathrm\{(\w+)\}|\\text\{(\w+)\}|\\(chi)\^\{?2\}?|([A-Za-z][A-Za-z0-9^{}]*))\s*(?:\\left)?\(([\s\S]*?)(?:\\right)?\)\s*$/.exec(
      text.trim(),
    );
  if (!match) {
    throw new StatementError(
      "syntax",
      `Write ${name}'s distribution with its parameters, like ${name} ~ N(0, 1).`,
    );
  }
  const written = match[1] ?? match[2] ?? match[3] ?? match[4] ?? (match[5] ? "chi2" : match[6]);
  const distribution = DISTRIBUTIONS[written.toLowerCase()];
  if (!distribution) {
    throw new StatementError(
      "unsupported",
      `“${written}” isn't a distribution the engine knows.`,
      "Supported: N, LogNormal, U, Exp, Gamma, Beta, Chi2, t, Cauchy, Laplace, Weibull, Pareto, Erlang, Bern, Bin, Pois, Geom, NB, Hypergeom, DU.",
    );
  }
  return { name, distribution, params: splitArguments(match[7]) };
}

function parseDefinition(lhs: string, value: string): Statements["definitions"][number] {
  const call = /^([A-Za-z][A-Za-z0-9_]*)\s*\(([^()]*)\)$/.exec(lhs.trim());
  if (call) {
    return {
      name: call[1],
      args: splitArguments(call[2]).map((a) => plainName(a, "a function's argument")),
      value,
    };
  }
  return { name: plainName(lhs, "a definition"), args: [], value };
}
