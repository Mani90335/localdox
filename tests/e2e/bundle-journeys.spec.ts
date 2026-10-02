import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { exportFile, openExportMenu } from "./sidebar-menu";

test.skip(!process.env.PLAYWRIGHT_PRODUCTION, "Measures production bundles");
// Disable registration in the top page below. Playwright's "block" init script
// accesses navigator.serviceWorker inside opaque preview frames and throws.
test.use({ serviceWorkers: "allow" });
test.setTimeout(120_000);

// Incremental, cold feature costs AFTER the idle reader warm-up. KiB gzip,
// including worker scripts and WASM. These are regression ceilings, not speed claims.
const budgets = {
  import: 5,
  pdf: 570,
  conversion: 3250,
  diagram: 390,
  // CodeMirror source highlighting, folding, and undo: 193.2 KiB measured.
  edit: 210,
  export: 165,
  spreadsheet: 180,
  interactive: 840,
  keyboard: 240,
  // The engine worker (~303 KiB) and, since Compute's input became a math
  // field, MathLive (~215 KiB; the keyboard journey's library).
  compute: 540,
} as const;
type Journey = keyof typeof budgets;
const optional =
  /(?:compiler\.worker|compute\.worker|advanced\.worker|\/pyodide\/|mathlive\.min|spreadsheet\.worker|pdf(?:\.worker)?-|anydoc_wasm|conversion\.worker|mermaid\.core|media-bundle|react-dom-server|katex-[^.]+\.js)/;
type ReportFile = { file: string; modules?: string[] };
const capabilityModules =
  /node_modules\/(?:@babel\/standalone|@(?:codemirror|lezer)\/[^/]+|@cortex-js\/compute-engine|mathlive|xlsx|pdfjs-dist|mermaid|katex)\//;

async function upload(page: Page, name: string, source: string) {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(source),
    });
}

async function edit(page: Page) {
  await page.getByRole("button", { name: "Options", exact: true }).first().click();
  await page.getByText("Edit", { exact: true }).click();
  await expect(page.locator("#markdown-source")).toBeVisible();
}

function track(context: BrowserContext) {
  let phase = "shell";
  const phases = new WeakMap<object, string>();
  context.on("request", (request) => phases.set(request, phase));
  const pending: Promise<void>[] = [];
  const rows: { phase: string; file: string; bytes: number; gzip: number }[] = [];
  context.on("response", (response) => {
    const file = new URL(response.url()).pathname;
    if (!/\.(?:js|mjs|wasm|zip|whl|css|woff2?|ttf)$/.test(file)) return;
    const requestedPhase = phases.get(response.request()) ?? phase;
    pending.push(
      (async () => {
        expect(response.ok(), file).toBeTruthy();
        const bytes = await response.body();
        rows.push({
          phase: requestedPhase,
          file,
          bytes: bytes.length,
          gzip: gzipSync(bytes).length,
        });
      })(),
    );
  });
  return {
    start() {
      phase = "feature";
    },
    async finish() {
      await Promise.all(pending);
      return rows;
    },
  };
}

