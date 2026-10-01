import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// The Compute tab's advanced engine (SymPy on Pyodide), end to end on the
// production build, which publishes it under /pyodide/: asked for before its
// download, computing calculus, probability, linear algebra and differential
// equations in a worker without blocking the page, carrying its givens into
// rough work and a confirmed insertion, and working offline once loaded.

test.skip(!process.env.PLAYWRIGHT_PRODUCTION, "The engine is published by the production build");
// The first load downloads ~11 MB, which Vite's preview server compresses on
// every request; allow for it.
test.setTimeout(180_000);

const GUIDE = "# Field guide\n\nOpening words of the guide.\n";
const FIRST_LOAD = { timeout: 120_000 };

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

const panel = (page: Page) => page.getByRole("region", { name: "Notes panel" });
const field = (page: Page) => panel(page).getByRole("textbox", { name: /^Expression or equation/ });
const button = (page: Page, name: string) => panel(page).getByRole("button", { name, exact: true });

async function openCompute(page: Page) {
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("tab", { name: "Compute" }).click();
  await expect(field(page)).toBeVisible();
}

/** Requests for the engine's own files. */
function engineRequests(context: BrowserContext) {
  const urls: string[] = [];
  context.on("request", (request) => {
    if (/\/pyodide\/|advanced\.worker/.test(request.url())) urls.push(request.url());
  });
  return urls;
}

interface Stored {
  files: Array<{ content: string }>;
  scratchpads: Array<{ content: string }>;
}

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

