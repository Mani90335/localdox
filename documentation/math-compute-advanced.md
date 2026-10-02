# Math Compute: the advanced engine (SymPy)

The Compute tab (math-compute.md) has a second engine for graduate-level work:
calculus, linear algebra, probability and random variables, statistics,
transforms and differential equations. It is **SymPy**, the standard Python
computer algebra system, running on the device in a Web Worker through
**Pyodide** (CPython compiled to WebAssembly). It is downloaded only after the
reader agrees (10.9 MB, once), and after that it works offline.

## The problem

The basic engine (Compute Engine 0.58, ~300 KB) is right for arithmetic,
algebra and single-variable equations. When probed at graduate level it
fails, and some failures are wrong answers rather than refusals:

| Probe                            | Basic engine                             |
| -------------------------------- | ---------------------------------------- |
| d²/dx² x⁴                        | "dx²"                                    |
| Σ k, k = 1…n                     | 50015001                                 |
| Σ 1/n²                           | 1.644834 (true: 1.644934)                |
| ∫ e^{−x²} over ℝ                 | 1.7729 ± 0.0004 by random sampling, ~1 s |
| 3×3 inverse                      | crashes                                  |
| (1+i)¹⁰                          | decimal noise in an "exact" result       |
| lim, series, ODEs, distributions | unsupported                              |

A learner can't tell an engine's error from their own, so a wrong answer is
worse than none. Growing our own CAS on top of that engine would be a large,
error-prone project.

## Mental model