for (const journey of Object.keys(budgets) as Journey[]) {
  test(`optional bundle journey: ${journey}`, async ({ page, context }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      if (window !== window.top) return;
      Reflect.deleteProperty(Object.getPrototypeOf(navigator), "serviceWorker");
      localStorage.setItem(
        "localdox:prefs",
        JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
      );
    });
    const traffic = track(context);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
    // B02 intentionally warms the reader at idle. Let it finish before attributing feature cost.
    await page.waitForTimeout(2000);
    await page.waitForLoadState("networkidle");
    const shell = await traffic.finish();
    expect(
      shell.filter((r) => optional.test(r.file)),
      "optional code on empty startup",
    ).toEqual([]);
    if (!process.env.BUNDLE_RECORD_ONLY) {
      const report: { files: ReportFile[] } = JSON.parse(
        await readFile(".output/public/bundle-report.json", "utf8"),
      );
      const loaded = new Set(shell.map((row) => row.file.slice(1)));
      expect(
        report.files
          .filter((file) => loaded.has(file.file))
          .flatMap((file) => (file.modules ?? []).filter((id) => capabilityModules.test(id))),
        "optional modules merged into shell chunks",
      ).toEqual([]);
    }

    if (["edit", "export", "keyboard", "compute"].includes(journey)) {
      await upload(page, "budget.md", "# Budget note\n\nA **complete** note with $E=mc^2$.\n");
      await expect(page.locator("article .katex")).toHaveCount(1);
      if (journey === "keyboard") await edit(page);
      // The Notes panel itself is a prerequisite; the engine is the feature.
      if (journey === "compute") {
        await page.getByRole("button", { name: "Notes", exact: true }).click();
        await expect(page.getByRole("tab", { name: "Compute" })).toBeVisible();
      }
      await page.waitForLoadState("networkidle");
      await traffic.finish();
    }
    traffic.start();
    switch (journey) {
      case "import":
        await upload(page, "budget.md", "# Budget import\n\nOrdinary prose.");
        await expect(page.getByRole("heading", { name: "Budget import" })).toBeVisible();
        break;
      case "pdf":
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles("tests/fixtures/anydoc/text.pdf");
        await expect(page.locator(".pdf-page-area canvas").first()).toBeVisible();
        await expect(page.getByRole("textbox", { name: "Page number", exact: true })).toHaveValue(
          "1",
        );
        break;
      case "conversion":
        await upload(page, "budget.csv", "Name,Count\nApples,4\nPears,2\n");
        await expect(page.getByRole("textbox", { name: "Filter rows" })).toBeVisible();
        await page.waitForLoadState("networkidle");
        // CSV's viewer is a prerequisite, so keep its bytes in this journey too.
        await (
          await openExportMenu(page)
        )
          .getByRole("button", { name: "Convert to Markdown", exact: true })
          .click();
        await expect(page.getByText("Converted from budget.csv", { exact: true })).toBeVisible({
          timeout: 60_000,
        });
        await expect(page.locator("article")).toContainText("Apples");
        break;
      case "diagram":
        await upload(
          page,
          "budget.md",
          '# Budget diagram\n\n```mermaid\nflowchart LR\n A["$$x^2$$"] --> B[End]\n```\n',
        );
        await expect(page.locator(".mermaid-frame svg").first()).toBeVisible();
        await expect(page.locator(".mermaid-frame .katex").first()).toBeVisible();
        break;
      case "edit":
        await edit(page);
        await page.locator("#markdown-source").fill("# Budget note\n\nEdited text.");
        await page.getByRole("button", { name: /Done.*Preview/ }).click();
        await expect(page.getByText("Edited text.", { exact: true })).toBeVisible();
        break;
      case "export": {
        const download = await exportFile(page, "Web page (.html)");
        const html = await readFile((await download.path())!, "utf8");
        expect(html).toContain("<strong>complete</strong>");
        expect(html).toContain("<math");
        expect(html).not.toContain("katex-error");
        break;
      }
      case "spreadsheet":
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles("tests/fixtures/anydoc/sheet.xlsx");
        await expect(page.getByRole("heading", { name: "sheet.xlsx" })).toBeVisible();
        await expect(
          page.getByRole("region", { name: "Spreadsheet data" }).locator("tbody td").first(),
        ).toBeVisible();
        break;
      case "interactive":
        await upload(
          page,
          "budget.md",
          '# Budget example\n\n```interactive-react\ntype P = { text?: string };\nexport default function Example({text = "Ready"}: P) { return <button>{text}</button>; }\n```\n',
        );
        await expect(
          page
            .frameLocator('iframe[title="Interactive react preview"]')
            .getByRole("button", { name: "Ready" }),
        ).toBeVisible();
        break;
      case "keyboard":
        await page.getByRole("button", { name: "Insert equation", exact: true }).click();
        await expect(page.locator("math-field")).toBeVisible();
        break;
      case "compute":
        // As a reader first meets it: the math field (MathLive) and its keypad.
        await page.getByRole("tab", { name: "Compute" }).click();
        for (const key of ["1", "Fraction", "2", "Move right", "Plus", "1", "Fraction", "3"]) {
          await page.getByRole("button", { name: key, exact: true }).click();
        }
        await page.getByRole("button", { name: "Compute", exact: true }).click();
        await expect(page.getByRole("region", { name: "Evaluate result" })).toContainText(
          "0.833333333333",
        );
        break;
    }
    await page.waitForLoadState("networkidle");
    const rows = await traffic.finish();
    const feature = rows.filter((row) => row.phase === "feature");
    // Python wheels and the standard library are code too.
    const executable = feature.filter((row) => /\.(?:js|mjs|wasm|zip|whl)$/.test(row.file));
    const totals = {
      raw: executable.reduce((n, row) => n + row.bytes, 0),
      gzip: executable.reduce((n, row) => n + row.gzip, 0),
      allAssetGzip: feature.reduce((n, row) => n + row.gzip, 0),
    };
    const result = {
      journey,
      browser: context.browser()!.version(),
      budgetKiB: budgets[journey],
      totals,
      rows,
    };
    await testInfo.attach("bundle-journey", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });
    if (process.env.BUNDLE_RESULTS) {
      await mkdir(process.env.BUNDLE_RESULTS, { recursive: true });
      await writeFile(
        path.join(process.env.BUNDLE_RESULTS, `${journey}.json`),
        JSON.stringify(result, null, 2) + "\n",
      );
    }
    if (!process.env.BUNDLE_RECORD_ONLY) {
      expect(totals.gzip, JSON.stringify(feature)).toBeLessThanOrEqual(budgets[journey] * 1024);
      if (journey === "import" || journey === "edit")
        expect(feature.filter((r) => optional.test(r.file))).toEqual([]);
      if (journey === "export")
        expect(feature.filter((r) => /katex-[^.]+\.js/.test(r.file))).toEqual([]);
      const required: Partial<Record<Journey, RegExp>> = {
        pdf: /pdf\.worker/,
        conversion: /anydoc_wasm.*\.wasm$/,
        spreadsheet: /spreadsheet\.worker/,
        interactive: /compiler\.worker/,
        keyboard: /mathlive\.min/,
        compute: /compute\.worker/,
        diagram: /katex-[^.]+\.js$/,
      };
      if (required[journey])
        expect(
          feature.some((r) => required[journey]!.test(r.file)),
          "worker/engine bytes captured",
        ).toBeTruthy();
    }
    expect(errors).toEqual([]);
  });
}

