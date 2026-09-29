import { test, expect, type Page, type BrowserContext } from "@playwright/test";

// A08: PDF zoom had no pixel budget. At DPR 2 and 400% one page needed a
// 4435×6272 canvas, about 106 MiB of RGBA. The reader now keeps each visible
// page within 32 MiB (base plus detail canvas) and all visible pages within
// 64 MiB, while the part of the page in view stays at device resolution.

const MiB = 1024 * 1024;
const PAGE_BUDGET = 32 * MiB;
const TOTAL_BUDGET = 64 * MiB;

test.use({ deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } });

async function createPdf(context: BrowserContext, label: string) {
  const source = await context.newPage();
  await source.setContent(
    "<style>section { break-after: page; font: 14px serif; }</style>" +
      [1, 2, 3]
        .map(
          (n) =>
            `<section><h1>${label} page ${n}</h1>` +
            "<p>Budget fixture paragraph. </p>".repeat(40) +
            "</section>",
        )
        .join(""),
  );
  const buffer = await source.pdf();
  await source.close();
  return buffer;
}

async function openPdf(page: Page, context: BrowserContext, name: string) {
  const buffer = await createPdf(context, name);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: `${name}.pdf`, mimeType: "application/pdf", buffer });
}

test.beforeEach(async ({ page, context }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    );
    // Every page canvas ever attached, so replaced or unmounted ones can be
    // checked for a released backing store, not just those still in the DOM.
    const w = window as unknown as { __pdfCanvases: HTMLCanvasElement[] };
    w.__pdfCanvases = [];
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const canvases =
            node instanceof HTMLCanvasElement ? [node] : [...node.querySelectorAll("canvas")];
          for (const canvas of canvases)
            if (canvas.closest(".pdf-page-canvas") && !w.__pdfCanvases.includes(canvas))
              w.__pdfCanvases.push(canvas);
        }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("/");
  await openPdf(page, context, "Budget");
  await expect(page.locator(".pdf-page-area .textLayer").first()).toContainText("Budget page 1");
});

interface CanvasInfo {
  className: string;
  width: number;
  height: number;
  cssWidth: number;
  rect: { left: number; top: number; right: number; bottom: number };
}
interface PageInfo {
  renderedScale: string | null;
  detailScale: string | null;
  cssWidth: number;
  canvases: CanvasInfo[];
  bytes: number;
  /** Part of the page on screen, in viewport coordinates. */
  visible: { left: number; top: number; right: number; bottom: number } | null;
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const pages: PageInfo[] = [...document.querySelectorAll<HTMLElement>(".pdf-page-canvas")].map(
      (el) => {
        const pageRect = el.getBoundingClientRect();
        const area = el.closest(".pdf-page-area")!.getBoundingClientRect();
        const visible = {
          left: Math.max(pageRect.left, area.left, 0),
          top: Math.max(pageRect.top, area.top, 0),
          right: Math.min(pageRect.right, area.right, innerWidth),
          bottom: Math.min(pageRect.bottom, area.bottom, innerHeight),
        };
        const canvases = [...el.querySelectorAll("canvas")].map((c) => {
          const r = c.getBoundingClientRect();
          return {
            className: c.className,
            width: c.width,
            height: c.height,
            cssWidth: r.width,
            rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
          };
        });
        return {
          renderedScale: el.getAttribute("data-rendered-scale"),
          detailScale: el.getAttribute("data-detail-scale"),
          cssWidth: pageRect.width,
          canvases,
          bytes: canvases.reduce((sum, c) => sum + c.width * c.height * 4, 0),
          visible: visible.right > visible.left && visible.bottom > visible.top ? visible : null,
        };
      },
    );
    const tracked = (window as unknown as { __pdfCanvases?: HTMLCanvasElement[] }).__pdfCanvases;
    return {
      pages,
      totalBytes: pages.reduce((sum, p) => sum + p.bytes, 0),
      // Backing bytes still held by any page canvas ever created, attached or not.
      retainedBytes: (tracked ?? []).reduce((sum, c) => sum + c.width * c.height * 4, 0),
      retainedDetached: (tracked ?? []).filter((c) => !c.isConnected && c.width * c.height > 0)
        .length,
    };
  });
}

