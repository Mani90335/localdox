import { test, expect, type Page } from "@playwright/test";
import { confirmMoveToBin } from "./sidebar-menu";

// Two pages in one browser context share IndexedDB and BroadcastChannel,
// exactly like two tabs of the same site.

async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        revision: string;
        name: string;
        content: string;
        workspaces: number;
        sidebarCollapsed: boolean;
      }>(
        (resolve, reject) => {
          const request = indexedDB.open("localdox");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(["workspaces", "files"], "readonly");
            const workspaces = tx.objectStore("workspaces").getAll();
            const files = tx.objectStore("files").getAll();
            tx.oncomplete = () => {
              db.close();
              const original = workspaces.result.find((w) => !/my changes/.test(w.name));
              const file = files.result.find((f) => f.workspaceId === original.id);
              resolve({
                revision: original.revision,
                name: file.name,
                content: file.content,
                workspaces: workspaces.result.length,
                sidebarCollapsed: original.ui.sidebarCollapsed,
              });
            };
          };
        },
      ),
  );
}

/** Commit a change the way another tab would, without telling this one. */
async function writeFromOtherTab(page: Page, content: string) {
  await page.evaluate(
    (content) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("localdox");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(["workspaces", "files"], "readwrite");
          const all = tx.objectStore("workspaces").getAll();
          all.onsuccess = () => {
            const workspace = all.result[0];
            tx.objectStore("workspaces").put({ ...workspace, revision: "other-tab" });
            const files = tx.objectStore("files").getAll();
            files.onsuccess = () => {
              for (const file of files.result.filter((f) => f.workspaceId === workspace.id))
                tx.objectStore("files").put({ ...file, content });
            };
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
    content,
  );
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
});

test("an idle tab adopts another tab's save instead of overwriting it", async ({ context }) => {
  const a = await context.newPage();
  await a.goto("/");
  await a
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "note.md", mimeType: "text/markdown", buffer: Buffer.from("# Note\n\noriginal\n") });
  await expect(a.getByRole("heading", { name: "Note" }).first()).toBeVisible();

  const b = await context.newPage();
  await b.goto("/");
  await expect(b.getByRole("heading", { name: "Note" }).first()).toBeVisible();

  // Tab B changes something and saves; tab A was idle, so it should follow
  // along silently rather than hold an old revision.
  const before = (await stored(a)).revision;
  await b.getByRole("button", { name: "Toggle sidebar" }).first().click();
  await expect.poll(async () => (await stored(a)).revision).not.toBe(before);

  // Tab A now saves on top of B's revision — no conflict, no lost update.
  const afterB = (await stored(a)).revision;
  await a.getByRole("button", { name: /Toggle sidebar|Expand sidebar/ }).first().click();
  await expect.poll(async () => (await stored(a)).revision).not.toBe(afterB);
  await expect(a.getByRole("alert").filter({ hasText: "changed in another tab" })).toHaveCount(0);
  await expect(b.getByRole("alert").filter({ hasText: "changed in another tab" })).toHaveCount(0);
});

async function openWith(page: Page, names: string[]) {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(
      names.map((name) => ({
        name,
        mimeType: "text/markdown",
        buffer: Buffer.from(`# ${name}\n\noriginal\n`),
      })),
    );
  await expect(page.getByRole("heading", { name: names[0] }).first()).toBeVisible();
}

test("unsaved work in one tab merges with another tab's edit to a different thing", async ({
  context,
}) => {
  const a = await context.newPage();
  await openWith(a, ["note.md"]);

  // A has an unsaved view change (the save is debounced) when another tab
  // commits a content edit. Neither change touches the other's data.
  const before = await stored(a);
  await a.getByRole("button", { name: "Toggle sidebar" }).first().click();
  await writeFromOtherTab(a, "# note.md\n\nedit from the other tab\n");

  await expect.poll(async () => (await stored(a)).revision).not.toBe("other-tab");
  const after = await stored(a);
  expect(after.revision).not.toBe(before.revision);
  expect(after.content).toContain("edit from the other tab");
  expect(after.sidebarCollapsed).toBe(!before.sidebarCollapsed);
  expect(after.workspaces).toBe(1);
  await expect(a.getByRole("alert").filter({ hasText: "changed in another tab" })).toHaveCount(0);
  // And this tab now shows the other tab's edit.
  await expect(a.getByText("edit from the other tab").first()).toBeVisible();
});

test("the same document changed in two tabs keeps both versions (A01)", async ({ context }) => {
  const a = await context.newPage();
  await openWith(a, ["note.md", "other.md"]);

  // A bins a document; before that save lands, another tab edits it.
  await a.getByRole("button", { name: "Options", exact: true }).first().click();
  await a.getByText("Move to Bin", { exact: true }).click();
  // It is the document on screen, so binning it asks first.
  await confirmMoveToBin(a);
  await writeFromOtherTab(a, "# edited\n\nedit from the other tab\n");

  // A's save is refused and cannot be merged: the other tab's edit survives
  // untouched and A is asked what to do.
  const banner = a.getByRole("alert").filter({ hasText: "changed in another tab" });
  await expect(banner).toBeVisible();
  let now = await stored(a);
  expect(now.revision).toBe("other-tab");
  expect(now.content).toContain("edit from the other tab");

  await banner.getByRole("button", { name: "Keep both" }).click();
  await expect(banner).toHaveCount(0);
  now = await stored(a);
  expect(now.workspaces).toBe(2);
  expect(now.revision).toBe("other-tab");
  expect(now.content).toContain("edit from the other tab");
});
