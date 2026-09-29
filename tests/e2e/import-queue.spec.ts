import { test, expect, type Page } from "@playwright/test";

// R04: a picked batch is read a few files at a time, one unreadable file
// doesn't sink the rest, and the batch can be cancelled while it is read.
//
// FileReader.readAsDataURL is wrapped to count reads in flight, and on request
// to delay reads or fail one file the way Chrome does when a picked file was
// moved or edited (NotReadableError).

type Fault = { fail?: string; delay?: number };

async function instrument(page: Page, fault: Fault = {}) {
  await page.addInitScript((fault: Fault) => {
    if (!localStorage.getItem("localdox:prefs"))
      localStorage.setItem(
        "localdox:prefs",
        JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
      );
    const reads = { active: 0, peak: 0, started: 0 };
    Object.assign(window, { __reads: reads });
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (this: FileReader, blob: Blob) {
      reads.active++;
      reads.started++;
      reads.peak = Math.max(reads.peak, reads.active);
      // Counted down inside the reader's own handlers, before the app's code
      // sees the result: the app starts its next read from onload, before any
      // listener added here would run.
      let open = true;
      for (const key of ["onload", "onerror", "onabort"] as const) {
        const handler = this[key];
        this[key] = function (this: FileReader, event: ProgressEvent<FileReader>) {
          if (open) reads.active--;
          open = false;
          return handler?.call(this, event);
        };
      }
      if (blob instanceof File && blob.name === fault.fail) {
        setTimeout(() => {
          const error = new DOMException("The file could not be read.", "NotReadableError");
          Object.defineProperty(this, "error", { value: error });
          this.dispatchEvent(new ProgressEvent("error"));
          this.dispatchEvent(new ProgressEvent("loadend"));
        }, 10);
        return;
      }
      if (fault.delay) setTimeout(() => read.call(this, blob), fault.delay);
      else read.call(this, blob);
    };
  }, fault);
}

/** A small, distinct PNG-typed payload per index, so none is a duplicate. */
function image(index: number) {
  const bytes = Buffer.alloc(20_000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 131 + index * 17 + 7) & 0xff;
  bytes.writeUInt32BE(index, 0);
  return { name: `photo-${index}.png`, mimeType: "image/png", buffer: bytes };
}

async function pick(page: Page, files: ReturnType<typeof image>[]) {
  await page.locator('input[type="file"]').first().setInputFiles(files);
}

/** Every stored file name, across every workspace, straight from IndexedDB. */
async function storedNames(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open("localdox");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("files")) {
            db.close();
            return resolve([]);
          }
          const all = db.transaction("files").objectStore("files").getAll();
          all.onsuccess = () => {
            db.close();
            resolve(all.result.map((f: { name: string }) => f.name).sort());
          };
        };
      }),
  );
}

const reads = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __reads: { peak: number; started: number } }).__reads,
  );

const toastWith = (page: Page, text: string | RegExp) =>
  page.locator("[data-sonner-toast]").filter({ hasText: text });

test("a batch of 40 files is read at most four at a time, and every file lands", async ({
  page,
}) => {
  await instrument(page);
  await page.goto("/");
  const files = Array.from({ length: 40 }, (_, i) => image(i));
  await pick(page, files);

  await expect.poll(async () => (await storedNames(page)).length).toBe(40);
  expect(await storedNames(page)).toEqual(files.map((f) => f.name).sort());
  const { peak, started } = await reads(page);
  expect(started).toBe(40);
  expect(peak).toBeLessThanOrEqual(4);
  await expect(toastWith(page, "Successfully uploaded 40 files")).toBeVisible();
});

test("one unreadable file is reported by name; the rest of the batch is stored", async ({
  page,
}) => {
  await instrument(page, { fail: "broken.png" });
  await page.goto("/");
  await pick(page, [image(1), { ...image(2), name: "broken.png" }, image(3), image(4)]);

  await expect.poll(() => storedNames(page)).toEqual(["photo-1.png", "photo-3.png", "photo-4.png"]);
  await expect(toastWith(page, "Couldn't read “broken.png”")).toBeVisible();
  await expect(toastWith(page, "Successfully uploaded 3 files")).toBeVisible();
  await expect(toastWith(page, "Could not upload")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /photo-3/ }).first()).toBeVisible();
});

test("Cancel while the batch is read stores nothing and reads nothing more", async ({ page }) => {
  // 12 files at 1.5 s each, four at a time: about 4.5 s of reading.
  await instrument(page, { delay: 1_500 });
  await page.goto("/");
  await pick(
    page,
    Array.from({ length: 12 }, (_, i) => image(i)),
  );

  const progress = toastWith(page, "Uploading 12 files");
  await progress.getByRole("button", { name: "Cancel" }).click();
  await expect(toastWith(page, "Upload cancelled. Nothing was added.")).toBeVisible();
  const atCancel = (await reads(page)).started;
  expect(atCancel).toBeLessThan(12);

  // Longer than the whole batch would have taken.
  await page.waitForTimeout(5_000);
  expect((await reads(page)).started).toBe(atCancel);
  expect(await storedNames(page)).toEqual([]);
  await expect(toastWith(page, "Successfully uploaded")).toHaveCount(0);
  // Still the empty home screen, ready for another pick.
  await expect(page.locator('input[type="file"]').first()).toBeAttached();
});
