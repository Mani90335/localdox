// One advanced request, end to end: statements → MathJSON → Python → result.
// Runs in the advanced worker, and unchanged in the unit tests (with Pyodide
// in Node), so the tests exercise exactly what the reader gets.

import { prepareInput } from "../../src/services/compute/input.ts";
import type {
  AdvancedRequest,
  ComputeFailure,
  ComputeResult,
} from "../../src/services/compute/protocol.ts";
import {
  assertParsed,
  collectFunctions,
  newContext,
  normalize,
  NormalizeError,
  preprocessLatex,
  type Context,
  type Json,
} from "./normalize.ts";
import { parseStatements, StatementError, splitArguments } from "./statements.ts";

/** What run.ts needs from Pyodide: the bridge's `run`, loaded into its globals. */
export interface Bridge {
  run(request: string): string;
}

/** LaTeX → MathJSON as written: `parse` from @cortex-js/compute-engine/latex-syntax. */
export type ParseLatex = (latex: string) => unknown;

class InputError extends Error {
  readonly failure: Omit<ComputeFailure, "ok" | "op">;
  constructor(failure: Omit<ComputeFailure, "ok" | "op">) {
    super(failure.message);
    this.failure = failure;
  }
}

interface Parsed {
  latex: string;
  raw: Json;
}

/** Text → raw MathJSON, with the LaTeX shown back to the reader. */
function parse(parseLatex: ParseLatex, text: string, context: Context): Parsed {
  const prepared = prepareInput(text, { advanced: true });
  if (!prepared.ok) {
    throw new InputError({ kind: prepared.kind, message: prepared.message, hint: prepared.hint });
  }
  const latex = preprocessLatex(prepared.latex, context);
  const raw = parseLatex(latex);
  if (raw === null)
    throw new InputError({ kind: "syntax", message: "The engine couldn't read this." });
  assertParsed(raw);
  collectFunctions(raw, context);
  return { latex: prepared.latex, raw };
}

function variableName(text: string | undefined): string | undefined {
  const name = text
    ?.trim()
    .replace(/^\$|\$$/g, "")
    .replace(/^\\/, "");
  if (!name) return undefined;
  const greek: Record<string, string> = { θ: "theta", λ: "lambda", μ: "mu", σ: "sigma", τ: "tau" };
  const resolved = greek[name] ?? name;
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(resolved)) {
    throw new InputError({ kind: "syntax", message: `“${text}” isn't a variable name.` });
  }
  return resolved;
}

/** The JSON request bridge.py reads, or the reason there can't be one. */
export function bridgeRequest(parseLatex: ParseLatex, request: AdvancedRequest) {
  const statements = parseStatements(request.input);
  const context = newContext();
  for (const definition of statements.definitions) {
    if (definition.args.length) context.functions.add(definition.name);
  }
  // Parse everything first: a function named in one statement (y in y'' + y = 0)
  // decides how another reads (y(0) = 1 is a condition, not y·0).
  const targets = statements.targets.map((t) => parse(parseLatex, t, context));
  const definitions = statements.definitions.map((d) => ({
    ...d,
    parsed: parse(parseLatex, d.value, context),
  }));
  const random = statements.random.map((r) => ({
    ...r,
    parsed: r.params.map((p) => parse(parseLatex, p, context)),
  }));
  const params = request.params ?? {};
  const value = (text: string | undefined) =>
    text?.trim() ? normalize(parse(parseLatex, text, context).raw, context) : undefined;
  const lower = value(params.lower);
  const upper = value(params.upper);
  const point = value(params.point);
  const variables = params.variables
    ? splitArguments(params.variables).map((v) => variableName(v)!)
    : undefined;
  return {
    latex: targets.map((t) => t.latex),
    payload: {
      op: request.op,
      assumptions: statements.assumptions,
      random: random.map((r) => ({
        name: r.name,
        distribution: r.distribution,
        params: r.parsed.map((p) => normalize(p.raw, context)),
      })),
      definitions: definitions.map((d) => ({
        name: d.name,
        args: d.args,
        value: normalize(d.parsed.raw, context),
      })),
      targets: targets.map((t) => normalize(t.raw, context)),
      functions: [...context.functions],
      independent: context.independent,
      params: {
        variable: variableName(params.variable),
        variables,
        order: params.order,
        lower,
        upper,
        point,
        direction: params.direction,
        target: variableName(params.target),
        domain: params.domain,
      },
    },
  };
}

export function runAdvanced(
  bridge: Bridge,
  parseLatex: ParseLatex,
  request: AdvancedRequest,
): ComputeResult {
  let built;
  try {
    built = bridgeRequest(parseLatex, request);
  } catch (error) {
    if (error instanceof InputError) return { ok: false, op: request.op, ...error.failure };
    if (error instanceof StatementError || error instanceof NormalizeError) {
      return {
        ok: false,
        op: request.op,
        kind: error.kind,
        message: error.message,
        hint: error.hint,
      };
    }
    throw error;
  }
  if (!built.payload.targets.length) {
    return { ok: false, op: request.op, kind: "empty", message: "Type an expression to compute." };
  }
  const result = JSON.parse(bridge.run(JSON.stringify(built.payload))) as ComputeResult;
  if (!result.ok) return result;
  // Equations of a system are shown side by side.
  const input = built.latex.join(",\\quad ");
  return {
    ...result,
    input,
    exact: result.exact ?? undefined,
    approx: result.approx ?? undefined,
  };
}
