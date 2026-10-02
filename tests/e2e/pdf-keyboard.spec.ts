import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { openExportMenu } from "./sidebar-menu";

const shortcuts = ["ArrowRight", "ArrowLeft", "PageDown", "PageUp", "Home", "End", "=", "+", "-"];

async function settle(page: Page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function createPdf(context: BrowserContext) {
  const source = await context.newPage();
  await source.setContent(
    "<style>section { break-after: page; }</style>" +
      [1, 2, 3].map((n) => `<section><p>Keyboard fixture page ${n}</p></section>`).join(""),
  );
  const buffer = await source.pdf();
  await source.close();
  return buffer;
}

test.beforeEach(async ({ page, context }) => {
  const buffer = await createPdf(context);
  await page.addInitScript(() => {
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    );
  });
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "keyboard.pdf", mimeType: "application/pdf", buffer });
  await expect(page.locator(".pdf-page-area .textLayer")).toContainText("Keyboard fixture page 1");
});

test("PDF shortcuts leave toolbar and menu keyboard input alone", async ({ page }) => {
  const pageNumber = page.getByRole("textbox", { name: "Page number", exact: true });
  await page.getByRole("button", { name: "Next page", exact: true }).focus();
  for (const key of shortcuts) {
    await page.keyboard.press(key);
    await settle(page);
    await expect(pageNumber, `toolbar ${key}`).toHaveValue("1");
    await expect(page.getByTitle("Reset zoom", { exact: true })).toHaveText("100%");
  }
  const menu = await openExportMenu(page);
  const original = menu.getByRole("button", { name: "Original file", exact: true });
  await original.focus();
  for (const key of shortcuts) {
    await page.keyboard.press(key);
    await settle(page);
    await expect(pageNumber, `menu ${key}`).toHaveValue("1");
  }
  await expect(menu).toBeVisible();
  await expect(original).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(pageNumber).toHaveValue("1");
  await page.getByRole("button", { name: "Search in document", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search in document", exact: true });
  await search.fill("Keyboard");
  await page.keyboard.press("End");
  await page.keyboard.press("+");
  await expect(search).toHaveValue("Keyboard+");
  await expect(page.getByTitle("Reset zoom", { exact: true })).toHaveText("100%");
});

test("Tab reaches a named PDF region and page/zoom shortcuts work there", async ({ page }) => {
  const area = page.getByRole("region", { name: "PDF pages", exact: true });
  await expect(area).toHaveAttribute("tabindex", "0");
  await page.getByRole("button", { name: "Enter fullscreen", exact: true }).focus();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    if (await area.evaluate((el) => document.activeElement === el)) break;
  }
  await expect(area).toBeFocused();
  const pageNumber = page.getByRole("textbox", { name: "Page number", exact: true });
  for (const [key, expected] of [
    ["ArrowRight", "2"],
    ["End", "3"],
    ["Home", "1"],
    ["PageDown", "2"],
    ["PageUp", "1"],
    ["End", "3"],
    ["ArrowLeft", "2"],
  ]) {
    await page.keyboard.press(key);
    await expect(pageNumber).toHaveValue(expected);
    await expect(area).toBeFocused();
  }
  await page.keyboard.press("+");
  await expect(page.getByTitle("Reset zoom", { exact: true })).toHaveText("125%");
  await page.keyboard.press("-");
  await expect(page.getByTitle("Reset zoom", { exact: true })).toHaveText("100%");
  await page.keyboard.press("=");
  await expect(page.getByTitle("Reset zoom", { exact: true })).toHaveText("125%");
  await page.keyboard.press("Tab");
  await expect(area).not.toBeFocused();
});

test("clicking PDF text focuses its reader without breaking text selection", async ({ page }) => {
  const area = page.getByRole("region", { name: "PDF pages", exact: true });
  await page.locator(".textLayer span").filter({ hasText: "Keyboard" }).dblclick();
  await expect(area).toBeFocused();
  expect(await page.evaluate(() => getSelection()?.toString().trim())).toBeTruthy();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("textbox", { name: "Page number", exact: true })).toHaveValue("2");
  await expect(area).toBeFocused();
});

