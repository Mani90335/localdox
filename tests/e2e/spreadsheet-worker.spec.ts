import { test, expect, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";

// R04: spreadsheets are parsed, filtered and sorted in a worker, and the grid
// renders only the rows and columns in view.

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function workbook(rows: unknown[][], name = "Data"): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Row r (1-based data row), column c of the generated sheets. */
const cellValue = (r: number, c: number) =>
  c === 0 ? r : c % 2 ? (r * 37 + c * 11) % 1000 : `row ${r} col ${c}`;

function grid(rowCount: number, columnCount: number): unknown[][] {
  const rows: unknown[][] = [
    Array.from({ length: columnCount }, (_, c) => (c === 0 ? "Id" : `Label ${c}`)),
  ];
  for (let r = 1; r <= rowCount; r++)
    rows.push(Array.from({ length: columnCount }, (_, c) => cellValue(r, c)));
  return rows;
}

async function upload(page: Page, name: string, buffer: Buffer, mimeType = XLSX_MIME) {
  await page.locator('input[type="file"]').first().setInputFiles({ name, mimeType, buffer });
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

const region = (page: Page) => page.getByRole("region", { name: "Spreadsheet data" });
/** Data rows actually rendered (spacers are aria-hidden). */
const dataRows = (page: Page) => region(page).locator("tbody tr:not([aria-hidden])");
const rowNumber = (page: Page, index: number) => dataRows(page).nth(index).locator("td").first();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    );
    // Records spreadsheet workers, and can hold their "view" requests or
    // make them fail, so the tests can see what the viewer does meanwhile.
    type Tracked = Worker & { terminated?: boolean };
    const state = {
      workers: [] as Tracked[],
      holdViews: false,
      held: [] as Array<() => void>,
    };
    Object.assign(window, {
      sheetWorkers: state,
      releaseViews: () => {
        state.holdViews = false;
        state.held.splice(0).forEach((send) => send());
      },
      crashSheetWorker: () =>
        state.workers[state.workers.length - 1].dispatchEvent(new Event("error")),
    });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private readonly sheet: boolean;
      terminated = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        if (String(url).includes("spreadsheet") && localStorage.getItem("test:no-worker"))
          throw new Error("Test: worker unavailable");
        super(url, options);
        this.sheet = String(url).includes("spreadsheet");
        if (this.sheet) state.workers.push(this);
      }
      postMessage(message: unknown) {
        const send = () => super.postMessage(message);
        if (this.sheet && state.holdViews && (message as { type?: string }).type === "view")
          state.held.push(send);
        else send();
      }
      terminate() {
        this.terminated = true;
        super.terminate();
      }
    };
  });
  await page.goto("/");
});

const workerStates = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { sheetWorkers: { workers: { terminated: boolean }[] } }
    ).sheetWorkers.workers.map((worker) => worker.terminated),
  );