test("build contains one shared KaTeX implementation", async () => {
  const report = JSON.parse(await readFile(".output/public/bundle-report.json", "utf8"));
  const implementations = report.files.flatMap((file: ReportFile) =>
    (file.modules ?? [])
      .filter((id) => /\/katex\/dist\/katex\.(?:m?js)$/.test(id))
      .map((module) => ({ file: file.file, module })),
  );
  expect(implementations).toHaveLength(1);
  const sw = await readFile(".output/public/sw.js", "utf8");
  expect(sw).not.toContain("bundle-report.json");
});

test("the math engine ships only inside its worker", async () => {
  const report = JSON.parse(await readFile(".output/public/bundle-report.json", "utf8"));
  // Page chunks list their modules; the engine must be in none of them.
  const onPage = report.files.filter((file: ReportFile) =>
    (file.modules ?? []).some((id) => id.includes("/@cortex-js/compute-engine/")),
  );
  expect(onPage.map((file: ReportFile) => file.file)).toEqual([]);
  const worker = report.files.filter((file: ReportFile) => /compute\.worker/.test(file.file));
  expect(worker).toHaveLength(1);
  expect(
    report.files.filter((file: ReportFile) => /pyodide|advanced\.worker|\.whl$/.test(file.file)),
  ).toEqual([]);
  // Precached only once used (or downloaded on request), like other optional engines.
  const sw = await readFile(".output/public/sw.js", "utf8");
  const manifest = JSON.parse(sw.slice(sw.indexOf("=") + 1, sw.indexOf(";\n")));
  expect(manifest.shell.filter((url: string) => /compute\.worker/.test(url))).toEqual([]);
});
