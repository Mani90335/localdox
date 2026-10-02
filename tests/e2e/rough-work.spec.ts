import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

// Rough work end to end: a scratchpad in the Notes panel that is saved,
// linked to a document, survives a reload and a crash, is cleared only after
// a confirmation, and reaches a document only through a confirmed insertion.
// Plus the narrow-screen sheet, and a math-heavy pad beside a math-heavy
// document without a long task.

const GUIDE = [
  "# Field guide",
  "",
  "Opening words of the guide.",
  "",
  "# Measurements",
  "",
  "Record the wind speed before you set up the mast.",
  "",
].join("\n");

const WORK = "Try:\n\n$$x^2 = 9$$\n\nSo $x = 3$ works.";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    );
  });
});

async function openGuide(page: Page, body = GUIDE, name = "guide.md") {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name, mimeType: "text/markdown", buffer: Buffer.from(body) });
  await expect(page.locator("article h1").first()).toBeVisible();
}

interface Stored {
  files: Array<{ name: string; content: string }>;
  scratchpads: Array<{ id: string; title: string; content: string; fileId: string | null }>;
  notes: Array<{ content: string; origin?: { scratchpadId: string } }>;
}

/** What IndexedDB holds for the (only) workspace right now. */
function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Stored>((resolve, reject) => {
        const open = indexedDB.open("localdox");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["workspaces", "files"], "readonly");
          const workspaces = tx.objectStore("workspaces").getAll();
          const files = tx.objectStore("files").getAll();
          tx.oncomplete = () => {
            db.close();
            const ws = workspaces.result[0] ?? {};
            resolve({
              files: files.result,
              scratchpads: ws.scratchpads ?? [],
              notes: ws.notes ?? [],
            });
          };
        };
      }),
  );
}

const panel = (page: Page) => page.getByRole("region", { name: "Notes panel" });
const field = (page: Page) => page.locator("textarea[id^='scratchpad-']");

async function openRoughWork(page: Page) {
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("tab", { name: "Rough work" }).click();
}

