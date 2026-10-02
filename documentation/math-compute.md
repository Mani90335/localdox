# Math Compute

The Notes panel's third tab, **Compute**, works things out: evaluate an
expression, simplify it, solve an equation, or get a decimal value. It runs on
the device, in a background thread, and works offline once used. Graduate-level
work (calculus, linear algebra, probability, statistics, transforms, ODEs) goes
to a second engine, SymPy, downloaded only after the reader agrees; see
math-compute-advanced.md. What the
reader wrote and what the engine computed never mix: a result goes to rough
work or into a document only when the reader asks, and an insertion only after
its confirmation dialog. Results come with worked steps where a textbook
method applies; see math-compute-steps.md. The input is a math field with an
embedded keypad, or plain text; see math-input.md.

## The problem

Rough work (documentation/rough-work.md) is scrap paper: the reader writes
every step themselves. Checking an answer meant leaving the app for a
calculator or a CAS website, which is slow, needs a network, and sends the work
somewhere else. A built-in calculator has its own risks:

- **A wrong answer stated confidently** is worse than none. A learner can't
  tell an engine bug from their own mistake.
- **A heavy engine on the page's thread** freezes reading and typing while it
  thinks. One `100000!` is about a second of work.
- **Computed text written into a document** without the reader choosing it
  would blur what they wrote with what a machine produced.

## Mental model

Compute is a calculator lying on the desk beside the scrap paper. You type a
question, press a button, and read the answer on the calculator's display,
which shows your question too. Copying the answer onto the paper (**Add to
rough work**) or into the book (**Insert into document…**) is something you do
by hand. The calculator never writes on either.

Its display also says how sure it is. "Exact" means exact. "≈" means rounded.
"Solutions" means all of them, and "Found" means the engine's list may be
incomplete. Notes underneath give conditions, such as "matches the original
where x − 1 ≠ 0".

## Choosing the engine

Requirements: runs in a browser (in a worker) and offline, reads LaTeX (the app
writes math as LaTeX), exact arithmetic, simplification and equation solving,
permissive license, a bundle that can stay optional.

| Candidate                                | Why not / why                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **@cortex-js/compute-engine 0.58** (MIT) | **Chosen.** Parses LaTeX directly, exact rationals and radicals, `simplify`/`evaluate`/`N`/`solve`, arbitrary precision, a cooperative time limit. Already installed as MathLive's dependency, at the same pinned version, so no new package was downloaded or audited and there is a single copy. |
| math.js (Apache-2.0)                     | No LaTeX input; no general equation solver.                                                                                                                                                                                                                                                        |
| nerdamer, Algebrite (MIT)                | No LaTeX input; less active.                                                                                                                                                                                                                                                                       |
| Giac/Xcas (WASM), SymPy (Pyodide)        | Strong CAS, but GPL (Giac) or a ~11 MB runtime (Pyodide): SymPy is now the optional second tier (math-compute-advanced.md), not the default.                                                                                                                                                       |

It is now a direct dependency pinned to `0.58.0`, the exact version MathLive
pins. When MathLive is upgraded, upgrade this to match, or the build will ship
two engines.

**Cost**, measured on the production build (`tests/e2e/bundle-journeys.spec.ts`,
journey `compute`): **292.3 KiB gzip** the first time Compute is used. That is
291.0 KiB for `compute.worker-*.js` (1.13 MB raw: the engine plus our code) and
1.3 KiB for the client chunk. The ceiling is 320 KiB. The tab's UI adds 6.2 KiB
gzip to the Notes panel chunk (12.4 → 18.5 KiB), and the offline shell is
unchanged apart from per-file overhead (+0.9 KB raw), because the bundler
re-split two shared vendor modules. A build check asserts the engine appears in
no page chunk, only in its worker.

## Architecture

