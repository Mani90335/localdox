import { test, expect, type Page } from "@playwright/test";

// B04: when a lazily loaded chunk fails, the page used to reload at once —
// over unsaved work, while offline, and once per distinct error message. Now
// it saves first, reloads by itself only when nothing could be lost (once per
// window), offers the reload otherwise, and waits out an offline spell.
//
// The document viewer chunk stands in for any optional feature: opening a CSV
// is what first asks for it.

// Vite's preload handler (and so `vite:preloadError`) exists only in the build.
test.skip(!process.env.PLAYWRIGHT_PRODUCTION, "Requires the production build");
// Keep the offline worker out of it: these tests are about the page's handling.
test.use({ serviceWorkers: "block" });

const VIEWER_CHUNK = "**/assets/DocumentViewer-*.js";
const AT_RISK_PROMPT =
  "Some changes couldn't be saved on this device and will be lost if Localdox reloads now. Reload anyway?";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
});

const indicator = (page: Page) =>
  page.getByTestId("save-indicator").filter({ visible: true }).first();

async function openNote(page: Page) {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "note.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Note\n\nbody\n"),
    });
  await expect(page.getByRole("heading", { name: "Note" }).first()).toBeVisible();
  await expect(indicator(page)).toHaveAttribute("data-save-state", "saved");
}

async function importCsv(page: Page) {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "data.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("city,count\nLisbon,3\nOslo,5\n"),
    });
  await openCsv(page);
}

/** Opening the CSV is what first needs the viewer chunk. */
const openCsv = (page: Page) => page.getByRole("button", { name: "data CSV" }).click();

/** What the host does after a deployment: an unknown path gets the SPA shell. */
async function deployNewBuild(page: Page) {
  await page.route(VIEWER_CHUNK, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><title>Localdox</title>",
    }),
  );
}

/** A flag that a reload wipes, to tell "reloaded" from "still the same page". */
async function mark(page: Page) {
  await page.evaluate(() => ((window as unknown as { __same?: boolean }).__same = true));
}
const samePage = (page: Page) =>
  page.evaluate(() => (window as unknown as { __same?: boolean }).__same === true);

async function storedNames(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open("localdox");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("files", "readonly");
          const files = tx.objectStore("files").getAll();
          tx.oncomplete = () => {
            db.close();
            resolve(files.result.map((f: { name: string }) => f.name));
          };
        };
      }),
  );
}

const notice = (page: Page) =>
  page.getByRole("alert").filter({ hasText: "This part of Localdox didn't load" });
const toast = (page: Page, title: string) =>
  page.locator("[data-sonner-toast]").filter({ hasText: title });

test("nothing unsaved: saves, reloads once by itself, then offers instead of looping", async ({
  page,
}) => {
  await openNote(page);
  await mark(page);
  await deployNewBuild(page);

  // The import is still pending when the viewer chunk fails. It must be
  // written before the page goes away.
  await importCsv(page);
  await expect.poll(() => samePage(page).catch(() => false), { timeout: 20_000 }).toBe(false);
  expect(await storedNames(page)).toContain("data.csv");

  // The reloaded page asks for the same missing chunk. No second reload.
  await page.waitForLoadState("load");
  await openCsv(page);
  await expect(toast(page, "Localdox has been updated")).toBeVisible();
  await expect(notice(page)).toBeVisible();
  await mark(page);
  await page.waitForTimeout(1500);
  expect(await samePage(page)).toBe(true);
  // The rest of the app is still there: only the viewer area failed.
  await expect(page.getByRole("button", { name: /^note/ }).first()).toBeVisible();

  // The deployment is reachable again; the offered reload fixes the viewer.
  await page.unroute(VIEWER_CHUNK);
  await toast(page, "Localdox has been updated").getByRole("button", { name: "Reload" }).click();
  await expect.poll(() => samePage(page).catch(() => false)).toBe(false);
  await openCsv(page);
  await expect(page.getByText("Lisbon").first()).toBeVisible();
});

test("unsaveable changes: no automatic reload, and Reload asks before dropping them", async ({
  page,
}) => {
  await openNote(page);
  // Every file write fails, as on a full disk.
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
  await mark(page);
  await deployNewBuild(page);
  await importCsv(page);

  await expect(toast(page, "Localdox has been updated")).toBeVisible();
  await expect(notice(page)).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Changes not saved" })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await samePage(page)).toBe(true);

  // Choosing to stay keeps everything as it was.
  const prompts: string[] = [];
  page.once("dialog", (dialog) => {
    prompts.push(dialog.message());
    void dialog.dismiss();
  });
  await notice(page).getByRole("button", { name: "Reload" }).click();
  await expect.poll(() => prompts).toEqual([AT_RISK_PROMPT]);
  await expect(notice(page).getByRole("button", { name: "Reload" })).toBeEnabled();
  expect(await samePage(page)).toBe(true);
  expect(await storedNames(page)).not.toContain("data.csv");

  // Space comes back: Reload now saves, and goes without asking anything.
  await page.evaluate(() => (window as unknown as { __restorePut: () => void }).__restorePut());
  await page.unroute(VIEWER_CHUNK);
  page.on("dialog", (dialog) => {
    prompts.push(dialog.message());
    void dialog.dismiss();
  });
  await notice(page).getByRole("button", { name: "Reload" }).click();
  await expect.poll(() => samePage(page).catch(() => false)).toBe(false);
  expect(prompts).toEqual([AT_RISK_PROMPT]);
  expect(await storedNames(page)).toContain("data.csv");
  await openCsv(page);
  await expect(page.getByText("Lisbon").first()).toBeVisible();
});

test("offline: no reload; it waits, and recovers by itself once back online", async ({
  page,
  context,
}) => {
  await openNote(page);
  await mark(page);
  await context.setOffline(true);
  await importCsv(page);

  await expect(toast(page, "You're offline")).toBeVisible();
  await expect(notice(page)).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await samePage(page)).toBe(true);

  await context.setOffline(false);
  await expect.poll(() => samePage(page).catch(() => false), { timeout: 20_000 }).toBe(false);
  expect(await storedNames(page)).toContain("data.csv");
  await openCsv(page);
  await expect(page.getByText("Lisbon").first()).toBeVisible();
});
