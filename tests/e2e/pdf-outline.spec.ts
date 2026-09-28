import { test, expect, type Page, type Browser } from "@playwright/test";

// R03: the PDF reader resolved every outline entry's destination as soon as a
// document loaded (recursively, all in parallel: one worker round trip per
// entry) and mounted the whole tree expanded. On a 6,020-entry outline that
// was 6,020 GetPageIndex requests and 6,020 rows (13,065 sidebar elements).
// Destinations now resolve only for rows on screen and on click, a large
// tree opens collapsed to a bounded number of rows, and a long visible list
// is windowed.

test.use({ viewport: { width: 1280, height: 800 } });

/** A tiny hand-written PDF: three pages and an outline covering every kind of destination. */
function handmadePdf(): Buffer {
  const objects: string[] = [];
  const set = (n: number, body: string) => (objects[n] = body);
  set(1, "<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R /Names << /Dests 12 0 R >> >>");
  set(2, "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>");
  for (const [n, content] of [
    [3, 13],
    [4, 14],
    [5, 15],
  ])
    set(
      n,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents ${content} 0 R ` +
        "/Resources << /Font << /F1 16 0 R >> >> >>",
    );
  set(6, "<< /Type /Outlines /First 7 0 R /Last 11 0 R /Count 5 >>");
  set(7, "<< /Title (Ref to page 3) /Parent 6 0 R /Next 8 0 R /Dest [5 0 R /Fit] >>");
  set(8, "<< /Title (Named page 2) /Parent 6 0 R /Prev 7 0 R /Next 9 0 R /Dest (second) >>");
  set(9, "<< /Title (Missing name) /Parent 6 0 R /Prev 8 0 R /Next 10 0 R /Dest (nowhere) >>");
  set(
    10,
    "<< /Title (Closed group) /Parent 6 0 R /Prev 9 0 R /Next 11 0 R " +
      "/First 17 0 R /Last 17 0 R /Count -1 /Dest [4 0 R /Fit] >>",
  );
  set(11, "<< /Title (No destination) /Parent 6 0 R /Prev 10 0 R >>");
  set(12, "<< /Names [(second) [4 0 R /Fit]] >>");
  for (const [n, label] of [
    [13, "Handmade page 1"],
    [14, "Handmade page 2"],
    [15, "Handmade page 3"],
  ] as const) {
    const stream = `BT /F1 20 Tf 30 150 Td (${label}) Tj ET`;
    set(n, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  set(16, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  set(17, "<< /Title (Hidden child) /Parent 10 0 R /Dest [3 0 R /Fit] >>");

  let pdf = "%PDF-1.7\n";
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = pdf.length;
    pdf += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n++)
    pdf += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/** 20 chapters × 50 sections × 5 topics = 6,020 outline entries, 100 pages; chapter c starts page 5(c−1)+1. */
async function bookPdf(browser: Browser): Promise<Buffer> {
  const page = await browser.newPage();
  let html =
    "<style>h1{break-before:page;font:20px serif}h2{font:15px serif;margin:4px 0}" +
    "h3{font:12px serif;margin:2px 0}</style>";
  for (let c = 1; c <= 20; c++) {
    html += `<h1>Chapter ${c}</h1>`;
    for (let s = 1; s <= 50; s++) {
      html += `<h2>Section ${c}.${s}</h2>`;
      for (let t = 1; t <= 5; t++) html += `<h3>Topic ${c}.${s}.${t}</h3>`;
    }
  }
  await page.setContent(html);
  const buffer = await page.pdf({ outline: true, tagged: true });
  await page.close();
  return buffer;
}

let book: Buffer;
test.beforeAll(async ({ browser }) => {
  book = await bookPdf(browser);
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    );
    // Count pdf.js worker requests by action (GetPageIndex, GetDestination…).
    const w = window as unknown as { __pdfActions: Record<string, number> };
    w.__pdfActions = {};
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
      const action = (message as { action?: unknown } | null)?.action;
      if (typeof action === "string") w.__pdfActions[action] = (w.__pdfActions[action] ?? 0) + 1;
      return (post as (...args: unknown[]) => void).call(this, message, ...rest);
    } as typeof Worker.prototype.postMessage;
  });
  await page.goto("/");
});

async function openPdf(page: Page, name: string, buffer: Buffer, firstText: string) {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: `${name}.pdf`, mimeType: "application/pdf", buffer });
  await expect(page.locator(".pdf-page-area .textLayer").first()).toContainText(firstText);
}

const lookups = (page: Page) =>
  page.evaluate(() => {
    const actions = (window as unknown as { __pdfActions: Record<string, number> }).__pdfActions;
    return (actions.GetPageIndex ?? 0) + (actions.GetDestination ?? 0);
  });

async function openContents(page: Page) {
  await page.getByRole("button", { name: /Show thumbnails/ }).click();
  await page.getByRole("button", { name: "Contents", exact: true }).click();
  const tree = page.getByRole("tree", { name: "Contents" });
  await expect(tree).toBeVisible();
  return tree;
}

const pageNumber = (page: Page) => page.getByRole("textbox", { name: "Page number", exact: true });

test("every kind of destination: named, explicit, missing, none, and a closed group", async ({
  page,
}) => {
  await openPdf(page, "Handmade", handmadePdf(), "Handmade page 1");
  const tree = await openContents(page);
  const item = (name: string) => tree.getByRole("treeitem", { name, exact: true });

  await expect(tree.getByRole("treeitem")).toHaveCount(5);
  await expect(item("Closed group")).toHaveAttribute("aria-expanded", "false");
  await expect(item("Hidden child")).toHaveCount(0);
  await expect(item("Missing name")).toHaveAttribute("aria-disabled", "true");
  await expect(item("No destination")).toHaveAttribute("aria-disabled", "true");
  await expect(item("Named page 2")).not.toHaveAttribute("aria-disabled", "true");

  await item("Named page 2").click();
  await expect(pageNumber(page)).toHaveValue("2");
  // One current entry: the first of the two on page 2.
  await expect(item("Named page 2")).toHaveAttribute("aria-current", "page");
  await expect(item("Closed group")).not.toHaveAttribute("aria-current", "page");

  await item("Ref to page 3").click();
  await expect(pageNumber(page)).toHaveValue("3");
  await expect(item("Ref to page 3")).toHaveAttribute("aria-current", "page");
  await expect(item("Named page 2")).not.toHaveAttribute("aria-current", "page");

  // Unresolvable entries do nothing (forced: Playwright won't click aria-disabled).
  await item("Missing name").click({ force: true });
  await item("No destination").click({ force: true });
  await expect(pageNumber(page)).toHaveValue("3");

  // Keyboard: the tree is one tab stop; arrows move, Right/Left expand and
  // collapse, Enter navigates.
  await tree.focus();
  const active = () =>
    tree.evaluate(
      (el) => document.getElementById(el.getAttribute("aria-activedescendant") ?? "")?.textContent,
    );
  await page.keyboard.press("End");
  await expect.poll(active).toBe("No destination");
  await page.keyboard.press("ArrowUp");
  await expect.poll(active).toBe("Closed group");
  await page.keyboard.press("ArrowRight");
  await expect(item("Closed group")).toHaveAttribute("aria-expanded", "true");
  await expect(item("Hidden child")).toHaveAttribute("aria-level", "2");
  await page.keyboard.press("ArrowRight");
  await expect.poll(active).toBe("Hidden child");
  await page.keyboard.press("Enter");
  await expect(pageNumber(page)).toHaveValue("1");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(active).toBe("Closed group");
  await page.keyboard.press("ArrowLeft");
  await expect(item("Hidden child")).toHaveCount(0);
  await page.keyboard.press("Home");
  await expect.poll(active).toBe("Ref to page 3");
  await page.keyboard.press(" ");
  await expect(pageNumber(page)).toHaveValue("3");
  await expect(tree).toBeFocused();
});

test("a 6,020-entry outline resolves nothing up front and mounts a bounded tree", async ({
  page,
}) => {
  await openPdf(page, "Book", book, "Chapter 1");
  await page.waitForTimeout(500);
  expect(await lookups(page), "no destination resolves before Contents opens").toBe(0);

  const tree = await openContents(page);
  const rows = tree.getByRole("treeitem");
  await expect(tree.getByRole("treeitem", { name: "Chapter 20", exact: true })).toBeVisible();
  // Chapters 1–3 open (the PDF marks them open) until the next would pass 200 rows.
  await expect(rows).toHaveCount(20 + 3 * 50);
  await expect(tree.getByRole("treeitem", { name: "Section 3.50", exact: true })).toBeAttached();
  await expect(tree.getByRole("treeitem", { name: "Section 4.1", exact: true })).toHaveCount(0);
  await expect(tree.getByRole("treeitem", { name: "Chapter 4", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  // Page 1's entry is the chapter, not its first section on the same page.
  await expect(tree.getByRole("treeitem", { name: "Chapter 1", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.waitForTimeout(500);
  // 170 rows point into 32 distinct pages; each page resolves once.
  expect(await lookups(page)).toBeLessThanOrEqual(32);

  await tree.getByRole("treeitem", { name: "Chapter 20", exact: true }).click();
  await expect(pageNumber(page)).toHaveValue("96");
});

test("past 300 visible rows the list is windowed; scrolling, End and clicks still reach every row", async ({
  page,
}) => {
  await openPdf(page, "Book", book, "Chapter 1");
  const tree = await openContents(page);
  const rows = tree.getByRole("treeitem");
  const chapter = (c: number) => tree.getByRole("treeitem", { name: `Chapter ${c}`, exact: true });

  // Open chapters 20…4 by their chevrons (bottom up, so the rest stay at the top).
  for (let c = 20; c >= 4; c--) {
    await chapter(c).locator("span[aria-hidden]").first().click();
    await expect(chapter(c)).toHaveAttribute("aria-expanded", "true");
  }
  // 1,020 visible rows; only the window is mounted.
  const mounted = await rows.count();
  expect(mounted).toBeGreaterThan(20);
  expect(mounted).toBeLessThan(80);
  const height = await tree.evaluate((el) => el.scrollHeight);
  expect(height).toBe(1020 * 28 + 16);

  // Scroll to the middle: the rows there mount with their tree positions.
  await tree.evaluate((el) => (el.scrollTop = 8 + (11 * 51 + 7) * 28));
  const section = tree.getByRole("treeitem", { name: "Section 12.7", exact: true });
  await expect(section).toBeVisible();
  await expect(section).toHaveAttribute("aria-level", "2");
  await expect(section).toHaveAttribute("aria-posinset", "7");
  await expect(section).toHaveAttribute("aria-setsize", "50");
  await expect(chapter(1)).toHaveCount(0);

  // Keyboard End jumps the window to the last row, and Enter goes there.
  await tree.focus();
  await page.keyboard.press("End");
  const last = tree.getByRole("treeitem", { name: "Section 20.50", exact: true });
  await expect(last).toBeVisible();
  await expect(tree).toHaveAttribute("aria-activedescendant", (await last.getAttribute("id"))!);
  await page.keyboard.press("Enter");
  await expect(pageNumber(page)).toHaveValue("100");
  await expect(tree).toBeFocused();

  // Home returns; the active row is mounted and in view again.
  await page.keyboard.press("Home");
  await expect(chapter(1)).toBeVisible();
  await expect(tree).toHaveAttribute(
    "aria-activedescendant",
    (await chapter(1).getAttribute("id"))!,
  );

  // Look-ups tracked only the windows visited, not the 1,020 rows (100 pages).
  await page.waitForTimeout(500);
  expect(await lookups(page)).toBeLessThanOrEqual(100);
  expect(await lookups(page)).toBeLessThan(1020);
});

test("the current page's entry is highlighted, its collapsed chapter opens, and it scrolls into view", async ({
  page,
}) => {
  await openPdf(page, "Book", book, "Chapter 1");
  // Chapter 15 (pages 71–75) starts collapsed.
  await pageNumber(page).fill("73");
  await pageNumber(page).press("Enter");
  await expect(page.locator(".pdf-page-area .textLayer").first()).toContainText("Section 15.");

  const tree = await openContents(page);
  const current = tree.locator('[role="treeitem"][aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText(/^Section 15\.\d+$/);
  await expect(current).toHaveAttribute("aria-level", "2");
  await expect(current).toBeInViewport();
  await expect(tree.getByRole("treeitem", { name: "Chapter 15", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  // The section shown really is on (or starts before) page 73.
  const title = (await current.textContent())!;
  const shown = await page.locator(".pdf-page-area .textLayer").first().textContent();
  const onPage = shown!.includes(title);
  const n = Number(title.split(".")[1]);
  expect(onPage || !shown!.includes(`Section 15.${n + 1}`)).toBe(true);
  // Keyboard focus starts at the current entry.
  await tree.focus();
  await expect(tree).toHaveAttribute("aria-activedescendant", (await current.getAttribute("id"))!);

  // Turning pages with Contents open follows along: the chapter itself on its first page.
  await pageNumber(page).fill("96");
  await pageNumber(page).press("Enter");
  const chapter20 = tree.getByRole("treeitem", { name: "Chapter 20", exact: true });
  await expect(chapter20).toHaveAttribute("aria-current", "page");
  await expect(chapter20).toBeInViewport();
  await expect(chapter20).toHaveAttribute("aria-expanded", "false");
  await pageNumber(page).fill("99");
  await pageNumber(page).press("Enter");
  await expect(current).toHaveText(/^Section 20\.\d+$/);
  await expect(current).toBeInViewport();
  await expect(chapter20).toHaveAttribute("aria-expanded", "true");

  // A binary search per level, not the whole outline.
  await page.waitForTimeout(500);
  expect(await lookups(page)).toBeLessThan(100);
});