test("nested controls keep focus, editing and their own keyboard behavior", async ({ page }) => {
  // Exercise form/annotation controls a PDF page may contain, including nested targets.
  await page.locator(".pdf-page-area").evaluate((area) => {
    const controls = document.createElement("div");
    controls.style.cssText = "position:absolute;top:0;left:0;z-index:10;background:white";
    controls.innerHTML =
      '<select aria-label="Fixture select"><option>One</option><option>Two</option></select><div contenteditable="true" role="textbox" aria-label="Fixture editor"><span>Editable</span></div><button>Fixture button</button><a href="#fixture">Fixture link</a><div role="slider" tabindex="0" aria-label="Fixture slider">Slider</div><input aria-label="Fixture input"><textarea aria-label="Fixture textarea"></textarea>';
    area.append(controls);
  });
  for (const label of [
    "Fixture select",
    "Fixture editor",
    "Fixture button",
    "Fixture link",
    "Fixture slider",
    "Fixture input",
    "Fixture textarea",
  ]) {
    const control =
      label === "Fixture button" || label === "Fixture link"
        ? page.getByText(label, { exact: true })
        : page.getByLabel(label, { exact: true });
    await control.click();
    await expect(control).toBeFocused();
    for (const key of ["End", "Home", "ArrowRight", "=", "-"]) {
      await page.keyboard.press(key);
      await settle(page);
      await expect(
        page.getByRole("textbox", { name: "Page number", exact: true }),
        `${label}: ${key}`,
      ).toHaveValue("1");
      await expect(page.getByTitle("Reset zoom", { exact: true })).toHaveText("100%");
    }
  }
});

test("modified, composing and already-handled keys keep their native behavior", async ({
  page,
}) => {
  const area = page.getByRole("region", { name: "PDF pages", exact: true });
  await area.focus();
  for (const flags of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { shiftKey: true },
    { isComposing: true },
    { prevented: true },
  ]) {
    for (const key of ["End", "=", "-"]) {
      const prevented = await area.evaluate(
        (el, { flags, key }) => {
          const event = new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
            ...flags,
          });
          if ("prevented" in flags) event.preventDefault();
          el.dispatchEvent(event);
          return event.defaultPrevented;
        },
        { flags, key },
      );
      expect(prevented).toBe("prevented" in flags);
      await settle(page);
      await expect(page.getByRole("textbox", { name: "Page number", exact: true })).toHaveValue(
        "1",
      );
      await expect(page.getByTitle("Reset zoom", { exact: true })).toHaveText("100%");
    }
  }
});

test("only the focused PDF changes in a two-reader split", async ({ page, context }) => {
  const buffer = await createPdf(context);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "second.pdf",
    mimeType: "application/pdf",
    buffer,
  });
  await expect(page.getByRole("button", { name: "second PDF", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Options", exact: true }).first().click();
  await page.getByRole("button", { name: "Add to split view", exact: true }).click();
  const areas = page.getByRole("region", { name: "PDF pages", exact: true });
  await expect(areas).toHaveCount(2);
  const numbers = page.getByRole("textbox", { name: "Page number", exact: true });
  await expect(numbers).toHaveCount(2);
  await areas.first().click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("End");
  await expect(numbers.first()).toHaveValue("3");
  await expect(numbers.last()).toHaveValue("1");
  await areas.last().click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("ArrowRight");
  await expect(numbers.last()).toHaveValue("2");
  await expect(numbers.first()).toHaveValue("3");
  await page.keyboard.press("=");
  await expect(page.getByTitle("Reset zoom", { exact: true }).last()).toHaveText("125%");
  await expect(page.getByTitle("Reset zoom", { exact: true }).first()).toHaveText("100%");
});
