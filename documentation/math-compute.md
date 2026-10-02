# Math Compute

Compute sits beside Notes and Rough work. It has one input, the existing math
keyboard, and a Compute button. There are no subject pickers, chapter tools,
or separate calculus settings. Enter computes in Math mode; Ctrl/Cmd+Enter
computes in Text mode. Equations are solved automatically; expressions with
letters are simplified. Explicit Simplify, Numeric and Solve actions remain
available, including a choice of variable for equations.

The input stays unchanged. Copy, Add to rough work and Insert into document
carry the result and any visible steps. Insertion still asks for confirmation.
Input and the last answer survive switching between the panel's tabs.

## Scope

The existing JavaScript engine handles arithmetic, fractions, powers, roots,
logarithms, trigonometry, simplification and equations in one unknown. Existing
checks distinguish exact values from rounded numbers and incomplete solutions.

Basic calculus uses the same worker. Keyboard forms such as
`\frac{d}{dx}\left(x^3+2x\right)` and `\int_0^1 x^2\,dx`
compute directly, with plain explanations. Supported inputs are first
derivatives and integrals of single-variable polynomials (individual powers
from 0 to 12), plus sin(x), cos(x) and exp(x). Definite integrals require finite
numeric bounds. An indefinite integral includes +C.

Higher and partial derivatives, limits, advanced integrals, matrices,
distributions, transforms and multi-statement definitions are outside this
calculator's scope. Unsupported inputs get a clear message, never a download
offer. The keyboard still supports writing those symbols in math documents.
This is a small convenience beside the reader, not a general math assistant.

## Performance decision

SymPy/Pyodide was removed from the application after comparing the same inputs
through both computation pipelines. It added 10.9 MB gzip of runtime assets,
slow startup and substantially more memory. Some warmed arithmetic was faster
in SymPy, which did not justify its startup and memory costs here.

See [the measured comparison](../docs/performance/compute-benchmark.md) and
its raw JSON. The old engine is retained only under scripts/compute-reference
for reproducible development benchmarks; pyodide is a dev dependency. No
production Vite plugin, Python assets, advanced worker or consent UI remains.

## Architecture and limits

ComputePanel lazily imports compute.ts, which creates compute.worker.ts.
The engine stays off the main thread and outside the offline shell's initial
precache. After first use the worker is available offline. The client caches
up to 100 answers and terminates timed-out or cancelled workers.

Input is limited to 1,000 characters and 32 levels of brackets. The engine
uses a four-second cooperative deadline, backed by an eight-second worker
limit. Calculus checks the raw expression before simplification so cancelled
fractions cannot hide an undefined point inside an integral.

Run the compute unit tests, tests/e2e/compute.spec.ts and
tests/e2e/compute-advanced.spec.ts (now a no-Python regression test). Production
bundle tests enforce the lazy worker and the existing Compute size budget.