test("a wide sheet renders only the columns in view, and scrolls across all of them", async ({
  page,
}) => {
  await upload(page, "Wide.xlsx", workbook(grid(400, 300)));
  await expect(rowNumber(page, 0)).toHaveText("2");
  // The pre-worker viewer mounted every column: ~34 rows × 301 cells here.
  const cells = await region(page).locator("td").count();
  expect(cells).toBeLessThan(900);
  await expect(page.getByRole("columnheader", { name: "Label 2", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Label 200", exact: true })).toHaveCount(0);
  // Assistive technology still hears the sheet's full size.
  const table = region(page).getByRole("table");
  await expect(table).toHaveAttribute("aria-colcount", "301");
  await expect(table).toHaveAttribute("aria-rowcount", "401");
  expect(await workerStates(page)).toEqual([false]);

  // Columns keep their widths while scrolling, so the middle of the sheet is
  // reachable and correct.
  await region(page).evaluate((el) => {
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  });
  const middle = region(page).locator("thead th[aria-colindex]").nth(5);
  await expect
    .poll(async () => Number(await middle.getAttribute("aria-colindex")))
    .toBeGreaterThan(100);
  const index = Number(await middle.getAttribute("aria-colindex")) - 2;
  expect(index).toBeLessThan(200);
  await expect(page.getByRole("columnheader", { name: "Label 2", exact: true })).toHaveCount(0);
  await expect(
    dataRows(page)
      .first()
      .locator(`td[aria-colindex="${index + 2}"]`),
  ).toHaveText(String(cellValue(1, index)));
  expect(await region(page).locator("td").count()).toBeLessThan(900);

  await region(page).evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByRole("columnheader", { name: "Label 299", exact: true })).toBeVisible();
  await expect(dataRows(page).last().locator("td").first()).toHaveText("401");
  await expect(dataRows(page).last().locator('td[aria-colindex="300"]')).toHaveText(
    String(cellValue(400, 298)),
  );
  // Nothing on the page itself scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    (page.viewportSize()?.width ?? 0) + 1,
  );
});

test("filtering keeps the current rows on screen until the worker answers, and the latest query wins", async ({
  page,
}) => {
  await upload(page, "Rows.xlsx", workbook(grid(2000, 4)));
  await expect(rowNumber(page, 0)).toHaveText("2");
  await page.evaluate(() => {
    (window as unknown as { sheetWorkers: { holdViews: boolean } }).sheetWorkers.holdViews = true;
  });
  const filter = page.getByRole("textbox", { name: "Filter rows" });
  await filter.fill("row 12");
  await expect(page.getByRole("status").filter({ hasText: "Filtering…" })).toBeVisible();
  await expect(region(page)).toHaveAttribute("aria-busy", "true");
  // The old rows stay: no empty table while the filter runs.
  await expect(rowNumber(page, 0)).toHaveText("2");
  await filter.fill("row 123");
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as unknown as { releaseViews: () => void }).releaseViews());
  // "row 123" and "row 1230".."row 1239" match.
  await expect(page.getByRole("status").filter({ hasText: /^11 matching rows$/ })).toBeVisible();
  await expect(region(page)).toHaveAttribute("aria-busy", "false");
  await expect(rowNumber(page, 0)).toHaveText("124");
  await expect(dataRows(page)).toHaveCount(11);

  await page.getByRole("button", { name: "Clear filter" }).click();
  await expect(page.getByRole("status")).toHaveText("Select a column heading to sort");
  await expect(rowNumber(page, 0)).toHaveText("2");
});

