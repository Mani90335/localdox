import { test, expect, type Page } from "@playwright/test";

// A03: a share link uploads to a third-party paste service. Nothing may leave
// the device before the sender has seen the destination and the file list,
// and the Bin and private annotations stay out unless ticked. bytebin is
// intercepted here, so no test ever uploads anything.

const BINNED_SECRET = "BINNED SALARY TEXT";
const PRIVATE_NOTE = "PRIVATE STAR NOTE";
const PRIVATE_HIGHLIGHT = "PRIVATE HIGHLIGHT NOTE";

const backup = {
  format: "localdox-workspace",
  version: 2,
  workspace: {
    id: "source",
    name: "Research",
    createdAt: 1,
    updatedAt: 1,
    folders: [
      { id: "papers", name: "Papers", createdAt: 1, parentId: null },
      { id: "hidden", name: "Secret plans", createdAt: 1, parentId: null },
    ],
    files: [
      {
        id: "notes",
        name: "notes.md",
        content: "# Notes\n\nPublic text.",
        kind: "markdown",
        folderId: "papers",
        addedAt: 1,
      },
      { id: "draft", name: "draft.md", content: "# Draft\n\nMore.", kind: "markdown", addedAt: 2 },
      {
        id: "binned",
        name: "salary.md",
        content: BINNED_SECRET,
        kind: "markdown",
        folderId: "hidden",
        addedAt: 3,
        deletedAt: Date.now(),
      },
    ],
    bookmarks: [],
    saved: [
      {
        id: "s1",
        fileId: "notes",
        kind: "file",
        title: "notes.md",
        note: PRIVATE_NOTE,
        createdAt: 5,
      },
    ],
    highlights: [
      { id: "h1", fileId: "notes", text: "Public", color: "yellow", label: PRIVATE_HIGHLIGHT },
    ],
    ui: { activeFileId: "notes", expanded: {}, sidebarCollapsed: false, scrollTop: 0 },
  },
};

interface Bytebin {
  uploads: string[];
  fetches: number;
  failUploads: boolean;
}

/** Serve the fixture for `#share=` reads and record every upload. */
async function stubBytebin(page: Page): Promise<Bytebin> {
  const state: Bytebin = { uploads: [], fetches: 0, failUploads: false };
  await page.route("https://bytebin.lucko.me/**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      state.uploads.push(request.postData() ?? "");
      if (state.failUploads) return route.fulfill({ status: 503, body: "unavailable" });
      return route.fulfill({ status: 201, json: { key: "uploadedkey" } });
    }
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204 });
    state.fetches++;
    // Slow enough that a second run of the restore effect overlaps this one.
    await new Promise((resolve) => setTimeout(resolve, 300));
    return route.fulfill({ status: 200, json: backup });
  });
  return state;
}

async function workspaceNames(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open("localdox");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const all = db.transaction("workspaces").objectStore("workspaces").getAll();
          all.onsuccess = () => {
            db.close();
            resolve(all.result.map((w: { name: string }) => w.name));
          };
        };
      }),
  );
}

/** Land the fixture workspace through an incoming link, then open Share. */
async function openWorkspaceShare(page: Page) {
  await page.goto("/#share=fixturekey");
  await expect(page.getByRole("heading", { name: "Notes", level: 1 })).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Workspace" }).click();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  // Located by content, not title: the title becomes "Link ready" on success.
  const dialog = page.getByRole("dialog").filter({ hasText: "bytebin.lucko.me" });
  await expect(dialog).toContainText("Share “Research (Shared)”");
  return dialog;
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
});

test("an incoming workspace link is imported exactly once", async ({ page }) => {
  const bytebin = await stubBytebin(page);
  await page.goto("/#share=fixturekey");
  await expect(page.getByRole("heading", { name: "Notes", level: 1 })).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  // Let any second import finish before counting.
  await page.waitForTimeout(800);
  expect(await workspaceNames(page)).toEqual(["Research (Shared)"]);
  expect(bytebin.fetches).toBe(1);
});

