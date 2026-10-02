# Worked steps in Compute

A Compute result can show **how** it was reached: numbered steps under the
answer, each saying what is done ("Subtract $2x$ from both sides") and what it
gives. Parts of a step (the chain rule inside a sum rule) are nested beneath
it. The list is open by default and its open/closed state is remembered on the
device (`localdox:compute-steps`). Copy, Add to rough work and Insert carry
the steps when they are shown.

## The problem

An answer alone doesn't help a learner who got a different one: they can't
see where their working went wrong. Generating steps has its own risk. Steps
that are subtly wrong teach the mistake, and they look more authoritative than
a bare number. So the design rule is: **steps explain an answer the engine has
already checked; they are shown only if they arrive at that same answer.**

## Mental model

The calculator from math-compute.md now has a second display: a worked
solution. Two people write it independently. The solver finds and checks the
answer. A tutor writes out a textbook method. The card shows the tutor's
working only when the tutor's final line matches the solver's answer. If no
method fits, or the tutor ends up somewhere else, the card shows the answer
with no steps rather than a wrong explanation.

## What gets steps

| Engine           | Operation                                            | Method                                                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| basic (JS)       | Solve, unknown appearing once                        | Undo the operations from the outside in: ±, ×/÷, roots (both signs), logarithms, exponentials, arcsin/arccos/arctan within one period, absolute value. Squaring adds a check step.                            |
| basic            | Solve, polynomial or rational, rational coefficients | Collect terms; clear fractions; linear step; quadratic by factoring, √ or the formula (simplified radical, complex roots); degree ≥ 3 by rational roots and synthetic division; denominators' zeros excluded. |
| basic            | Solve, one √ beside polynomial terms                 | Isolate the root, square, solve, reject answers where the other side is negative.                                                                                                                             |
| basic            | Evaluate (exact arithmetic)                          | Order of operations, one level per step; fraction work (common denominator, reciprocal, reduction) as substeps.                                                                                               |
| advanced (SymPy) | Derivative (also `\frac{d}{dx}…` evaluated)          | Rule by rule: sum, constant multiple, product, quotient, power, exponential, chain, standard derivatives. Orders up to 3 and mixed partials.                                                                  |
| advanced         | Integral (also `\int…` evaluated)                    | SymPy's own method tree (`manualintegrate`): substitution, parts, partial fractions, standard forms; definite integrals by the fundamental theorem.                                                           |
| advanced         | Determinant, Row reduction, Inverse, linear systems  | Cofactor expansion along the row/column with most zeros (≤ 4×4); Gauss–Jordan, one step per pivot; `[A                                                                                                        | I]`for the inverse;`[A | b]` for a square system with one solution. |

Anything else (an irreducible cubic, x on both sides of an exponential,
limits, series, statistics) has no steps. That is expected, not an error.

## Architecture

```
basic worker (compute.worker.ts)                 advanced worker (Pyodide)
  engine.ts  compute()                             steps.py   (loaded first)
    solve ─ solveSteps(toolkit, lhs, rhs) ──┐        derivative_steps, integral_steps,
    │        solve-steps.ts: isolate,       │        determinant/rref/inverse_steps,
    │        polynomial, radical            │        linear_system_steps
    │      → Worked[] (steps + solutions)   │      bridge.py  op_* → answer(extra={"steps"})
    ├─ chooseMethod(worked, verified roots) │
    │    same solution set? ─ yes → steps   │
    │                         no  → none    │
    evaluate ─ arithmeticSteps(raw MathJSON)│
    │        arithmetic-steps.ts            │
    exact.ts  BigInt rationals, polynomials ┘
            │                                           │
            ▼                                           ▼
  ComputeAnswer.steps: Step[]  ({ text, latex?, substeps? }, protocol.ts)
            ▼
  ComputePanel ResultCard → StepsSection (ol, NoteMath per line)
  result-markdown.ts stepsMarkdown → Copy / rough work / Insert
```

- **Exact by construction.** The solver's polynomials (polynomial.ts) are
  floating point, which is right for finding roots and wrong for printing
  "subtract 1/3". `exact.ts` reads the equation into BigInt rationals, so a
  step can't show a rounded coefficient.
- **The toolkit.** solve-steps.ts gets the engine through a small interface
  (`Toolkit`: latex, simplify, value, exact angle, substitute, holds) passed
  in by engine.ts. That avoids a circular import and keeps the step logic
  testable with the real engine.
- **Raw input for arithmetic.** The engine's canonical form already folds
  `2 + 3` into `5`, so arithmetic steps read `ce.parse(latex, {form: "raw"})`.
- **The check.** `chooseMethod` compares the method's solutions with the
  solver's verified ones as sets (numerically, 1e-9 relative). In SymPy,
  each node of an integral tree is checked by differentiating back
  (numerically, at random points), and the whole tree exactly
  (`simplify(F' − f) = 0`). Each derivative level is compared with
  `sp.diff`. A row reduction must equal SymPy's `rref`. A definite integral's
  F(b) − F(a) must equal the computed value, so an integral across a pole
  (∫₋₁¹ 1/x²) gets no steps.

### Side effects worth knowing

- **Isolation finds solutions the engine's solver misses.** It returns nothing
  for `2^x = 8` or `e^{2x−1} = 5`. Isolation's candidates are added to the
  solver's list and substituted back like any other, so these now solve.
- **Simpler exact forms.** When the matched steps name a solution more simply
  (`1 + √2` for the engine's `1 + √8/2`), or when the solver only had a
  decimal (the roots of `1/x + 1/(x−1) = 1`), the answer takes the steps'
  form. They are the same number: that's why the steps were chosen.
- **Exact large powers.** The engine works `2^{100}` to about 20 significant
  digits and still calls it exact. For pure arithmetic, Evaluate now takes the
  value from exact.ts (BigInt, up to 4,000 digits). Past that, a power's
  result is shown as a rounded decimal with a note, never as made-up digits.

## Trade-offs

- **Own steppers instead of a library.** No permissively licensed JS library
  gives steps for LaTeX input (mathsteps is unmaintained and reads its own
  syntax), and SymPy gives steps only for integrals. The equation and
  arithmetic methods are what a textbook teaches, so they're small to own.
  `manualintegrate` is SymPy's (BSD), already in the download, and is used
  as is.
- **Cost.** The basic worker grew about 10.5 KiB gzip (291.0 → ~301.5 of
  the 320 KiB ceiling). steps.py adds nothing to download beyond its own
  source; SymPy is already there. Steps are computed with every answer:
  the methods are linear in the size of the input, and SymPy steps are
  skipped above 60 operations (`MAX_OPS`) or 80 steps (`MAX_STEPS`).
- **Steps for some problems, not all.** A narrower set of methods that are
  always right beats a general one that is sometimes wrong. A missing method
  means no steps, never a guess.

## Debugging

- A result has no steps: either no method applies, or one ran and its answer
  didn't match. Run the probe pattern from tests/compute-steps.test.ts
  (`compute(ce, {op, input})`) and look at `solveSteps(...)` directly.
  Its `Worked[]` shows what each method concluded.
- SymPy steps missing: call `derivative_steps` / `integral_steps` on the
  expression in a Python with SymPy 1.14. They return `None` on `NoSteps`
  (an unknown rule, or a node that didn't differentiate back).
- Tests: tests/compute-steps.test.ts (basic engine, KaTeX-renders every step,
  Markdown parses as math inside list items), the "steps:" tests in
  tests/compute-advanced.test.ts (SymPy, via Pyodide in Node).
