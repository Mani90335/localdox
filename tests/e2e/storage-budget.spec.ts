import { test, expect, type Page } from "@playwright/test";

// D03: the documents limit (5% of the browser's quota) is one number, counted
// one way, for every way content arrives. The quota is stubbed to 20 MiB, so
// the limit is exactly 1 MiB, and the browser's own usage figure is inflated
// to 48 MiB, as offline files and caches make it in real use.

const CAP = 1024 * 1024;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    // Only on first load: the app keeps its last-open workspace here.
    if (!localStorage.getItem("localdox:prefs"))
      localStorage.setItem(
        "localdox:prefs",
        JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
      );
    Object.defineProperty(navigator.storage, "estimate", {
      value: async () => ({ quota: 20 * 1024 * 1024, usage: 48 * 1024 * 1024 }),
    });
  });
});

/** Binary bytes, stored as a Blob without a base64 copy. */
function binary(length: number) {
  const bytes = Buffer.alloc(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 131 + 7) & 0xff;
  return bytes;
}

async function upload(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.locator('input[type="file"]').first().setInputFiles({ name, mimeType, buffer });
}

/** Every stored file, across every workspace, straight from IndexedDB. */
async function storedFiles(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ name: string; workspaceId: string; bytes: number }[]>((resolve, reject) => {
        const request = indexedDB.open("localdox");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const all = db.transaction("files").objectStore("files").getAll();
          all.onsuccess = () => {
            db.close();
            resolve(
              all.result.map((f) => ({
                name: f.name,
                workspaceId: f.workspaceId,
                bytes:
                  new TextEncoder().encode(f.content).byteLength +
                  (typeof f.data === "string" ? f.data.length : (f.data?.blob.size ?? 0)),
              })),
            );
          };
        };
      }),
  );
}

const total = (files: { bytes: number }[]) => files.reduce((sum, f) => sum + f.bytes, 0);

const rejection = (page: Page) =>
  page.locator("[data-sonner-toast]").filter({ hasText: "Not enough space" });

/** Wait until the upload of `name` has either landed in the sidebar or been refused. */
async function settled(page: Page, name: RegExp) {
  await expect(page.getByRole("button", { name }).first().or(rejection(page))).toBeVisible();
  await page.waitForTimeout(500);
}

