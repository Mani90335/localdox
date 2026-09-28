import { test, expect, type Page, type Request } from "@playwright/test";

// A12: Settings offers only Gemini models Google still serves, migrates a saved
// retired model, greys out models the key can't use, explains why a key didn't
// save, and a retired model is reported as a model problem. Every call to
// Google is answered locally with the shapes Google returns.

const GOOGLE = "https://generativelanguage.googleapis.com/**";
const KEY = "test-gemini-key";

const modelList = (...ids: string[]) =>
  JSON.stringify({
    models: ids.map((id) => ({
      name: `models/${id}`,
      supportedGenerationMethods: ["generateContent", "countTokens"],
    })),
  });

const ALL = modelList("gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview");

/** Answer Google's model list with `body`, recording every request. */
async function google(page: Page, body = ALL, status = 200) {
  const seen: Request[] = [];
  await page.route(GOOGLE, (route) => {
    seen.push(route.request());
    return route.fulfill({ status, contentType: "application/json", body });
  });
  return seen;
}

async function openAiSettings(page: Page) {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Ask AI" }).click();
  return page.locator("div.px-4.py-3").filter({ hasText: "Google Gemini" });
}

async function saveKey(page: Page) {
  const row = await openAiSettings(page);
  await row.getByPlaceholder("Paste API key").fill(KEY);
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row.getByRole("button", { name: "Remove Google Gemini key" })).toBeVisible();
}

const modelSelect = (page: Page) => page.locator("select:has(optgroup)");

const savedConfig = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("localdox:ai-config") ?? "null"));

test("only current Gemini models are offered, and the key travels in a header", async ({
  page,
}) => {
  const seen = await google(page);
  await saveKey(page);

  const options = await modelSelect(page)
    .locator('optgroup[label^="Google Gemini"] option')
    .allTextContents();
  expect(options).toEqual([
    "Gemini 3.8 Flash",
    "Gemini 3.5 Flash-Lite",
    "Gemini 3.1 Pro (preview)",
  ]);
  await expect(modelSelect(page)).toHaveValue("gemini-3.8-flash");

  expect(seen.length).toBeGreaterThan(0);
  for (const request of seen) {
    expect(request.url()).not.toContain(KEY);
    expect(request.headers()["x-goog-api-key"]).toBe(KEY);
  }
});

test("a saved retired model migrates to its replacement", async ({ page }) => {
  await google(page);
  await saveKey(page);
  await page.evaluate(() =>
    localStorage.setItem(
      "localdox:ai-config",
      JSON.stringify({ defaultProvider: "gemini", defaultModel: "gemini-1.5-pro" }),
    ),
  );

  await page.reload();
  await page.getByRole("tab", { name: "Ask AI" }).click();
  await expect(modelSelect(page)).toHaveValue("gemini-3.1-pro-preview");
  expect(await savedConfig(page)).toEqual({
    defaultProvider: "gemini",
    defaultModel: "gemini-3.1-pro-preview",
  });
});

test("a model the key can't use is greyed out and the default moves off it", async ({ page }) => {
  await google(page, modelList("gemini-3.8-flash", "gemini-3.5-flash-lite"));
  await saveKey(page);
  // Choose it the way a stale config would: saved before Google withdrew it.
  await page.evaluate(() =>
    localStorage.setItem(
      "localdox:ai-config",
      JSON.stringify({ defaultProvider: "gemini", defaultModel: "gemini-3.1-pro-preview" }),
    ),
  );
  await page.reload();
  await page.getByRole("tab", { name: "Ask AI" }).click();

  const pro = modelSelect(page).locator('option[value="gemini-3.1-pro-preview"]');
  await expect(pro).toBeDisabled();
  await expect(pro).toHaveText("Gemini 3.1 Pro (preview) (not available to your key)");
  await expect(modelSelect(page)).toHaveValue("gemini-3.8-flash");
  await expect(page.getByRole("status").filter({ hasText: "can't use" })).toHaveText(
    "Your Google Gemini key can't use Gemini 3.1 Pro (preview), so Ask AI now uses Gemini 3.8 Flash.",
  );
  expect((await savedConfig(page)).defaultModel).toBe("gemini-3.8-flash");
});

test("a key that doesn't save says why", async ({ page }) => {
  const cases: { answer: () => Promise<void>; message: string }[] = [
    {
      // What Google returns today for an unknown key.
      answer: () =>
        page.route(GOOGLE, (route) =>
          route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: 400,
                message: "API key not valid. Please pass a valid API key.",
                status: "INVALID_ARGUMENT",
                details: [{ reason: "API_KEY_INVALID" }],
              },
            }),
          }),
        ),
      message: "That key didn't validate. Check it and try again.",
    },
    {
      answer: () =>
        page.route(GOOGLE, (route) =>
          route.fulfill({
            status: 429,
            contentType: "application/json",
            body: JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "slow down" } }),
          }),
        ),
      message: "Gemini: rate limit or quota exceeded.",
    },
    {
      answer: () => page.route(GOOGLE, (route) => route.abort("internetdisconnected")),
      message: "Couldn't reach Google. Check your connection.",
    },
  ];

  const row = await openAiSettings(page);
  for (const { answer, message } of cases) {
    await page.unrouteAll();
    await answer();
    await row.getByPlaceholder("Paste API key").fill(`${KEY}-${message.length}`);
    await row.getByRole("button", { name: "Save" }).click();
    await expect(row.getByRole("alert")).toHaveText(message);
    await expect(row.getByRole("button", { name: "Remove Google Gemini key" })).toHaveCount(0);
  }
});

test("a retired model is reported as a model problem, not a bad key", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: true }),
    ),
  );
  await google(page);
  await saveKey(page);

  // Google withdraws the default model after the key was saved.
  await page.unrouteAll();
  const streams: Request[] = [];
  await page.route(GOOGLE, (route) => {
    if (!route.request().url().includes(":streamGenerateContent")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: ALL });
    }
    streams.push(route.request());
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: 404,
          message:
            "models/gemini-3.8-flash is not found for API version v1beta, or is not supported for generateContent.",
          status: "NOT_FOUND",
        },
      }),
    });
  });

  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Notes\n\nSome text to ask about.\n"),
    });
  await expect(page.getByRole("heading", { name: "Notes", exact: true })).toBeVisible();
  await page
    .locator("article p")
    .filter({ hasText: "Some text" })
    .first()
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  const box = page.getByPlaceholder("Ask anything about the content…");
  await box.fill("What is this?");
  await box.press("Enter");

  await expect(
    page.getByText(
      "Gemini can't use Gemini 3.8 Flash: Google has retired it or doesn't offer it to this key. Choose another model in Settings → Ask AI.",
    ),
  ).toBeVisible();
  await expect(page.getByText(/API key is invalid/)).toHaveCount(0);
  expect(streams).toHaveLength(1);
  expect(streams[0].url()).not.toContain(KEY);
  expect(streams[0].headers()["x-goog-api-key"]).toBe(KEY);
});
