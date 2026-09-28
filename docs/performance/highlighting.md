# Highlighting performance and correctness

Measured locally on 2026-09-27 in headless Chromium 153.0.8010.12 on macOS arm64. DevTools MCP was not available in this session; Playwright drove Chrome's DevTools Protocol CPU profiler, performance metrics, and timeline tracing instead.

## Decision

Keep browser-native CSS Custom Highlights and JavaScript. Move Markdown search highlighting out of React's renderers and into CSS ranges, alongside saved highlights. Use exact CSS ranges for PDF matches too. No new production dependency or native service is necessary for the measured workload.

mark.js was substantially slower. The compiled C++ prototype was close to JavaScript: a 0.3 ms median advantage for 4,000 matches, with a higher maximum sample. That is insufficient evidence of a practical application benefit, especially before adding Unicode support and module startup. Rust was not benchmarked; these results do not establish that every Rust/C++ implementation is slower.

## Controlled benchmark

4,000 paragraphs, 8,000 existing elements, one phrase crossing a `strong` boundary in every paragraph. Each variant ran 11 times, with the first two excluded from median/max calculations. Each run rebuilt the document and invalidated its text index. Timings below include matching and range/wrapper creation/registration, but exclude the subsequent browser rendering opportunity. Raw results also record a two-animation-frame completion interval; that interval includes scheduling/vsync and is not pure paint time.

| Implementation | Median synchronous time | Maximum measured time | Resulting elements |
| --- | ---: | ---: | ---: |
| JavaScript + CSS ranges | 3.0 ms | 4.5 ms | 8,000 |
| mark.js 8.11.1 `mark`, across elements | 239.8 ms | 661.6 ms | 16,000 |
| mark.js 8.11.1 `markRanges` | 300.0 ms | 311.2 ms | 16,000 |
| C++ WebAssembly + CSS ranges | 2.7 ms | 6.4 ms | 8,000 |

All variants produced 4,000 logical matches. mark.js creates two wrappers for each cross-element match. The C++ prototype uses UTF-16 Boyer–Moore–Horspool matching with ASCII case folding. Its measurement includes copying text into WASM and constructing JavaScript DOM ranges, but excludes WASM download/compilation. Production Unicode matching and anchor-context behavior are not implemented in the prototype.

A separate anchor workload located 500 different passages in the same document: the original implementation took 33.0 ms median, versus 25.8 ms after the fixes (about 22% less). This is the expensive re-anchoring path after content changes; ordinary saved highlights use their stored offsets.

These are single-machine synthetic results, with fixed variant order and no CPU throttling. They are not a universal speed ranking or a guarantee for arbitrarily large documents.

## Application profile

A real 1,000-paragraph Markdown upload and search-result selection produced 1,000 CSS query ranges, zero `mark` elements, and no browser exceptions. The article stayed at **2,018 elements before and after search**. The initial implementation had 9,018 elements after the equivalent query.

The final CDP measurement around result selection and two rendering opportunities recorded 24.8 ms task time, 9.7 ms script time, 0.14 ms layout time, and 0.95 ms style recalculation. Heap growth was approximately 4.5 MB before GC; this is allocation during the interaction, not retained memory or evidence of a leak.

Other work changed the app's command palette into a sidebar search panel during this investigation. Consequently the original and final whole-app timings are not a controlled before/after comparison. The controlled library benchmark and the article DOM counts are the stronger evidence for the highlighting changes.

## Correctness fixes

- Match in the original UTF-16 string. Previously `İ target` selected `arget` because lowercasing changed the string length before the stored offset.
- Drain pending mutation records before reading cached offsets, avoiding detached-node ranges during same-task React updates.
- Keep a separate text index per content container, with cleanup on replacement/unmount.
- Repaint after async text replacement, including syntax plugins, embeds and folded sections.
- Share CSS color groups without one pane clearing another pane's ranges.
- Search across inline formatting without rebuilding Markdown renderers or adding wrapper elements.
- Remove the 400-occurrence anchor cutoff, so a quote near occurrence 551 can resolve correctly.
- Hit-test the ranges actually painted, including highlights re-anchored into a different reading mode. Allow whole-document highlights to appear in paginated mode.
- Avoid repeated identical repair writes for partially edited passages.
- PDF search now paints individual character ranges rather than whole spans, preserves Unicode offsets, and excludes marked-content records from text-span indices.
- PDF match mapping advances through text items instead of restarting for every match. Page results are batched and the scan yields between batches so cached pages cannot monopolize the main thread.

## Validation and artifacts

- TypeScript: `bun run typecheck` passed.
- Unit tests: `bun run test` passed, 198 tests.
- Production build and prerender: `bun run build` passed.
- Browser regressions: all 4 tests passed. `tests/e2e/highlighting.spec.ts` covers Unicode, punctuation, whitespace, repeated anchors, synchronous DOM replacement, shared CSS groups, actual app highlight creation/repainting/search, recoloring/removal, and real PDF match navigation/cleanup.
- Focused lint passed for the text index, registry, PDF matcher, PDF canvas and PDF search hook. `MarkdownViewer.tsx` still has existing `any`-type errors and hook warnings in its renderers; these are outside the changed highlighting logic.
- Tested in Chromium. Cross-browser behavior and unlimited document sizes are not certified. CSS Custom Highlight API support is required.

Raw summaries: [controlled benchmark](./highlighting-benchmark.json), [app metrics](./highlighting-app-profile.json).

Local profiling artifacts are in `test-results/highlighting/`: per-variant `.cpuprofile` files, `app.trace.json`, and the initial snapshots. Open CPU profiles in Chrome DevTools' Performance panel; the timeline trace is also compatible with trace viewers. These generated artifacts are git-ignored and may be removed by test cleanup.

## Reproduce

The benchmark adds no npm dependency. Fetch pinned mark.js into the artifact directory and compile the benchmark-only C++ source with a WebAssembly-capable clang (tested with WASI SDK 25.0):

```sh
mkdir -p test-results/highlighting
curl -fL https://unpkg.com/mark.js@8.11.1/dist/mark.min.js -o test-results/highlighting/mark.min.js
/path/to/wasi-sdk/bin/clang++ --target=wasm32-unknown-unknown -O3 -nostdlib -Wl,--no-entry -Wl,--export-all -Wl,--initial-memory=33554432 -o test-results/highlighting/matcher.wasm bench/highlighting/matcher.cpp
# Optional original anchor implementation, from this investigation's base:
git show 83262d429a37c84555b4d334a782895dc5ac16c6:src/lib/markdown/text-offsets.ts > test-results/highlighting/text-offsets-before.ts
node bench/highlighting/run.mjs
```

For an application trace, run the dev server on port 4175, then `node bench/highlighting/app-profile.mjs`. Set `BENCH_URL` to profile another local server. Run browser regressions with `node node_modules/@playwright/test/cli.js test tests/e2e/highlighting.spec.ts --output=test-results/highlighting-tests`.

Background references: [CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API), [mark.js options and markRanges](https://markjs.io/), [WebAssembly JavaScript API](https://webassembly.org/getting-started/js-api/), [WASI SDK](https://github.com/WebAssembly/wasi-sdk).