```
ComputePanel (Notes panel chunk)              main thread
  input ─ prepareInput (input.ts) ─▶ "Reads as" preview, every keystroke (debounced)
  Evaluate / Simplify / Numeric / Solve
     │  import("services/compute/compute")   ← 1.3 KiB, first use only
     ▼
  compute-client.ts ── queue, cache, timeout, cancel ──┐
                                                       │ postMessage
  compute.worker.ts ◀──────────────────────────────────┘ worker thread
     new ComputeEngine() ─ configureEngine (4 s limit)
     compute(ce, request)  ← engine.ts (+ input.ts, polynomial.ts)
     ▼
  ComputeResult (plain data) ──▶ ResultCard / FailureCard
     Copy · Add to rough work · Insert into document… (InsertDialog, confirmed)
```

- **Lazy.** Nothing loads at startup. When the Compute tab opens, an idle
  callback imports the client and starts the worker (`warm()`), so the engine
  is usually ready by the time the first expression is typed. The engine's own
  dependencies are bundled into the worker file, so there is one request.
- **Worker.** `engine.ts` is a pure function `compute(ce, request)`. The same
  code runs in the worker and in the Node unit tests, against the real engine.
- **Client** (modelled on the interactive-examples compiler,
  documentation/interactive-examples.md): one request at a time, in order;
  results cached by `op + variable + input` (100 entries, least recently used
  out). Engine answers are cached, including "unsupported" ones. Worker
  failures and cancellations never are.
- **Offline.** The worker and client chunk are optional files, so the service
  worker caches them on first use (and with "Download all features"). After
  that, Compute works with no network (e2e: `once loaded, Compute works offline
after a reload`).

## What each operation does

| Operation | Accepts                                      | Gives                                                                                           |
| --------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Evaluate  | an expression with no unknowns               | exact value, plus a decimal when it adds something                                              |
| Simplify  | any expression or equation                   | simplified form; for a polynomial in one unknown, its expanded and factored forms; domain notes |
| Numeric   | an expression with no unknowns               | decimal, 12 significant digits (complex included)                                               |
| Solve     | an equation, or an expression (solved `= 0`) | every solution, exact where possible, with a decimal                                            |

A mismatch is a labelled failure with a way forward, not a guess: Evaluate on
`2x+3=7` says "That's an equation" and offers **Solve instead**. Evaluate on
`x+1` offers Simplify. Solve on `ax+b=0` asks which unknown (buttons for `a`,
`b`, `x`). Enter (in Math input; `Ctrl/⌘+Enter` in Text) runs Solve when the
input has `=`, Evaluate otherwise.

### Input

`prepareInput` (input.ts) runs before the engine, and on every keystroke for
the "Reads as" preview:

- `$…$`, `$$…$$`, `\(…\)`, `\[…\]` around the whole input are dropped.
- **Plain text** (no backslash, no braces) is converted by a small strict
  grammar: `sqrt(8)`, `x^(n+1)`, `2^-3`, `**`, `*`, `×`, `÷`, `√2`, `π`, `abs()`,
  `sin()`…`atanh`, `ln`, `log`, `exp`. This is needed because the engine reads
  `sqrt(8)` as 8·q·r·s·t. Variables are single letters, and an unknown name
  (`abc`, `x2`) is refused with a hint rather than read as a product.
- **LaTeX** passes through, but a bare `sin` (meaning s·i·n) is refused with
  "write \sin".
- Refused before the engine runs: inequalities, more than one `=`,
  environments and matrices, commas, over 1,000 characters, brackets nested
  over 32 deep.

### Exact or approximate

- `exact` comes from the engine only when it is exact: an integer, a fraction,
  a surd, `\pi`. A decimal the engine computed from `sin(1)` or `ln 2` is
  marked inexact by the engine itself (`isExact`), so the unevaluated form
  `\sin(1)` is shown as exact, with the decimal beside it.
- Decimals in the input make the result decimal (`1/3 + 0.5` → ≈ 0.8333…, with
  a note).
- An exact result over 4,000 characters is replaced by a note, and the
  decimal stays (`100000!`). Large integers are written out in full, not as
  `digits·10ⁿ`.

### Solving

Polynomial and rational equations are solved **completely**; the result says
"Solutions" and `complete: true`.

1. The equation is read as one fraction `num(x)/den(x) = 0` with numeric
   coefficients (`rationalForm`, polynomial.ts), up to degree 40.
