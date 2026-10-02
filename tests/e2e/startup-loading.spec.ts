import { test, expect, type Page } from "@playwright/test";

// B02: an empty workspace used to download the Markdown reader, the editor, the
// Markdown parser and split view's panes before it could paint. They now load
// when needed: the reader once the shell has painted (or when a document
// opens), the editor on the way to editing, the panes on the first split.
//
// Chunks are recognized by code they contain, not by file name, so renaming or
// re-merging a chunk can't make these pass while the code is still on the
// startup path.

// Dev serves individual modules; this concerns production chunking.
test.skip(!process.env.PLAYWRIGHT_PRODUCTION, "Requires the production bundle");
// The offline worker precaches these chunks by design; this is about what the
// page itself asks for.
test.use({ serviceWorkers: "block" });

const MARKERS = {
  // The Markdown reader's highlight menu; no other chunk carries this label.
  reader: "More highlight actions",
  editor: "Editing — changes save automatically",
  parser: "Cannot close document, a token",
  panes: "data-separator",
} as const;
type Feature = keyof typeof MARKERS;

/** Records every app script with the phase it was requested in. */
function trackScripts(page: Page) {
  const state = { phase: "startup" };
  const scripts: Promise<{ phase: string; url: string; features: Feature[] }>[] = [];
  page.on("response", (response) => {
    const url = response.url();
    if (!/\/assets\/[^?]+\.js(?:\?|$)/.test(url) || /\.worker-/.test(url)) return;
    const phase = state.phase;
    scripts.push(
      response.text().then((code) => ({
        phase,
        url,
        features: (Object.keys(MARKERS) as Feature[]).filter((f) => code.includes(MARKERS[f])),
      })),
    );
  });
  const loaded = async (phase?: string) =>
    new Set(
      (await Promise.all(scripts))
        .filter((s) => !phase || s.phase === phase)
        .flatMap((s) => s.features),
    );
  const urls = async () => (await Promise.all(scripts)).map((s) => s.url);
  return { state, loaded, urls };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
});

const saved = (page: Page) => page.getByTestId("save-indicator").filter({ visible: true }).first();

async function openNote(page: Page, content: string) {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "note.md", mimeType: "text/markdown", buffer: Buffer.from(content) });
}

test("an empty workspace paints without the reader, editor, parser or panes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const scripts = trackScripts(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await page.waitForLoadState("load");
  expect([...(await scripts.loaded("startup"))]).toEqual([]);
  // The search fallback is for browsers whose worker fails; not this one.
  expect((await scripts.urls()).filter((url) => /local-search/.test(url))).toEqual([]);

  // Once the shell has painted, the reader is fetched in idle time so the
  // first document opens without waiting for it. The editor is not.
  scripts.state.phase = "idle";
  await expect.poll(async () => (await scripts.loaded("idle")).has("reader")).toBe(true);
  await page.waitForLoadState("networkidle");
  expect(await scripts.loaded()).not.toContain("editor");
  expect(errors).toEqual([]);
});

test("the editor downloads on the way to editing, and editing works", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const scripts = trackScripts(page);
  await page.goto("/");
  await openNote(page, "# Lazy note\n\nFirst paragraph.\n");
  await expect(page.getByRole("heading", { name: "Lazy note", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await scripts.loaded()).not.toContain("editor");

  // Opening the file's menu is the cue: the editor is fetched before Edit.
  await page.getByRole("button", { name: "Options", exact: true }).first().click();
  await expect.poll(async () => (await scripts.loaded()).has("editor")).toBe(true);
  await page.getByText("Edit", { exact: true }).click();
  const source = page.locator("#markdown-source");
  await expect(source).toHaveText("# Lazy note\n\nFirst paragraph.\n", { useInnerText: true });
  await source.fill("# Lazy note\n\nEdited on demand.\n");
  await page.getByRole("button", { name: "Done · Preview", exact: true }).click();
  await expect(page.getByText("Edited on demand.", { exact: true })).toBeVisible();

  await expect(saved(page)).toHaveAttribute("data-save-state", "saved");
  await page.reload();
  await expect(page.getByText("Edited on demand.", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Inspect source selects the passage in an editor that wasn't loaded yet", async ({ page }) => {
  const scripts = trackScripts(page);
  await page.goto("/");
  await openNote(page, "# Inspect\n\nAlpha paragraph.\n\nThe target passage lives here.\n");
  const paragraph = page.locator("article p").filter({ hasText: "The target passage" }).first();
  await expect(paragraph).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await scripts.loaded()).not.toContain("editor");

  await paragraph.evaluate((el) => {
    const node = el.firstChild!;
    const at = node.textContent!.indexOf("target passage");
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + "target passage".length);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "More highlight actions" }).click();
  await page.getByRole("menuitem", { name: "Inspect source", exact: true }).click();

  // The selection is applied once the editor has arrived, not dropped because
  // it wasn't there when edit mode began.
  const source = page.locator("#markdown-source");
  await expect(source).toBeFocused();
  await expect
    .poll(() =>
      source.evaluate(() => window.getSelection()?.toString()),
    )
    .toBe("target passage");
});

test("a restored split view loads its panes after a reload", async ({ page }) => {
  await page.goto("/");
  await openNote(page, "# First\n\nOne.\n");
  await expect(page.getByRole("heading", { name: "First", exact: true })).toBeVisible();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "second.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Second\n\nTwo.\n"),
    });
  // Adding a file doesn't switch to it; put it beside the open one.
  await expect(page.getByRole("button", { name: /^second/ })).toBeVisible();
  await page.getByRole("button", { name: "Options", exact: true }).nth(1).click();
  await page.getByRole("button", { name: "Add to split view", exact: true }).click();
  const separators = page.locator("[data-separator]");
  await expect(separators).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "First", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Second", exact: true })).toBeVisible();

  await expect(saved(page)).toHaveAttribute("data-save-state", "saved");
  await page.reload();
  await expect(separators).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "First", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Second", exact: true })).toBeVisible();
});

test("a reader that can't download leaves the rest of the app working", async ({ page }) => {
  // Unreachable for the reader's chunk only, including the recovery's probe of
  // it, so recovery waits for a connection instead of reloading and the page
  // under test stays put.
  const unreachable = new Set<string>();
  await page.route(
    (url) => /\/assets\/[^/]+\.js$/.test(url.pathname),
    async (route) => {
      if (unreachable.has(route.request().url())) return route.abort("internetdisconnected");
      const response = await route.fetch();
      const body = await response.text();
      if (!body.includes(MARKERS.reader)) return route.fulfill({ response, body });
      unreachable.add(route.request().url());
      return route.abort("internetdisconnected");
    },
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await openNote(page, "# Unreachable\n\nBody.\n");
  await expect(
    page.getByRole("alert").filter({ hasText: "This part of Localdox didn't load" }),
  ).toBeVisible();
  // The shell and the imported file are still there.
  await expect(page.getByRole("button", { name: /^note/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
