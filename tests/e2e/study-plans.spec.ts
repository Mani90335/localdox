import { test, expect, type Page } from "@playwright/test";
import JSZip from "jszip";
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
const topicPicker = (page: Page) => page.getByRole("combobox", { name: "Topic" });
const topicHeading = (page: Page) => page.getByRole("heading", { level: 1 });
async function completeExam(page: Page, correct: boolean) {
  await page.getByRole("checkbox", { name: "I have read and acknowledge" }).check();
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page
    .getByRole("radio")
    .nth(correct ? 0 : 1)
    .check();
  await page.getByRole("button", { name: "Submit exam", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();
  await expect(page.getByRole("region", { name: "Result" })).toBeVisible();
}
test("four steps in order: learn, exam to MAX_ATTEMPTS, revise, new paper, pass, review", async ({
  page,
}) => {
  await page.goto("/exams");
  // One upload: the plan together with both exams' files.
  await page.getByLabel("Import study plan", { exact: true }).setInputFiles([
    ...files("day", "day-exam", "Daily check", "easy", "First question?"),
    ...files(
      "rewrite",
      "new-day-exam",
      "Fresh challenging paper",
      "hard",
      "A different, harder question?",
    ),
    {
      name: "daily.plan.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(plan)),
    },
  ]);
  await expect(topicHeading(page)).toHaveText("First principles");
  // Topics are independent: the learner can open any of them.
  await topicPicker(page).selectOption({ label: "Next topic" });
  await expect(topicHeading(page)).toHaveText("Next topic");
  await expect(page.getByRole("button", { name: "I've finished studying" })).toBeVisible();
  await topicPicker(page).selectOption({ label: "First principles" });
  // Step 1: learn. The exam stays locked until it is marked done.
  await expect(page.getByRole("button", { name: /Step 3: Exam/ })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Read the lesson" }).check();
  await page.getByLabel("Study notes").fill("Review signs and assumptions.");
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Read the lesson" })).toBeChecked();
  await expect(page.getByLabel("Study notes")).toHaveValue("Review signs and assumptions.");
  await page.screenshot({ path: "test-results/study-plan-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "I've finished studying" }).click();
  // Step 2 has no questions in this plan, so the exam opens next.
  await expect(page.getByRole("button", { name: /Step 2: Practice.*No questions/ })).toBeVisible();
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await completeExam(page, false);
  await expect(page.getByRole("heading", { name: /^Not passed/ })).toBeVisible();
  await expect(page.getByText(/1 attempt left/)).toBeVisible();
  await page.getByRole("button", { name: "Back to study plan" }).click();
  await page.getByRole("button", { name: "Retake exam", exact: true }).click();
  await completeExam(page, false);
  await expect(page.getByText(/No attempts left\. Revise, then use a new paper\./)).toBeVisible();
  await page.getByRole("button", { name: "Back to study plan" }).click();
  await expect(page.getByRole("button", { name: "Retake exam", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Replacement paper", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "I've revised this topic" }).click();
  await page.getByLabel("Replacement paper", { exact: true }).selectOption("day-exam");
  await page.getByRole("button", { name: "Use new paper" }).click();
  await expect(page.getByRole("alert")).toContainText("at least 100% hard");
  await page.getByLabel("Replacement paper", { exact: true }).selectOption("new-day-exam");
  await page.screenshot({ path: "test-results/study-plan-revision.png", fullPage: true });
  await page.getByRole("button", { name: "Use new paper" }).click();
  await expect(page.getByText("Paper 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await completeExam(page, true);
  await expect(page.getByRole("heading", { name: /^Passed/ })).toBeVisible();
  // Passing is Step 3; the topic finishes with the review (Step 4).
  await page.getByRole("button", { name: "Back to study plan" }).click();
  await expect(page.getByRole("button", { name: /Step 4: Review/ })).toBeEnabled();
  await page.getByRole("button", { name: "Review answers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Answer review" })).toBeVisible();
  await page.getByRole("button", { name: "Finish review" }).click();
  // The next unfinished topic opens; the finished one is ticked in the picker.
  await expect(topicHeading(page)).toHaveText("Next topic");
  await expect(topicPicker(page).locator("option", { hasText: "First principles" })).toHaveText(
    "✓ First principles",
  );
  await page.reload();
  await expect(topicHeading(page)).toHaveText("Next topic");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/study-plan-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a zip with plan, exam, practice and image: practice gates the exam", async ({ page }) => {
  const zip = new JSZip();
  for (const f of files("unit", "unit-exam", "Unit exam", "easy", "Exam question?"))
    zip.file(`course/${f.name}`, f.buffer);
  zip.file(
    "course/unit.plan.json",
    JSON.stringify({
      schemaVersion: 1,
      id: "zip-plan",
      name: "Zip course",
      days: [{ id: "d1", title: "Unit one", examId: "unit-exam", practice: ["unit-practice"] }],
    }),
  );
  zip.file(
    "course/unit-practice.practice.md",
    [
      ":::question{#p1 type=mcq marks=1}",
      "Pick the square. ![A square](square.svg)",
      "",
      "- Square",
      "- Circle",
      ":::",
      "",
      ":::solution{#p1 answer=A}",
      "Four equal sides.",
      ":::",
      "",
      ":::question{#p2 type=nat marks=1}",
      "What is $3 \\times 3$?",
      ":::",
      "",
      ":::solution{#p2 answer=9}",
      "```mermaid",
      "flowchart LR",
      "  A[3] -->|times 3| B[9]",
      "```",
      ":::",
    ].join("\n"),
  );
  zip.file(
    "course/square.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#4f5bd5"/></svg>',
  );
  await page.goto("/exams");
  await page.getByLabel("Import study plan", { exact: true }).setInputFiles({
    name: "course.zip",
    mimeType: "application/zip",
    buffer: await zip.generateAsync({ type: "nodebuffer" }),
  });
  await expect(topicHeading(page)).toHaveText("Unit one");
  await page.getByRole("button", { name: "I've finished studying" }).click();
  await expect(page.getByRole("button", { name: /Step 3: Exam/ })).toBeDisabled();
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page.getByRole("img", { name: "A square" })).toBeVisible();
  // The image actually decodes (an SVG blob without its MIME type would not).
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "A square" })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.getByRole("radio").nth(1).check();
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByText("Not quite")).toBeVisible();
  await expect(page.getByText("Four equal sides.")).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByLabel("Numeric answer").fill("9");
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.locator(".ex-diagram svg")).toBeVisible();
  await page.getByRole("button", { name: "Finish practice" }).click();
  await expect(page.getByRole("button", { name: "Start exam", exact: true })).toBeVisible();
});

test("example plan is usable and malformed plan imports fail in plain words", async ({ page }) => {
  await page.goto("/exams");
  await page.getByLabel("Import study plan", { exact: true }).setInputFiles({
    name: "bad.plan.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":1,"typo":true}'),
  });
  await expect(page.getByRole("alert")).toContainText("Unknown field typo");
  await page.getByRole("button", { name: "Try the example" }).click();
  await expect(topicHeading(page)).toHaveText("Reasoning & arithmetic");
  await expect(
    page.getByRole("checkbox", { name: "Review even numbers and divisibility" }),
  ).toBeVisible();
});