2. Every root of `num` is found by the Aberth–Ehrlich method. A degree-n
   polynomial has exactly n roots counted with multiplicity, complex included.
3. Repeated roots are regrouped: m nearby points form one m-fold root only if
   p, p′ … p⁽ᵐ⁻¹⁾ all vanish there (after Newton on p⁽ᵐ⁻¹⁾).
4. Roots where `den` vanishes are left out, with a note ("the equation is
   undefined there").
5. Exact forms come from substitution, never by trusting a decimal. A nearby
   fraction, or for trigonometric equations a fraction of π, is substituted
   into the equation in the engine's exact arithmetic and kept only if the
   result is exactly 0. Otherwise the engine's own exact solutions (`√2`) are
   matched to the numeric roots.

This exists because the engine's solver misses ordinary cases. It returns
nothing for `x³+x+1=0` and `(x²−1)/(x−1)=0`, and only `3` for `|x|=3`, and its
`Together` combines `1/x + 1/(x−1)` incorrectly. Each case is a unit test.

Every other equation (trigonometric, exponential, logarithmic, radical, or with
other unknowns treated as constants) uses the engine's `solve`. Each solution
is substituted back numerically and dropped with a note if it's infinite or
doesn't satisfy the equation (`1/x = 0` → ∞ is dropped). The result says
"Found", and notes say it may be incomplete. Trigonometric results note that
only one period is listed. With constants, `Assumes a ≠ 0` comes from the
solution's denominators. An empty list says "No solutions found. That doesn't
prove there are none", never "no solution".

### Domain notes

Simplify compares where the input (parsed raw, before `x/x → 1`) and the result
are defined: denominators ≠ 0, logarithm arguments > 0, even-root arguments
≥ 0. A condition the result dropped becomes "Matches the original where
x − 1 ≠ 0". A condition the result added becomes "The result assumes x > 0", as
for `ln(x²) → 2 ln x`, which the engine rewrites as if x > 0. A > or ≥
condition that holds at every sample (x² ≥ 0) is not worth a note and is left
out.

### Output

Results are LaTeX for the app's renderers (KaTeX, MathJax, Temml). Engine-only
commands are rewritten (`\imaginaryI` → `i`, `\exponentialE` → `e`, a leading
`\frac{-b}{a}` → `-\frac{b}{a}`). A unit test renders every result through
KaTeX with `throwOnError`. Copy, Add to rough work and Insert all carry the same
Markdown (`resultMarkdown`): one display equation that reads as a statement,
followed by its notes.

```
$$
x^{2}-5x+6=0 \quad\Longrightarrow\quad x = 3,\quad x = 2
$$
```

## Failure behavior

| What happens                              | Shown as                                              | Cached |
| ----------------------------------------- | ----------------------------------------------------- | ------ |
| Unreadable input (`x+`, `\frac{1}{`)      | "Can't read this" + where                             | yes    |
| Out of scope (mod, max…)                  | "Not supported yet" + Use the advanced engine         | yes    |
| 1/0, 0/0                                  | "Undefined"                                           | yes    |
| Engine's 4 s limit (`ce.timeLimit`)       | "Too complex", worker kept                            | yes    |
| Worker busy past 8 s (non-cooperative)    | "Took too long"; worker terminated, a fresh one next  | no     |
| Worker crashes                            | "The engine stopped"; the queue goes on               | no     |
| Worker can't load (offline, never cached) | "Couldn't load the math engine", once for all waiting | no     |
| No `Worker`                               | "Not available in this browser"                       | no     |
| Cancel (button or Esc)                    | "Cancelled"; a running request terminates the worker  | no     |

A running request can only be stopped by terminating the worker, because the
engine is synchronous. The next request starts a fresh one (from cache). There is no main-thread fallback, for the reason given in
interactive-examples.md: whatever stops the worker loading stops a main-thread
engine the same way, and keeping both would ship the engine twice.

## UI

- The composer (math-input.md): a math field with its keypad (Math, the
  default) or a monospace textarea (Text), and the button for the implied
  operation, Evaluate or Solve. Under it, why the input can't be read (and,
  in Text, "Reads as" with the input drawn).
