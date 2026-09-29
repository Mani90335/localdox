# Optional feature bundle budgets (B03)

The production build keeps heavy capabilities behind their user journeys. B03
adds a repeatable download-size gate and shares KaTeX across reading, Mermaid
math labels, and HTML export. It does not replace Babel or narrow accepted TSX,
spreadsheet, PDF, or conversion formats.

## Measured journeys

2026-09-29, Windows, Node 24.18.0, installed Chrome 154.0.8037.58, Vite 8.1.4.
Baseline: `cc6e4c54aedff911fb1d794dd163b180677e583c`. Both builds use the
same installed dependencies and fixtures. Each journey starts in a fresh browser
context, with service-worker registration disabled. It waits for the existing
B02 idle reader warm-up, then measures the additional feature requests. Edit and
export start with a rendered math note; the math keyboard starts in its editor.
Conversion includes opening a CSV and then converting it. The diagram fixture
contains a math label. These prerequisites matter when interpreting the totals.

| Journey | Before, KiB gzip | After, KiB gzip | Ceiling, KiB gzip |
| --- | ---: | ---: | ---: |
| Import ordinary Markdown | 0.0 | 0.0 | 5 |
| First PDF | 517.4 | 517.4 | 570 |
| First conversion, including CSV viewer | 3038.4 | 3038.4 | 3250 |
| First flowchart with math label | 420.1 | 345.2 | 390 |
| First edit | 8.4 | 8.4 | 12 |
| First HTML export after reading math | 215.3 | 140.4 | 165 |
| First XLSX | 156.6 | 156.6 | 180 |
| First interactive React example | 764.7 | 764.7 | 840 |
| First math keyboard | 215.0 | 215.0 | 240 |

The gate sums decoded JS/MJS/WASM responses recompressed independently with
Node's default `gzipSync`. It includes dedicated-worker requests through the
browser context, not just the page's Performance API. It is a deterministic
size comparison, not a measurement of network transfer headers, Brotli, latency,
INP, memory, or physical-device performance. CSS and fonts are recorded separately
in each report's `allAssetGzip`, but are not executable-budget bytes. Font request
timing can move those ancillary bytes between phases. No five-run latency claim
is made. The Vite preview's on-demand compression of conversion WASM is slow on
this host; the size harness allows 60 seconds for conversion to complete. The
finalized harness was also run against Nitro and produced the same executable
byte totals. Offline verification uses static hosting: this Nitro build returns
404 for the prerendered `/_shell.html`, whereas Vite preview and a static server
serve it correctly.

The shell's bytes are additional to this table. The existing idle reader preload
and offline precache policy remain in place; this does not claim the overall
200 KiB startup target is met. Budgets are explicit regression ceilings with
modest headroom, not goals to increase bundles toward.

## Why KaTeX was duplicated

The app resolves KaTeX 0.17.0. Mermaid and rehype-katex each resolve a nested
0.16.47 installation. The baseline emits two named KaTeX chunks plus a copy
inside `media-bundle`. The diagram's math-related paths fetch both named chunks;
export fetches its embedded renderer even after the reader has loaded one.

`resolve.dedupe: ["katex"]` selects the root renderer for all three consumers.
The client build now contains one `node_modules/katex/dist/katex.mjs` module,
257,867 raw / 76,548 gzip bytes. Export's own chunk falls from 271,943 to 12,870
raw bytes. Across the named renderer and export chunks, this removes 517,859
raw bytes (153,500 gzip bytes). This is an intentional bundler compatibility
choice across the dependencies' version ranges; rerun the math, export and
diagram checks when updating any of those dependencies. No dependency version
or lockfile changed.

Other substantial assets remain optional: Babel's worker is 2,967,068 raw bytes,
MathLive 807,992, XLSX's worker 430,570 (including its protocol), PDF's worker
1,265,413, and conversion WASM 6,691,779. The 1,821,047-byte chunk from the audit
is Excalidraw's vendor output, not a common vendor bundle fetched by these nine
journeys. The emitted module report identifies its owner. A future compiler
replacement needs a separate syntax-compatibility decision; worker execution
alone does not reduce download size.

## Running and reviewing the gate

```sh
npm run build
npm run test:bundles
```

On hosts using installed Chrome rather than Playwright Chromium, set
`PLAYWRIGHT_CHANNEL=chrome`. Set `BUNDLE_RESULTS` to a directory to retain JSON
files as well as Playwright attachments. The launcher requires a production
report, forces production tests and enables assertions; it cannot silently skip
the gate or inherit record-only mode. Use a production server on port 4175;
Playwright otherwise starts Vite preview there.

`build/vite-bundle-report.ts` emits `bundle-report.json` with raw/gzip bytes,
client module ownership, and static/dynamic imports. Worker outputs appear as
assets, with their sizes but without an internal module graph. It runs after the offline manifest,
so diagnostics are excluded from offline downloads. The build regression checks
that exclusion and that exactly one KaTeX implementation exists. Browser checks
validate useful rendered output, required worker/engine requests, no heavy
capabilities on empty startup (including module ownership to catch merged chunks),
and the per-journey ceilings. Import/edit cannot fetch optional runtimes. Export
must reuse the reader's KaTeX. These checks fail on the original diagram/export
sizes; simply renaming the chunks cannot evade the size ceilings.

To measure an older build, copy the journey spec into a separate checkout and
run it with `PLAYWRIGHT_PRODUCTION=1`, `BUNDLE_RECORD_ONLY=1`, and
`--grep "optional bundle journey"`. Record-only mode is for evidence collection,
not the gate. Do not overwrite the original audit evidence.

Raw before/after reports and selected asset inventories are in
[`docs/b03-bundles`](../docs/b03-bundles). Chrome DevTools MCP independently
verified a combined reader-math + diagram + export journey: one renderer request,
rendered math in both views, MathML in exported HTML, and no console warnings or
errors; see [`devtools.json`](../docs/b03-bundles/devtools.json).

Validation: typecheck, production build, focused ESLint, 467 unit tests (two
credential-dependent skips), and all ten bundle checks pass. Across production
reruns, 33 of 34 related browser cases pass. The remaining 2,000-equation stress
case is not certified on this host: the untouched baseline records a 257 ms task
against its 100 ms gate; the changed preview records 153 ms, and later changed
build runs time out waiting for completion. These single observations do not
establish equivalent performance or an improvement. The intermittent CSP event
assertion also reproduces on baseline and passes the final static-build rerun.
No existing threshold or assertion was weakened. Full counts and server-specific
limitations are in [`verification.json`](../docs/b03-bundles/verification.json).
