# Advanced math decision

The SymPy/Pyodide feature has been removed from the shipped app. Compute keeps
one input and the existing keyboard, with lightweight local arithmetic,
algebra and basic calculus. There is no subject picker or 10.9 MB download.

See [Math Compute](math-compute.md) for supported operations and
[the benchmark](../docs/performance/compute-benchmark.md) for startup, memory,
per-operation timings, methodology and limitations.

The previous SymPy implementation lives only in scripts/compute-reference.
Run `npm run bench:compute` to reproduce the comparison, and
`npm run test:compute-reference` to validate that reference. Neither
command is part of app startup, production builds or the ordinary test suite.
Old localdox:advanced-math consent values have no effect.
