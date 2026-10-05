import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// The Compute tab end to end: a result computed in a worker is shown beside
// its input, copied, added to rough work and inserted into a document, each
// only when asked (an insertion only after its confirmation). Plus solving,
// labelled failures, cancellation, a responsive page while the engine works,
// and (production build) computing offline once the engine has loaded.

const GUIDE = "# Field guide\n\nOpening words of the guide.\n";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    );
  });
});

async function openGuide(page: Page) {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "guide.md", mimeType: "text/markdown", buffer: Buffer.from(GUIDE) });
  await expect(page.locator("article h1").first()).toBeVisible();
}

interface Stored {
  files: Array<{ name: string; content: string }>;
  scratchpads: Array<{ title: string; content: string }>;
}

/** What IndexedDB holds for the (only) workspace right now. */
function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Stored>((resolve, reject) => {
        const open = indexedDB.open("localdox");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["workspaces", "files"], "readonly");
          const workspaces = tx.objectStore("workspaces").getAll();
          const files = tx.objectStore("files").getAll();
          tx.oncomplete = () => {
            db.close();
            resolve({ files: files.result, scratchpads: workspaces.result[0]?.scratchpads ?? [] });
          };
        };
      }),
  );
}

const panel = (page: Page) =>
  page
    .getByRole("region", { name: "Notes panel" })
    .or(page.getByRole("dialog", { name: "Notes", exact: true }));
const field = (page: Page) => panel(page).getByRole("textbox", { name: /^Expression or equation/ });
const button = (page: Page, name: string) => panel(page).getByRole("button", { name, exact: true });

/** Opens Compute with Text input: these tests type plain text and LaTeX. */
async function openCompute(page: Page) {
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("tab", { name: "Compute" }).click();
  await panel(page).getByRole("radio", { name: "Text" }).click();
  await expect(field(page)).toBeVisible();
}

