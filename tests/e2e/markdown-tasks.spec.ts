import { test, expect, type Page } from "@playwright/test";

async function storedSource(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open("localdox");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("files", "readonly");
          const files = tx.objectStore("files").getAll();
          tx.oncomplete = () => {
            resolve(files.result.find((file) => file.name === "tasks.md")?.content ?? "");
            db.close();
          };
        };
      }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({
        ...JSON.parse(localStorage.getItem("localdox:prefs") ?? "{}"),
        name: "Reader",
        namePrompted: true,
        aiEnabled: false,
      }),
    ),
  );
  await page.goto("/");
});

test("checkbox changes persist in source and survive reload and keyboard toggling", async ({
  page,
}) => {
  const source =
    "# Tasks\n\n- [] First\n- [y] Second\n- [ ] Standard\n\n```md\n- [] Example\n```\n";
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "tasks.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(source),
    });
  const first = page.getByRole("checkbox", { name: "First", exact: true });
  const second = page.getByRole("checkbox", { name: "Second", exact: true });
  await expect(first).not.toBeChecked();
  await expect(second).toBeChecked();
  await expect(page.locator('article input[type="checkbox"]')).toHaveCount(3);
  await first.check();
  await second.uncheck();
  await expect
    .poll(() => storedSource(page))
    .toBe(source.replace("[] First", "[y] First").replace("[y] Second", "[] Second"));
  await page.reload();
  await expect(first).toBeChecked();
  await expect(second).not.toBeChecked();
  await first.focus();
  await first.press("Space");
  await expect(first).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Standard", exact: true }).check();
  await expect
    .poll(() => storedSource(page))
    .toBe(source.replace("[y] Second", "[] Second").replace("[ ] Standard", "[x] Standard"));
});

test("late segments and later pages update only their task even with identical labels", async ({
  page,
}) => {
  const intro = Array.from(
    { length: 150 },
    (_, i) => `## Part ${i}\n\n${"Some text. ".repeat(15)}\n\n- [] Same\n\n`,
  ).join("");
  const source = `# First\n\n${intro}# Second\n\n---\n\n- [] Same\n`;
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "tasks.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(source),
    });
  const tasks = page.getByRole("checkbox", { name: "Same", exact: true });
  await expect(tasks).toHaveCount(150);
  await tasks.nth(149).check();
  const offset = source.lastIndexOf("- [] Same", source.indexOf("# Second"));
  const changed = source.slice(0, offset) + source.slice(offset).replace("- [] Same", "- [y] Same");
  await expect.poll(() => storedSource(page)).toBe(changed);
  await page.locator("article [aria-busy]").waitFor({ state: "detached" });
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /Second/ }).click();
  await expect(tasks).toHaveCount(1);
  await tasks.check();
  const bothPagesChanged = changed.replace("---\n\n- [] Same", "---\n\n- [y] Same");
  await expect.poll(() => storedSource(page)).toBe(bothPagesChanged);
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem("localdox:prefs") ?? "{}");
    localStorage.setItem("localdox:prefs", JSON.stringify({ ...prefs, readingMode: "single" }));
  });
  await page.reload();
  await expect(tasks).toHaveCount(151);
  await expect(tasks.nth(149)).toBeChecked();
  await expect(tasks.nth(150)).toBeChecked();
  await tasks.first().check();
  await expect
    .poll(() => storedSource(page))
    .toBe(bothPagesChanged.replace("- [] Same", "- [y] Same"));
});
