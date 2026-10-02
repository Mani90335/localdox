import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const moduleScript = (path: string, name: string) => {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return `{ const exports = {}; ${js}; window.${name} = exports; }`;
};

test("ranges survive synchronous edits, preserve Unicode offsets and resolve late repeated quotes", async ({
  page,
}) => {
  await page.setContent("<main></main>");
  await page.addScriptTag({ content: moduleScript("src/lib/markdown/text-offsets.ts", "offsets") });
  const result = await page.evaluate(() => {
    const api = (window as any).offsets;
    const root = document.createElement("div");
    document.body.append(root);
    root.innerHTML = "<p>İ alpha <strong>bravo</strong> charlie 😀 target</p>";
    const unicode = api.firstTextRange(root, "target")?.toString();
    const crossNode = api.queryRanges(root, "bravo charlie").map((r: Range) => r.toString());
    const emoji = api.queryRanges(root, "😀").map((r: Range) => r.toString());
    api.buildRange(root, 0, 3);
    root.textContent = "new content";
    const replaced = api.buildRange(root, 0, 3)?.toString();
    root.firstChild!.textContent = "updated";
    const edited = api.buildRange(root, 0, 7)?.toString();
    root.textContent = "same ".repeat(600);
    const repeated = api.findAnchor(root, "same", "", "", 550 * 5);
    root.textContent = "prefix  line\n break suffix";
    const whitespace = api.findAnchor(root, "line break");
    const compact = api.buildRange(root, whitespace.start, whitespace.end)?.toString();
    root.textContent = "a+b [x]";
    const literal = api.queryRanges(root, "a+b [x]").map((r: Range) => r.toString());
    const invalid = [api.buildRange(root, NaN, 2), api.buildRange(root, 0, 100)];
    api.releaseTextIndex(root);
    return { unicode, crossNode, emoji, replaced, edited, repeated, compact, literal, invalid };
  });
  expect(result).toEqual({
    unicode: "target",
    crossNode: ["bravo charlie"],
    emoji: ["😀"],
    replaced: "new",
    edited: "updated",
    repeated: { start: 2750, end: 2754 },
    compact: "line\n break",
    literal: ["a+b [x]"],
    invalid: [null, null],
  });
});

test("split panes share CSS colors without erasing each other's ranges", async ({ page }) => {
  await page.setContent("<main></main>");
  await page.addScriptTag({
    content: moduleScript("src/lib/markdown/highlight-registry.ts", "painting"),
  });
  const result = await page.evaluate(() => {
    const api = (window as any).painting;
    const root = document.createElement("div");
    root.textContent = "one two";
    document.body.append(root);
    const first = document.createRange();
    first.setStart(root.firstChild!, 0);
    first.setEnd(root.firstChild!, 3);
    const second = document.createRange();
    second.setStart(root.firstChild!, 4);
    second.setEnd(root.firstChild!, 7);
    const a = api.createHighlightPainter();
    const b = api.createHighlightPainter();
    a.paint({ "dc-hl-0": [first] });
    b.paint({ "dc-hl-0": [second] });
    const css = (CSS as any).highlights;
    const both = css.get("dc-hl-0").size;
    a.clear();
    const remaining = [...css.get("dc-hl-0")].map((r: any) => r.toString());
    b.clear();
    return { both, remaining, cleared: !css.has("dc-hl-0") };
  });
  expect(result).toEqual({ both: 2, remaining: ["two"], cleared: true });
});

