import { test, expect, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
});

async function uploadMaterials(page: Page) {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(
      Array.from({ length: 40 }, (_, index) => ({
        name: `Sidebar ${String(index + 1).padStart(2, "0")}.md`,
        mimeType: "text/markdown",
        buffer: Buffer.from(
          `# Sidebar fixture ${index + 1}\n\n${"Reading content.\n\n".repeat(80)}`,
        ),
      })),
    );
  await expect(page.locator("aside [data-sidebar-file]")).toHaveCount(40);
}

async function expectFooterInViewport(page: Page) {
  await expect
    .poll(() =>
      page.locator("aside > div:last-child").evaluate((node) => {
        const { top, bottom } = node.getBoundingClientRect();
        return top >= 0 && bottom <= innerHeight + 1;
      }),
    )
    .toBe(true);
}

test("document sidebar scrolls independently and only its visible controls receive focus", async ({
  page,
}) => {
  await page.goto("/");
  await uploadMaterials(page);
  // Also catches missing Tailwind utilities when a Git ignore rule hides docs.
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeHidden();
  await expectFooterInViewport(page);
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toHaveCount(0);
  const list = page.locator("aside nav");
  await list.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(page.locator("aside [data-sidebar-file]").last()).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expectFooterInViewport(page);

  await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeFocused();
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Search docs", exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Toggle sidebar", exact: true })).toBeFocused();
  await expect(page.getByRole("complementary")).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toHaveCount(0);
  await expectFooterInViewport(page);
});