for (const width of [1440, 390]) {
  test(`one compute input beside notes and rough work at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await openGuide(page);
    await openCompute(page);
    await expect(panel(page).getByRole("group", { name: "Math area" })).toHaveCount(0);
    await expect(panel(page).getByRole("combobox", { name: "Operation", exact: true })).toHaveCount(
      0,
    );
    await field(page).fill("1/2 + 1/3");
    await button(page, "Compute").click();
    await expect(panel(page).getByRole("region", { name: "Evaluate result" })).toContainText(
      "0.833333333333",
    );
    await page.getByRole("tab", { name: "Rough work" }).click();
    await page.getByRole("tab", { name: "Compute" }).click();
    await expect(field(page)).toHaveValue("1/2 + 1/3");
    await expect(panel(page).getByRole("region", { name: "Evaluate result" })).toBeVisible();
    await panel(page).screenshot({ path: testInfo.outputPath("compute-panel.png") });
  });
}

test("evaluate, copy, add to rough work, then insert into the document only when confirmed", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await openCompute(page);

  await field(page).fill("1/2 + 1/3");
  // How the input reads, drawn, before anything is computed.
  await expect(panel(page).locator("#compute-reading .katex")).toBeVisible();
  await button(page, "Compute").click();

  const result = panel(page).getByRole("region", { name: "Evaluate result" });
  await expect(result).toBeVisible();
  // Input, exact result and decimal, each drawn by the app's math renderer.
  await expect(result.locator("dl .katex")).toHaveCount(3);
  await expect(result).toContainText("0.833333333333");
  // What was typed is untouched by the result.
  await expect(field(page)).toHaveValue("1/2 + 1/3");

  // Worked steps, open by default: the fraction work under its step.
  const stepsToggle = result.getByRole("button", { name: /^Steps/ });
  await expect(stepsToggle).toHaveAttribute("aria-expanded", "true");
  const steps = result.getByRole("list", { name: "Steps" });
  await expect(steps).toContainText("Give both fractions the same bottom number:");
  // Hidden steps aren't copied: what is copied is what the card shows.
  await stepsToggle.click();
  await expect(steps).toBeHidden();

  const markdown = "$$\n1/2+1/3 = \\frac{5}{6} \\approx 0.833333333333\n$$";
  await result.getByRole("button", { name: "Copy" }).click();
  await expect(result.getByRole("button", { name: "Copied" })).toBeVisible();
  // Windows uses CRLF in the system clipboard.
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard.replace(/\r\n/g, "\n")).toBe(markdown);

  // Computing, copying: no document or scratchpad changed.
  expect((await stored(page)).files.map((f) => f.content)).toEqual([GUIDE]);
  expect((await stored(page)).scratchpads).toEqual([]);

  await result.getByRole("button", { name: "Add to rough work" }).click();
  await expect(page.getByText("Added to “Scratchpad”")).toBeVisible();
  await expect
    .poll(async () => (await stored(page)).scratchpads.map((p) => p.content))
    .toEqual([`${markdown}\n`]);
  // Still only rough work: the document is as it was.
  expect((await stored(page)).files.map((f) => f.content)).toEqual([GUIDE]);

  await page.getByRole("tab", { name: "Rough work" }).click();
  const pad = panel(page).locator("textarea[id^='scratchpad-']");
  await expect(pad).toHaveValue(`${markdown}\n`);
  await expect(panel(page).getByRole("region", { name: "Preview" }).locator(".katex")).toHaveCount(
    1,
  );

  // The insertion shows what goes in, and Cancel changes nothing.
  await panel(page).getByRole("button", { name: "Insert into document…" }).click();
  const dialog = page.getByRole("dialog", { name: "Insert into “guide.md”?" });
  await expect(dialog.locator(".katex")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect((await stored(page)).files.map((f) => f.content)).toEqual([GUIDE]);

  await panel(page).getByRole("button", { name: "Insert into document…" }).click();
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  await expect
    .poll(async () => (await stored(page)).files.map((f) => f.content))
    .toEqual([`${GUIDE}\n${markdown}\n`]);
  await expect(page.locator("article .katex-display")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a result goes straight into the document too, but only after its confirmation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await openCompute(page);
  await field(page).fill("x^2 - 5x + 6 = 0");
  await button(page, "Compute").click();
  const result = panel(page).getByRole("region", { name: "Solve result" });
  await expect(result.locator("dl").getByRole("listitem")).toHaveCount(2);
  await expect(result).toContainText("Solutions");
  await expect(result.getByRole("list", { name: "Steps" })).toContainText(
    "find two numbers that multiply to",
  );

  await result.getByRole("button", { name: "Insert into document…" }).click();
  const dialog = page.getByRole("dialog", { name: "Insert into “guide.md”?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect((await stored(page)).files.map((f) => f.content)).toEqual([GUIDE]);

  await result.getByRole("button", { name: "Insert into document…" }).click();
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  // The steps, shown, go in with the result: a numbered list with its math as display blocks.
  await expect
    .poll(async () => (await stored(page)).files[0].content)
    .toContain("**Steps**\n\n1. Factor: find two numbers");
  const inserted = (await stored(page)).files[0].content;
  expect(
    inserted.startsWith(
      `${GUIDE}\n$$\nx^{2}-5x+6=0 \\quad\\Longrightarrow\\quad x = 3,\\quad x = 2\n$$\n`,
    ),
  ).toBe(true);
  // Every step's math renders in the document: the result's block and one per step line.
  await expect(page.locator("article li .katex-display").first()).toBeVisible();
  // Inserting from Compute makes no scratchpad.
  expect((await stored(page)).scratchpads).toEqual([]);
});

test("unsupported and invalid input is labelled; a choice of unknown is asked for", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await openCompute(page);

  // Unsupported operations are labelled without offering a download.
  await field(page).fill("5 \\mod 3");
  await button(page, "Compute").click();
  const unsupported = panel(page).getByRole("region", { name: "Evaluate: Not supported yet" });
  await expect(unsupported).toContainText("Remainders (mod) aren't supported yet");
  await expect(unsupported.getByRole("button", { name: "Use the advanced engine" })).toHaveCount(0);

  // Basic calculus uses the same worker.
  await field(page).fill("\\int_0^1 x\\,dx");
  await button(page, "Compute").click();
  await expect(panel(page).getByRole("region", { name: "Evaluate result" })).toContainText(
    "upper number",
  );

  await field(page).fill("x +");
  await button(page, "Simplify").click();
  await expect(
    panel(page).getByRole("region", { name: "Simplify: Can't read this" }),
  ).toBeVisible();

  // An equation asked to evaluate offers Solve instead.
  await field(page).fill("2x + 3 = 7");
  await button(page, "Evaluate").click();
  await panel(page).getByRole("button", { name: "Solve instead" }).click();
  await expect(panel(page).getByRole("region", { name: "Solve result" })).toContainText("x=2");

  await field(page).fill("a x + b = 0");
  await button(page, "Compute").click();
  const choose = panel(page).getByRole("region", { name: "Solve: Choose a variable" });
  await choose.getByRole("button", { name: "Solve for x" }).click();
  const result = panel(page).getByRole("region", { name: "Solve result" });
  await expect(result).toContainText("Treats");
  await expect(result).toContainText("Assumes");
  await expect(panel(page).getByRole("textbox", { name: /^Unknown to solve for/ })).toHaveValue(
    "x",
  );

  // Escape clears the result, and the panel stays open.
  await field(page).press("Escape");
  await expect(result).toBeHidden();
  await expect(field(page)).toBeVisible();
});

test("the engine works in a worker: the page stays responsive, and a long computation can be cancelled", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tasks: number[] = [];
    (window as unknown as { __longTasks: number[] }).__longTasks = tasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(Math.round(entry.duration));
    }).observe({ type: "longtask", buffered: true });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await openCompute(page);
  // Load the engine first, so what follows measures computing alone.
  await field(page).fill("2 + 2");
  await button(page, "Compute").click();
  await expect(panel(page).getByRole("region", { name: "Evaluate result" })).toBeVisible();

  const longest = () =>
    page.evaluate(() =>
      Math.max(0, ...(window as unknown as { __longTasks: number[] }).__longTasks),
    );
  // The observer sees a task the page blocks itself, so a small number below means none.
  await page.evaluate(() => {
    setTimeout(() => {
      const end = performance.now() + 120;
      while (performance.now() < end);
    });
  });
  await expect.poll(longest).toBeGreaterThanOrEqual(100);
  await page.evaluate(
    () => ((window as unknown as { __longTasks: number[] }).__longTasks.length = 0),
  );

  // Substantial work in the engine (exact 100000!, then its decimal).
  await field(page).fill("100000!");
  await button(page, "Compute").click();
  // A fast machine may finish before the delayed status appears. Typing must
  // still remain responsive; the long-task check below measures the page.
  await panel(page)
    .getByRole("textbox", { name: /^Unknown to solve for/ })
    .pressSequentially("x");
  // Show its decimal if it finishes; on a busy or slow machine, the documented
  // engine time limit can stop this workload. Both must leave the page usable.
  await expect(
    panel(page).getByRole("region", {
      name: /^Evaluate(?: result|: Too complex|: Took too long)$/,
    }),
  ).toContainText(/2\.82422940796|Stopped after/, { timeout: 15_000 });
  // On the page's own thread this would be one task of a second or more.
  expect(await longest()).toBeLessThan(250);

  await field(page).fill("4000000!");
  await button(page, "Compute").click();
  await expect(panel(page).getByText("Computing…")).toBeVisible();
  await panel(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(panel(page).getByRole("region", { name: "Evaluate: Cancelled" })).toBeVisible();
  // A fresh engine serves the next request.
  await field(page).fill("6 * 7");
  await button(page, "Compute").click();
  await expect(panel(page).getByRole("region", { name: "Evaluate result" })).toContainText("42");
});

test("math input: written as it looks, from the keyboard or the keypad; Enter computes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("tab", { name: "Compute" }).click();
  // Math is the default, its keypad open under it.
  const math = panel(page).locator("math-field");
  const keypad = panel(page).getByRole("group", { name: "Math keyboard" });
  await expect(keypad).toBeVisible();
  const key = (name: string) => keypad.getByRole("button", { name, exact: true });
  const value = () =>
    math.evaluate((el) =>
      (el as unknown as { getValue: (format: string) => string }).getValue("latex-unstyled"),
    );

  // Typed linearly, as meant: a sum of two fractions, not 1/(2 + 1/3).
  await math.click();
  // MathLive takes focus a moment after the click.
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("MATH-FIELD");
  await page.keyboard.type("1/2+1/3");
  expect(await value()).toBe("\\frac12+\\frac13");
  await page.keyboard.press("Enter");
  const result = panel(page).getByRole("region", { name: "Evaluate result" });
  await expect(result).toContainText("0.833333333333");

  // From the keypad: a root, its digits, out of it, on to a fraction.
  await panel(page).getByRole("button", { name: "Clear input" }).click();
  for (const name of ["Square root", "1", "6", "Move right", "Plus", "Fraction"]) {
    await key(name).click();
  }
  expect(await value()).toBe("\\sqrt{16}+\\frac{\\placeholder{}}{\\placeholder{}}");
  // An empty box would be computed as nothing: it's asked for instead.
  await expect(panel(page).locator("#compute-reading")).toHaveText(
    "Fill in the empty boxes, then compute.",
  );
  await page.keyboard.press("Enter");
  await expect(result).toContainText("0.833333333333");
  // The first box is selected; the keypad moves on to the next.
  await page.keyboard.type("1");
  await key("Move right").click();
  await page.keyboard.type("4");
  await page.keyboard.press("Enter");
  await expect(result).toContainText("4.25");

  // Text shows what was written, as LaTeX; plain text comes back as math.
  await panel(page).getByRole("radio", { name: "Text" }).click();
  await expect(field(page)).toHaveValue("\\sqrt{16}+\\frac14");
  await field(page).fill("sqrt(8)");
  await panel(page).getByRole("radio", { name: "Math" }).click();
  // MathLive writes it its own way: one-digit groups lose their braces.
  await expect.poll(value).toBe("\\sqrt8");
  expect(await page.evaluate(() => localStorage.getItem("localdox:compute-input"))).toBe("math");

  // The keypad folds away, and stays folded.
  await panel(page).getByRole("button", { name: "Math keyboard" }).click();
  await expect(keypad).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("localdox:compute-keypad"))).toBe("closed");
  expect(errors).toEqual([]);
});

/** No network, as offline.spec.ts does it: offline, HTTP cache off, every request aborted. */
async function goOffline(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await context.setOffline(true);
  await context.route("**/*", (route) => route.abort("internetdisconnected"));
}

test("once loaded, Compute works offline after a reload", async ({ page, context }) => {
  test.skip(!process.env.PLAYWRIGHT_PRODUCTION, "The service worker exists only in the build");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, {
    timeout: 30_000,
  });
  await openCompute(page);
  await field(page).fill("1/2 + 1/3");
  await button(page, "Compute").click();
  await expect(panel(page).getByRole("region", { name: "Evaluate result" })).toBeVisible();
  // Let the service worker store what this first use fetched.
  await page.waitForTimeout(500);

  await goOffline(context, page);
  await page.reload();
  await expect(page.locator("article h1").first()).toBeVisible();
  // The panel and its tab come back; the engine starts from the cache.
  await expect(page.getByRole("tab", { name: "Compute" })).toHaveAttribute("aria-selected", "true");
  await field(page).fill("x^2 = 2");
  await button(page, "Compute").click();
  const result = panel(page).getByRole("region", { name: "Solve result" });
  await expect(result.locator("dl").getByRole("listitem")).toHaveCount(2);
  await expect(result).toContainText("1.41421356237");
});