async function menu(page: Page, item: string) {
  await page.getByRole("button", { name: "Scratchpad actions" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("a scratchpad is saved, linked to its document, renamed, and back after a reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await openRoughWork(page);
  await expect(panel(page).getByText("No rough work yet")).toBeVisible();
  await panel(page).getByRole("button", { name: "New scratchpad" }).click();

  // Linked to the document being read when it was made.
  await expect(panel(page).getByRole("button", { name: "For guide.md" })).toBeVisible();
  await field(page).fill(WORK);
  // Drawn below the source: one display and one inline equation.
  const preview = panel(page).getByRole("region", { name: "Preview" });
  await expect(preview.locator(".katex")).toHaveCount(2);

  await menu(page, "Rename");
  await panel(page).getByRole("textbox", { name: "Scratchpad name" }).fill("Quadratics");
  await page.keyboard.press("Enter");
  await expect(panel(page).getByRole("button", { name: /^Scratchpad: Quadratics/ })).toBeVisible();

  await expect
    .poll(async () => (await stored(page)).scratchpads.map((p) => [p.title, p.content]))
    .toEqual([["Quadratics", WORK]]);
  const [pad] = (await stored(page)).scratchpads;
  expect(pad.fileId).not.toBeNull();
  // The document itself never changed.
  expect((await stored(page)).files.map((f) => f.content)).toEqual([GUIDE]);

  await page.reload();
  await expect(page.locator("article h1").first()).toBeVisible();
  // The panel, its tab and its pad all come back.
  await expect(page.getByRole("tab", { name: "Rough work" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(field(page)).toHaveValue(WORK);
  await expect(panel(page).getByRole("button", { name: /^Scratchpad: Quadratics/ })).toBeVisible();
  await expect(panel(page).getByRole("region", { name: "Preview" }).locator(".katex")).toHaveCount(
    2,
  );

  // A second pad, for the workspace as a whole once unlinked; switching back
  // and forth keeps each pad's own text.
  await panel(page).getByRole("button", { name: "New scratchpad" }).click();
  await expect(field(page)).toHaveValue("");
  await field(page).fill("Loose ends");
  await menu(page, "Unlink from document");
  await expect(panel(page).getByText("Not linked to a document")).toBeVisible();
  await panel(page)
    .getByRole("button", { name: /^Scratchpad: Scratchpad/ })
    .click();
  const picker = page.getByRole("menu");
  await expect(picker.getByText("This document")).toBeVisible();
  await picker.getByRole("menuitem", { name: /^Quadratics/ }).click();
  await expect(field(page)).toHaveValue(WORK);
  await expect
    .poll(async () =>
      (await stored(page)).scratchpads.map((p) => [p.title, p.content, p.fileId === null]),
    )
    .toEqual([
      ["Quadratics", WORK, false],
      ["Scratchpad", "Loose ends", true],
    ]);
  expect(errors).toEqual([]);
});

test("clearing asks first, and only then empties the pad", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await openRoughWork(page);
  await panel(page).getByRole("button", { name: "New scratchpad" }).click();
  await field(page).fill(WORK);

  await menu(page, "Clear contents…");
  const dialog = page.getByRole("dialog", { name: "Clear “Scratchpad”?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(field(page)).toHaveValue(WORK);

  await menu(page, "Clear contents…");
  await dialog.getByRole("button", { name: "Clear contents" }).click();
  await expect(field(page)).toHaveValue("");
  await expect.poll(async () => (await stored(page)).scratchpads[0]?.content).toBe("");
  // The pad itself stays, with its name and link.
  expect((await stored(page)).scratchpads[0].title).toBe("Scratchpad");

  // And the toast's Undo brings the work back.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(field(page)).toHaveValue(WORK);
  await expect.poll(async () => (await stored(page)).scratchpads[0]?.content).toBe(WORK);
});

test("selected work goes into the document only after Insert is confirmed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await openRoughWork(page);
  await panel(page).getByRole("button", { name: "New scratchpad" }).click();
  await field(page).fill(WORK);
  await expect.poll(async () => (await stored(page)).scratchpads[0]?.content).toBe(WORK);

  // Select just the display equation.
  await field(page).evaluate((el: HTMLTextAreaElement) => {
    const start = el.value.indexOf("$$");
    el.focus();
    el.setSelectionRange(start, el.value.indexOf("$$", start + 2) + 2);
  });
  await panel(page).getByRole("button", { name: "Insert selection…" }).click();
  const dialog = page.getByRole("dialog", { name: "Insert into “guide.md”?" });
  await expect(dialog).toBeVisible();
  // Shows exactly what goes in, drawn.
  await expect(dialog.locator(".katex")).toHaveCount(1);
  await expect(dialog.getByRole("radio", { name: "End of this page — Field guide" })).toBeChecked();

  // Cancel: nothing happens to the document.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(1500);
  expect((await stored(page)).files[0].content).toBe(GUIDE);
  await expect(page.locator("article .katex")).toHaveCount(0);

  await panel(page).getByRole("button", { name: "Insert selection…" }).click();
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect(dialog).toBeHidden();
  const expected = GUIDE.replace(
    "Opening words of the guide.\n\n",
    // A function: in a replacement string, "$$" would mean one "$".
    () => "Opening words of the guide.\n\n$$x^2 = 9$$\n\n",
  );
  await expect.poll(async () => (await stored(page)).files[0].content).toBe(expected);
  // On the page the reader is on, drawn, and flashed so it can be found.
  // (A one-line `$$…$$` is drawn inline by the reader, as in the preview.)
  await expect(page.locator("article .katex")).toHaveCount(1);
  await expect(page.locator("article .katex")).toBeInViewport();
  // The rough work is unchanged: the document got a copy.
  expect((await stored(page)).scratchpads[0].content).toBe(WORK);

  // Undo takes back exactly this insertion.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await stored(page)).files[0].content).toBe(GUIDE);
});

test("insertion waits while the document is open in its editor", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await openRoughWork(page);
  await panel(page).getByRole("button", { name: "New scratchpad" }).click();
  await field(page).fill(WORK);
  // The reader opens the document's own editor beside it.
  await page.getByRole("button", { name: "Options", exact: true }).first().click();
  await page.getByText("Edit", { exact: true }).click();
  await expect(page.locator("#markdown-source")).toBeVisible();
  await panel(page).getByRole("button", { name: "Insert into document…" }).click();
  const dialog = page.getByRole("dialog", { name: "Insert into “guide.md”?" });
  await expect(dialog.getByText("is open in the editor")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Insert" })).toBeDisabled();
});

test("saving work as a note keeps a copy that links back to its scratchpad", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await openRoughWork(page);
  await panel(page).getByRole("button", { name: "New scratchpad" }).click();
  await field(page).fill(WORK);
  await field(page).evaluate((el: HTMLTextAreaElement) => {
    const start = el.value.indexOf("So ");
    el.focus();
    el.setSelectionRange(start, el.value.length);
  });
  await panel(page).getByRole("button", { name: "Save selection as note" }).click();
  await page.getByRole("button", { name: "Show notes" }).click();
  const card = panel(page).getByRole("listitem").first();
  await expect(card.locator(".katex")).toHaveCount(1);
  await expect
    .poll(async () => (await stored(page)).notes.map((n) => n.content))
    .toEqual(["So $x = 3$ works."]);

  // The note's link opens the pad it came from.
  await card.getByRole("button", { name: "Rough work › Scratchpad" }).click();
  await expect(page.getByRole("tab", { name: "Rough work" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(field(page)).toHaveValue(WORK);
});

/** Type into the pad, then kill the renderer before the autosave can land. */
async function typeThenCrash(page: Page, text: string) {
  await field(page).evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
  await field(page).pressSequentially(text);
  // The journal flushes 250 ms after the last keystroke; the pad hands its
  // text over at 500 ms and the workspace writes 700 ms after that.
  await page.waitForTimeout(400);
  const crashed = page.waitForEvent("crash");
  const cdp = await page.context().newCDPSession(page);
  void cdp.send("Page.crash").catch(() => {});
  await crashed;
}

async function reopen(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("article h1").first()).toBeVisible();
  return page;
}

test("rough work typed just before a crash is offered back into its pad", async ({ context }) => {
  const a = await context.newPage();
  await a.setViewportSize({ width: 1440, height: 900 });
  await openGuide(a);
  await openRoughWork(a);
  await panel(a).getByRole("button", { name: "New scratchpad" }).click();
  await field(a).fill("Saved part.");
  await expect.poll(async () => (await stored(a)).scratchpads[0]?.content).toBe("Saved part.");
  await typeThenCrash(a, " LAST STEP");

  const b = await reopen(context);
  await b.setViewportSize({ width: 1440, height: 900 });
  // Nothing reached IndexedDB: this is the loss the journal exists for.
  expect((await stored(b)).scratchpads[0].content).toBe("Saved part.");
  const banner = b.getByRole("region", { name: "Recovered edits" });
  await expect(banner).toContainText("Scratchpad (rough work)");
  await banner.getByRole("button", { name: "Restore edits to Scratchpad (rough work)" }).click();
  await expect(banner).toHaveCount(0);
  await expect(field(b)).toHaveValue("Saved part. LAST STEP");
  await expect
    .poll(async () => (await stored(b)).scratchpads.map((p) => p.content))
    .toEqual(["Saved part. LAST STEP"]);

  // Once stored, the draft is forgotten: a reload offers nothing.
  await b.reload();
  await expect(field(b)).toHaveValue("Saved part. LAST STEP");
  await b.waitForTimeout(500);
  await expect(b.getByRole("region", { name: "Recovered edits" })).toHaveCount(0);
  expect(
    await b.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith("localdox:draft:")),
    ),
  ).toEqual([]);
});

test("on a narrow screen rough work is in the sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGuide(page);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Notes" });
  await sheet.getByRole("tab", { name: "Rough work" }).click();
  await sheet.getByRole("button", { name: "New scratchpad" }).click();
  await field(page).fill(WORK);
  await expect(sheet.getByRole("region", { name: "Preview" }).locator(".katex")).toHaveCount(2);
  // The menus open above the sheet, not behind it.
  await sheet.getByRole("button", { name: "Scratchpad actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Nothing scrolls sideways at phone width.
  expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

/** `count` distinct equations: one inline and one display per section. */
function manyEquations(sections: number, heading = "# Many equations") {
  let source = `${heading}\n\n`;
  for (let i = 0; i < sections; i++)
    source +=
      `## Section ${i}\n\nInline $x_{${i}}^2 + y_{${i}} = ${i}$ here.\n\n` +
      `$$\n\\sum_{k=0}^{${i}} \\frac{k^{${(i % 7) + 1}}}{${i + 1}!} = \\int_0^{${i}} f_{${i}}(t)\\,dt\n$$\n\n`;
  return source;
}

test("a math-heavy pad beside a math-heavy document opens without a long task", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tasks: number[] = [];
    (window as unknown as { __longTasks: number[] }).__longTasks = tasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(Math.round(entry.duration));
    }).observe({ type: "longtask", buffered: true });
    const prefs = JSON.parse(localStorage.getItem("localdox:prefs") ?? "{}");
    localStorage.setItem("localdox:prefs", JSON.stringify({ ...prefs, readingMode: "single" }));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  // From disk: a buffer is built into a File inside the page, a long task of its own.
  const path = test.info().outputPath("many.md");
  writeFileSync(path, manyEquations(1000));
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles(path);
  const documentTypeset = () =>
    page.waitForFunction(
      () =>
        !document.querySelector(
          "article [aria-busy], article .docs-math-pending, article .docs-math-pending-block",
        ) &&
        document.querySelectorAll("article .docs-math-inline, article .docs-math-rendered")
          .length === 2000,
      null,
      { timeout: 60_000, polling: 1000 },
    );
  await documentTypeset();

  // A 600-equation pad (~45,000 characters), entered as one paste.
  await openRoughWork(page);
  await panel(page).getByRole("button", { name: "New scratchpad" }).click();
  const work = manyEquations(300, "# Working");
  await field(page).fill(work);
  await expect
    .poll(async () => (await stored(page)).scratchpads[0]?.content.length, { timeout: 20_000 })
    .toBe(work.length);

  // Reload with the panel open on that pad: the document's 2,000 equations
  // and the pad's preview mount together, from cold caches.
  await page.evaluate(() => ((window as unknown as { __longTasks: number[] }).__longTasks = []));
  await page.reload();
  await documentTypeset();
  await page.waitForFunction(
    () => document.querySelectorAll("[aria-label='Preview'] .docs-note-math .katex").length > 0,
    null,
    { timeout: 30_000, polling: 1000 },
  );
  await page.waitForTimeout(1500);
  const longest = await page.evaluate(() =>
    Math.max(0, ...(window as unknown as { __longTasks: number[] }).__longTasks),
  );
  // The same bound math.spec.ts holds the 2,000-equation document to alone.
  expect(longest).toBeLessThan(100);

  // Typing in the pad re-parses only the segment being typed in.
  await page.evaluate(() => ((window as unknown as { __longTasks: number[] }).__longTasks = []));
  await field(page).evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
  await field(page).pressSequentially(" $z = 1$", { delay: 30 });
  await page.waitForTimeout(1000);
  expect(
    await page.evaluate(() =>
      Math.max(0, ...(window as unknown as { __longTasks: number[] }).__longTasks),
    ),
  ).toBeLessThan(100);
  // Drawn per equation as it comes on screen, not all 600 at once.
  const drawn = await page.evaluate(
    () => document.querySelectorAll("[aria-label='Preview'] .docs-note-math .katex").length,
  );
  expect(drawn).toBeGreaterThan(0);
  expect(drawn).toBeLessThan(600);
});