async function importBackup(page: Page, name: string, content: string, size = content.length) {
  const backup = {
    format: "localdox-workspace",
    version: 2,
    workspace: {
      id: `backup-${name}`,
      name,
      createdAt: 1,
      updatedAt: 1,
      files: [{ id: "big", name: `${name}.md`, content, kind: "markdown", size, addedAt: 1 }],
      bookmarks: [],
      ui: { activeFileId: "big", expanded: {}, sidebarCollapsed: false, scrollTop: 0 },
    },
  };
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Workspace" }).click();
  await page.locator('input[type="file"][accept*="json"]').setInputFiles({
    name: `${name}.json`,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
}

test("a binary upload counts Blob bytes, accepts what fits, and refuses overflow", async ({
  page,
}) => {
  await page.goto("/");
  // 540,000 bytes on disk and in the Blob body.
  await upload(page, "photo.png", "image/png", binary(540_000));
  await expect(page.getByRole("button", { name: /photo/ }).first()).toBeVisible();
  await expect.poll(async () => total(await storedFiles(page))).toBe(540_000);

  // The old base64 storage would have refused this fitting upload.
  await upload(page, "notes.txt", "text/plain", Buffer.from("n".repeat(400_000)));
  await settled(page, /notes/);
  await expect.poll(async () => total(await storedFiles(page))).toBe(940_000);
  await upload(page, "overflow.txt", "text/plain", Buffer.from("o".repeat(200_000)));
  await settled(page, /overflow/);
  const files = await storedFiles(page);
  expect(files.map((f) => f.name).sort()).toEqual(["notes.txt", "photo.png"]);
  expect(total(files)).toBeLessThanOrEqual(CAP);
  await expect(rejection(page)).toBeVisible();
});

test("every workspace counts, not just the open one", async ({ page }) => {
  await page.goto("/");
  await upload(page, "photo.png", "image/png", binary(540_000));
  await expect(page.getByRole("button", { name: /photo/ }).first()).toBeVisible();

  // A second, small workspace becomes the open one.
  await importBackup(page, "Second", "# Second\n\nsmall");
  await expect.poll(async () => (await storedFiles(page)).length).toBe(2);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Second" }).first()).toBeVisible();

  await upload(page, "notes.txt", "text/plain", Buffer.from("n".repeat(600_000)));
  await settled(page, /notes/);
  expect((await storedFiles(page)).map((f) => f.name).sort()).toEqual(["Second.md", "photo.png"]);
  await expect(rejection(page)).toBeVisible();
});

test("restoring a backup is held to the same limit, and says why", async ({ page }) => {
  await page.goto("/");
  await upload(page, "photo.png", "image/png", binary(300_000));
  await expect(page.getByRole("button", { name: /photo/ }).first()).toBeVisible();

  // The backup claims a tiny size; its real text is 800,000 bytes.
  await importBackup(page, "Big", "b".repeat(800_000), 10);
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Nothing was imported" });
  await expect(toast).toContainText("Not enough space");
  await expect(toast).not.toContainText("isn't a valid workspace backup");
  await page.waitForTimeout(500);
  expect((await storedFiles(page)).map((f) => f.name)).toEqual(["photo.png"]);
});

test("uploads picked while another is still importing share one reservation", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').first().waitFor({ state: "attached" });
  // Each fits on its own; together they don't. Both change events fire before
  // either file has been read.
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    for (const name of ["one.txt", "two.txt"]) {
      const transfer = new DataTransfer();
      transfer.items.add(new File([name[0].repeat(600_000)], name, { type: "text/plain" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await expect(page.getByRole("button", { name: /one|two/ }).first()).toBeVisible();
  await page.waitForTimeout(1_000);
  const files = await storedFiles(page);
  expect(files).toHaveLength(1);
  expect(total(files)).toBeLessThanOrEqual(CAP);
  await expect(rejection(page)).toBeVisible();
});

test("Settings measures documents against the limit, not the whole origin", async ({ page }) => {
  await page.goto("/");
  await upload(page, "photo.png", "image/png", binary(540_000));
  await expect(page.getByRole("button", { name: /photo/ }).first()).toBeVisible();
  await expect.poll(async () => (await storedFiles(page)).length).toBe(1);

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Storage", exact: true }).click();
  // 540,000 bytes as stored, against the 1 MiB limit; the browser's 48 MB
  // (offline files, caches) is reported separately as an estimate.
  await expect(page.getByText("527.34 KB of 1 MB")).toBeVisible();
  await expect(page.getByText(/48 MB/)).toBeVisible();
});

test("a shared-files link is measured, not trusted for its size", async ({ page }) => {
  // The payload claims 10 bytes; its text is 1.2 MB.
  const payload = {
    format: "localdox-files",
    version: 1,
    sourceName: "Sender",
    sharedAt: 1,
    files: [
      { id: "big", name: "big.md", content: "s".repeat(1_200_000), kind: "markdown", size: 10 },
    ],
  };
  await page.route("https://bytebin.lucko.me/**", (route) =>
    route.fulfill({ status: 200, json: payload }),
  );
  await page.goto("/");
  await upload(page, "note.md", "text/markdown", Buffer.from("# Note\n\nbody"));
  await expect(page.getByRole("heading", { name: "Note" }).first()).toBeVisible();

  await page.goto("/#share-files=fixturekey");
  const dialog = page.getByRole("dialog").filter({ hasText: "Shared from" });
  await dialog.getByRole("button", { name: /Add to/ }).click();
  await settled(page, /big/);
  expect((await storedFiles(page)).map((f) => f.name)).toEqual(["note.md"]);
  await expect(rejection(page)).toBeVisible();
});