test("workspace share previews the payload and leaves out the Bin and annotations", async ({
  page,
}) => {
  const bytebin = await stubBytebin(page);
  const dialog = await openWorkspaceShare(page);

  // The destination and the lack of revocation are stated before any upload.
  await expect(dialog).toContainText("bytebin.lucko.me");
  await expect(dialog).toContainText("can't delete it");
  await expect(dialog.getByRole("checkbox", { name: /notes\.md/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /draft\.md/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /salary\.md.*In Bin/ })).not.toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: /stars, notes and highlights/ }),
  ).not.toBeChecked();
  expect(bytebin.uploads).toHaveLength(0);

  await dialog.getByRole("button", { name: "Upload and copy link" }).click();
  const link = dialog.getByRole("textbox", { name: "Share link" });
  await expect(link).toHaveValue("http://127.0.0.1:4175/#share=uploadedkey");
  await expect(dialog.getByRole("status")).toContainText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "http://127.0.0.1:4175/#share=uploadedkey",
  );

  expect(bytebin.uploads).toHaveLength(1);
  const body = bytebin.uploads[0];
  for (const secret of [BINNED_SECRET, PRIVATE_NOTE, PRIVATE_HIGHLIGHT, "Secret plans"])
    expect(body).not.toContain(secret);
  const shared = JSON.parse(body).workspace;
  expect(shared.files.map((f: { name: string }) => f.name)).toEqual(["notes.md", "draft.md"]);
  expect(shared.folders.map((f: { name: string }) => f.name)).toEqual(["Papers"]);
  expect(shared.saved).toEqual([]);
  expect(shared.highlights).toEqual([]);
});

test("annotations and binned files travel only when ticked", async ({ page }) => {
  const bytebin = await stubBytebin(page);
  const dialog = await openWorkspaceShare(page);
  await dialog.getByRole("checkbox", { name: /draft\.md/ }).uncheck();
  await dialog.getByRole("checkbox", { name: /salary\.md/ }).check();
  await dialog.getByRole("checkbox", { name: /stars, notes and highlights/ }).check();
  await dialog.getByRole("button", { name: "Upload and copy link" }).click();
  await expect(dialog.getByRole("textbox", { name: "Share link" })).toBeVisible();

  const shared = JSON.parse(bytebin.uploads[0]).workspace;
  expect(shared.files.map((f: { name: string }) => f.name)).toEqual(["notes.md", "salary.md"]);
  expect(shared.files.every((f: { deletedAt?: number }) => f.deletedAt == null)).toBe(true);
  expect(shared.saved.map((s: { note: string }) => s.note)).toEqual([PRIVATE_NOTE]);
  expect(shared.highlights.map((h: { label: string }) => h.label)).toEqual([PRIVATE_HIGHLIGHT]);
});

test("cancel and download never upload; a failed upload stays visible", async ({ page }) => {
  const bytebin = await stubBytebin(page);
  let dialog = await openWorkspaceShare(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Share", exact: true }).click();
  dialog = page.getByRole("dialog").filter({ hasText: "bytebin.lucko.me" });
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download instead" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("research-(shared).json");
  const text = await (await saved.createReadStream()).toArray();
  const local = JSON.parse(Buffer.concat(text).toString("utf8"));
  expect(local.format).toBe("localdox-workspace");
  expect(JSON.stringify(local)).not.toContain(BINNED_SECRET);
  expect(bytebin.uploads).toHaveLength(0);

  bytebin.failUploads = true;
  await dialog.getByRole("button", { name: "Upload and copy link" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Nothing was shared");
  await expect(dialog.getByRole("textbox", { name: "Share link" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Upload and copy link" })).toBeEnabled();
});

test("sharing one file from the sidebar previews it and sends only that file", async ({ page }) => {
  const bytebin = await stubBytebin(page);
  await page.goto("/#share=fixturekey");
  await expect(page.getByRole("heading", { name: "Notes", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: /^notes/ }).hover();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Options", exact: true })
    .first()
    .click();
  // The file menu is portaled; the reader has its own "Export" button too.
  const fileMenu = page
    .locator("div")
    .filter({ has: page.getByRole("button", { name: "Move to Bin" }) })
    .last();
  await fileMenu.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Share link" }).click();

  const dialog = page.getByRole("dialog").filter({ hasText: "bytebin.lucko.me" });
  await expect(dialog).toContainText("Share “notes.md”");
  await expect(dialog.getByRole("checkbox")).toHaveCount(1);
  expect(bytebin.uploads).toHaveLength(0);
  await dialog.getByRole("button", { name: "Upload and copy link" }).click();
  await expect(dialog.getByRole("textbox", { name: "Share link" })).toHaveValue(
    "http://127.0.0.1:4175/#share-files=uploadedkey",
  );

  const payload = JSON.parse(bytebin.uploads[0]);
  expect(payload.format).toBe("localdox-files");
  expect(payload.files.map((f: { name: string }) => f.name)).toEqual(["notes.md"]);
  expect(bytebin.uploads[0]).not.toContain(PRIVATE_NOTE);
});
