import { test, expect } from "@playwright/test";
test("complete exam: sealed solutions, resume, reflection, report, review and dashboard", async ({
  page,
}) => {
  const solutionRequests: string[] = [];
  page.on("request", (request) => {
    if (
      /\.solutions(?:-[\w-]+)?\.md(?:\?|$)/.test(request.url()) &&
      !request.url().includes("import")
    )
      solutionRequests.push(request.url());
  });
  await page.goto("/exams");
  await expect(page.getByRole("heading", { name: "Exam library", exact: true })).toBeVisible();
  await page
    .getByRole("article")
    .filter({ hasText: "Two-section reasoning quiz" })
    .getByRole("button", { name: "View instructions" })
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
  await page.getByRole("button", { name: "Confirm finish section" }).click();
  await expect(page.getByRole("button", { name: "Logic", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Numeric answer" }).fill("2.33");
  await page.getByRole("button", { name: "Submit exam", exact: true }).click();
  await expect(page.getByText("2 answered · 0 unanswered · 0 marked for review.")).toBeVisible();
  await page.getByRole("button", { name: "Confirm submission" }).click();
  await expect(page.getByRole("heading", { name: "Before you see the answers" })).toBeVisible();
  expect(solutionRequests.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "sure", exact: true }).first().click();
  await page.getByRole("button", { name: "Show result" }).click();
  await expect(page.getByRole("heading", { name: "Exam result" })).toBeVisible();
  await expect(page.getByText("4.00 / 5", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Weakness Report" }).click();
  await expect(page.getByRole("heading", { name: "Marks lost by cause" })).toBeVisible();
  await page.getByRole("button", { name: "Review answers & solutions" }).click();
  await expect(page.getByRole("heading", { name: "Answer review" })).toBeVisible();
  await page.getByLabel("Cause for logic-1").selectOption("concept_gap");
  await page.getByLabel("Note for logic-1").fill("Remember to select every correct option.");
  await page.getByRole("button", { name: "Weakness Dashboard", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Weakness Dashboard", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/1 completed attempts/)).toBeVisible();
});
test("seeded demo shows every default rule without taking an exam", async ({ page }) => {
  test.skip(!!process.env.PLAYWRIGHT_PRODUCTION, "Demo menu is development-only");
  await page.goto("/exams");
  await page.getByText("Developer demos", { exact: true }).click();
  await page.getByRole("button", { name: "Load diagnostic demo" }).click();
  await expect(page.getByRole("heading", { name: "Exam result" })).toBeVisible();
  await page.getByRole("tab", { name: "Weakness Report" }).click();
  for (const id of [
    "slow_on_easy",
    "stuck_on_hard",
    "rushed_wrong",
    "overconfident_wrong",
    "lucky_guess",
    "underconfident_right",
    "unjustified_guess_penalty",
    "fell_for_trap",
    "changed_right_to_wrong",
    "skipped_easy",
    "late_collapse",
    "guess_bleed",
  ])
    await expect(page.getByText(id, { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/exam-demo-report.png", fullPage: true });
});
test("mobile exam library and invalid import report", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/exams");
  await expect(page.getByRole("heading", { name: "Exam library", exact: true })).toBeVisible();
  await page.getByLabel("Import exam files", { exact: true }).setInputFiles({
    name: "invalid.exam.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":2,"typo":1}'),
  });
  await expect(page.getByRole("alert")).toContainText("Unrecognized");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/exam-library-mobile.png", fullPage: true });
});

test("an imported malformed key stays sealed until submission and can be repaired", async ({
  page,
}) => {
  await page.goto("/exams");
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
    .getByRole("button", { name: "View instructions" })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "I have read and acknowledge" }).check();
  await page.getByRole("button", { name: "Start exam" }).click();
  await page.getByLabel("Numeric answer").fill("4");
  await page.getByRole("button", { name: "Submit exam", exact: true }).click();
  await page.getByRole("button", { name: "Confirm submission" }).click();
  await expect(page.getByRole("alert")).toContainText("solutions");
  await expect(page.getByRole("heading", { name: "Submission saved" })).toBeVisible();
  await page.getByLabel("Replace solutions file").setInputFiles({
    name: "proof.solutions.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(":::solution{#q answer=4}\nFour.\n:::"),
  });
  await expect(page.getByRole("heading", { name: "Exam result" })).toBeVisible();
  await expect(page.getByText("1.00 / 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Weakness Report" })).toHaveCount(0);
});

test("expiry after reload submits automatically and preserves the answer", async ({ page }) => {
  await page.goto("/exams");
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
    .getByRole("button", { name: "View instructions" })
    .click();
  await page.getByRole("checkbox", { name: "I have read and acknowledge" }).check();
  await page.getByRole("button", { name: "Start exam" }).click();
  await page.getByLabel("Numeric answer").fill("2");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Before you see the answers" })).toBeVisible();
  await page.getByRole("button", { name: "Skip reflection" }).click();
  await expect(page.getByText("1.00 / 1", { exact: true })).toBeVisible();
  await expect(page.getByText(/integrity violations · expiry/)).toBeVisible();
});

test("GATE screen renders math, diagrams and charts while hiding diagnostic metadata", async ({
  page,
}) => {
  await page.goto("/exams");
  await page
    .getByRole("article")
    .filter({ hasText: "GATE 2027" })
    .getByRole("button", { name: "View instructions" })
    .click();
  await page.getByRole("checkbox", { name: "I have read and acknowledge" }).check();
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByText("ga.verbal", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Question 3: not visited", exact: true }).click();
  await expect(page.locator(".katex").first()).toBeVisible();
  await page.getByRole("button", { name: "Question 9: not visited", exact: true }).click();
  await expect(page.locator(".exam-markdown svg").first()).toBeVisible();
  await page.getByRole("button", { name: "Question 10: not visited", exact: true }).click();
  await expect(page.getByRole("img", { name: "bar chart" })).toBeVisible();
  await page.screenshot({ path: "test-results/exam-screen-desktop.png", fullPage: true });
  await page.evaluate(() => document.exitFullscreen());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/exam-screen-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