test("sorting orders every row, not just the ones rendered", async ({ page }) => {
  const rows = grid(3000, 3);
  await upload(page, "Sort.xlsx", workbook(rows));
  const heading = page.getByRole("button", { name: "Label 1", exact: true });
  await heading.click();
  await heading.click();
  await expect(page.getByRole("columnheader", { name: "Label 1" })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  const values = rows.slice(1).map((row, i) => ({ value: row[1] as number, source: i + 2 }));
  // Ties keep sheet order in both directions.
  const expected = [...values].sort((a, b) => b.value - a.value || a.source - b.source);
  await expect(rowNumber(page, 0)).toHaveText(String(expected[0].source));
  await region(page).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(dataRows(page).last().locator("td").first()).toHaveText(
    String(expected[expected.length - 1].source),
  );
  await expect(dataRows(page).last().locator('td[aria-colindex="3"]')).toHaveText(
    String(expected[expected.length - 1].value),
  );
});

test("columns fit values from anywhere in the sheet, so sorting doesn't clip them", async ({
  page,
}) => {
  const rows: unknown[][] = [["Id", "Name"]];
  for (let r = 1; r <= 400; r++) rows.push([r, "short"]);
  rows.push([1234567890, "Quite a lot longer than the rest"]);
  await upload(page, "Clip.xlsx", workbook(rows));
  await page.getByRole("button", { name: "Id", exact: true }).click();
  await page.getByRole("button", { name: "Id", exact: true }).click();
  await expect(rowNumber(page, 0)).toHaveText("402");
  const clipped = await dataRows(page)
    .first()
    .locator("td")
    .evaluateAll((cells) =>
      cells.filter((cell) => cell.scrollWidth > cell.clientWidth).map((cell) => cell.textContent),
    );
  expect(clipped).toEqual([]);
});

test("switching sheets after scrolling right shows the new sheet's rows at once, from its first column", async ({
  page,
}) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(grid(300, 200)), "One");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(grid(300, 200)), "Two");
  await upload(
    page,
    "Sheets.xlsx",
    XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer,
  );
  await expect(rowNumber(page, 0)).toHaveText("2");
  await region(page).evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect(page.getByRole("columnheader", { name: "Label 199", exact: true })).toBeVisible();
  // Flags any rendered data row whose row number is blank: rows shown
  // before their cells have arrived.
  await page.evaluate(() => {
    (window as unknown as { blankRows: number }).blankRows = 0;
    new MutationObserver(() => {
      for (const cell of document.querySelectorAll(
        '[aria-label="Spreadsheet data"] tbody tr[aria-rowindex] td:first-child',
      ))
        if (!cell.textContent) (window as unknown as { blankRows: number }).blankRows++;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.getByRole("button", { name: "Two", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Id", exact: true })).toBeVisible();
  await expect(rowNumber(page, 0)).toHaveText("2");
  await expect(dataRows(page).first().locator('td[aria-colindex="3"]')).toHaveText(
    String(cellValue(1, 1)),
  );
  expect(await page.evaluate(() => (window as unknown as { blankRows: number }).blankRows)).toBe(0);
});

test("a crashed worker is reported, and Try again reopens the sheet in a new one", async ({
  page,
}) => {
  await upload(page, "Crash.xlsx", workbook(grid(50, 3)));
  await expect(rowNumber(page, 0)).toHaveText("2");
  await page.evaluate(() =>
    (window as unknown as { crashSheetWorker: () => void }).crashSheetWorker(),
  );
  const alert = page.getByRole("alert").filter({ hasText: "The spreadsheet viewer stopped" });
  await expect(alert).toBeVisible();
  expect(await workerStates(page)).toEqual([true]);
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(rowNumber(page, 0)).toHaveText("2");
  expect(await workerStates(page)).toEqual([true, false]);
});

test("without workers the viewer still reads, filters and sorts", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("test:no-worker", "1"));
  await page.reload();
  await upload(page, "Local.xlsx", workbook(grid(300, 3)));
  await expect(rowNumber(page, 0)).toHaveText("2");
  expect(await workerStates(page)).toEqual([]);
  await page.getByRole("textbox", { name: "Filter rows" }).fill("row 29");
  await expect(page.getByRole("status").filter({ hasText: /^11 matching rows$/ })).toBeVisible();
  await page.getByRole("button", { name: "Id", exact: true }).click();
  await page.getByRole("button", { name: "Id", exact: true }).click();
  await expect(rowNumber(page, 0)).toHaveText("300");
});

test("opening a large workbook does not block the page, and leaving it ends its worker", async ({
  page,
}, testInfo) => {
  // Uploaded from disk: a large in-memory buffer is turned into a File by
  // Playwright's own script in the page, which is itself a long task.
  const big = testInfo.outputPath("Big.xlsx");
  writeFileSync(big, workbook(grid(60_000, 8)));
  await page.evaluate(() => {
    (window as unknown as { longTasks: number[] }).longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        (window as unknown as { longTasks: number[] }).longTasks.push(entry.duration);
    }).observe({ type: "longtask" });
  });
  await page.locator('input[type="file"]').first().setInputFiles(big);
  await expect(page.getByRole("heading", { name: "Big.xlsx" })).toBeVisible();
  await expect(rowNumber(page, 0)).toHaveText("2", { timeout: 60_000 });
  await expect(page.getByText("60,000 rows")).toBeVisible();
  const longest = await page.evaluate(() =>
    Math.max(0, ...(window as unknown as { longTasks: number[] }).longTasks),
  );
  testInfo.annotations.push({ type: "longest main-thread task (ms)", description: `${longest}` });
  // Parsing on the main thread was one ~300 ms task at this size (860 ms at
  // 100,000 rows × 10 columns).
  expect(longest).toBeLessThan(150);

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "Notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Notes\n\nPlain text.\n"),
    });
  await page.getByRole("button", { name: /^Notes/ }).click();
  await expect(region(page)).toHaveCount(0);
  await expect.poll(() => workerStates(page)).toEqual([true]);
});
