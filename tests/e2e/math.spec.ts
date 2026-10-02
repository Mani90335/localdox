import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

// R05: math is typeset in the reader, and a document with thousands of
// equations opens without a long task.
//
// Before this change the reader's component map had no math renderers (lost in
// a refactor), so `$…$` and `$$…$$` rendered as empty elements. With them
// restored, a 2,000-equation document typeset every waiting equation in one
// ~960 ms task and committed them in another ~820 ms one.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    );
    const tasks: number[] = [];
    (window as unknown as { __longTasks: number[] }).__longTasks = tasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(Math.round(entry.duration));
    }).observe({ type: "longtask", buffered: true });
  });
});

/** Upload from disk: a buffer is built into a File inside the page, itself a long task. */
async function upload(page: Page, name: string, source: string, readingMode?: "single") {
  if (readingMode)
    await page.addInitScript(() => {
      const prefs = JSON.parse(localStorage.getItem("localdox:prefs") ?? "{}");
      localStorage.setItem("localdox:prefs", JSON.stringify({ ...prefs, readingMode: "single" }));
    });
  const path = test.info().outputPath(name);
  writeFileSync(path, source);
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles(path);
}

const typeset = (page: Page) =>
  page.locator("article").locator(".docs-math-inline, .docs-math-rendered");
const waiting = (page: Page) =>
  page.locator("article").locator(".docs-math-pending, .docs-math-pending-block");
const longestTask = (page: Page) =>
  page.evaluate(() => Math.max(0, ...(window as unknown as { __longTasks: number[] }).__longTasks));

/** 1,000 sections, each with one inline and one display equation, all distinct. */
function manyEquations(sections = 1000) {
  let source = "# Many equations\n\n";
  for (let i = 0; i < sections; i++)
    source +=
      `## Section ${i}\n\nInline $x_{${i}}^2 + y_{${i}} = ${i}$ here.\n\n` +
      `$$\n\\sum_{k=0}^{${i}} \\frac{k^{${(i % 7) + 1}}}{${i + 1}!} = \\int_0^{${i}} f_{${i}}(t)\\,dt\n$$\n\n`;
  return source;
}

test("inline and display math are typeset, numbered and referenced in the reader", async ({
  page,
}) => {
  await upload(
    page,
    "math.md",
    [
      "# Math",
      "",
      "Inline $E = mc^2$ in a sentence.",
      "",
      "$$",
      "\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2} \\label{eq:gauss}",
      "$$",
      "",
      "See equation $\\eqref{eq:gauss}$.",
      "",
      "Broken: $\\frac{1}{$ end.",
      "",
    ].join("\n"),
  );

  const article = page.locator("article");
  await expect(article.locator(".docs-math-inline .katex")).toHaveCount(1);
  const gauss = article.locator("#eq-eq-gauss");
  await expect(gauss.locator(".katex-display")).toBeVisible();
  await expect(gauss).toHaveAttribute("data-equation-number", "1");
  // Screen readers get MathML; the visual layer is hidden from them.
  await expect(gauss.locator("math")).toHaveCount(1);
  await expect(article.locator(".docs-eq-ref")).toHaveText("(1)");
  // Malformed LaTeX shows its source, not an empty gap or a crash.
  await expect(article.getByText("\\frac{1}{", { exact: false })).toBeVisible();
  await expect(waiting(page)).toHaveCount(0);
});

test("what KaTeX can't draw falls back to MathJax, which can't be used to style the page", async ({
  page,
}) => {
  const missing: string[] = [];
  page.on("response", (response) => {
    if (response.status() === 404) missing.push(new URL(response.url()).pathname);
  });
  await upload(
    page,
    "fallback.md",
    [
      "# Fallback",
      "",
      "$$",
      "\\begin{multline} a + b \\\\ = c \\end{multline}",
      "$$",
      "",
      "Styled: $\\style{position:fixed;inset:0;background:red}{x}$ end.",
      "",
    ].join("\n"),
  );
  // Only the production build was missing MathJax's extensions: its startup
  // waited on them forever and the equation stayed on its placeholder.
  const block = page.locator("article .docs-math-block");
  await expect(block).toHaveAttribute("data-math-engine", "mathjax", { timeout: 30_000 });
  await expect(block.locator("mjx-container")).toBeVisible();
  // `\style` needs MathJax's html extension, which isn't published: the
  // expression fails in place and nothing on the page is restyled.
  await expect(page.locator("article .docs-math-error-inline")).toContainText("\\style");
  expect(
    await page
      .locator("article *")
      .evaluateAll((els) => els.filter((el) => getComputedStyle(el).position === "fixed").length),
  ).toBe(0);
  expect(missing).toEqual(["/vendor/mathjax/input/tex/extensions/html.js"]);
});