type Measurement = Awaited<ReturnType<typeof measure>>;

function base(info: PageInfo) {
  return info.canvases.find((c) => c.className === "pdf-base-canvas");
}
function detail(info: PageInfo) {
  return info.canvases.find((c) => c.className === "pdf-detail-canvas");
}

/** Every page rendered at the current zoom, with its detail canvas settled on the view. */
function settled(m: Measurement) {
  return m.pages.every((p) => {
    const b = base(p);
    if (!p.renderedScale || !b || Math.abs(b.cssWidth - p.cssWidth) > 1) return false;
    const needsDetail = b.width < p.cssWidth * 2 - 2;
    if (!needsDetail) return p.canvases.length === 1;
    // Scrolled entirely out of view: nothing to sharpen.
    if (!p.visible) return p.canvases.length <= 2;
    const d = detail(p);
    return (
      p.canvases.length === 2 &&
      p.detailScale === p.renderedScale &&
      !!d &&
      d.rect.left <= p.visible.left + 1 &&
      d.rect.top <= p.visible.top + 1 &&
      d.rect.right >= p.visible.right - 1 &&
      d.rect.bottom >= p.visible.bottom - 1
    );
  });
}

async function waitSettled(page: Page) {
  await expect.poll(async () => settled(await measure(page)), { timeout: 15_000 }).toBe(true);
  return measure(page);
}

async function zoomTo400(page: Page, readerIndex = 0) {
  const area = page.getByRole("region", { name: "PDF pages", exact: true }).nth(readerIndex);
  await area.focus();
  for (let i = 0; i < 7; i++) await page.keyboard.press("+");
  await expect(page.getByTitle("Reset zoom", { exact: true }).nth(readerIndex)).toHaveText("400%");
}

test("400% zoom on a DPR 2 screen stays within the page budget", async ({ page }) => {
  const initial = await waitSettled(page);
  // 100% fits the budget: one canvas at full device resolution, as before.
  expect(initial.pages).toHaveLength(1);
  const first = base(initial.pages[0])!;
  expect(first.width / first.cssWidth).toBeCloseTo(2, 1);

  await zoomTo400(page);
  // Generic check (no reliance on the new markup): at baseline this measured
  // about 106 MiB for the one page.
  await expect
    .poll(async () => (await measure(page)).totalBytes, { timeout: 10_000 })
    .toBeLessThanOrEqual(PAGE_BUDGET);

  const zoomed = await waitSettled(page);
  const info = zoomed.pages[0];
  expect(info.cssWidth).toBeGreaterThan(first.cssWidth * 3.9);
  expect(info.bytes).toBeLessThanOrEqual(PAGE_BUDGET);
  // Replaced canvases were released, not left for GC.
  expect(zoomed.retainedDetached).toBe(0);
  expect(zoomed.retainedBytes).toBeLessThanOrEqual(PAGE_BUDGET);
  // Soft full page underneath, sharp pixels where the reader is looking.
  const b = base(info)!;
  const d = detail(info)!;
  expect(b.width / b.cssWidth).toBeLessThan(2);
  expect(d.width / d.cssWidth).toBeCloseTo(2, 1);
  // Text remains selectable/searchable over the scaled page.
  await expect(page.locator(".pdf-page-area .textLayer")).toContainText("Budget page 1");

  // Every edge of the zoomed page can be scrolled into view (centering used
  // to push the top and left out of reach), and the detail canvas follows.
  const edges = () =>
    page.locator(".pdf-page-area").evaluate((el) => {
      const pageRect = el.querySelector(".pdf-page-canvas")!.getBoundingClientRect();
      const area = el.getBoundingClientRect();
      return {
        top: pageRect.top - area.top,
        left: pageRect.left - area.left,
        bottom: area.bottom - pageRect.bottom,
        right: area.right - pageRect.right,
      };
    });
  const scrollTo = (where: "start" | "end") =>
    page.locator(".pdf-page-area").evaluate((el, where) => {
      el.scrollTop = where === "start" ? 0 : el.scrollHeight;
      el.scrollLeft = where === "start" ? 0 : el.scrollWidth;
    }, where);
  await scrollTo("start");
  const start = await edges();
  expect(start.top).toBeGreaterThanOrEqual(0);
  expect(start.left).toBeGreaterThanOrEqual(0);
  await expect.poll(async () => settled(await measure(page))).toBe(true);
  // Detail position relative to the page (both offsets include the area's own top).
  const topAtStart = detail((await measure(page)).pages[0])!.rect.top - start.top;
  await scrollTo("end");
  const end = await edges();
  expect(end.bottom).toBeGreaterThanOrEqual(0);
  expect(end.right).toBeGreaterThanOrEqual(0);
  // The detail canvas moved down the page with the view.
  await expect
    .poll(async () => {
      const m = await measure(page);
      const d = detail(m.pages[0]);
      return settled(m) && !!d && d.rect.top - end.top > topAtStart + 200;
    })
    .toBe(true);
  const scrolled = await measure(page);
  expect(scrolled.totalBytes).toBeLessThanOrEqual(PAGE_BUDGET);
  expect(scrolled.retainedDetached).toBe(0);
  expect(detail(scrolled.pages[0])!.width / detail(scrolled.pages[0])!.cssWidth).toBeCloseTo(2, 1);
});

