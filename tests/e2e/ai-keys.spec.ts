import { test, expect, type Page } from "@playwright/test";

// D06: an API key is reported saved only once it is committed, and tabs never
// end up with competing master keys.

async function openAiSettings(page: Page) {
  // Key validation is the only network call; answer it locally.
  await page.route("https://generativelanguage.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"models":[]}' }),
  );
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Ask AI" }).click();
  return page.locator("div.px-4.py-3").filter({ hasText: "Google Gemini" });
}

async function storedSecretIds(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open("localdox-ai");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("secrets")) {
            db.close();
            resolve([]);
            return;
          }
          const keys = db.transaction("secrets", "readonly").objectStore("secrets").getAllKeys();
          keys.onsuccess = () => {
            db.close();
            resolve(keys.result.map(String));
          };
        };
      }),
  );
}

test("a saved key survives a reload", async ({ page }) => {
  const row = await openAiSettings(page);
  await row.getByPlaceholder("Paste API key").fill("test-gemini-key");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row.getByRole("button", { name: "Remove Google Gemini key" })).toBeVisible();
  expect(await storedSecretIds(page)).toEqual(["key:gemini"]);

  await page.reload();
  const again = await openAiSettings(page);
  await expect(again.locator("input")).toHaveValue("test-gemini-key");
});

test("a key that fails to commit is not shown as saved", async ({ page }) => {
  // Let the secret's put succeed, then abort before commit (quota, tab close).
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args) {
      const req = put.apply(this, args as Parameters<typeof put>);
      if (this.name === "secrets") {
        req.addEventListener("success", () => this.transaction.abort());
      }
      return req;
    };
  });
  const row = await openAiSettings(page);
  await row.getByPlaceholder("Paste API key").fill("doomed-key");
  await row.getByRole("button", { name: "Save" }).click();

  await expect(row.getByRole("alert")).toHaveText(/Couldn't save the key/);
  await expect(row.getByRole("button", { name: "Remove Google Gemini key" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Save" })).toBeEnabled();
  expect(await storedSecretIds(page)).toEqual([]);
});

test("two fresh tabs saving at once share one master key", async ({ context }) => {
  test.skip(!!process.env.PLAYWRIGHT_PRODUCTION, "imports the dev-server module directly");
  const [a, b] = [await context.newPage(), await context.newPage()];
  for (const page of [a, b]) {
    await page.goto("/");
    await page.evaluate(async () => {
      const w = window as unknown as { store: unknown };
      w.store = await import(/* @vite-ignore */ "/src/services/ai/crypto-store.ts");
    });
  }

  type Store = typeof import("../../src/services/ai/crypto-store.ts");
  const save = (page: Page, id: string) =>
    page.evaluate(
      ([id]) => (window as unknown as { store: Store }).store.encryptSecret(id, `value of ${id}`),
      [id],
    );
  await Promise.all([save(a, "key:a"), save(b, "key:b")]);

  // A tab opened afterwards only sees committed state; both secrets decrypt.
  const later = await context.newPage();
  await later.goto("/");
  const values = await later.evaluate(async () => {
    const store = await import(/* @vite-ignore */ "/src/services/ai/crypto-store.ts");
    return [await store.decryptSecret("key:a"), await store.decryptSecret("key:b")];
  });
  expect(values).toEqual(["value of key:a", "value of key:b"]);
});
