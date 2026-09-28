import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Dev serves individual modules; this regression concerns production chunking.
test.skip(!process.env.PLAYWRIGHT_PRODUCTION, "Requires the production bundle");

function trackRenderer(page: Page) {
  const scripts: Promise<{ url: string; renderer: boolean }>[] = [];
  page.on("response", (response) => {
    if (!/\/assets\/[^?]+\.js(?:\?|$)/.test(response.url())) return;
    scripts.push(
      response.text().then((code) => ({
        url: response.url(),
        // Inspect implementation, not chunk names: renaming/merging the chunk
        // must not make this test pass while still shipping it on startup.
        renderer: /\.renderToStaticMarkup\s*=/.test(code),
      })),
    );
  });
  return async () => (await Promise.all(scripts)).filter((script) => script.renderer);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
});

test("empty startup does not download the HTML server renderer", async ({ page }) => {
  const rendererScripts = trackRenderer(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await rendererScripts()).toEqual([]);
});

test("reading defers the renderer, exports load it once, and editing still works", async ({
  page,
}) => {
  const rendererScripts = trackRenderer(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "lazy-export.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Lazy export\n\nA **complete** document.\n\n## Last section\n\nThe end.",
      ),
    });
  await expect(page.getByRole("heading", { name: "Lazy export", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await rendererScripts()).toEqual([]);

  const downloadHTML = async () => {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download HTML + Media", exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe("lazy-export.html");
    expect(await download.failure()).toBeNull();
    return readFile((await download.path())!, "utf8");
  };
  const html = await downloadHTML();
  expect(html).toContain("<strong>complete</strong>");
  expect(html).toContain("Last section</h2>");
  expect(html).toContain("The end.");
  expect(await rendererScripts()).toHaveLength(1);

  // Both the client and the lazy renderer must share a working React runtime.
  await page.getByRole("button", { name: "Options", exact: true }).first().click();
  await page.getByText("Edit", { exact: true }).click();
  await page.locator("#markdown-source").fill("# Lazy export\n\nEdited after export.");
  await page.getByRole("button", { name: "Done · Preview", exact: true }).click();
  await expect(page.getByText("Edited after export.", { exact: true })).toBeVisible();
  expect(await downloadHTML()).toContain("Edited after export.");
  expect(await rendererScripts()).toHaveLength(1);
  await expect(page.getByTestId("save-indicator").filter({ visible: true }).first()).toHaveText(
    "Saved on this device",
  );

  const afterReload = trackRenderer(page);
  await page.reload();
  await expect(page.getByText("Edited after export.", { exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await afterReload()).toEqual([]);
  expect(errors).toEqual([]);
});
