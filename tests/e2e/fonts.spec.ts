import { test, expect, type Page } from "@playwright/test";

test.skip(!process.env.PLAYWRIGHT_PRODUCTION, "Verifies production font chunks");
// Measure page requests independently of the offline worker's precaching.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
});

async function openNote(page: Page, content: string, name = "fonts.md") {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name,
      mimeType: "text/markdown",
      buffer: Buffer.from(content),
    });
}

/** Actual glyph providers, rather than just the declared CSS fallback stack. */
async function renderedFonts(page: Page, selector: string) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    return fonts.filter((font) => font.glyphCount > 0);
  } finally {
    await cdp.detach();
  }
}

test("startup requests only the selected family, with no unused Inter CSS or offline assets", async ({
  page,
}) => {
  const styles: Promise<string>[] = [];
  const fonts: string[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "stylesheet") styles.push(response.text());
    if (response.request().resourceType() === "font") fonts.push(response.url());
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  // Covers the former idle callback's 2 s deadline, not only the load event.
  await page.waitForTimeout(2500);
  await page.waitForLoadState("networkidle");
  expect((await Promise.all(styles)).join("\n")).not.toMatch(/font-family:\s*["']?Inter\b/i);
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every((url) => url.includes("atkinson-hyperlegible-latin-"))).toBe(true);
  // Inter's binaries also used to inflate Settings' download-all operation.
  const sw = await (await page.request.get("/sw.js")).text();
  const manifest = JSON.parse(sw.slice(sw.indexOf("=") + 1, sw.indexOf(";\n")));
  expect(manifest.files.filter(([url]: [string]) => /\/inter-/.test(url))).toEqual([]);
});

test("code loads JetBrains Mono on demand and only requests the language subsets it uses", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") requests.push(request.url());
  });
  await page.goto("/");
  await openNote(page, "# Reading\n\nOrdinary Latin text.\n");
  await expect(page.getByRole("heading", { name: "Reading", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(requests.some((url) => url.includes("jetbrains-mono"))).toBe(false);

  await openNote(page, "# Code\n\n```text\nHello world\n```\n", "code.md");
  // Adding a file leaves the first note active.
  await page.getByRole("button", { name: /^code/ }).first().click();
  await expect(page.locator("article pre code")).toHaveText("Hello world");
  await expect
    .poll(async () => (await renderedFonts(page, "article pre code")).map((f) => f.familyName))
    .toContain("JetBrains Mono");
  const monoRequests = () => requests.filter((url) => url.includes("jetbrains-mono"));
  expect(monoRequests().length).toBeGreaterThan(0);
  expect(monoRequests().every((url) => url.includes("-latin-"))).toBe(true);

  // Exercise native unicode-range selection without changing font rules.
  await page.locator("article pre code").evaluate((el) => {
    el.textContent = "Hello Привет κόσμος";
  });
  await expect.poll(() => monoRequests().some((url) => url.includes("-cyrillic-"))).toBe(true);
  await expect.poll(() => monoRequests().some((url) => url.includes("-greek-"))).toBe(true);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  expect(monoRequests().some((url) => /-(cyrillic-ext|vietnamese)-/.test(url))).toBe(false);
});

test("delayed reading fonts keep text readable and swap to the chosen face when available", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/atkinson-hyperlegible.*\.woff2?$/, async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await openNote(page, "# Font fallback\n\nReadable while the font is delayed.\n");
    const paragraph = page.locator("article p").filter({ hasText: "Readable while" }).first();
    await expect(paragraph).toBeVisible();
    await expect
      .poll(async () => (await renderedFonts(page, "article p")).some((font) => !font.isCustomFont))
      .toBe(true);
    release();
    await expect
      .poll(async () => (await renderedFonts(page, "article p")).map((font) => font.familyName))
      .toContain("Atkinson Hyperlegible");
    await expect(paragraph).toHaveText("Readable while the font is delayed.");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
