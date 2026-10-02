import { test, expect, type Page } from "@playwright/test";

const source =
  "# Source note\n\n## First section\n\nA **bold** word and a [link](https://example.com).\n\n### Nested section\n\nNested body.\n\n```javascript\nconst answer = 42;\n```\n\n## Second section\n\nKeep this body visible.\n";

async function openEditor(page: Page, text = source) {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({
        name: "Reader",
        namePrompted: true,
        aiEnabled: false,
        readingMode: "single",
      }),
    ),
  );
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "source.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(text),
    });
  await expect(page.locator("article h1")).toContainText("Source note");
  await page.getByRole("button", { name: "Options", exact: true }).first().click();
  await page.getByText("Edit", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Markdown source", exact: true })).toBeVisible();
}

test("source highlights Markdown and fenced code, folds nested sections, and wraps long lines", async ({
  page,
}) => {
  await openEditor(page);
  await page.setViewportSize({ width: 720, height: 1000 });
  const editor = page.locator("#markdown-source");
  const heading = editor.locator(".cm-line").filter({ hasText: "## First section" });
  await expect(heading.locator("span").last()).toHaveCSS("font-weight", "700");
  const keyword = editor.locator("span").filter({ hasText: /^const$/ });
  await expect(keyword).toHaveCount(1);
  await expect
    .poll(async () => keyword.evaluate((el) => getComputedStyle(el).color))
    .not.toBe(await editor.evaluate((el) => getComputedStyle(el).color));

  await editor.press("Control+Home");
  await editor.press("ArrowDown");
  await editor.press("ArrowDown");
  await editor.press("Control+Shift+[");
  await expect(editor.locator(".cm-foldPlaceholder")).toHaveCount(1);
  await expect(editor).not.toContainText("Nested body.");
  await expect(editor).toContainText("Keep this body visible.");
  await editor.locator(".cm-foldPlaceholder").click();
  await expect(editor).toContainText("Nested body.");

  await editor.press("Control+End");
  await editor.pressSequentially("A long paragraph ".repeat(20));
  await expect(editor).toHaveCSS("white-space", "break-spaces");
  expect(
    await page.locator(".cm-scroller").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await page.getByRole("button", { name: /Done.*Preview/ }).click();
  await expect(page.getByText("Nested body.", { exact: true })).toBeVisible();
  await expect(page.locator("article pre")).toContainText("const answer = 42;");
});

test("formatting, undo, autosave and cancel retain the source editor's document", async ({
  page,
}) => {
  await openEditor(page, "# Source note\n\nOriginal.");
  const editor = page.locator("#markdown-source");
  await editor.press("Control+End");
  await editor.press("Enter");
  await editor.pressSequentially("formatme");
  await editor.press("Control+Shift+ArrowLeft");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(editor).toContainText("**formatme**");
  await editor.press("Control+z");
  await expect(editor).not.toContainText("**formatme**");
  await editor.press("Control+Shift+z");
  await expect(editor).toContainText("**formatme**");
  await editor.press("Control+s");
  await page.getByRole("button", { name: /Done.*Preview/ }).click();
  await expect(page.locator("article strong")).toHaveText("formatme");
  await page.reload();
  await expect(page.locator("article strong")).toHaveText("formatme");
  await page.getByRole("button", { name: "Options", exact: true }).first().click();
  await page.getByText("Edit", { exact: true }).click();
  await editor.press("Control+End");
  await editor.pressSequentially(" discarded");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("article")).not.toContainText("discarded");
});
