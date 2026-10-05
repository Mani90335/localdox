import { test, expect, type Page } from "@playwright/test";
// The app opens on the study plan; standalone exams live in the library.
async function openLibrary(page: Page, url = "/exams") {
  await page.goto(url);
  await page.getByRole("button", { name: "Exam library", exact: true }).click();
}
test("complete exam: sealed solutions, resume, result and mistake review", async ({ page }) => {
  const solutionRequests: string[] = [];
  page.on("request", (request) => {
    if (
      /\.solutions(?:-[\w-]+)?\.md(?:\?|$)/.test(request.url()) &&
      !request.url().includes("import")
    )
      solutionRequests.push(request.url());
  });
  await openLibrary(page);
  await expect(page.getByRole("heading", { name: "Exam library", exact: true })).toBeVisible();
  await page
    .getByRole("article")
    .filter({ hasText: "Two-section reasoning quiz" })
    .getByRole("button", { name: "Start", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Start exam" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "I have read and acknowledge" }).check();
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  expect(solutionRequests).toEqual([]);
  await page.getByRole("checkbox").first().check();
  await page.reload();
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  await expect(page.getByRole("timer")).toContainText("00:04:");
  expect(solutionRequests).toEqual([]);
  await page.getByRole("button", { name: "Finish section", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Finish section" }).click();
  await expect(page.getByRole("button", { name: "Logic", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Numeric answer" }).fill("2.33");
  await page.getByRole("button", { name: "Submit exam", exact: true }).click();
  const summary = page.getByRole("dialog");
  await expect(summary.getByRole("row", { name: "Logic 1 0 0 0" })).toBeVisible();
  await expect(summary.getByRole("row", { name: "Numbers 1 0 0 0" })).toBeVisible();
  await summary.getByRole("button", { name: "Submit exam" }).click();
  // No confidence reflection or analytics: straight to the result.
  await expect(page.getByRole("heading", { name: "Exam result" })).toBeVisible();
  expect(solutionRequests.length).toBeGreaterThan(0);
  await expect(page.getByText("4.00 / 5", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await page.getByRole("button", { name: "Review answers & solutions" }).click();
  await expect(page.getByRole("heading", { name: "Answer review" })).toBeVisible();
  // The partly correct MSQ is a mistake; the correct NAT shows under "All".
  await expect(page.getByRole("radio", { name: "Mistakes (1)" })).toBeChecked();
  await expect(page.getByRole("heading", { name: "Question 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Question 2" })).toHaveCount(0);
  await page.getByRole("radio", { name: "All (2)" }).click();
  await expect(page.getByRole("heading", { name: "Question 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Weakness Dashboard" })).toHaveCount(0);
});
test("developer demo is hidden from learners and loads with ?dev=1", async ({ page }) => {
  test.skip(!!process.env.PLAYWRIGHT_PRODUCTION, "Demo menu is development-only");
  await openLibrary(page);
  await expect(page.getByText("Developer demos")).toHaveCount(0);
  await openLibrary(page, "/exams?dev=1");
  await page.getByText("Developer demos", { exact: true }).click();
  await page.getByRole("button", { name: "Load diagnostic demo" }).click();
  await expect(page.getByRole("heading", { name: "Exam result" })).toBeVisible();
  await page.getByRole("button", { name: "Review answers & solutions" }).click();
  await expect(page.getByRole("heading", { name: "Answer review" })).toBeVisible();
  await page.screenshot({ path: "test-results/exam-demo-review.png", fullPage: true });
});
test("mobile exam library and invalid import report", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLibrary(page);
  await expect(page.getByRole("heading", { name: "Exam library", exact: true })).toBeVisible();
  await page.getByLabel("Import exam files", { exact: true }).setInputFiles({
    name: "invalid.exam.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":2,"typo":1}'),
  });
  await expect(page.getByRole("alert")).toContainText("Unknown field typo");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/exam-library-mobile.png", fullPage: true });
});

test("an imported malformed key stays sealed until submission and can be repaired", async ({
  page,
}) => {
  await openLibrary(page);
  const rules = {
    schemaVersion: 2,
    meta: { id: "import-proof", name: "Imported proof", version: "1" },
    timing: { mode: "global", durationMinutes: 1 },
    sections: [{ id: "one", name: "One", questionCount: 1 }],
    questionTypes: { nat: { inputMode: "keyboard" } },
    diagnostics: { enabled: false },
  };
  const paper = ":::question{#q section=one type=nat marks=1}\nWhat is 2 + 2?\n:::";
  await page.getByLabel("Import exam files", { exact: true }).setInputFiles([
    {
      name: "proof.exam.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(rules)),
    },
    { name: "proof.paper.md", mimeType: "text/markdown", buffer: Buffer.from(paper) },
    {
      name: "proof.solutions.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("Malformed key, deliberately not a directive."),
    },
  ]);
  await page
    .getByRole("article")
    .filter({ hasText: "Imported proof" })
    .getByRole("button", { name: "Start", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "I have read and acknowledge" }).check();
  await page.getByRole("button", { name: "Start exam" }).click();
  await page.getByLabel("Numeric answer").fill("4");
  await page.getByRole("button", { name: "Submit exam", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();
  await expect(page.getByRole("alert")).toContainText("solutions");
  await expect(page.getByRole("heading", { name: "Submission saved" })).toBeVisible();
  await page.getByLabel("Replace solutions file").setInputFiles({
    name: "proof.solutions.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(":::solution{#q answer=4}\nFour.\n:::"),
  });
  await expect(page.getByRole("heading", { name: "Exam result" })).toBeVisible();
  await expect(page.getByText("1.00 / 1", { exact: true })).toBeVisible();
});

test("expiry after reload submits automatically and preserves the answer", async ({ page }) => {
  await openLibrary(page);
  const rules = {
    schemaVersion: 2,
    meta: { id: "expiry-proof", name: "Expiry proof", version: "1" },
    timing: { mode: "global", durationMinutes: 0.06 },
    sections: [{ id: "one", name: "One", questionCount: 1 }],
    questionTypes: { nat: { inputMode: "keyboard" } },
  };
  await page.getByLabel("Import exam files", { exact: true }).setInputFiles([
    {
      name: "expiry.exam.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(rules)),
    },
    {
      name: "expiry.paper.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(":::question{#q section=one type=nat marks=1}\nOne plus one?\n:::"),
    },
    {
      name: "expiry.solutions.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(":::solution{#q answer=2}\nTwo.\n:::"),
    },
  ]);
  await page
    .getByRole("article")
    .filter({ hasText: "Expiry proof" })
    .getByRole("button", { name: "Start", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "I have read and acknowledge" }).check();
  await page.getByRole("button", { name: "Start exam" }).click();
  await page.getByLabel("Numeric answer").fill("2");
  await page.reload();
  await expect(page.getByText("1.00 / 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Submitted automatically when time ran out.")).toBeVisible();
});

test("GATE screen renders math, diagrams and charts while hiding diagnostic metadata", async ({
  page,
}) => {
  await openLibrary(page);
  await page
    .getByRole("article")
    .filter({ hasText: "GATE 2027" })
    .getByRole("button", { name: "Start", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "I have read and acknowledge" }).check();
  await page.getByRole("button", { name: "Start exam" }).click();
  // Fullscreen exams confirm the switch first (a real user gesture).
  await page.getByRole("button", { name: "Enter fullscreen & start" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByText("ga.verbal", { exact: true })).toHaveCount(0);
  // The palette shows the current section, as in GATE; switch sections to reach Q3.
  await page.getByRole("button", { name: "Data Science & AI", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Question 3 of 12" })).toBeVisible();
  await expect(page.locator(".katex").first()).toBeVisible();
  await page.getByRole("button", { name: "Question 9: not visited", exact: true }).click();
  await expect(page.locator(".exam-markdown svg").first()).toBeVisible();
  // No flicker: the exam clock re-renders twice a second, but the drawn
  // diagram must stay the same DOM node (it used to be rebuilt every tick).
  const diagram = await page.locator(".xr-body-md .ex-diagram svg").elementHandle();
  await page.waitForTimeout(1600);
  expect(await diagram!.evaluate((node) => node.isConnected)).toBe(true);
  await page.getByRole("button", { name: "Question 10: not visited", exact: true }).click();
  await expect(page.getByRole("img", { name: "bar chart" })).toBeVisible();
  const chart = await page.locator(".xr-body-md .recharts-wrapper").elementHandle();
  await page.waitForTimeout(1600);
  expect(await chart!.evaluate((node) => node.isConnected)).toBe(true);
  await page.screenshot({ path: "test-results/exam-screen-desktop.png", fullPage: true });
  await page.evaluate(() => document.exitFullscreen());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/exam-screen-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