test("application search preserves the article DOM and saved highlights repaint after async replacement", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
    .setInputFiles({
      name: "highlights.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Highlight checks\n\nİ alpha **bravo** charlie target passage.\n\nSecond target paragraph.",
      ),
    });
  await expect(page.getByRole("heading", { name: "Highlight checks", exact: true })).toBeVisible();
  const paragraph = page.locator("article p").filter({ hasText: "İ alpha" }).first();
  // Create a saved passage through the real selection menu.
  await paragraph.evaluate((el) => {
    const node = el.lastChild!;
    const range = document.createRange();
    const at = node.textContent!.indexOf("target");
    range.setStart(node, at);
    range.setEnd(node, at + 6);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  // Measured before the dropdown opens: an open Radix menu hides the rest of
  // the page from the accessibility tree.
  const highlightLayer = await page
    .getByRole("button", { name: "Highlight #fde047", exact: true })
    .evaluate((button) => Number(getComputedStyle(button.closest(".fixed")!).zIndex));
  await page.getByRole("button", { name: "More highlight actions" }).click();
  const actionsLayer = await page
    .getByRole("menu")
    .evaluate((menu) => Number(getComputedStyle(menu).zIndex));
  expect(actionsLayer).toBeGreaterThan(highlightLayer);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Highlight #fde047", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (CSS as any).highlights.get("dc-hl-0")?.size ?? 0))
    .toBe(1);
  await paragraph.evaluate((el) => {
    el.innerHTML = "İ alpha <strong>bravo</strong> charlie target passage.";
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...((CSS as any).highlights.get("dc-hl-0") ?? [])].map((r: any) => r.toString()),
      ),
    )
    .toEqual(["target"]);
  const before = await page.locator("article *").count();
  await page
    .locator("button:visible")
    .filter({ has: page.locator("svg.lucide-search") })
    .first()
    .click();
  await page.getByPlaceholder("Search all documents...").fill("target");
  await page.locator("aside button[title]").filter({ hasText: "target" }).first().click();
  await expect
    .poll(() => page.evaluate(() => (CSS as any).highlights.get("dc-query")?.size ?? 0))
    .toBe(2);
  expect(await page.locator("article *").count()).toBe(before);
  expect(await page.locator("article mark").count()).toBe(0);
  // Click the painted passage, recolor it, then remove it through the menu.
  const clickHighlight = async (group: string) => {
    const point = await page.evaluate((name) => {
      const range = [...(CSS as any).highlights.get(name)][0] as Range;
      const rect = range.getClientRects()[0];
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, group);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByRole("button", { name: "Remove highlight" })).toBeVisible();
  };
  await clickHighlight("dc-hl-0");
  await page.getByRole("button", { name: "Highlight #86efac", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (CSS as any).highlights.get("dc-hl-1")?.size ?? 0))
    .toBe(1);
  await clickHighlight("dc-hl-1");
  await page.getByRole("button", { name: "Remove highlight" }).click();
  await expect
    .poll(() => page.evaluate(() => (CSS as any).highlights.get("dc-hl-1")?.size ?? 0))
    .toBe(0);
  expect(errors).toEqual([]);
});

test("PDF search paints exact matches and changes the active occurrence within one span", async ({
  page,
  context,
}) => {
  const source = await context.newPage();
  await source.setContent('<p style="font:20px Arial">alpha target middle target omega</p>');
  const buffer = await source.pdf();
  await source.close();
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({ name: "highlights.pdf", mimeType: "application/pdf", buffer });
  await page.getByRole("button", { name: "Search in document", exact: true }).click();
  await page.getByRole("textbox", { name: "Search in document", exact: true }).fill("target");
  const read = () =>
    page.evaluate(() => ({
      active: [...((CSS as any).highlights.get("pdf-search-hit-active") ?? [])].map((r: any) => ({
        text: r.toString(),
        start: r.startOffset,
      })),
      other: [...((CSS as any).highlights.get("pdf-search-hit") ?? [])].map((r: any) =>
        r.toString(),
      ),
    }));
  await expect.poll(async () => (await read()).active.map((r) => r.text)).toEqual(["target"]);
  const first = await read();
  expect(first.other).toEqual(["target"]);
  await page.getByRole("button", { name: "Next match", exact: true }).click();
  await expect.poll(async () => (await read()).active[0]?.start).not.toBe(first.active[0].start);
  expect((await read()).active[0].text).toBe("target");
  await page.getByRole("button", { name: "Close search", exact: true }).click();
  await expect.poll(async () => (await read()).active.length).toBe(0);
});

test("the selection menu opens beside the selection, never over it", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
  await page.goto("/");
  const paragraphs = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} body text.`);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "placement.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(`# Placement\n\n${paragraphs.join("\n\n")}`),
    });
  await expect(page.getByRole("heading", { name: "Placement", exact: true })).toBeVisible();
  // Selects a paragraph's text, then returns the selection's and the menu's boxes.
  const open = (text: string, block: ScrollLogicalPosition) =>
    page
      .locator("article p")
      .filter({ hasText: text })
      .first()
      .evaluate(async (el, at) => {
        el.scrollIntoView({ block: at, behavior: "instant" });
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const range = document.createRange();
        range.selectNodeContents(el);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        const menu = await new Promise<Element>((resolve) => {
          const find = () => {
            const button = document.querySelector('[aria-label="More highlight actions"]');
            if (button) resolve(button.closest(".fixed")!);
            else requestAnimationFrame(find);
          };
          find();
        });
        const s = range.getBoundingClientRect();
        const m = menu.getBoundingClientRect();
        return { selTop: s.top, selBottom: s.bottom, menuTop: m.top, menuBottom: m.bottom };
      }, block);

  // Room below: the menu sits under the selection.
  const middle = await open("Paragraph 10 body", "center");
  expect(middle.menuTop).toBeGreaterThanOrEqual(middle.selBottom);
  await page.keyboard.press("Escape");

  // The last line of the window: no room below, so the menu flips above.
  const bottom = await open("Paragraph 30 body", "end");
  expect(bottom.menuBottom).toBeLessThanOrEqual(bottom.selTop);
  expect(bottom.menuBottom).toBeLessThanOrEqual(600);
});
