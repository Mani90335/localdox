# Compute engine comparison

Measured 2 October 2026, Windows, Node v24.18.0, 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz.

Decision: keep the existing JavaScript engine and small basic-calculus support.
Remove SymPy/Pyodide from the shipped app, along with subject controls and download consent.
The first-use Python runtime alone was 10.91 MB gzip (18.03 MB raw).

| Metric (median of 3 processes)                    | JavaScript | SymPy/Pyodide |
| ------------------------------------------------- | ---------: | ------------: |
| Local engine startup                              |     0.29 s |       13.36 s |
| Added process memory after workload and GC        |    37.5 MB |      141.9 MB |
| Retained JS heap increase                         |    10.9 MB |       13.5 MB |
| WASM heap allocation (included in process memory) |       0 MB |       65.4 MB |

| Warm operation (median milliseconds) | JavaScript | SymPy/Pyodide |
| ------------------------------------ | ---------: | ------------: |
| fractions                            |       3.05 |          2.22 |
| arithmetic                           |       3.58 |          2.10 |
| trigonometry                         |       2.75 |          2.72 |
| quadratic                            |      15.86 |         34.66 |
| simplify                             |       4.35 |         33.46 |
| derivative                           |       5.70 |         11.88 |
| integral                             |       3.14 |          7.49 |
| definite integral                    |       3.13 |         19.53 |

All eight cases succeeded in all three trials on both engines. The computation
pipelines include input parsing, answer construction and available steps. Native
JavaScript arithmetic alone is not a substitute for the app's LaTeX input,
exact answers, equation solving and explanations.

## Interpretation and limits

Each engine runs in a fresh process, with one first request and 25 warm runs per
case. Values above are medians across the three process trials. Assets are already
on disk: startup excludes internet transfer time and includes module loading and
initialization. The app's answer cache is bypassed; each engine's internal caches
remain active. First-request times and process peak RSS are in the raw JSON.

RSS includes native/WASM allocations; comparing JS heap alone would undercount
Python substantially. The added-memory figure is a retained process-memory delta
after GC, not an isolated peak, and is sensitive to allocator and OS behavior.
These are desktop Node measurements, not mobile/browser speed or memory claims.
The small corpus supports this product decision; it does not rank general CAS
capability. SymPy handles many advanced problems that are deliberately excluded.

SymPy was slightly faster on warmed simple arithmetic. That
millisecond-scale advantage varied between runs and did not offset its startup,
10.9 MB download and larger memory use for a secondary app feature.

The production build is checked separately: no Python assets, no advanced worker,
and the JavaScript engine appears only in a lazy worker outside the startup
precache. The existing 540 KiB first-Compute budget includes the math keyboard.

## Reproduce

Run `npm run bench:compute`. Source: [benchmark-compute.ts](../../scripts/benchmark-compute.ts).
Raw samples: [compute-benchmark.json](compute-benchmark.json). The SymPy baseline
and its optional validation suite are in scripts/compute-reference; pyodide is
a development dependency and no longer participates in production builds.

Production verification (Windows, Chrome 154.0.8037.59): first Compute requested 520.2 KiB gzip of executable code including the existing math keyboard, below the 540 KiB ceiling. The math worker alone is 303.8 KiB gzip. The startup/import gate passed with no Compute engine in page chunks or the initial offline precache. No Python files or advanced worker are published.
