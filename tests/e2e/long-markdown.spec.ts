import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

// A05: a long Markdown document renders in bounded steps (ProgressiveMarkdown)
// and ends as the same full DOM a single render produced. These cases cover the
// audit's 3,000-section workload and the things that read the rendered
// document as a whole while it is still mounting.

const SECTIONS = 3000;

/** The audit's workload: one H1 chapter holding 3,000 H2 sections. */
function longDocument(intro = "") {
  let source = `# Long document\n\n${intro}`;
  for (let i = 0; i < SECTIONS; i++)
    source += `## Section ${i}\n\nParagraph ${i}: alpha **bravo** charlie target passage ${i}.\n\n`;
  return source;
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    );
    const tasks: number[] = [];
    (window as unknown as { __longTasks: number[] }).__longTasks = tasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(Math.round(entry.duration));
    }).observe({ type: "longtask", buffered: true });
  });
});

/**
 * Upload from disk: handing Playwright a buffer builds the File inside the
 * page, which is itself a long task on a document this size.
 */
async function upload(page: Page, name: string, source: string) {
  const path = test.info().outputPath(name);
  writeFileSync(path, source);
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles(path);
}

/**
 * Slow the page's CPU so a document is reliably still mounting when a test
 * acts on it; each such test also checks that it was.
 */
