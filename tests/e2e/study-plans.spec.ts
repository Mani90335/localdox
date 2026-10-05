import { test, expect, type Page } from "@playwright/test";
const policy = { passPercentage: 80, rewriteDifficultyPercentage: 100, difficultyLabel: "hard" };
const rules = (id: string, name: string) => ({
  schemaVersion: 2,
  meta: { id, name, version: "1" },
  timing: { mode: "global", durationMinutes: 5 },
  sections: [{ id: "one", name: "One", questionCount: 1 }],
  questionTypes: { mcq: { optionCount: 2 } },
  attempts: { max: 2 },
  progression: policy,
  diagnostics: { enabled: false },
});
function files(stem: string, id: string, name: string, difficulty: string, body: string) {
  return [
    {
      name: `${stem}.exam.json`,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(rules(id, name))),
    },
    {
      name: `${stem}.paper.md`,
      mimeType: "text/markdown",
      buffer: Buffer.from(
        `:::question{#q section=one type=mcq marks=5 difficulty=${difficulty}}\n${body}\n\n- Correct answer\n- Wrong answer\n:::`,
      ),
    },
    {
      name: `${stem}.solutions.md`,
      mimeType: "text/markdown",
      buffer: Buffer.from(":::solution{#q answer=A}\nExplanation.\n:::"),
    },
  ];
}
const plan = {
  schemaVersion: 1,
  id: "day-tracking",
  name: "Daily mastery",
  description: "Build a durable daily learning habit.",
  days: [
    {
      id: "day1",
      title: "First principles",
      examId: "day-exam",
      estimatedMinutes: 25,
      summaryMd: "Read, practice, then demonstrate understanding.",
      tasks: [
        { id: "read", label: "Read the lesson" },
        { id: "practice", label: "Practice two problems" },
      ],
    },
    { id: "day2", title: "Next topic", examId: "day-exam", tasks: [] },
  ],
};
async function completeExam(page: Page, correct: boolean) {
  await page.getByRole("checkbox", { name: "I have read and acknowledge" }).check();
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page
    .getByRole("radio")
    .nth(correct ? 0 : 1)
    .check();
  await page.getByRole("button", { name: "Submit exam", exact: true }).click();
  await page.getByRole("button", { name: "Confirm submission" }).click();
  await expect(page.getByRole("heading", { name: "Exam result" })).toBeVisible();
}
test("daily tracking: fail, retry to MAX_ATTEMPTS, revise, new difficulty-qualified paper, pass and unlock", async ({
  page,
}) => {
  await page.goto("/exams");
  await page
    .getByLabel("Import exam files", { exact: true })
    .setInputFiles([
      ...files("day", "day-exam", "Daily check", "easy", "First question?"),
      ...files(
        "rewrite",
        "new-day-exam",
        "Fresh challenging paper",
        "hard",
        "A different, harder question?",
      ),
    ]);
  await page.getByRole("button", { name: "Study plans", exact: true }).click();
  await page.getByLabel("Import study plan", { exact: true }).setInputFiles({
    name: "daily.plan.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(plan)),
  });
  await expect(page.getByRole("heading", { name: "Daily mastery" })).toBeVisible();
  await page.locator(".study-day-link").filter({ hasText: "Next topic" }).click();
  await expect(page.getByRole("heading", { name: "One step at a time" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start today's exam" })).toHaveCount(0);
  await page.getByRole("button", { name: "Go to your current day" }).click();
  await page.getByRole("checkbox", { name: "Read the lesson" }).check();
  await page.getByLabel("Daily study notes").fill("Review signs and assumptions.");
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Read the lesson" })).toBeChecked();
  await expect(page.getByLabel("Daily study notes")).toHaveValue("Review signs and assumptions.");
  await page.screenshot({ path: "test-results/study-plan-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Start today's exam" }).click();
  await completeExam(page, false);
  await expect(page.getByText("Day failed. Review your mistakes and try again.")).toBeVisible();
  await page.getByRole("button", { name: "Continue study plan" }).click();
  await expect(page.locator(".study-day-link").filter({ hasText: "Next topic" })).toContainText(
    "Locked",
  );
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await completeExam(page, false);
  await expect(page.getByText("Day failed. Revision and a new paper are required.")).toBeVisible();
  await page.getByRole("button", { name: "Continue study plan" }).click();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Replacement paper", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "I've revised this topic" }).click();
  await page.getByLabel("Replacement paper", { exact: true }).selectOption("day-exam");
  await page.getByRole("button", { name: "Use new paper" }).click();
  await expect(page.getByRole("alert")).toContainText("at least 100% hard");
  await page.getByLabel("Replacement paper", { exact: true }).selectOption("new-day-exam");
  await page.screenshot({ path: "test-results/study-plan-revision.png", fullPage: true });
  await page.getByRole("button", { name: "Use new paper" }).click();
  await expect(page.getByText("DAILY CHECKPOINT · PAPER 2")).toBeVisible();
  await page.getByRole("button", { name: "Start today's exam" }).click();
  await completeExam(page, true);
  await expect(page.getByText("Day passed. Your next step is unlocked.")).toBeVisible();
  await page.getByRole("button", { name: "Continue study plan" }).click();
  await expect(page.locator(".study-day-heading")).toContainText("Next topic");
  await expect(
    page.locator(".study-day-link").filter({ hasText: "First principles" }),
  ).toContainText("Passed");
  await expect(page.locator(".study-day-link").filter({ hasText: "Next topic" })).toContainText(
    "Ready to begin",
  );
  await page.reload();
  await expect(page.locator(".study-day-heading")).toContainText("Next topic");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/study-plan-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("sample plan is usable and malformed plan imports fail clearly", async ({ page }) => {
  await page.goto("/exams");
  await page.getByRole("button", { name: "Study plans", exact: true }).click();
  await page.getByLabel("Import study plan", { exact: true }).setInputFiles({
    name: "bad.plan.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":1,"typo":true}'),
  });
  await expect(page.getByRole("alert")).toContainText("Unrecognized");
  await page.getByRole("button", { name: "Try the example plan" }).click();
  await expect(page.getByRole("heading", { name: "Build your foundations" })).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Review even numbers and divisibility" }),
  ).toBeVisible();
});
