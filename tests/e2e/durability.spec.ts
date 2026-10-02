import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// A10: the save state is always visible, a failed save stays on screen until
// a write commits, and text typed just before a tab dies is offered back.
//
// Timing: the editor hands its draft to the app 600 ms after the last
// keystroke and the app writes 700 ms after that, so a tab killed ~450 ms after
// typing has saved nothing to IndexedDB. The draft journal flushes at 250 ms.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
});

async function storedContent(page: Page, name: string) {
  return page.evaluate(
    (name) =>
      new Promise<string | undefined>((resolve, reject) => {
        const request = indexedDB.open("localdox");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("files", "readonly");
          const files = tx.objectStore("files").getAll();
          tx.oncomplete = () => {
            db.close();
            resolve(files.result.find((f) => f.name === name)?.content);
          };
        };
      }),
    name,
  );
}

async function openNote(page: Page, body = "# Note\n\noriginal\n") {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "note.md", mimeType: "text/markdown", buffer: Buffer.from(body) });
  await expect(page.getByRole("heading", { name: "Note" }).first()).toBeVisible();
}

async function openEditor(page: Page) {
  await page.getByRole("button", { name: "Options", exact: true }).first().click();
  await page.getByText("Edit", { exact: true }).click();
  await expect(page.locator("#markdown-source")).toBeVisible();
}

const indicator = (page: Page) =>
  page.getByTestId("save-indicator").filter({ visible: true }).first();

async function caretToEnd(page: Page) {
  await page.locator("#markdown-source").press("ControlOrMeta+End");
}

/** Type into the editor, then kill the renderer before the autosave can land. */
async function typeThenCrash(page: Page, text: string) {
  await caretToEnd(page);
  await page.locator("#markdown-source").pressSequentially(text);
  await page.waitForTimeout(450);
  // A crash runs no pagehide/beforeunload handler: whatever was not already
  // on disk is lost, exactly like a killed process.
  const crashed = page.waitForEvent("crash");
  const cdp = await page.context().newCDPSession(page);
  void cdp.send("Page.crash").catch(() => {});
  await crashed;
}

async function reopen(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Note" }).first()).toBeVisible();
  return page;
}

test("the save indicator moves from pending to saved and reads 'Saved on this device'", async ({
  page,
}) => {
  await openNote(page);
  await expect(indicator(page)).toHaveAttribute("data-save-state", "saved");
  await expect(indicator(page)).toHaveText("Saved on this device");

  await openEditor(page);
  await caretToEnd(page);
  await page.locator("#markdown-source").pressSequentially(" more");
  await expect(indicator(page)).toHaveAttribute("data-save-state", "pending");
  await expect(indicator(page)).toHaveText("Changes pending");
  await expect(indicator(page)).toHaveAttribute("data-save-state", "saved");
  expect(await storedContent(page, "note.md")).toContain("original\n more");
});

test("text typed just before the tab crashes is offered back and restored", async ({ context }) => {
  const a = await context.newPage();
  await openNote(a);
  await openEditor(a);
  await typeThenCrash(a, "LAST WORDS");

  const b = await reopen(context);
  // Nothing reached IndexedDB — this is the loss the journal exists for.
  expect(await storedContent(b, "note.md")).not.toContain("LAST WORDS");
  const banner = b.getByRole("region", { name: "Recovered edits" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("note.md");
  await banner.getByRole("button", { name: "Restore edits to note.md" }).click();
  await expect(banner).toHaveCount(0);
  await expect(b.getByText("LAST WORDS").first()).toBeVisible();
  await expect.poll(() => storedContent(b, "note.md")).toContain("LAST WORDS");

  // Once storage holds it, the draft is gone: a reload offers nothing.
  await b.reload();
  await expect(b.getByRole("heading", { name: "Note" }).first()).toBeVisible();
  await expect(b.getByText("LAST WORDS").first()).toBeVisible();
  await b.waitForTimeout(500);
  await expect(b.getByRole("region", { name: "Recovered edits" })).toHaveCount(0);
  expect(
    await b.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith("localdox:draft:")),
    ),
  ).toEqual([]);
});

