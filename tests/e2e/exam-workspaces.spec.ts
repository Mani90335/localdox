import { test, expect } from "@playwright/test";

test("create a core Exam Workspace, keep arbitrary materials, and configure a GATE variation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create or manage workspaces" }).click();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("New workspace name").fill("GATE preparation");
  await page.getByLabel("Workspace kind").selectOption("exam");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("GATE preparation", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("button", { name: "Learning materials (0)" })).toBeVisible();
  await page.getByRole("button", { name: "Learning materials (0)" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "study-material.custom",
      mimeType: "application/octet-stream",
      buffer: Buffer.from([0, 1, 255, 17]),
    });
  await expect(page.getByRole("button", { name: "Back to exams" })).toBeVisible();
  await page.getByRole("button", { name: "Back to exams" }).click();
  await expect(page.getByRole("button", { name: "Learning materials (1)" })).toBeVisible();
  await page.getByRole("button", { name: "New exam", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "New exam" });
  await dialog.getByLabel("Name", { exact: true }).fill("Five minute variation");
  await dialog.getByLabel("Questions", { exact: true }).fill("1");
  await dialog.getByLabel("Time (minutes)").fill("5");
  await dialog.getByRole("button", { name: "Create exam" }).click();
  await page.getByLabel("Upload exam file").setInputFiles({
    name: "short.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(`# Exam
:::question{#q1 type=mcq marks=1}
What is 2 + 2?

- Four
- Three
- Two
- One
:::
:::solution{#q1 answer=A}
Two plus two is four.
:::
`),
  });
  await expect(
    page.getByRole("heading", { name: "Five minute variation", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Learning materials (1)" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Five minute variation", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Exam Sessions", { exact: true })).toHaveCount(0);
});