test("zoom keeps the same point of the page in the middle of the view", async ({ page }) => {
  await waitSettled(page);
  // Fraction of the page under the middle of the view.
  const focus = () =>
    page.locator(".pdf-page-area").evaluate((el) => {
      const pageRect = el.querySelector(".pdf-page-canvas")!.getBoundingClientRect();
      const area = el.getBoundingClientRect();
      return {
        x: (area.left + area.width / 2 - pageRect.left) / pageRect.width,
        y: (area.top + area.height / 2 - pageRect.top) / pageRect.height,
        width: pageRect.width,
      };
    });
  const initialWidth = (await focus()).width;
  await zoomTo400(page);
  // (Not exactly 4×: the fit scale shrinks slightly once a scrollbar appears.)
  await expect.poll(async () => (await focus()).width).toBeGreaterThan(initialWidth * 3.9);
  await waitSettled(page);
  const centered = await focus();
  expect(centered.x).toBeCloseTo(0.5, 2);
  expect(centered.y).toBeCloseTo(0.5, 2);

  // Look lower right (inside the range still scrollable one step out, so the
  // browser doesn't clamp it), then zoom out: the same spot stays in the middle.
  await page.locator(".pdf-page-area").evaluate((el) => {
    const pageRect = el.querySelector(".pdf-page-canvas")!.getBoundingClientRect();
    const area = el.getBoundingClientRect();
    el.scrollLeft += pageRect.left + 0.6 * pageRect.width - (area.left + area.width / 2);
    el.scrollTop += pageRect.top + 0.7 * pageRect.height - (area.top + area.height / 2);
  });
  await expect.poll(async () => (await focus()).y).toBeCloseTo(0.7, 2);
  const before = await focus();
  await page.keyboard.press("-");
  await expect(page.getByTitle("Reset zoom", { exact: true })).toHaveText("320%");
  await expect.poll(async () => (await focus()).width).toBeLessThan(before.width / 1.2);
  await waitSettled(page);
  const after = await focus();
  expect(after.x).toBeCloseTo(before.x, 2);
  expect(after.y).toBeCloseTo(before.y, 2);
});

