import { test, expect, type Page } from "@playwright/test";

// The Notes panel end to end: copy a selection, find it again after a reload,
// and follow its source link back to the passage — on another page of the
// document than the one on screen, so the jump has to resolve the page first.

const GUIDE = [
  "# Field guide",
  "",
  "Opening words of the guide.",
  "",
  "# Measurements",
  "",
  "Record the **wind speed** before you set up the mast.",
  "",
  "- Check the anemometer",
  "- Log it with `units=m/s`",
  "",
  "Closing paragraph of the measurements page.",
].join("\n");

const QUOTE_START = "Record the wind speed";

async function openGuide(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "guide.md", mimeType: "text/markdown", buffer: Buffer.from(GUIDE) });
  await expect(page.getByRole("heading", { name: "Field guide", level: 1 })).toBeVisible();
}

/** Notes in every workspace record IndexedDB holds right now. */
function storedNoteCount(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("localdox");
        open.onerror = () => resolve(-1);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction("workspaces").objectStore("workspaces").getAll();
          all.onerror = () => resolve(-1);
          all.onsuccess = () => {
            db.close();
            resolve(
              (all.result as Array<{ notes?: unknown[] }>).reduce(
                (n, ws) => n + (ws.notes?.length ?? 0),
                0,
              ),
            );
          };
        };
      }),
  );
}

async function goToPage(page: Page, title: string) {
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: new RegExp(`^${title}`) }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
}

test("select, save a note, reload, open it, and return to its source", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await goToPage(page, "Measurements");

  // Select from the start of the paragraph to the end of the list's code span.
  await page.locator("article").evaluate((article) => {
    const paragraph = [...article.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("Record the"),
    )!;
    const code = [...article.querySelectorAll("li code")].find(
      (c) => c.textContent === "units=m/s",
    )!;
    const range = document.createRange();
    range.setStart(paragraph.firstChild!, 0);
    range.setEnd(code.firstChild!, code.textContent!.length);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Copy selection to notes" }).click();
  await expect(page.getByText("Copied to notes")).toBeVisible();

  // The document itself is unchanged: a note is not a highlight.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("dc-hl-0")
            ?.size ?? 0,
      ),
    )
    .toBe(0);

  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const panel = page.getByRole("region", { name: "Notes panel" });
  await expect(panel).toBeVisible();
  const card = panel.getByRole("listitem").filter({ hasText: QUOTE_START });
  await expect(card).toHaveCount(1);
  // Rendered from clean Markdown: emphasis, a real list, inline code.
  await expect(card.locator("strong")).toHaveText("wind speed");
  await expect(card.locator("li")).toHaveText(["Check the anemometer", "Log it with units=m/s"]);

  // And that Markdown is exactly what was stored.
  await card.getByRole("button", { name: "Edit note" }).click();
  // Mid-edit the text lives only in the field's value, so find it by role.
  await expect(panel.getByRole("textbox", { name: "Note text (Markdown)" })).toHaveValue(
    "Record the **wind speed** before you set up the mast.\n\n- Check the anemometer\n- Log it with `units=m/s`",
  );
  await panel.getByRole("button", { name: "Cancel" }).click();

  // Wait until autosave has written the note to IndexedDB, then reload: the
  // note and the open panel both survive.
  await expect.poll(() => storedNoteCount(page)).toBe(1);
  await page.reload();
  // The document reopens (on its first page — the open page isn't restored).
  await expect(page.getByRole("heading", { name: "Field guide", level: 1 })).toBeVisible();
  const reloadedPanel = page.getByRole("region", { name: "Notes panel" });
  await expect(reloadedPanel).toBeVisible();
  const reloadedCard = reloadedPanel.getByRole("listitem").filter({ hasText: QUOTE_START });
  await expect(reloadedCard).toHaveCount(1);

  // Search narrows the list, and finds the note by its source too.
  const search = reloadedPanel.getByRole("searchbox", { name: "Search notes" });
  await search.fill("no such words");
  await expect(reloadedPanel.getByText("No notes match")).toBeVisible();
  await search.fill("guide anemometer");
  await expect(reloadedCard).toHaveCount(1);
  await search.fill("");

  // From another page of the document, follow the note back to its passage.
  await reloadedCard.getByRole("button", { name: "guide.md › Measurements" }).click();
  await expect(page.getByRole("heading", { name: "Measurements", level: 1 })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        [
          ...((CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get(
            "dc-saved-flash",
          ) ?? []),
        ].map((r: Range) => r.toString().replace(/\s+/g, " ").trim()),
      ),
    )
    .toEqual([
      "Record the wind speed before you set up the mast. Check the anemometer Log it with units=m/s",
    ]);
  await expect(page.locator("article p").filter({ hasText: QUOTE_START })).toBeInViewport();

  expect(errors).toEqual([]);
});

test("on a narrow screen the panel is a sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGuide(page);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Notes" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("No notes yet")).toBeVisible();
  // Not docked beside the document as well.
  await expect(page.getByRole("region", { name: "Notes panel" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

const FIGURES = [
  "# Figures",
  "",
  "Energy obeys $E = mc^2$ here.",
  "",
  "```mermaid",
  "graph TD",
  "  A[Start] --> B[End]",
  "```",
  "",
  "After the diagram.",
].join("\n");

test("a note draws its equations and diagrams, from cache and again after a reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "figures.md", mimeType: "text/markdown", buffer: Buffer.from(FIGURES) });
  // The document's own equation and diagram are drawn first.
  await expect(page.locator("article .docs-math-inline .katex")).toHaveCount(1);
  await expect(page.locator("article svg[id^='mermaid']")).toHaveCount(1);

  await page.locator("article").evaluate((article) => {
    const paragraphs = [...article.querySelectorAll("p")];
    const first = paragraphs.find((p) => p.textContent?.startsWith("Energy obeys"))!;
    const last = paragraphs.find((p) => p.textContent === "After the diagram.")!;
    const range = document.createRange();
    range.setStart(first.firstChild!, 0);
    range.setEnd(last.firstChild!, last.firstChild!.textContent!.length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    first.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Copy selection to notes" }).click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const panel = page.getByRole("region", { name: "Notes panel" });
  const card = panel.getByRole("listitem").first();

  // Stored as source: the LaTeX and a mermaid fence, never the SVG's text.
  await card.getByRole("button", { name: "Edit note" }).click();
  await expect(panel.getByRole("textbox", { name: "Note text (Markdown)" })).toHaveValue(
    "Energy obeys $E = mc^2$ here.\n\n```mermaid\ngraph TD\n  A[Start] --> B[End]\n```\n\nAfter the diagram.",
  );
  await panel.getByRole("button", { name: "Cancel" }).click();

  // Drawn in the panel: the equation (a cache hit — the document drew it) and
  // the diagram (the document's SVG, with ids of its own).
  await expect(card.locator(".docs-note-math .katex")).toHaveCount(1);
  await expect(card.locator(".docs-note-diagram svg")).toHaveCount(1);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll("svg[id^='mermaid']")].map((svg) => svg.id),
  );
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);

  // After a reload every cache is cold: the note's equation is typeset in
  // idle time and its diagram drawn again.
  await expect.poll(() => storedNoteCount(page)).toBe(1);
  await page.reload();
  const reloaded = page.getByRole("region", { name: "Notes panel" }).getByRole("listitem").first();
  await expect(reloaded.locator(".docs-note-math .katex")).toHaveCount(1);
  await expect(reloaded.locator(".docs-note-diagram svg")).toHaveCount(1);
  await expect(reloaded.locator(".docs-note-math")).toContainText("E");
  expect(errors).toEqual([]);
});
