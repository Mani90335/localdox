# SymPy benchmark reference

This is the previous SymPy pipeline, kept only to reproduce the engine comparison.
It has no browser entry, worker, Vite plugin, or app import. Pyodide is a development
dependency; it is never published or downloaded by the app.

Run `npm run bench:compute` for three fresh processes per engine and timings of
the same inputs, including explanation generation. The script writes
`docs/performance/compute-benchmark.json`. Run `npm run test:compute-reference`
to validate this baseline separately from the ordinary test suite.

The first developer run may download the two pinned Python wheels into
node_modules/.cache. Their SHA-256 hashes are checked against Pyodide's lockfile.
Later runs use those cached assets; benchmark startup excludes network time.
