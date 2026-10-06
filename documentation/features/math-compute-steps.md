# Worked steps in Compute

Results show numbered steps when a supported method applies. Explanations use
plain actions: multiply by the power, lower it by one, subtract the lower
value, or add a constant. Steps are open by default; localdox:compute-steps
remembers the reader's preference. Copy, rough work and document insertion
include steps only while they are shown.

## Methods

- Exact arithmetic: order of operations and fraction work, using BigInt
  rationals in exact.ts and arithmetic-steps.ts.
- Equations: collect terms, isolate the unknown, factor or apply the quadratic
  formula, and check excluded values. solve-steps.ts provides candidate work;
  engine.ts shows it only when its solutions match the checked answer.
- Basic calculus: calculus.ts checks the raw input against a small supported
  set, uses the existing engine's derivative/integral rules, and shows the work
  for each term. Definite integrals show the upper value minus the lower value;
  indefinite integrals explain +C.

Some valid answers have no supported explanation. Compute does not invent one.
Advanced calculus, matrix and probability steps were removed with SymPy.

## Validation

The step tests exercise real arithmetic and equation answers, render every
math line with KaTeX and check Markdown export. compute-calculus.test.ts checks
known derivatives, integrals, reversed bounds and unsupported inputs, including
fractions whose undefined points must survive input checks. Browser tests
verify steps carry into rough work and confirmed document insertion.