test("advanced work is asked for first, and declining downloads nothing", async ({
  page,
  context,
}) => {
  const requests = engineRequests(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await openCompute(page);
  await field(page).fill("\\int_0^1 x^2\\,dx");
  await button(page, "Evaluate").click();
  const consent = panel(page).getByRole("region", { name: "Advanced engine" });
  await expect(consent).toContainText("Evaluate needs the advanced engine");
  await expect(consent).toContainText(/downloads \d+(\.\d)? MB/);
  await consent.getByRole("button", { name: "Not now" }).click();
  await expect(consent).toBeHidden();
  await page.waitForTimeout(500);
  expect(requests).toEqual([]);
  // The basic engine still answers what it can.
  await field(page).fill("1/2 + 1/3");
  await button(page, "Evaluate").click();
  await expect(panel(page).getByRole("region", { name: "Evaluate result" })).toContainText(
    "0.833333333333",
  );
  expect(requests).toEqual([]);
});

test("calculus, probability, matrices and an ODE, in a worker, carried into rough work and the document", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const tasks: number[] = [];
    (window as unknown as { __longTasks: number[] }).__longTasks = tasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(Math.round(entry.duration));
    }).observe({ type: "longtask", buffered: true });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const requests = engineRequests(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await openCompute(page);
  const longest = () =>
    page.evaluate(() =>
      Math.max(0, ...(window as unknown as { __longTasks: number[] }).__longTasks),
    );
  // The observer sees a task the page blocks itself, so a small number below means none.
  await page.evaluate(() =>
    setTimeout(() => {
      const end = performance.now() + 120;
      while (performance.now() < end);
    }),
  );
  await expect.poll(longest).toBeGreaterThanOrEqual(100);
  await page.evaluate(() => {
    (window as unknown as { __longTasks: number[] }).__longTasks.length = 0;
  });

  await field(page).fill("\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx");
  await button(page, "Evaluate").click();
  await panel(page)
    .getByRole("region", { name: "Advanced engine" })
    .getByRole("button", { name: "Download and compute" })
    .click();
  await expect(panel(page).getByText(/Loading Python|Loading SymPy/)).toBeVisible();
  const integral = panel(page).getByRole("region", { name: "Evaluate result" });
  await expect(integral).toContainText("1.77245385091", FIRST_LOAD);
  await expect(integral).toContainText("SymPy");
  expect(requests.some((url) => /sympy-[\d.]+-py3-none-any\.whl$/.test(url))).toBe(true);
  // Loading Python, SymPy and computing all happened off the page's thread.
  expect(await longest()).toBeLessThan(250);

  // Probability: the distribution is shown as a given, and read as N(mean, variance).
  await field(page).fill("X ~ N(0, 4)\nP(-2 < X < 2)");
  await button(page, "Evaluate").click();
  const probability = panel(page).getByRole("region", { name: "Evaluate result" });
  await expect(probability).toContainText("0.682689492137");
  await expect(probability).toContainText("Given");
  await expect(probability).toContainText("variance");

  // Linear algebra from the advanced tools.
  await field(page).fill("[[2, 1], [1, 2]]");
  await panel(page)
    .getByRole("button", { name: /^Advanced/ })
    .click();
  await panel(page).getByRole("tab", { name: "Matrices" }).click();
  await button(page, "Eigenvectors").click();
  const eigen = panel(page).getByRole("region", { name: "Eigenvectors result" });
  await expect(eigen).toContainText("λ = 1");
  await expect(eigen).toContainText("λ = 3");

  // A differential equation with initial conditions.
  await field(page).fill("y'' + y = 0\ny(0) = 1\ny'(0) = 0");
  await button(page, "Solve").click();
  await expect(panel(page).getByRole("region", { name: "Solve result" })).toContainText("cos");

  // Back to the probability: its given travels with it.
  await field(page).fill("X ~ N(0, 4)\nP(-2 < X < 2)");
  await button(page, "Evaluate").click();
  await probability.getByRole("button", { name: "Add to rough work" }).click();
  await expect
    .poll(async () => (await stored(page)).scratchpads.map((p) => p.content))
    .toEqual([
      expect.stringMatching(
        /^Given \$X \\sim \\mathcal\{N\}\\left\(0, 4\\right\)\$\.\n\n\$\$\nP\(-2<X<2\) = /,
      ),
    ]);
  expect((await stored(page)).files.map((f) => f.content)).toEqual([GUIDE]);

  await probability.getByRole("button", { name: "Insert into document…" }).click();
  const dialog = page.getByRole("dialog", { name: "Insert into “guide.md”?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect((await stored(page)).files.map((f) => f.content)).toEqual([GUIDE]);
  await probability.getByRole("button", { name: "Insert into document…" }).click();
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  await expect
    .poll(async () => (await stored(page)).files[0].content)
    .toContain("Given $X \\sim \\mathcal{N}\\left(0, 4\\right)$.");
  expect(errors).toEqual([]);
});

test("an incomplete basic answer offers the advanced engine, which finds the rest", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("localdox:advanced-math", "accepted"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await openCompute(page);
  await field(page).fill("|x| = 3");
  await button(page, "Solve").click();
  const basic = panel(page).getByRole("region", { name: "Solve result" });
  await expect(basic).toContainText("Found");
  await basic.getByRole("button", { name: "Try the advanced engine" }).click();
  const advanced = panel(page).getByRole("region", { name: "Solve result" });
  await expect(advanced).toContainText("SymPy", FIRST_LOAD);
  await expect(advanced).toContainText("−3");
});

test("a download that fails is reported, and nothing is left spinning", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => localStorage.setItem("localdox:advanced-math", "accepted"));
  await context.route("**/pyodide/**", (route) => route.abort("internetdisconnected"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await openCompute(page);
  await field(page).fill("\\int_0^1 x^2\\,dx");
  await button(page, "Evaluate").click();
  const failure = panel(page).getByRole("region", {
    name: "Evaluate: Couldn't load the math engine",
  });
  await expect(failure).toContainText("advanced math engine", { timeout: 30_000 });
  await expect(panel(page).getByText(/Loading Python|Loading SymPy/)).toBeHidden();
});

async function goOffline(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await context.setOffline(true);
  await context.route("**/*", (route) => route.abort("internetdisconnected"));
}

test("once loaded, advanced math works offline after a reload", async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem("localdox:advanced-math", "accepted"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, {
    timeout: 30_000,
  });
  await openCompute(page);
  await field(page).fill("\\sum_{n=1}^{\\infty}\\frac{1}{n^2}");
  await button(page, "Evaluate").click();
  await expect(panel(page).getByRole("region", { name: "Evaluate result" })).toContainText(
    "1.64493406685",
    FIRST_LOAD,
  );
  // Let the service worker finish storing what this first use fetched.
  await page.waitForTimeout(1500);

  await goOffline(context, page);
  await page.reload();
  await expect(page.locator("article h1").first()).toBeVisible();
  await expect(page.getByRole("tab", { name: "Compute" })).toHaveAttribute("aria-selected", "true");
  await field(page).fill("\\frac{d}{dx} x^3");
  await button(page, "Evaluate").click();
  await expect(panel(page).getByRole("region", { name: "Evaluate result" })).toContainText("3x", {
    timeout: 60_000,
  });
});