- The other operations as a row (Evaluate or Solve, Simplify, Numeric), then
  Solve for [auto]. "Computing…" (or
  "Loading the math engine…" the first time) appears after 150 ms, with Cancel.
- The result card names the operation and shows Input, Exact, other forms, ≈,
  solutions (one line each, complex ones tagged), and notes. Its actions are
  Copy, Add to rough work, and Insert into document…. Esc in the input cancels
  or clears, and the panel stays open.
- Input and last result survive switching tabs in this session (module state)
  but aren't stored.
- **Add to rough work** appends to the pad Rough work shows (or a new one,
  linked to the open document), refuses past the pad's 200k limit, and toasts
  "Added to “…”" with **Show**.
- **Insert into document…** is Rough work's `InsertDialog` and
  `insertRoughWork`: the same re-checks (document unchanged, not open in the
  editor), the same flash on the inserted span, and the same Undo.

## Responsiveness

Measured in `tests/e2e/compute.spec.ts` (production build): while the engine
computes `100000!` (about a second of CPU), the page records **no long task**,
and typing continues. The test first blocks the page for 120 ms itself and
checks that the observer records it, so a zero means none happened.

## Debugging

- Wrong or surprising answer: reproduce in Node with the real engine. The unit
  tests do exactly that (`compute(ce, { op, input })`). Check `prepareInput(input)`
  first: most surprises are the input reading differently than intended, which
  is what "Reads as" is for.
- "Couldn't load the math engine": the worker file wasn't cached and the network
  is down. DevTools → Application → Cache Storage → `localdox-assets` should
  hold `compute.worker-*.js` after first use.
- Client state: `(await import("/src/services/compute/compute.ts")).computeClient.stats()`
  in dev (cache entries, ready, workers started, posted, queued).

## Known limits

- Equations in one unknown. Systems, inequalities, integrals, derivatives,
  limits, sums and matrices go to the advanced engine (routing in
  math-compute-advanced.md).
- Non-polynomial equations may have solutions the engine doesn't find
  (`|x| = 3` gives only 3; `2^x = 8` gives none). The result says so.
- Trigonometric solutions are listed for one period only.
- Factored forms only for polynomials whose roots are all rational. `x³ − 1`
  gets no factored form rather than the engine's `(x√x−1)(x√x+1)`, which is
  wrong for x < 0.
- Distinct roots very close together (a double root 5×10⁻⁴ from a simple one)
  can come back as near-equal roots with tiny imaginary parts. Degree above 40
  is refused.
- Approximations are double precision, 12 significant digits. Coefficients in
  the root finder are doubles too, so exactness of roots comes only from the
  verified substitution.
- `e` is Euler's number and `i` the imaginary unit, so neither can be an
  unknown.
- No history: one result at a time, kept for the session.

## Tests

- `tests/compute-engine.test.ts` (14), against the real engine: plain-text
  conversion; refusals; operation routing; syntax/unsupported/undefined/timeout;
  exact versus approximate; polynomial forms; domain notes; complete
  polynomial/rational solving; engine solving with checks and caveats; the root
  finder (multiplicity, Wilkinson degree 10); every result rendered by KaTeX;
  the Markdown carried by Copy, Add and Insert.
- `tests/compute-client.test.ts` (13): worker protocol, caching and keys,
  ordering, timeout, the time limit not covering load, crash, failed start and
  no-Worker, cancellation (queued and running), warm-up, bounded cache; and for
  the advanced engine, loading stages, a reported failed load, a stalled load,
  custom keys.
- `tests/e2e/compute.spec.ts` (5): evaluate → copy → add to rough work →
  insert (Cancel leaves the document byte-identical), direct insert from
  Compute, labelled failures (and the advanced engine offered or asked for)
  and the choice of variable, no long task while
  computing plus cancellation, and offline after first use (production only).
- `tests/e2e/bundle-journeys.spec.ts`: the `compute` journey (ceiling 320 KiB
  gzip, the worker must be fetched) and "the math engine ships only inside its
  worker".
