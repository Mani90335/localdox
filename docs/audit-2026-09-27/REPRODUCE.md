**Reproduce the audit**

Use the repository root, installed dependencies, and Playwright's Chromium. Browser scripts create isolated temporary profiles and use synthetic or repository fixture files. They do not use your existing browser profile or upload documents to the share service. The production preview is expected on port 4176.

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 4176 --strictPort
```

In another terminal, run cases separately so workloads do not compete:

```sh
node bench/audit/profile.mjs
node bench/audit/scenarios.mjs
node bench/audit/deep.mjs
node bench/audit/ui.mjs
node --experimental-strip-types bench/audit/correctness.mjs
npx playwright test --config bench/audit/playwright.config.ts
npm test
npm run typecheck
npx eslint src tests build vite.config.ts --format json
```

The scripts overwrite their audit evidence files. `profile.mjs` accepts `AUDIT_URL`; the other scripts currently use the fixed localhost URL. `profile.mjs` stores a DevTools trace at `docs/audit-2026-09-27/long-document.trace.json`; import it into Chrome DevTools → Performance. `coverage.json` is raw CDP precise coverage, not a source-map attribution report.

`scenarios.mjs` retains two harness limitations for transparency: the 500-edge Raw test waits for SVG although that case can switch to canvas; the offline test can lose its execution context while collecting the final snapshot. Use `ui.mjs` for the definitive 500-edge Stepped measurement and `deep.mjs` for the completed offline check. Do not classify those harness errors as application exceptions.

`deep.mjs` transpiles the actual persistence module and exposes it in an isolated page for measurement. The only runtime import is an import-validation helper; it is stubbed because the measured database operations do not call it. This harness tests actual IndexedDB operation costs, not the app's entire startup lifecycle. `correctness.mjs` uses fake-indexeddb with two independently imported module instances to reproduce tab-local caches and stale writes deterministically.

The initial throttled profile used three runs; other workloads are single observations. Long-task arrays accumulate within the profile page, and later snapshots include earlier interactions. Do not interpret them as separate navigation CWV samples. `uploadToSettledMs` includes 1.5 seconds of intentional settling. PDF RGBA bytes are calculated as width × height × 4 and exclude native/GPU intermediate surfaces. No forced-GC leak analysis was performed.

For future comparisons, stop other workloads, use the same build/browser/hardware, run each stress case at least five times, add physical-device checks, and preserve raw results per build rather than overwriting the baseline directory.
