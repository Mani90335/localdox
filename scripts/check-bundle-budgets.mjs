import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";

// A production build is required; do not silently skip the budget gate in dev.
await access(".output/public/bundle-report.json").catch(() => {
  throw new Error("Run npm run build before npm run test:bundles.");
});
const result = spawnSync(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "tests/e2e/bundle-journeys.spec.ts",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", env: { ...process.env, PLAYWRIGHT_PRODUCTION: "1", BUNDLE_RECORD_ONLY: "" } },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
