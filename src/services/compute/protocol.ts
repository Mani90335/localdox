// What the Compute tab asks the math engine, and what comes back. Plain data:
// it crosses the worker boundary by structured clone.

export type ComputeOperation = "evaluate" | "simplify" | "solve" | "approximate";

export const OPERATION_LABELS: Readonly<Record<ComputeOperation, string>> = {
  evaluate: "Evaluate",
  simplify: "Simplify",
  solve: "Solve",
  approximate: "Numeric value",
};

/**
 * Types retained for the development-only SymPy benchmark reference under
 * scripts/compute-reference. The app runs only the basic operations above.
 */
export type AdvancedOperation =
  | "differentiate"
  | "integrate"
  | "limit"
  | "series"
  | "gradient"
  | "hessian"
  | "jacobian"
  | "laplace"
  | "inverse-laplace"
  | "fourier"
  | "residue"
  | "determinant"
  | "inverse"
  | "transpose"
  | "trace"
  | "rank"
  | "rref"
  | "nullspace"
  | "columnspace"
  | "eigenvalues"
  | "eigenvectors"
  | "charpoly"
  | "diagonalize"
  | "statistics";

export type AnyOperation = ComputeOperation | AdvancedOperation;

export const ADVANCED_LABELS: Readonly<Record<AdvancedOperation, string>> = {
  differentiate: "Derivative",
  integrate: "Integral",
  limit: "Limit",
  series: "Series",
  gradient: "Gradient",
  hessian: "Hessian",
  jacobian: "Jacobian",
  laplace: "Laplace transform",
  "inverse-laplace": "Inverse Laplace",
  fourier: "Fourier transform",
  residue: "Residue",
  determinant: "Determinant",
  inverse: "Inverse",
  transpose: "Transpose",
  trace: "Trace",
  rank: "Rank",
  rref: "Row reduction",
  nullspace: "Null space",
  columnspace: "Column space",
  eigenvalues: "Eigenvalues",
  eigenvectors: "Eigenvectors",
  charpoly: "Characteristic polynomial",
  diagonalize: "Diagonalize",
  statistics: "Statistics",
};

export function operationLabel(op: AnyOperation): string {
  return (
    (OPERATION_LABELS as Record<string, string>)[op] ?? ADVANCED_LABELS[op as AdvancedOperation]
  );
}

/** The settings an advanced operation takes, as typed (LaTeX or plain text). */
export interface AdvancedParams {
  /** With respect to, the limit's or series' variable, a transform's input variable. */
  variable?: string;
  /** Several variables: mixed partials, gradient, Hessian, Jacobian ("x, y"). */
  variables?: string;
  /** Derivative or series order. */
  order?: number;
  /** Definite integral bounds; both or neither. */
  lower?: string;
  upper?: string;
  /** Limit point, series centre, residue point. */
  point?: string;
  direction?: "+-" | "+" | "-";
  /** A transform's output variable (s, t, k). */
  target?: string;
  /** Solve over the real (default) or complex numbers. */
  domain?: "real" | "complex";
}

export interface AdvancedRequest {
  op: AnyOperation;
  /** One or more statements in the benchmark reference. */
  input: string;
  params?: AdvancedParams;
}

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

/**
 * One step of a worked solution: what is done, and what it gives. A step can
 * hold the work for one of its parts (the chain rule inside a sum rule).
 */
export interface Step {
  /** What is done, as Markdown with `$…$` math: "Subtract $2x$ from both sides." */
  text: string;
  /** What it gives, as LaTeX. */
  latex?: string;
  substeps?: Step[];
}

/** An equivalent form shown beside a simplification (expanded, factored). */
export interface AlternativeForm {
  label: string;
  latex: string;
}

export interface ComputeAnswer {
  ok: true;
  op: AnyOperation;
  /** The input as the engine read it, as LaTeX. */
  input: string;
  /** Which engine answered: "advanced" for SymPy, absent for the basic one. */
  engine?: "advanced";
  /**
   * What the result equals, when it isn't the input itself: \det(A),
   * \frac{d}{dx}(…), \int … dx, "x \in" before a solution set.
   */
  lhs?: string;
  /** Definitions, distributions and assumptions the result depends on, as LaTeX. */
  given?: string[];
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
   * How the result is reached, step by step, when there is a method to show.
   * Steps are shown only when they arrive at this same result.
   */
  steps?: Step[];
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
  op: AnyOperation;
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