test("zooming previews the old pixels and coalesces rapid steps into one render", async ({
  page,
}) => {
  const initial = await waitSettled(page);
  const startScale = Number(initial.pages[0].renderedScale);
  await page.evaluate(() => {
    const w = window as unknown as { __baseRenders: number; __minCanvases: number };
    w.__baseRenders = 0;
    w.__minCanvases = Infinity;
    const host = document.querySelector(".pdf-page-canvas")!;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLCanvasElement && node.className === "pdf-base-canvas")
            w.__baseRenders++;
      w.__minCanvases = Math.min(w.__minCanvases, host.querySelectorAll("canvas").length);
    }).observe(host, { childList: true, subtree: true });
  });

  await page.getByRole("region", { name: "PDF pages", exact: true }).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("+");
  await expect(page.getByTitle("Reset zoom", { exact: true })).toHaveText("195%");
  // Layout already has the new size while the previous raster, stretched, is
  // still what's drawn: no blank page mid-zoom.
  const preview = await measure(page);
  expect(preview.pages[0].cssWidth).toBeGreaterThan(initial.pages[0].cssWidth * 1.5);
  expect(base(preview.pages[0])).toBeTruthy();

  const done = await waitSettled(page);
  expect(Number(done.pages[0].renderedScale)).toBeCloseTo(startScale * 1.25 ** 3, 5);
  const counters = await page.evaluate(() => {
    const w = window as unknown as { __baseRenders: number; __minCanvases: number };
    return { renders: w.__baseRenders, minCanvases: w.__minCanvases };
  });
  expect(counters.renders).toBe(1);
  expect(counters.minCanvases).toBeGreaterThanOrEqual(1);
});

test("a two-page spread keeps each page and the pair within budget", async ({ page }) => {
  await page.getByRole("button", { name: "Switch to two-page spread", exact: true }).click();
  await page.getByRole("region", { name: "PDF pages", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".pdf-page-canvas")).toHaveCount(2);
  await zoomTo400(page);
  const m = await waitSettled(page);
  expect(m.pages).toHaveLength(2);
  for (const info of m.pages) expect(info.bytes).toBeLessThanOrEqual(PAGE_BUDGET);
  expect(m.totalBytes).toBeLessThanOrEqual(TOTAL_BUDGET);
  expect(m.retainedDetached).toBe(0);
});

test("two readers in a split share the total budget", async ({ page, context }) => {
  await openPdf(page, context, "Second");
  await expect(page.getByRole("button", { name: "Second PDF", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Options", exact: true }).first().click();
  await page.getByRole("button", { name: "Add to split view", exact: true }).click();
  await expect(page.getByRole("region", { name: "PDF pages", exact: true })).toHaveCount(2);
  for (const index of [0, 1]) {
    await page
      .getByRole("button", { name: "Switch to two-page spread", exact: true })
      .nth(0)
      .click();
    const area = page.getByRole("region", { name: "PDF pages", exact: true }).nth(index);
    await area.focus();
    await page.keyboard.press("ArrowRight");
  }
  await expect(page.locator(".pdf-page-canvas")).toHaveCount(4);
  await zoomTo400(page, 0);
  await zoomTo400(page, 1);
  const m = await waitSettled(page);
  expect(m.pages).toHaveLength(4);
  for (const info of m.pages) expect(info.bytes).toBeLessThanOrEqual(TOTAL_BUDGET / 4);
  expect(m.totalBytes).toBeLessThanOrEqual(TOTAL_BUDGET);
  expect(m.retainedDetached).toBe(0);
});

test("rotating a zoomed page re-renders it upright within budget", async ({ page }) => {
  await zoomTo400(page);
  const upright = await waitSettled(page);
  const uprightBase = base(upright.pages[0])!;
  await page.getByRole("button", { name: "Rotate", exact: true }).click();
  await expect
    .poll(async () => {
      const m = await measure(page);
      const b = base(m.pages[0]);
      return settled(m) && !!b && b.width > b.height;
    })
    .toBe(true);
  const rotated = await measure(page);
  const b = base(rotated.pages[0])!;
  expect(b.width / b.height).toBeCloseTo(uprightBase.height / uprightBase.width, 2);
  expect(rotated.totalBytes).toBeLessThanOrEqual(PAGE_BUDGET);
  expect(rotated.retainedDetached).toBe(0);
});

test("leaving the PDF releases every page canvas", async ({ page }) => {
  await zoomTo400(page);
  await waitSettled(page);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "note.md", mimeType: "text/markdown", buffer: Buffer.from("# Note\n") });
  await page
    .getByRole("button", { name: /^note\b/i })
    .first()
    .click();
  await expect(page.locator(".pdf-page-canvas")).toHaveCount(0);
  const m = await measure(page);
  expect(m.retainedBytes).toBe(0);
});
