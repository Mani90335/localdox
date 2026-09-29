import { test, expect, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import path from "node:path";

async function expectFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    (page.viewportSize()?.width ?? 0) + 1,
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
  await page.goto("/");
});

test("spreadsheet controls, sheet navigation, filtering and keyboard sorting", async ({
  page,
}, testInfo) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["Product", "Revenue"], ["Apples", 42], [], ["Pears", 8]]),
    "Sales",
  );
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["Note"], ["Quarter complete"]]),
    "Notes",
  );
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "Quarterly sales.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }),
    });
  await expect(page.getByRole("heading", { name: "Quarterly sales.xlsx" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Convert to Markdown", exact: true })).toHaveCount(
    0,
  );
  const revenue = page.getByRole("button", { name: "Revenue", exact: true });
  await revenue.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("columnheader", { name: "Revenue" })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await page.getByRole("textbox", { name: "Filter rows" }).fill("Pears");
  await expect(page.getByRole("status").filter({ hasText: "1 matching rows" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Pears" }).locator("td").first()).toHaveText(
    "4",
  );
  await page.getByRole("textbox", { name: "Filter rows" }).fill("missing");
  await expect(page.getByText("No rows match your filter.")).toBeVisible();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Filter rows" })).toHaveValue("");
  await expect(page.getByText("Quarter complete", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sales", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("spreadsheet-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /^Convert to Markdown/ })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^Original file/ }).click();
  expect((await download).suggestedFilename()).toBe("Quarterly sales.xlsx");
  // The sidebar's file menu is a popover of buttons (not an ARIA menu), and
  // the viewer header has its own Export button, so scope to the panel.
  await page.getByRole("button", { name: "Options", exact: true }).first().click();
  const fileMenu = page.locator("[data-sidebar-menu-panel]");
  await expect(fileMenu.getByRole("button", { name: "Rename", exact: true })).toBeVisible();
  await expect(page.getByText("Convert to Markdown", { exact: true })).toHaveCount(0);
  await fileMenu.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByText("Convert to Markdown", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFits(page);
  await page.screenshot({ path: testInfo.outputPath("spreadsheet-mobile.png"), fullPage: true });
});

test("CSV viewer stays within a phone viewport and has one edit/export toolbar", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "A very long inventory report filename.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Code,Description,Stock\n001,An unusually long description for an inventory item,5\n002,Pears,10",
      ),
    });
  await expect(page.getByRole("textbox", { name: "Filter rows" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit spreadsheet", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Export", exact: true })).toHaveCount(1);
  await expectFits(page);
  await page.screenshot({ path: testInfo.outputPath("csv-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Edit spreadsheet", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sheet1", exact: true })).toHaveCount(0);
  await expectFits(page);
});

test("DOCX reading surface and export fit desktop and mobile", async ({ page }, testInfo) => {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(path.resolve("tests/fixtures/anydoc/handmade-rich.docx"));
  await expect(page.locator(".docx-prose")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "handmade-rich.docx", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("docx-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFits(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /^Convert to Markdown/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: testInfo.outputPath("docx-mobile.png"), fullPage: true });
});
