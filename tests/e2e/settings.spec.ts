import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("localdox:prefs")) {
      localStorage.setItem(
        "localdox:prefs",
        JSON.stringify({
          name: "Reader",
          namePrompted: true,
          theme: "light",
          aiEnabled: true,
        }),
      );
    }
  });
});

const settings = (page: Page) => page.getByRole("dialog", { name: "Settings", exact: true });
const prefs = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("localdox:prefs") ?? "{}"));

test("keyboard navigation keeps focus in Settings and dismissal restores the opener", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Settings", exact: true });
  await opener.click();
  const dialog = settings(page);
  await expect(dialog.getByRole("tab", { name: "Appearance", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(dialog.getByRole("tab", { name: "Reading", exact: true })).toBeFocused();
  await expect(dialog.getByRole("tabpanel", { name: "Reading", exact: true })).toBeVisible();
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let index = 0; index < 15; index++) {
      await page.keyboard.press(key);
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    }
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await opener.click();
  await settings(page).getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await page.mouse.click(8, 8);
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("theme, reading, equation, and diagram choices persist through reopening", async ({
  page,
}) => {
  await page.goto("/settings");
  const dialog = settings(page);
  await dialog.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await dialog.getByRole("tab", { name: "Reading", exact: true }).click();
  await dialog.getByRole("button", { name: /Single page/ }).click();
  await dialog.getByRole("slider", { name: "Content width", exact: true }).fill("70");
  await dialog.getByRole("tab", { name: "Equations", exact: true }).click();
  await dialog.getByLabel("Typesetting", { exact: true }).selectOption("temml");
  await dialog.getByRole("tab", { name: "Diagrams", exact: true }).click();
  await dialog
    .getByRole("switch", { name: "Show step numbers on arrows in Stepped diagrams" })
    .click();
  await expect
    .poll(() => prefs(page))
    .toMatchObject({
      theme: "dark",
      readingMode: "single",
      contentWidth: 70,
      mathRenderer: "temml",
      diagramNumbers: false,
    });
  await page.reload();
  await expect(settings(page).getByRole("button", { name: "Dark", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await settings(page).getByRole("tab", { name: "Reading", exact: true }).click();
  await expect(settings(page).getByRole("button", { name: /Single page/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(settings(page).getByRole("slider", { name: "Content width" })).toHaveValue("70");
});

test("AI can be hidden and enabled again from Appearance", async ({ page }) => {
  await page.goto("/settings");
  const dialog = settings(page);
  const toggle = dialog.getByRole("switch", { name: "Enable AI features" });
  await toggle.click();
  await expect(dialog.getByRole("tab", { name: "Ask AI" })).toHaveCount(0);
  await expect.poll(() => prefs(page)).toMatchObject({ aiEnabled: false });
  await page.reload();
  await expect(settings(page).getByRole("tab", { name: "Appearance" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(settings(page).getByRole("tab", { name: "Ask AI" })).toHaveCount(0);
  await settings(page).getByRole("switch", { name: "Enable AI features" }).click();
  await settings(page).getByRole("tab", { name: "Ask AI" }).click();
  await expect(settings(page).getByRole("tabpanel", { name: "Ask AI" })).toBeVisible();
  await expect(settings(page).getByPlaceholder("Paste API key").first()).toBeVisible();
});

test("Escape cancels a workspace draft before dismissing Settings", async ({ page }) => {
  await page.goto("/settings");
  const dialog = settings(page);
  await dialog.getByRole("tab", { name: "Workspace", exact: true }).click();
  await dialog.getByRole("button", { name: "New", exact: true }).click();
  await dialog.getByRole("textbox", { name: "New workspace name" }).fill("A draft");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "New workspace name" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "New", exact: true }).click();
  await dialog.getByRole("textbox", { name: "New workspace name" }).fill("Settings fixture");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Rename Settings fixture", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: /^Rename / })
    .first()
    .click();
  await dialog.getByRole("textbox", { name: "Workspace name", exact: true }).fill("Another draft");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Workspace name", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

for (const width of [320, 390, 768, 1440]) {
  test(`sections fit and remain reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 640 ? 740 : 900 });
    await page.goto("/settings");
    const dialog = settings(page);
    await expect(dialog.getByRole("tablist")).toHaveAttribute(
      "aria-orientation",
      width < 640 ? "horizontal" : "vertical",
    );
    for (const name of [
      "Appearance",
      "Reading",
      "Diagrams",
      "Equations",
      "Ask AI",
      "Workspace",
      "Storage",
    ]) {
      await dialog.getByRole("tab", { name, exact: true }).click();
      const panel = dialog.getByRole("tabpanel", { name, exact: true });
      await expect(panel).toBeVisible();
      expect(
        await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeInViewport();
    }
    expect(
      await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
        );
      }),
    ).toBe(true);
    if (width < 640) {
      await dialog.getByRole("tab", { name: "Appearance", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      await expect(dialog.getByRole("tab", { name: "Reading", exact: true })).toBeFocused();
    }
    await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
    await page.screenshot({ path: `test-results/settings-${width}.png`, animations: "disabled" });
    await dialog.getByRole("button", { name: "Close settings" }).click();
    await expect(dialog).toBeHidden();
  });
}