test("an equation reference on one page opens the page that holds the equation", async ({
  page,
}) => {
  await upload(
    page,
    "pages.md",
    [
      "# First",
      "",
      "As shown in $\\eqref{eq:far}$ on the next page.",
      "",
      "# Second",
      "",
      "Filler.",
      "",
      "$$",
      "a^2 + b^2 = c^2 \\label{eq:far}",
      "$$",
      "",
    ].join("\n"),
  );
  const ref = page.locator("article .docs-eq-ref");
  await expect(ref).toHaveText("(1)");
  await expect(page.locator("#eq-eq-far")).toHaveCount(0);
  await ref.click();
  await expect(page.locator("#eq-eq-far")).toBeInViewport();
  await expect(page.locator("#eq-eq-far .katex-display")).toBeVisible();
});

test("an equation reference lands on an equation far down a long document", async ({ page }) => {
  const source = manyEquations(600).replace(
    "# Many equations\n\n",
    "# Many equations\n\nJump to $\\eqref{eq:target}$.\n\n",
  );
  await upload(
    page,
    "jump.md",
    source.replace(
      "= \\int_0^{550} f_{550}(t)\\,dt",
      "= \\int_0^{550} f_{550}(t)\\,dt \\label{eq:target}",
    ),
    "single",
  );
  const ref = page.locator("article .docs-eq-ref").first();
  await expect(ref).toHaveText("(551)");
  await ref.click();
  await expect(page.locator("#eq-eq-target")).toBeInViewport({ timeout: 30_000 });
});

test("2,000 distinct equations open without a long task and are all typeset", async ({ page }) => {
  await upload(page, "many.md", manyEquations(), "single");
  // Waited for with a cheap check at a slow poll: Playwright's text and count
  // locators run in the page, and over this much markup they are long tasks
  // of their own.
  await page.waitForFunction(
    () =>
      !document.querySelector(
        "article [aria-busy], .docs-math-pending, .docs-math-pending-block",
      ) && document.querySelectorAll(".docs-math-inline, .docs-math-rendered").length === 2000,
    null,
    { timeout: 60_000, polling: 1000 },
  );
  // Before: a ~960 ms task typesetting every waiting equation and a ~820 ms one
  // committing them. Now each task typesets within a budget and off-screen
  // display equations skip layout; measured: no task over 50 ms (slicing
  // alone left 141-147 ms ones).
  expect(await longestTask(page)).toBeLessThan(100);
  await expect(typeset(page)).toHaveCount(2000);
  // Off-screen display equations are skipped by the renderer but stay in the
  // DOM, typeset, for find, selection and printing.
  const last = page.locator("article .docs-math-block").last();
  const contents = last.locator(".docs-math-scroll");
  const drawn = () =>
    contents.evaluate((el) => el.checkVisibility({ contentVisibilityAuto: true }));
  expect(await drawn()).toBe(false);
  await expect(last.locator(".katex-display")).toHaveCount(1);
  await last.scrollIntoViewIfNeeded();
  await expect.poll(drawn).toBe(true);
});

test("editing one equation re-typesets it and keeps the rest", async ({ page }) => {
  await upload(page, "edit.md", manyEquations(200), "single");
  await expect(typeset(page)).toHaveCount(400, { timeout: 30_000 });

  await page.getByRole("button", { name: "Options", exact: true }).first().click();
  await page.getByText("Edit", { exact: true }).click();
  const editor = page.locator("#markdown-source");
  await editor.fill(manyEquations(200).replace("x_{150}^2", "x_{150}^2 + z"));
  await page.getByText("Done · Preview").click();

  await expect(typeset(page)).toHaveCount(400, { timeout: 30_000 });
  await expect(waiting(page)).toHaveCount(0);
  const edited = page.locator(".docs-math-inline").filter({ hasText: "z" });
  await expect(edited).toHaveCount(1);
  await expect(edited.locator(".katex")).toHaveCount(1);
});
