import { test, expect, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 }, screenshot: "only-on-failure" });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
});

const file = (name: string, text: string, mimeType = "application/octet-stream") => ({
  name,
  mimeType,
  buffer: Buffer.from(text),
});
const DRILL = `# Parity

:::question{#even type=mcq}
Which number is even?

- 7
- 12
:::

:::solution{#even answer=B}
Twelve is divisible by two.
:::

:::question{#primes type=msq}
Select every prime.

- 2
- 4
- 5
:::

:::solution{#primes answer="A,C"}
Two and five.
:::

# Fractions

:::question{#third type=nat}
Write $7/3$ to two places.
:::

:::solution{#third answer=2.32:2.34}
Seven thirds.
:::
`;
const upload = (page: Page, files: ReturnType<typeof file>[]) =>
  page.locator('input[type="file"]').first().setInputFiles(files);
const sidebar = (page: Page) => page.getByRole("complementary").first();
const question = (page: Page, n: number) => page.getByRole("listitem", { name: `Question Q${n}` });
const progress = (page: Page) => page.getByText(/^\d+ of \d+ answered/);

test("an .xp checks each answer the moment it is given, with no rules, and remembers it", async ({
  page,
}) => {
  await page.goto("/");
  await upload(page, [file("drill.xp", DRILL)]);
  await sidebar(page).getByRole("button", { name: "drill", exact: true }).click();
  await expect(page.getByText("Practice", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Parity" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fractions" })).toBeVisible();
  await expect(progress(page)).toHaveText("0 of 3 answered");
  // Nothing is revealed before an answer.
  for (const hidden of ["Twelve is divisible by two.", "Two and five.", "Seven thirds."])
    await expect(page.getByText(hidden)).toHaveCount(0);
  await page.screenshot({ path: "test-results/practice-unanswered.png" });

  // MCQ: choosing is answering. A wrong choice shows the key and why.
  const first = question(page, 1);
  await first.getByRole("button", { name: /^A: / }).click();
  await expect(first.getByRole("status")).toHaveText("Not quite");
  await expect(first.getByText("Twelve is divisible by two.")).toBeVisible();
  await expect(first.getByRole("button", { name: /^B, correct/ })).toBeVisible();
  await expect(first.getByRole("button", { name: /^A, your answer/ })).toBeVisible();
  // Answered is final: the options are inert, and even a forced click changes nothing.
  const key = first.getByRole("button", { name: /^B, correct/ });
  await expect(key).toHaveAttribute("aria-disabled", "true");
  await key.click({ force: true });
  await expect(first.getByRole("status")).toHaveText("Not quite");
  await expect(progress(page)).toHaveText("1 of 3 answered · 0 correct");
  // The other questions still hide their solutions.
  await expect(page.getByText("Two and five.")).toHaveCount(0);

  // MSQ: pick several, then check.
  const second = question(page, 2);
  await second.getByRole("button", { name: /^A: / }).click();
  await second.getByRole("button", { name: /^C: / }).click();
  await expect(second.getByRole("button", { name: /^C: / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await second.getByRole("button", { name: "Check answer" }).click();
  await expect(second.getByRole("status")).toHaveText("Correct");
  await expect(second.getByText("Two and five.")).toBeVisible();

  // NAT: a number, checked with Enter; focus lands on the verdict.
  const third = question(page, 3);
  await expect(third.getByRole("button", { name: "Check answer" })).toBeDisabled();
  await third.getByLabel("Answer to question 3").fill("2.33");
  await third.getByLabel("Answer to question 3").press("Enter");
  await expect(third.getByRole("status")).toHaveText("Correct");
  await expect(third.getByText("Correct: 2.32 to 2.34")).toBeVisible();
  await expect(progress(page)).toHaveText("3 of 3 answered · 2 correct");
  await page.screenshot({ path: "test-results/practice-answered.png", fullPage: true });

  // Answers belong to this browser and survive a reload.
  await page.reload();
  await expect(progress(page)).toHaveText("3 of 3 answered · 2 correct");
  await expect(question(page, 1).getByRole("status")).toHaveText("Not quite");

  // Editing a question retires its old answer; the others stand.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByLabel("Edit practice questions")
    .fill(DRILL.replace("Which number is even?", "Which of these is even?"));
  await page.getByRole("button", { name: "Done · Save" }).click();
  await expect(progress(page)).toHaveText("2 of 3 answered · 2 correct");
  await expect(question(page, 1).getByRole("status")).toHaveCount(0);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(progress(page)).toHaveText("0 of 3 answered");
  await page.reload();
  await expect(progress(page)).toHaveText("0 of 3 answered");
});

test("a broken .xp says what to fix, and Create ▸ Practice starts from a working file", async ({
  page,
}) => {
  await page.goto("/");
  await upload(page, [file("broken.xp", ":::question{#q type=mcq}\nQ?\n\n- a\n- b\n:::\n")]);
  await sidebar(page).getByRole("button", { name: "broken", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Question q has no matching :::solution block",
  );

  await sidebar(page).getByRole("button", { name: "Add to workspace" }).click();
  page.once("dialog", (dialog) => void dialog.accept("Warm-up drill"));
  await page.getByRole("button", { name: "New practice" }).click();
  const source = page.getByLabel("Edit practice questions");
  await expect(source).toHaveValue(/^# Warm-up\n/);
  await expect(page.getByText("Reads as 3 questions")).toBeVisible();
  await page.getByRole("button", { name: "Done · Save" }).click();
  await expect(
    sidebar(page).getByRole("button", { name: "Warm-up drill", exact: true }),
  ).toBeVisible();
  await expect(progress(page)).toHaveText("0 of 3 answered");
});

test("on a phone, practice fits the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await upload(page, [file("drill.xp", DRILL)]);
  await expect(progress(page)).toBeVisible();
  await question(page, 1).getByRole("button", { name: /^B: / }).click();
  await expect(question(page, 1).getByRole("status")).toHaveText("Correct");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/practice-mobile.png", fullPage: true });
});
