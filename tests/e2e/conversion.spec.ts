import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

async function storedFiles(
  page: Page,
): Promise<import("../../src/lib/persistence").PersistedFile[]> {
  return page.evaluate(
    () =>
      new Promise<import("../../src/lib/persistence").PersistedFile[]>((resolve, reject) => {
        const open = indexedDB.open("localdox");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("files", "readonly");
          const request = tx.objectStore("files").getAll();
          tx.oncomplete = () => {
            resolve(request.result);
            db.close();
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("localdox:prefs"))
      localStorage.setItem(
        "localdox:prefs",
        JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
      );
  });
  await page.goto("/");
});

test("convert, edit, repeat, reload and compare while preserving the original", async ({
  page,
}) => {
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") uploads.push(request.url());
  });
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "table.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Name,Count\nApples,4\nPears,2\n"),
    });
  await expect(
    page.getByRole("button", { name: "Convert to Markdown", exact: true }),
  ).toBeVisible();
  const original = (await storedFiles(page))[0];
  await page.getByRole("button", { name: "Convert to Markdown", exact: true }).click();
  await expect(page.getByText("Converted from table.csv", { exact: true })).toBeVisible();
  await expect.poll(async () => (await storedFiles(page)).length).toBe(2);
  const copy = (await storedFiles(page)).find((f) => f.derivedFrom);
  expect(copy.content).toContain("Apples");
  expect(copy.derivedFrom.sourceFileId).toBe(original.id);
  expect((await storedFiles(page)).find((f) => f.id === original.id)).toEqual(original);

  // The selected document's sidebar menu uses the existing source editor.
  await page.getByRole("button", { name: "Options", exact: true }).nth(1).click();
  await page.getByText("Edit", { exact: true }).click();
  await page.locator("textarea").fill("# My edited copy\n\nKeep these edits.");
  await page.getByRole("button", { name: /Done.*Preview/ }).click();
  await expect
    .poll(async () => (await storedFiles(page)).find((f) => f.id === copy.id)?.content)
    .toContain("Keep these edits");
  await page.getByRole("button", { name: "Open original", exact: true }).click();
  await page.getByRole("button", { name: "Convert again", exact: true }).click();
  await expect.poll(async () => (await storedFiles(page)).length).toBe(3);
  expect((await storedFiles(page)).find((f) => f.id === copy.id)?.content).toContain(
    "Keep these edits",
  );
  expect((await storedFiles(page)).map((f) => f.name)).toContain("table (2).md");
  await page.reload();
  await expect(page.getByText("Converted from table.csv", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close this pane" })).toHaveCount(2);
  expect(uploads).toEqual([]);
});

test("scanned PDFs report OCR locally and create no derivative", async ({ page }) => {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(path.resolve("tests/fixtures/anydoc/handmade-mixed.pdf"));
  await page.getByRole("button", { name: "Convert to Markdown", exact: true }).click();
  await expect(page.getByText(/This PDF needs OCR on page 2/)).toBeVisible();
  expect((await storedFiles(page)).length).toBe(1);
});

test("cancel and worker-load failure preserve the source", async ({ page }) => {
  await page.route(/\.wasm(?:\?|$)/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.abort().catch(() => {});
  });
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "cancel.csv", mimeType: "text/csv", buffer: Buffer.from("A,B\n1,2") });
  await page.getByRole("button", { name: "Convert to Markdown", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
  await expect(
    page.getByRole("button", { name: "Convert to Markdown", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Convert to Markdown", exact: true }).click();
  await expect(page.getByText(/local converter could not load/)).toBeVisible();
  expect((await storedFiles(page)).length).toBe(1);
});

test("a failed local save leaves no partial Markdown copy", async ({ page }) => {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "quota.csv", mimeType: "text/csv", buffer: Buffer.from("A,B\n1,2") });
  await expect(
    page.getByRole("button", { name: "Convert to Markdown", exact: true }),
  ).toBeVisible();
  const original = (await storedFiles(page))[0];
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      const request = put.call(this, value, ...args);
      if (this.name === "files" && value.derivedFrom) {
        request.addEventListener("success", () => this.transaction.abort());
        IDBObjectStore.prototype.put = put;
      }
      return request;
    };
  });
  await page.getByRole("button", { name: "Convert to Markdown", exact: true }).click();
  await expect(
    page.getByText("The Markdown copy could not be saved. The original is unchanged."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Convert to Markdown", exact: true }),
  ).toBeEnabled();
  expect(await storedFiles(page)).toEqual([original]);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Convert to Markdown", exact: true }),
  ).toBeVisible();
  expect(await storedFiles(page)).toEqual([original]);
});
