import { test, expect, type Page } from "@playwright/test";

/** One study-plan exam file: practice, exam, keys and solutions together. */
const examFile = (exam: string) =>
  [
    "# Practice",
    "",
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
    "# Exam",
    "",
    exam,
    "",
    "# Solutions",
    "",
    ":::solution{#q answer=A}",
    "Explanation.",
    ":::",
  ].join("\n");
const question = (difficulty: string, body: string) =>
  `:::question{#q type=mcq marks=5 difficulty=${difficulty}}\n${body}\n\n- Correct answer\n- Wrong answer\n- Alternative\n- None\n:::`;
const md = (name: string, text: string) => ({
  name,
  mimeType: "text/markdown",
  buffer: Buffer.from(text),
});
const square = {
  name: "square.svg",
  mimeType: "image/svg+xml",
  buffer: Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#4f5bd5"/></svg>',
  ),
};
const topicHeading = (page: Page) => page.getByRole("heading", { level: 1 });

async function newExam(page: Page, name: string) {
  await page.getByRole("button", { name: "New exam" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New exam" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Time (minutes)").fill("5");
  await dialog.getByLabel("Questions", { exact: true }).fill("1");
  await dialog.getByLabel("Pass mark (%)").fill("80");
  await dialog.getByLabel("Attempts").fill("2");
  await dialog.getByRole("button", { name: "Create exam" }).click();
  await expect(dialog).toBeHidden();
}
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

test("configure an exam, upload one file, then learn, practise, pass and review", async ({
  page,
}) => {
  await page.goto("/exams");
  await newExam(page, "First principles");
  await expect(topicHeading(page)).toHaveText("First principles");
  await expect(page.getByText("80% to pass")).toBeVisible();
  await page.screenshot({ path: "test-results/study-plan-upload.png", fullPage: true });

  await page
    .getByLabel("Upload exam file", { exact: true })
    .setInputFiles([md("first.md", examFile(question("easy", "First question?"))), square]);
  // Step 1: learn. The exam stays locked until it is marked done.
  await expect(page.getByRole("button", { name: /Step 3: Exam/ })).toBeDisabled();
  await page.getByLabel("Study notes").fill("Review signs and assumptions.");
  await page.reload();
  await expect(page.getByLabel("Study notes")).toHaveValue("Review signs and assumptions.");
  await page.getByRole("button", { name: "I've finished studying" }).click();

  // Step 2: practice from the same file, with its image.
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "A square" })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.getByRole("radio").nth(1).check();
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByText("Four equal sides.")).toBeVisible();
  await page.getByRole("button", { name: "Finish practice" }).click();

  // Step 3: the exam, to its attempt limit of 2.
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await completeExam(page, false);
  await expect(page.getByText(/1 attempt left/)).toBeVisible();
  await page.getByRole("button", { name: "Back to study plan" }).click();
  await page.getByRole("button", { name: "Retake exam", exact: true }).click();
  await completeExam(page, false);
  await expect(page.getByText(/No attempts left\. Revise, then use a new paper\./)).toBeVisible();
  await page.getByRole("button", { name: "Back to study plan" }).click();
  await page.getByRole("button", { name: "I've revised this topic" }).click();
  // The new paper is one file under the same rules, and must be harder.
  const newPaper = page.getByLabel("Import replacement exam files", { exact: true });
  await newPaper.setInputFiles(md("again.md", examFile(question("easy", "Another question?"))));
  await expect(page.getByRole("alert")).toContainText("at least 50% hard");
  await newPaper.setInputFiles(md("hard.md", examFile(question("hard", "A harder question?"))));
  await expect(page.getByText("Paper 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await completeExam(page, true);
  await expect(page.getByRole("heading", { name: /^Passed/ })).toBeVisible();

  // Step 4: review with the sealed key, now released.
  await page.getByRole("button", { name: "Back to study plan" }).click();
  await page.getByRole("button", { name: "Review answers", exact: true }).click();
  await expect(page.getByText("Explanation.")).toBeVisible();
  await page.getByRole("button", { name: "Finish review" }).click();
  await expect(page.getByText("All four steps done.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("All four steps done.")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/study-plan-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a broken file or missing name fails in plain words", async ({ page }) => {
  await page.goto("/exams");
  await newExam(page, "Broken");
  const missingKey = examFile(question("easy", "Q?")).replace(/:::solution\{#q[\s\S]*$/, "");
  await page.getByLabel("Upload exam file", { exact: true }).setInputFiles(md("x.md", missingKey));
  await expect(page.getByRole("alert")).toContainText(
    "x.md: Question q has no matching :::solution block",
  );
  // Nothing was attached: the exam still waits for its file.
  await expect(page.getByRole("heading", { name: "Upload the exam file" })).toBeVisible();

  // The rules are checked before anything is created.
  await page.getByRole("button", { name: "New exam" }).click();
  await page.getByRole("button", { name: "Create exam" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Give the exam a name");
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("the example exam opens on Learn", async ({ page }) => {
  await page.goto("/exams");
  await page.getByRole("button", { name: "Try the example" }).click();
  await expect(topicHeading(page)).toHaveText("Reasoning & arithmetic");
  await expect(page.getByText("Fractions as decimals")).toBeVisible();
  await expect(page.getByRole("button", { name: "I've finished studying" })).toBeVisible();
});

test("Settings deletes an uploaded exam, but not while Exam Workspaces is open", async ({
  context,
  page,
}) => {
  await page.goto("/exams");
  await page.getByRole("button", { name: "Try the example" }).click();
  await expect(topicHeading(page)).toHaveText("Reasoning & arithmetic");

  const settings = await context.newPage();
  settings.on("dialog", (dialog) => void dialog.accept());
  await settings.goto("/settings");
  await settings.getByRole("tab", { name: "Storage", exact: true }).click();
  const remove = settings.getByRole("button", { name: "Delete Reasoning & arithmetic" });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(settings.getByRole("alert")).toContainText("Exam Workspaces is open in another tab");

  await page.close();
  await expect
    .poll(() =>
      settings.evaluate(
        async () =>
          !(await navigator.locks.query()).held?.some(
            (lock) => lock.name === "localdox-exam-writer",
          ),
      ),
    )
    .toBe(true);
  await remove.click();
  await expect(settings.getByText("No uploaded exam files.")).toBeVisible();
  await settings.goto("/exams");
  await expect(settings.getByRole("heading", { name: "Create an exam to start" })).toBeVisible();
});