async function slowCpu(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

const content = (page: Page) => page.locator("article > div").first();
const mounting = (page: Page) => content(page).evaluate((el) => el.getAttribute("aria-busy"));
const settled = (page: Page) =>
  expect(page.locator("article [aria-busy]")).toHaveCount(0, { timeout: 30_000 });

test("a 3,000-section document opens without a long task and ends fully rendered", async ({
  page,
}) => {
  await upload(page, "long.md", longDocument());
  await expect(page.getByText("Paragraph 0: alpha")).toBeVisible();
  await settled(page);

  const ids = await page.locator("article h2[id]").evaluateAll((els) => els.map((el) => el.id));
  expect(ids).toHaveLength(SECTIONS);
  expect(new Set(ids).size).toBe(SECTIONS);
  expect(ids[SECTIONS - 1]).toBe(`section-${SECTIONS - 1}`);
  // All of it is in the DOM, so browser find, selection and printing see it.
  expect(await content(page).evaluate((el) => el.innerText.includes("Paragraph 2999:"))).toBe(true);
  // Before: one 800–1,400 ms task to parse and commit the whole document.
  const longest = await page.evaluate(() =>
    Math.max(0, ...(window as unknown as { __longTasks: number[] }).__longTasks),
  );
  expect(longest).toBeLessThan(150);
});

test("a link to a heading that hasn't mounted yet lands on it once it has", async ({ page }) => {
  await slowCpu(page);
  await upload(page, "jump.md", longDocument("Jump to [the end](#section-2990).\n\n"));
  const link = page.getByRole("link", { name: "the end" });
  await link.click();
  // The point of the case: the target wasn't in the DOM when the link was used.
  expect(await mounting(page)).toBe("true");
  expect(await page.locator("#section-2990").count()).toBe(0);
  await settled(page);
  await expect(page.locator("#section-2990")).toBeInViewport();
});

test("a highlight on a repeated phrase is repainted in its own paragraph after reload", async ({
  page,
}) => {
  await upload(page, "highlights.md", longDocument());
  await settled(page);
  // "alpha" appears in every section; only the stored offsets and context
  // say which one this is.
  const paragraph = page.locator("article p").filter({ hasText: "Paragraph 2990:" });
  await paragraph.scrollIntoViewIfNeeded();
  await paragraph.evaluate((el) => {
    const node = el.firstChild!;
    const at = node.textContent!.indexOf("alpha");
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + 5);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Highlight #fde047", exact: true }).click();

  const painted = () =>
    page.evaluate(() =>
      [
        ...((CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("dc-hl-0") ??
          []),
      ].map((range) => ({
        text: range.toString(),
        paragraph: range.startContainer.parentElement?.closest("p")?.textContent?.slice(0, 15),
      })),
    );
  await expect.poll(painted).toEqual([{ text: "alpha", paragraph: "Paragraph 2990:" }]);

  // On reload the document mounts in steps. Anchoring against the part that
  // is there would find an earlier "alpha" and store it as a repair.
  await page.reload();
  await expect(page.getByText("Paragraph 0: alpha")).toBeVisible();
  await settled(page);
  await expect.poll(painted).toEqual([{ text: "alpha", paragraph: "Paragraph 2990:" }]);
  await page.reload();
  await settled(page);
  await expect.poll(painted).toEqual([{ text: "alpha", paragraph: "Paragraph 2990:" }]);
});

test("folding a section hides it across segments, including blocks that mount later", async ({
  page,
}) => {
  // One section long enough to span several segments, folded while the rest
  // of the document is still mounting.
  let source = "# Folds\n\nOpening paragraph.\n\n## Big\n\n";
  for (let i = 0; i < 5000; i++)
    source += `Body ${i}: ${"filler words to make this paragraph longer ".repeat(3)}\n\n`;
  source += "## After\n\nTail paragraph.\n";
  await slowCpu(page);
  await upload(page, "folds.md", source);

  const big = page.locator("h2#big");
  // Dispatched rather than clicked: a click first waits for the chevron to
  // be hoverable and stable, by which time the document may have mounted.
  await big.getByRole("button", { name: "Collapse section" }).dispatchEvent("click");
  expect(await mounting(page)).toBe("true");
  expect(await page.getByText("Body 4999:").count()).toBe(0);
  await settled(page);

  await expect(page.getByText("Body 4999:")).toBeHidden();
  await expect(page.getByText("Body 0:")).toBeHidden();
  const hidden = await content(page).evaluate(
    (el) => [...el.children].filter((child) => (child as HTMLElement).hidden).length,
  );
  expect(hidden).toBe(5000);
  await expect(page.getByRole("heading", { name: "After" })).toBeVisible();
  await expect(page.getByText("Tail paragraph.")).toBeVisible();
  await expect(page.getByText("Opening paragraph.")).toBeVisible();

  await big.getByRole("button", { name: "Expand section" }).click();
  await expect(page.getByText("Body 4999:")).toBeAttached();
  expect(
    await content(page).evaluate(
      (el) => [...el.children].filter((child) => (child as HTMLElement).hidden).length,
    ),
  ).toBe(0);
});

test("a search hit opening a long document lands on the passage once it has mounted", async ({
  page,
}) => {
  const long = test.info().outputPath("search.md");
  const short = test.info().outputPath("short.md");
  // The passage sits far below its heading, so landing on the heading alone
  // (which the hit also selects) isn't enough.
  writeFileSync(
    long,
    longDocument() + "Filler paragraph.\n\n".repeat(200) + "The needle passage is here.\n",
  );
  writeFileSync(short, "# Short\n\nA short note.\n");
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles([long, short]);
  await expect(
    page.getByText("Paragraph 0: alpha").or(page.getByText("A short note.")),
  ).toBeVisible();
  // Read the short note, then use search to open the long document.
  await page
    .getByRole("button", { name: /^short/ })
    .first()
    .click();
  await expect(page.getByText("A short note.")).toBeVisible();
  await page
    .locator("button:visible")
    .filter({ has: page.locator("svg.lucide-search") })
    .first()
    .click();
  await page.getByPlaceholder("Search all documents...").fill("needle passage");
  const hit = page.locator("aside button[title]").filter({ hasText: "needle passage" }).first();
  await expect(hit).toBeVisible();
  await slowCpu(page);
  await hit.click();
  await expect(page.getByText("Paragraph 0: alpha")).toBeAttached();
  expect(await mounting(page)).toBe("true");
  await settled(page);
  await expect(
    page.locator("article p").filter({ hasText: "The needle passage" }),
  ).toBeInViewport();
  await expect(page.locator("#section-2999")).not.toBeInViewport();
});