test("discarding a recovered draft keeps the saved version and forgets the draft", async ({
  context,
}) => {
  const a = await context.newPage();
  await openNote(a);
  await openEditor(a);
  await typeThenCrash(a, "UNWANTED");

  const b = await reopen(context);
  const banner = b.getByRole("region", { name: "Recovered edits" });
  await banner.getByRole("button", { name: "Discard edits to note.md" }).click();
  await expect(banner).toHaveCount(0);
  await b.reload();
  await expect(b.getByRole("heading", { name: "Note" }).first()).toBeVisible();
  await b.waitForTimeout(500);
  await expect(b.getByRole("region", { name: "Recovered edits" })).toHaveCount(0);
  expect(await storedContent(b, "note.md")).not.toContain("UNWANTED");
});

test("a draft is restored as a copy when the saved document changed since", async ({ context }) => {
  const a = await context.newPage();
  await openNote(a);
  await openEditor(a);
  await typeThenCrash(a, "CRASHED DRAFT");

  const b = await reopen(context);
  const banner = b.getByRole("region", { name: "Recovered edits" });
  await expect(banner).toBeVisible();
  // The reader edits and saves the document before deciding about the draft.
  await openEditor(b);
  await caretToEnd(b);
  await b.locator("#markdown-source").pressSequentially("NEWER SAVE");
  await b.getByRole("button", { name: "Done · Preview" }).click();
  await expect.poll(() => storedContent(b, "note.md")).toContain("NEWER SAVE");

  await banner.getByRole("button", { name: "Restore edits to note.md" }).click();
  await expect.poll(() => storedContent(b, "note (recovered).md")).toContain("CRASHED DRAFT");
  const original = await storedContent(b, "note.md");
  expect(original).toContain("NEWER SAVE");
  expect(original).not.toContain("CRASHED DRAFT");
});

test("an open tab's draft is not offered to another tab, and Cancel forgets it", async ({
  context,
}) => {
  const a = await context.newPage();
  await openNote(a);
  await openEditor(a);
  await caretToEnd(a);
  await a.locator("#markdown-source").pressSequentially("STILL TYPING");
  await a.waitForTimeout(400);
  expect(
    await a.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith("localdox:draft:")),
    ),
  ).toHaveLength(1);

  // A's tab is alive (it holds its session lock), so B leaves its draft alone.
  const b = await context.newPage();
  await b.goto("/");
  await expect(b.getByRole("heading", { name: "Note" }).first()).toBeVisible();
  await b.waitForTimeout(500);
  await expect(b.getByRole("region", { name: "Recovered edits" })).toHaveCount(0);
  await b.close();

  await a.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await a.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith("localdox:draft:")),
    ),
  ).toEqual([]);
});

test("a failed save stays visible with Retry and Export until a write commits", async ({
  page,
}) => {
  await openNote(page);
  // Every file write now fails the way a full disk does.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { __restorePut: () => void }).__restorePut = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === "files") throw new DOMException("Quota exceeded", "QuotaExceededError");
      return original.apply(this, args);
    };
  });

  await openEditor(page);
  await caretToEnd(page);
  await page.locator("#markdown-source").pressSequentially(" doomed");
  const alert = page.getByRole("alert").filter({ hasText: "Changes not saved" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("out of storage space");
  await expect(indicator(page)).toHaveAttribute("data-save-state", "error");
  await expect(indicator(page)).toHaveText("Not saved");

  // A toast would be gone by now; the alert is not, even after further edits.
  await page.locator("#markdown-source").pressSequentially("!");
  await page.waitForTimeout(3000);
  await expect(alert).toBeVisible();
  await expect(indicator(page)).toHaveAttribute("data-save-state", "error");
  expect(await storedContent(page, "note.md")).not.toContain("doomed");

  // Export backup is offered while the save is failing.
  const download = page.waitForEvent("download");
  await alert.getByRole("button", { name: "Export backup" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);

  // Space comes back; Retry commits and clears the alert.
  await page.evaluate(() => (window as unknown as { __restorePut: () => void }).__restorePut());
  await alert.getByRole("button", { name: "Retry save" }).click();
  await expect(alert).toHaveCount(0);
  await expect(indicator(page)).toHaveAttribute("data-save-state", "saved");
  await expect.poll(() => storedContent(page, "note.md")).toContain("doomed!");
});