There are now two calculators on the desk. The small one is always within
reach and answers instantly. The big one, a full computer algebra system, is
in a cupboard: the first time a question needs it, the app asks before
fetching it (it's large). After that it stays on the desk, even offline. The
reader asks questions the same way either way, and each answer says which
calculator gave it (a **SymPy** badge).

## Choosing the engine

| Candidate                                        | Verdict                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SymPy 1.14 on Pyodide 314.0.7** (BSD, MPL-2.0) | **Chosen.** Complete, well-tested symbolic mathematics: `diff`, `integrate`, `limit`, `series`, `dsolve`, `solveset` (with full periodic solution sets), exact matrices (`rref`, `eigenvects`, `diagonalize`, Jordan form), `sympy.stats` (random variables, `P`, `E`, `variance`, densities, conditioning), transforms, residues, arbitrary precision (mpmath). |
| Extend the basic engine                          | Its gaps and wrong answers (above) would each need our own algorithm; a small fraction of SymPy's coverage, at high risk.                                                                                                                                                                                                                                        |
| Giac/Xcas (WASM)                                 | Strong, but GPL.                                                                                                                                                                                                                                                                                                                                                 |
| SymPy for everything                             | One engine, but even 1/2 + 1/3 would cost the download and a multi-second start.                                                                                                                                                                                                                                                                                 |

So there are two tiers. The basic engine answers what it can read; anything
else goes to SymPy (routing below).

### Cost

Measured on the production build (`tests/e2e/bundle-journeys.spec.ts`,
journey `advanced`, gzip as the gate measures it). Wheels are already
compressed.

| File                                     |     KiB gzip |
| ---------------------------------------- | -----------: |
| sympy-1.14.0 wheel                       |       4017.6 |
| pyodide.asm.wasm (CPython)               |       3516.4 |
| python_stdlib.zip                        |       2445.1 |
| mpmath-1.4.1 wheel                       |        417.4 |
| pyodide.asm.mjs + pyodide.mjs            |        262.2 |
| advanced.worker (parser, runner, bridge) |         81.7 |
| **Advanced engine**                      | **≈ 10,740** |

The journey total is 11,034 KiB, because it also includes the basic engine,
which the tab loads anyway. The ceiling is 12,000. The consent message's
figure (10.9 MB) is computed at build time from the published files.

The Notes panel chunk grows 5.4 KiB gzip for this UI (18.5 → 23.9). Nothing
loads at startup: the offline shell doesn't list the engine, and a build
check asserts it.

Timing, measured in Chromium on the development Mac (2026-10-02). With the
engine cached, a reload reaches the first answer in **2.8 s** (Python ready in
0.9 s, SymPy and the bridge in a further 1.7 s). Warm computations took
**50–310 ms**; the slowest was a normal probability, P(−2 < X < 2). The first
load also waits for the download: 26.6 s against Vite's preview server, which
re-compresses every file on each request, so that figure overstates a real
host. Expect the download time for 10.9 MB plus about 3 s.

## Architecture

```
ComputePanel ── needsAdvanced(input)? ──no──▶ basic engine (math-compute.md)
   │ yes, or an advanced tool, or "Use the advanced engine"
   ▼
consent? (localStorage "localdox:advanced-math") ──no──▶ ConsentCard
   │ yes                                                (Download and compute / Not now)
   ▼
import("advanced/advanced") ── createComputeClient(...) ── new Worker(advanced.worker)
                                  │ {type:"init", base:"/pyodide/314.0.7/"}
advanced.worker.ts                ▼
   progress "runtime" ─ import(base + "pyodide.mjs") ─ loadPyodide({indexURL: base})
   progress "sympy"   ─ loadPackage("sympy")  (checked against the trimmed lock)
   runPython(bridge.py) ─ ready
   request ─▶ run.ts: parseStatements ─ prepareInput(advanced) ─ preprocessLatex
              ─ parse (latex-syntax, 62 KB) ─ normalize ─▶ JSON ─▶ bridge.run (Python)
          ◀─ ComputeResult (JSON) ◀───────────────────────────────────┘
```

- **Routing** (`advanced/routing.ts`, pure). Advanced if the input has
  several statements, `~`, `let`, `:=` or `assume`; LaTeX such as `\int`,
  `\lim`, `\sum`, `\frac{d}{dx}`, `\partial`, `\binom`, `\det`, matrices; primes
  (`y''`); relations (`<`); commas; `[[…]]`; `E[…]`, `P(…)`; or a named function
  only SymPy knows (`Var(…)`, `det(…)`). Otherwise basic. A basic
  "unsupported" answer is re-run on SymPy automatically once the reader has
  agreed to it. Before that, the failure card offers **Use the advanced
  engine**. An incomplete basic Solve ("Found") offers **Try the advanced
  engine**.
- **Consent.** Remembered per device. Declining downloads nothing (an e2e
  test checks no `/pyodide/` or `advanced.worker` request is made).
- **One client for both engines** (`compute-client.ts`, now generic): the
  same queue, cache (key: op + input + params), cancellation and failure
  handling, plus loading stages (`progress` messages), a `failed` message (a
  rejected promise in a worker never reaches the page), and a load time limit
  (180 s). Pyodide hangs rather than fails on a bad WebAssembly response, so
  without that limit the panel could spin forever.
- **Timeouts.** SymPy can't be interrupted: that needs SharedArrayBuffer,
  hence cross-origin isolation, which the app doesn't have. A computation
  past 30 s is stopped by terminating the worker; the next request restarts
  Pyodide from the cache (≈ 3 s).

### Publishing and supply chain

`build/vite-pyodide.ts` publishes the engine under a versioned
`/pyodide/314.0.7/` (in dev, from node_modules and a cache directory):

- The runtime files (`pyodide.mjs`, `pyodide.asm.mjs`, `pyodide.asm.wasm`,
  `python_stdlib.zip`) come from the `pyodide` npm package, pinned in
  package.json and bun.lock.
- SymPy and mpmath are wheels Pyodide doesn't ship on npm.
  `build/pyodide-packages.ts` downloads them once from Pyodide's own release
  into `node_modules/.cache/localdox-pyodide/`, and accepts them only if their
  SHA-256 matches the npm package's `pyodide-lock.json`. The chain of trust is
  bun.lock → pyodide → its lock file → the wheels. A mismatching or corrupted
  wheel is refused, or downloaded again (unit-tested with a fake fetch).
- The published `pyodide-lock.json` is trimmed to `sympy` and `mpmath`, so
  nothing else can be loaded.
- The worker compiles WebAssembly from bytes when streaming compilation
  refuses the response's MIME type. Vite's preview server sends
  `application/octet-stream`; Firebase Hosting sends `application/wasm`.

### Security: input is never code

Python in Pyodide can reach JavaScript (`import js`), and from the worker, the
origin's IndexedDB: the reader's documents. Text pasted from a document must
therefore never run as Python. That rules out SymPy's own `parse_expr` and
`sympify` on strings, which `eval`.

1. JavaScript parses the input to MathJSON (Compute Engine's LaTeX parser),
   and `normalize.ts` reduces it to a fixed set of heads. Names must match
   `[A-Za-z][A-Za-z0-9_]*`.
2. `bridge.py` builds SymPy objects from that tree through an allow-list
   (`HANDLERS`, `UNARY`, `BINARY`, `RELATIONS`). It never calls `getattr` on a
   user string, never `eval`s or `exec`s, and checks names again (no leading
   `_`). Numbers must match a number pattern.
3. A test sends `__import__`, `x.__class__`, `__builtins__`, an unknown head
   and a non-number "Number" both ways: through the JavaScript side, and as a
   hand-made request straight to the bridge. All are refused, and nothing ran.

## Notation

Several statements, one per line (or `;`):

```
assume x > 0                 assumptions: > 0, ≥ 0, < 0, ≠ 0, or words
assume n positive integer      (positive, negative, nonnegative, real, integer, …)
let A = [[1, 2], [3, 4]]     definitions (also A := …); functions: let f(x) = x^2 + 1
X ~ N(0, 4)                  random variables, independent of each other
P(-2 < X < 2)                what to compute: every other line
```

- Plain text works in the advanced tier too, with relations (`<=`, `!=`),
  lists (`[1, 2, 3]`), matrices (`[[1, 2], [3, 4]]`, shown as a matrix), primes
  (`y''`), Greek names (`theta`), `oo` for ∞, `given` for a condition, and named
  functions: `diff(f, x, n)`, `integrate(f, x, a, b)`, `limit(f, x, a)`,
  `sum(f, n, a, b)`, `det`, `inv`, `transpose`, `Var`, `Cov`, `pdf`, `cdf`,
  `binomial`, `gamma`, `erf`, `log(x, b)`…
- LaTeX notation the parser doesn't know is rewritten first
  (`preprocessLatex`): `\binom`, `\frac{d^2}{dx^2}`, `\frac{\partial^2 f}{\partial x\partial y}`,
  `\frac{dy}{dx}` and `\frac{d^2y}{dx^2}` (y becomes a function of x),
  `\lim_{x\to 0^+}` (the side is kept), `\nabla`, `\mathbb{E}`, `\Pr`, and
  `E\left[…\right]` / `E\lbrack…\rbrack` (as plain `E[…]`: the parser read E
  followed by `\left[` as E alone and dropped the rest; `P\left[…\right]`
  becomes `P(…)`).
- **A d/dx applies to the term after it**, up to the next top-level `+`, `−`,
  relation, comma or `;`, as on paper: `\frac{d}{dx}(x^2)+4` is 2x + 4, and
  `\frac{d}{dx}(x^2)\cdot 3` is 6x. The parser reads `\frac{d}{dx}` as
  applying to everything after it (it made the first 2x), so `scopeDerivatives`
  puts each d/dx and its term in parentheses, innermost first so d²/dx² nests.
  Inside an integral the term stops before its `dx` (or a `\,`).
- `P(…)` or `E[…]` with nothing inside is a "Can't read this", not a crash.
- Juxtaposition is resolved deliberately: `Var(X)` and `Γ(5)` are calls,
  `x(x+1)` is a product, `y(0)` is a call when y is a function (it has a prime,
  a dy/dx or a `let`). Case matters for one letter: `E[X]` is an expectation,
  `e(x+1)` is e·(x+1). `β(a, b)` with two arguments is the beta function.
- Inside a sum, integral or limit, the variable is bound: in `\sum_{i=1}^{3} i^2`,
  `i` is the index, not √−1.

### Distributions and how parameters are read

Conventions differ between textbooks, so each result says how its parameters
were read ("Read X as Normal: mean 0, variance 4").

| Write                  | Parameters                                                          |
| ---------------------- | ------------------------------------------------------------------- |
| `N`, `Normal`          | mean, **variance** (σ²)                                             |
| `LogNormal`            | log-mean, log-variance                                              |
| `U`, `Uniform`         | a, b                                                                |
| `Exp`                  | rate λ                                                              |
| `Gamma`                | shape, **rate**                                                     |
| `Beta`                 | α, β                                                                |
| `Chi2` / `\chi^2`, `t` | degrees of freedom                                                  |
| `Cauchy`, `Laplace`    | location, scale                                                     |
| `Weibull`, `Pareto`    | scale, shape                                                        |
| `Erlang`               | shape, rate                                                         |
| `Bern`                 | p                                                                   |
| `Bin`                  | n trials, p                                                         |
| `Pois`                 | rate                                                                |
| `Geom`                 | p; counts trials up to and including the first success (1, 2, 3, …) |
| `NB`                   | r, p; failures before the r-th success                              |
| `Hypergeom`            | population N, successes in it, draws                                |
| `DU`                   | integers a…b                                                        |

Queries: `P(event)`, `P(A given B)` (or `\mid`), `E[expr]`, `Var`, `SD`, `Cov`,
`Corr`, `pdf(X)`, `cdf(X)` (in the lowercase variable), `mgf(X)` (in t),
`median`, `skewness`, `kurtosis`, `entropy`. Expressions of several
independent variables work (`E[(X+Y)^2]`).

## Operations

The four buttons work for both tiers. On SymPy, Evaluate carries out
integrals, sums, limits, derivatives and probabilities, and allows symbols.
Simplify adds Expanded, Factored, Partial fractions and Trigonometric forms.
Solve uses `solveset` over ℝ: full solution sets, including periodic ones
(`{2nπ + π/6 | n ∈ ℤ} ∪ …`), inequalities as intervals, and systems
(`linsolve`, else `nonlinsolve`). With other symbols it solves generically and
notes what that assumes. An equation with derivatives goes to `dsolve`, and
`y(0) = 1` and `y'(0) = 0` on their own lines are initial conditions.

The **Advanced** section adds operations that need settings:

| Field       | Operations                                                                                                                                                                                                   | Settings                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Calculus    | Derivative, Integral, Limit, Series, Gradient, Hessian, Jacobian                                                                                                                                             | variable(s), order, bounds (empty = antiderivative), point and side, centre |
| Matrices    | Determinant, Inverse, Transpose, Trace, Rank, RREF (+ pivots), Null space, Column space, Eigenvalues (× multiplicity), Eigenvectors (eigenspaces), Characteristic polynomial, Diagonalize (else Jordan form) | none                                                                        |
| Probability | (Evaluate / Numeric) with example lines to insert                                                                                                                                                            | none                                                                        |
| Statistics  | Summarize: n, mean, median, mode, sample and population variance and SD, min, Q1, Q3, max, IQR                                                                                                               | none                                                                        |
| Transforms  | Laplace, Inverse Laplace, Fourier, Residue                                                                                                                                                                   | from/to variables, point                                                    |

### What each answer says

- `lhs` makes the result a statement: `\det(A) = −2`, `∫₀^∞ x e^{−x} dx = 1`,
  `x ∈ {…}`, `λ ∈ {1, 3}`. **Given** rows list the definitions, distributions
  and assumptions used. Copy, Add to rough work and Insert carry all of this
  (`resultMarkdown`: "Given $X \sim …$." then the display equation, then
  labelled extra results, then notes).
- Exact versus decimal: exact unless the input had decimals (then decimal,
  with a note). The decimal is shown when it adds something; not for
  integers, or Gaussian rationals like 32i or −i/2. Numbers are tidied to
  their shortest exact form: (1+i)¹⁰ → 32i, (e³ − 17/2)/e³ → 1 − 17/(2e³).
- Conventions stated in notes: `+ C` for antiderivatives, and SymPy writes
  ln(u) where a real-variable text writes ln|u|. The Fourier transform uses
  f̂(k) = ∫ f(x) e^{−2πikx} dx. θ(t) is the unit step in inverse Laplace
  results. The Laplace transform states where it converges. Series show
  O(…) for the remainder. ODE answers state their arbitrary constants.
- Undefined and non-existent: a two-sided limit whose sides differ says
  "doesn't exist" with both one-sided values. A singular matrix has "no
  inverse: its determinant is 0". Division by zero is "Undefined". No closed
  form found: "left unevaluated", with a numeric value when there is one
  (mpmath quadrature, not random sampling).

## Failure behavior

Everything in math-compute.md's table applies, plus:

| What happens                                    | Shown as                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| Not yet agreed to the download                  | Consent card; nothing downloaded                                            |
| Download blocked or offline before first use    | "Couldn't load the advanced math engine: …" (the worker's own reason), once |
| Load stalls (no error)                          | Fails after 180 s, instead of spinning                                      |
| Computation past 30 s                           | "Took too long"; worker terminated, a fresh one next time                   |
| A Python exception the bridge didn't anticipate | "The engine couldn't work this out", with its last line as the hint         |
| SymPy can't do it (`NotImplementedError`)       | "Not supported yet" with SymPy's reason                                     |

## Debugging

- Reproduce in Node: `tests/compute-advanced.test.ts` loads Pyodide and the
  bridge exactly as the worker does. Call `runAdvanced(bridge, parseLatex, {op, input, params})`.
- To see what Python received: `bridgeRequest(parseLatex, request).payload` is
  the JSON `bridge.run` gets. Most surprises are a reading problem
  (juxtaposition, a name taken as a function), visible there.
- Stuck on "Loading Python": check the console for a WebAssembly error, and
  the network for `/pyodide/314.0.7/` (404 → the build didn't publish it;
  blocked → offline before first use).
- Upgrading Pyodide: bump the exact version in package.json (frozen
  lockfile, bun 1.4.2). The wheels and hashes follow its lock file. Rerun the
  unit tests: they pin outputs, so a changed SymPy result shows up there.

## Known limits

- Nothing is a proof assistant. Results are what SymPy can compute, and
  "unevaluated" or "couldn't solve in closed form" is said rather than
  guessed.
- Solve is over ℝ by default; complex roots of polynomials come from the
  basic engine (or `domain: complex`, not yet in the UI).
- Random variables are independent; joint distributions, Markov chains and
  stochastic processes aren't in the notation yet.
- Matrices up to 12×12, symbolic eigenvalues of large matrices can hit the
  30 s limit.
- First use needs the network and 10.9 MB. On phones the engine's memory use
  is significant (Python heap); it is released only with the tab.
- Integrals SymPy can't do (∫√(tan x) dx) stay unevaluated.

## Tests

- `tests/compute-advanced.test.ts` (13). Statements; routing; advanced plain
  text; normalizing. Then the real SymPy pipeline across calculus, ODEs,
  solving, linear algebra, probability, statistics, special functions,
  transforms and assumptions. Input never running as Python, on both sides.
  Every result rendered by KaTeX. The Markdown with its givens. Wheel
  verification (tampered download, corrupted cache, trimmed lock).
- `tests/compute-client.test.ts` (+4): loading stages, a reported failed load,
  a stalled load timing out, custom cache keys.
- `tests/e2e/compute-advanced.spec.ts` (5, production build). Consent first,
  and "Not now" downloads nothing. Calculus, probability, matrices and an ODE,
  with no long task on the page while Pyodide loads (with a positive
  control). Givens carried into rough work and a confirmed insertion. An
  incomplete basic answer handed to SymPy. A blocked download reported. Offline
  after first use.
- `tests/e2e/bundle-journeys.spec.ts`: journey `advanced` (ceiling 12,000 KiB;
  the SymPy wheel must be fetched). Optional engine files are never fetched on
  startup.
