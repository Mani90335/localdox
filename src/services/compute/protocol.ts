// What the Compute tab asks the math engine, and what comes back. Plain data:
// it crosses the worker boundary by structured clone.

export type ComputeOperation = "evaluate" | "simplify" | "solve" | "approximate";

export const OPERATION_LABELS: Readonly<Record<ComputeOperation, string>> = {
  evaluate: "Evaluate",
  simplify: "Simplify",
  solve: "Solve",
  approximate: "Numeric value",
};

export interface ComputeRequest {
  op: ComputeOperation;
  /** LaTeX or plain text, as typed. */
  input: string;
  /** Solve only: the unknown to solve for. Empty means "the only one there is". */
  variable?: string;
}

/** One solution of an equation. */
export interface Solution {
  /** Exact form, as LaTeX, when the engine found or verified one. */
  exact?: string;
  /** Decimal value, as LaTeX, when it differs from `exact`. */
  approx?: string;
  /** A repeated root counts once, with its multiplicity. */
  multiplicity: number;
  complex: boolean;
}

/** An equivalent form shown beside a simplification (expanded, factored). */
export interface AlternativeForm {
  label: string;
  latex: string;
}

export interface ComputeAnswer {
  ok: true;
  op: ComputeOperation;
  /** The input as the engine read it, as LaTeX. */
  input: string;
  /** The exact result, as LaTeX, when there is one. */
  exact?: string;
  /** A decimal approximation, as LaTeX, when it says something `exact` doesn't. */
  approx?: string;
  forms?: AlternativeForm[];
  /** Solve: the unknown, and every solution found (possibly none). */
  variable?: string;
  solutions?: Solution[];
  /** Solve: the solution list is provably complete. */
  complete?: boolean;
  /**
   * Assumptions, domain restrictions and caveats, as Markdown with `$…$`
   * math. Shown with the result and carried along when it is copied.
   */
  notes: string[];
}

export type ComputeFailureKind =
  /** Nothing to compute. */
  | "empty"
  /** The input isn't readable math. */
  | "syntax"
  /** Readable, but outside what the Compute tab handles. */
  | "unsupported"
  /** Another operation fits this input; see `suggest`. */
  | "wrong-operation"
  /** Several unknowns and no choice made; see `variables`. */
  | "choose-variable"
  /** Mathematically undefined, e.g. a division by zero. */
  | "undefined"
  /** Too long, too deep, or ran past the engine's time limit. */
  | "too-complex"
  /** The engine threw. */
  | "engine-error";

export interface ComputeFailure {
  ok: false;
  op: ComputeOperation;
  kind: ComputeFailureKind;
  message: string;
  hint?: string;
  suggest?: ComputeOperation;
  variables?: string[];
}

export type ComputeResult = ComputeAnswer | ComputeFailure;

/** Main thread → worker. */
export interface WorkerRequest {
  id: number;
  request: ComputeRequest;
}

/** Worker → main thread. `ready` once the engine has loaded. */
export type WorkerReply = { type: "ready" } | { type: "result"; id: number; result: ComputeResult };
