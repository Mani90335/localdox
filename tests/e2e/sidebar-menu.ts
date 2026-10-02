import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Exporting lives only in a sidebar row's ⋮ ▸ Export. Opens that flyout for the
 * document on screen and returns it: a portaled panel of plain buttons
 * ("Convert to Markdown", "Share link", one per format…), not an ARIA menu.
 */
export async function openExportMenu(page: Page): Promise<Locator> {
  await page
    .locator("[data-sidebar-file]")
    .filter({ has: page.locator('[aria-current="page"]') })
    .first()
    .getByRole("button", { name: "Options", exact: true })
    .click();
  const panels = page.locator("[data-sidebar-menu-panel]");
  await panels.getByRole("button", { name: "Export", exact: true }).click();
  await expect(panels).toHaveCount(2);
  return panels.last();
}

/**
 * Download the document on screen in one export format, e.g. "Web page
 * (.html)" or "Original file".
 */
export async function exportFile(page: Page, format: string) {
  const menu = await openExportMenu(page);
  const pending = page.waitForEvent("download");
  await menu.getByRole("button", { name: format, exact: true }).click();
  return pending;
}

/** Binning the document on screen asks first; confirm it. */
export async function confirmMoveToBin(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Move to the Bin?" });
  await dialog.getByRole("button", { name: "Move to Bin", exact: true }).click();
  await expect(dialog).toBeHidden();
}
