import { test, expect, type Page } from "@playwright/test";

// Source addressing end to end: rendered blocks carry their file spans, and
// search hits, Inspect source and note links all land on the exact occurrence
// — including inside table cells and diagrams, where counting rendered text
// used to land on the first occurrence in the document instead.

const DOC = [
  "# Guide",
  "",
  "The same sentence appears twice.",
  "",
  "| Part | Note |",
  "| --- | --- |",
  "| alpha | plain cell |",
  "| widget | the widget cell |",
  "| gamma | another widget here |",
  "",
  "```mermaid",
  "graph TD",
  "  A[widget start] --> B[End]",
  "```",
  "",
  "Closing widget line. The same sentence appears twice.",
].join("\n");

type Registry = { highlights: Map<string, Iterable<Range>> };

async function open(page: Page, content = DOC) {
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
    .setInputFiles({ name: "guide.md", mimeType: "text/markdown", buffer: Buffer.from(content) });
  await expect(page.getByRole("heading", { name: "Guide", level: 1 })).toBeVisible();
  await page.locator("article svg[id^='mermaid']").waitFor();
}

/** The flash a jump left: its text, and where on the page it is. */
async function flashed(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => [...((CSS as unknown as Registry).highlights.get("dc-saved-flash") ?? [])].length,
      ),
    )
    .toBeGreaterThan(0);
  return page.evaluate(() => {
    const range = [
      ...((CSS as unknown as Registry).highlights.get("dc-saved-flash") ?? []),
    ][0] as Range;
    const element = range.startContainer.parentElement!;
    const cell = element.closest("td, th");
    return {
      text: range.toString(),
      cell: cell?.textContent?.trim() ?? null,
      inDiagram: !!element.closest("svg"),
      block: element.closest("p, li, td, th, pre")?.textContent?.trim() ?? null,
    };
  });
}

/** Select occurrence `nth` (0-based) of `phrase` in the article, as a reader would. */
async function select(page: Page, phrase: string, nth = 0) {
  await page.locator("article").evaluate(
    (article, [needle, which]) => {
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (
        let node = walker.nextNode() as Text | null;
        node;
        node = walker.nextNode() as Text | null
      ) {
        let at = node.data.indexOf(needle as string);
        while (at !== -1) {
          if (seen++ === which) {
            // On screen, as a reader's selection is: the menu opens beside it.
            node.parentElement!.scrollIntoView({ block: "center" });
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + (needle as string).length);
            getSelection()!.removeAllRanges();
            getSelection()!.addRange(range);
            node.parentElement!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            return;
          }
          at = node.data.indexOf(needle as string, at + 1);
        }
      }
      throw new Error(`occurrence ${which} of “${needle}” not found`);
    },
    [phrase, nth] as const,
  );
}

test("search hits land on their own occurrence, in table cells and in diagrams", async ({
  page,
}) => {
  await open(page);
  await page
    .locator("button:visible")
    .filter({ has: page.locator("svg.lucide-search") })
    .first()
    .click();
  await page.getByPlaceholder("Search all documents...").fill("widget");
  const hits = page.locator("aside button[title]:has(mark)");
  await expect(hits).toHaveCount(5);

  const landings = [];
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => (CSS as unknown as Registry).highlights.delete("dc-saved-flash"));
    await hits.nth(i).click();
    landings.push(await flashed(page));
  }
  expect(landings).toEqual([
    { text: "widget", cell: "widget", inDiagram: false, block: "widget" },
    { text: "widget", cell: "the widget cell", inDiagram: false, block: "the widget cell" },
    { text: "widget", cell: "another widget here", inDiagram: false, block: "another widget here" },
    // The diagram's own label, not the first "widget" on the page.
    expect.objectContaining({ text: "widget", cell: null, inDiagram: true }),
    {
      text: "widget",
      cell: null,
      inDiagram: false,
      block: "Closing widget line. The same sentence appears twice.",
    },
  ]);
});

test("Inspect source selects exactly the occurrence that was selected", async ({ page }) => {
  await open(page);
  const editorSelection = () =>
    page
      .locator("textarea")
      .evaluate((field: HTMLTextAreaElement) => [field.selectionStart, field.selectionEnd]);

  // The second of two identical sentences.
  const sentence = "The same sentence appears twice.";
  await select(page, sentence, 1);
  await page.getByRole("button", { name: "Inspect source" }).click();
  await expect(page.locator("textarea")).toBeVisible();
  const second = DOC.lastIndexOf(sentence);
  await expect.poll(editorSelection).toEqual([second, second + sentence.length]);
  await page.getByRole("button", { name: /Done/ }).click();
  await expect(page.getByRole("heading", { name: "Guide", level: 1 })).toBeVisible();

  // A word in the second table cell, not the identical word in the first.
  await page.locator("article svg[id^='mermaid']").waitFor();
  await select(page, "widget", 1);
  await page.getByRole("button", { name: "Inspect source" }).click();
  const cell = DOC.indexOf("widget cell");
  await expect.poll(editorSelection).toEqual([cell, cell + "widget".length]);
});

test("a note's link lands on its own occurrence, even after the document is edited above it", async ({
  page,
}) => {
  await open(page);
  const sentence = "The same sentence appears twice.";
  await select(page, sentence, 1);
  await page.getByRole("button", { name: "Copy selection to notes" }).click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const panel = page.getByRole("region", { name: "Notes panel" });
  await expect(panel.getByRole("listitem")).toHaveCount(1);

  // Edit the document: a new paragraph above everything shifts every offset.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .locator("textarea")
    .fill(DOC.replace("# Guide\n", "# Guide\n\nA new opening paragraph, added later.\n"));
  await page.getByRole("button", { name: /Done/ }).click();
  await expect(page.getByText("A new opening paragraph, added later.")).toBeVisible();

  await page.evaluate(() => (CSS as unknown as Registry).highlights.delete("dc-saved-flash"));
  await panel.getByRole("button", { name: /^guide\.md/ }).click();
  expect(await flashed(page)).toEqual({
    text: sentence,
    cell: null,
    inDiagram: false,
    block: "Closing widget line. The same sentence appears twice.",
  });
});
