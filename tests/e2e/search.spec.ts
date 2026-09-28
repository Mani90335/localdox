import { test, expect, type Page } from "@playwright/test";

async function openSearch(page: Page, query: string) {
  await page
    .locator("button:visible")
    .filter({ has: page.locator("svg.lucide-search") })
    .first()
    .click();
  await page.getByPlaceholder("Search all documents...").fill(query);
}

async function upload(page: Page) {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "alpha.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Topic\n\nconstant content\n"),
    });
  await expect(page.getByRole("heading", { name: "Topic", exact: true })).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
});

for (const fallback of [false, true]) {
  test(`unchanged searches follow renames, edits and Bin moves (${fallback ? "fallback" : "worker"})`, async ({
    page,
    context,
  }) => {
    if (fallback)
      await page.addInitScript(() => {
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
          constructor(url: string | URL, options?: WorkerOptions) {
            if (String(url).includes("document-index")) throw new Error("Test: worker unavailable");
            super(url, options);
          }
        };
      });
    await upload(page);
    await page.getByRole("button", { name: "Options", exact: true }).first().click();
    await page.getByText("Edit", { exact: true }).click();
    await openSearch(page, "constant");
    const results = page.locator("aside");
    await expect(results.getByRole("button", { name: /^alpha\.md/ })).toBeVisible();

    await page.getByRole("textbox", { name: "Document name" }).fill("renamed.md");
    await page.getByRole("textbox", { name: "Document name" }).press("Enter");
    await expect(results.getByRole("button", { name: /^renamed\.md/ })).toBeVisible();
    await expect(results.getByRole("button", { name: /^alpha\.md/ })).toHaveCount(0);
    await expect(page.getByPlaceholder("Search all documents...")).toHaveValue("constant");

    await page.getByPlaceholder("Search all documents...").fill("alpha");
    await expect(results).toContainText('No results for "alpha"');
    await page.getByPlaceholder("Search all documents...").fill("renamed");
    await expect(results.getByRole("button", { name: /^renamed\.md/ }).first()).toBeVisible();

    await page.getByPlaceholder("Search all documents...").fill("constant");
    await expect(results.getByRole("button", { name: /^renamed\.md/ })).toBeVisible();
    await page.locator("textarea").fill("# Topic\n\nreplacement text\n");
    await expect(results).toContainText('No results for "constant"');
    await page.locator("textarea").fill("# Topic\n\nconstant restored\n");
    await expect(
      results.getByRole("button", { name: "constant restored", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Done · Preview" }).click();

    // Another real tab bins the file while the query stays open in this tab.
    const other = await context.newPage();
    await other.goto("/");
    await expect(other.getByText("constant restored", { exact: true })).toBeVisible();
    await other.getByRole("button", { name: "Options", exact: true }).first().click();
    await other.getByText("Move to Bin", { exact: true }).click();
    await expect(results).toContainText('No results for "constant"');
    await expect(page.getByPlaceholder("Search all documents...")).toHaveValue("constant");
  });
}

test("an unchanged query refreshes when initial worker indexing finishes after the search", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const deferred: Array<() => void> = [];
    let held = true;
    Object.assign(window, {
      releaseSearchSync: () => {
        held = false;
        deferred.splice(0).forEach((send) => send());
      },
    });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private searchWorker: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.searchWorker = String(url).includes("document-index");
      }
      postMessage(message: unknown) {
        const send = () => super.postMessage(message);
        if (held && this.searchWorker && (message as { type?: string }).type === "sync")
          deferred.push(send);
        else send();
      }
    };
  });
  await upload(page);
  await openSearch(page, "constant");
  await expect(page.locator("aside")).toContainText('No results for "constant"');
  await page.evaluate(() =>
    (window as unknown as { releaseSearchSync(): void }).releaseSearchSync(),
  );
  await expect(
    page.locator("aside").getByRole("button", { name: "constant content", exact: true }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Search all documents...")).toHaveValue("constant");
});
