import { test, expect, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "navigation.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Navigation fixture\n\nFindable mobile content.\n"),
    });
  await expect(page.getByRole("heading", { name: "Navigation fixture" })).toBeVisible();
});

async function expectFocusInsideDrawer(page: Page) {
  await expect
    .poll(() =>
      page
        .getByRole("dialog", { name: "Workspace navigation" })
        .evaluate((dialog) => dialog.contains(document.activeElement)),
    )
    .toBe(true);
}

test("drawer contains keyboard focus, hides background controls, and restores its opener", async ({
  page,
}) => {
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await menu.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(drawer).toBeVisible();
  await expectFocusInsideDrawer(page);
  await expect(page.getByRole("button", { name: "Home", exact: true })).toHaveCount(0);
  // Walk past both ends, checking every stop rather than only the final one.
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let index = 0; index < 30; index++) {
      await page.keyboard.press(key);
      await expectFocusInsideDrawer(page);
    }
  }
  // Programmatic focus attempts also cannot move into the background.
  await page
    .locator('header button[aria-label="Home"]')
    .evaluate((button) => (button as HTMLElement).focus());
  await expectFocusInsideDrawer(page);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
});

test("close button and backdrop dismiss the drawer and restore focus", async ({ page }) => {
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await menu.click();
  await drawer.getByRole("button", { name: "Close", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await expect(drawer).toBeVisible();
  await page.mouse.click(380, 400);
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
});

test("mobile search focuses its input, selects a result, and restores the search button", async ({
  page,
}) => {
  const search = page.getByRole("button", { name: "Search", exact: true });
  await search.click();
  const input = page.getByPlaceholder("Search all documents...").filter({ visible: true });
  await expect(input).toBeFocused();
  await input.fill("Findable");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Findable mobile content.", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(search).toBeFocused();
  await expect(page.getByRole("heading", { name: "Navigation fixture" })).toBeVisible();
});

test("tablet search shortcut opens navigation and desktop resize releases the modal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 844 });
  await page.getByRole("button", { name: "Menu", exact: true }).focus();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Workspace navigation" })).toBeVisible();
  await expect(
    page.getByPlaceholder("Search all documents...").filter({ visible: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none");
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await page.getByPlaceholder("Search all documents...").filter({ visible: true }).focus();
  await expect(
    page.getByPlaceholder("Search all documents...").filter({ visible: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expectFocusInsideDrawer(page);
});

test("viewport permits browser zoom and navigation fits a 320px viewport", async ({ page }) => {
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).not.toMatch(/maximum-scale\s*=\s*1|user-scalable\s*=\s*(0|no)/);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(drawer).toBeVisible();
  await expect
    .poll(() =>
      drawer.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        return (
          bounds.left >= 0 &&
          bounds.right <= window.innerWidth &&
          node.scrollWidth <= node.clientWidth
        );
      }),
    )
    .toBe(true);
  await expect(drawer.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
});

test("Escape closes nested search before navigation", async ({ page }) => {
  const search = page.getByRole("button", { name: "Search", exact: true });
  await search.click();
  await expect(
    page.getByPlaceholder("Search all documents...").filter({ visible: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByPlaceholder("Search all documents...").filter({ visible: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Workspace navigation" })).toBeVisible();
  await expectFocusInsideDrawer(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(search).toBeFocused();
});

test("file actions remain usable in a nested menu and document selection closes navigation", async ({
  page,
}) => {
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await menu.click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  const options = drawer.getByRole("button", { name: "Options", exact: true }).first();
  await options.click();
  const rename = drawer.getByRole("button", { name: "Rename", exact: true });
  await expect(rename).toBeVisible();
  // A portaled menu must be reachable within the modal, including by keyboard.
  await rename.focus();
  await expect(rename).toBeFocused();
  page.once("dialog", (dialog) => dialog.accept("renamed-navigation.md"));
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("button", { name: /^renamed-navigation/ })).toBeVisible();
  await options.click();
  await drawer.getByRole("button", { name: "Export", exact: true }).click();
  const share = drawer.getByRole("button", { name: "Share link", exact: true });
  await share.focus();
  await expect(share).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Rename", { exact: true })).toBeHidden();
  await expect(drawer).toHaveAttribute("data-state", "open");
  await expectFocusInsideDrawer(page);
  await drawer.getByRole("button", { name: /^renamed-navigation/ }).click();
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
  await expect(page.getByRole("heading", { name: "Navigation fixture" })).toBeVisible();
});
