import { test, expect, type Page, type Browser } from "@playwright/test";

// The Pages sidebar mounted one thumbnail button per page (1,000 for a
// 1,000-page book); it is now windowed and follows the current page. And a
// trackpad pinch (a burst of small ctrl+wheel events) zoomed a full ×1.25
// step per event, jumping straight to 400%; zoom now follows the gesture.

test.use({ viewport: { width: 1280, height: 800 } });

async function longPdf(browser: Browser, pages: number): Promise<Buffer> {
  const page = await browser.newPage();
  await page.setContent(
    "<style>section{break-after:page;font:24px serif}</style>" +
      Array.from({ length: pages }, (_, i) => `<section>Long page ${i + 1}</section>`).join(""),
  );
  const buffer = await page.pdf();
  await page.close();
  return buffer;
}

let book: Buffer;
test.beforeAll(async ({ browser }) => {
  book = await longPdf(browser, 300);
});

test.beforeEach(async ({ page }) => {
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
    .setInputFiles({ name: "Long.pdf", mimeType: "application/pdf", buffer: book });
  await expect(page.locator(".pdf-page-area .textLayer").first()).toContainText("Long page 1");
});

const pageNumber = (page: Page) => page.getByRole("textbox", { name: "Page number", exact: true });

async function goTo(page: Page, n: number) {
  await pageNumber(page).fill(String(n));
  await pageNumber(page).press("Enter");
  await expect(page.locator(".pdf-page-area .textLayer").first()).toContainText(`Long page ${n}`);
}

test("the Pages list mounts only the thumbnails near the view and follows the current page", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Show thumbnails/ }).click();
  const list = page.getByRole("list", { name: "Pages" });
  const items = list.getByRole("listitem");
  const thumb = (n: number) => list.getByRole("button", { name: String(n), exact: true });

  await expect(thumb(1)).toBeVisible();
  await expect(thumb(1)).toHaveAttribute("aria-current", "true");
  const mounted = await items.count();
  expect(mounted).toBeGreaterThan(2);
  expect(mounted).toBeLessThan(15);
  await expect(items.first()).toHaveAttribute("aria-setsize", "300");

  // The scroll range covers all 300 thumbnails, and scrolling mounts the ones in view.
  const scroller = list.locator("xpath=..");
  const { scrollHeight, pitch } = await scroller.evaluate((el) => {
    const first = el.querySelector("li")!;
    return { scrollHeight: el.scrollHeight, pitch: first.offsetHeight + 8 };
  });
  expect(scrollHeight).toBe(24 + 300 * pitch - 8);
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(thumb(300)).toBeInViewport();
  await expect(thumb(1)).toHaveCount(0);
  expect(await items.count()).toBeLessThan(15);

  // Changing page elsewhere brings its thumbnail into view.
  await goTo(page, 150);
  await expect(thumb(150)).toBeInViewport();
  await expect(thumb(150)).toHaveAttribute("aria-current", "true");
  const item150 = page.getByRole("button", { name: "150", exact: true });
  await expect(list.getByRole("listitem").filter({ has: item150 })).toHaveAttribute(
    "aria-posinset",
    "150",
  );

  // Clicking a thumbnail navigates.
  await thumb(152).click();
  await expect(pageNumber(page)).toHaveValue("152");

  // A focused thumbnail stays mounted (and focused) when scrolled away.
  await thumb(151).focus();
  await scroller.evaluate((el) => (el.scrollTop = 0));
  await expect(thumb(1)).toBeVisible();
  await expect(thumb(151)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(pageNumber(page)).toHaveValue("151");
});

async function pinch(page: Page, deltas: number[], perFrame = 3) {
  await page.locator(".pdf-page-area").evaluate(
    async (el, { deltas, perFrame }) => {
      for (let i = 0; i < deltas.length; i += perFrame) {
        for (const deltaY of deltas.slice(i, i + perFrame))
          el.dispatchEvent(
            new WheelEvent("wheel", { deltaY, ctrlKey: true, bubbles: true, cancelable: true }),
          );
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    },
    { deltas, perFrame },
  );
}

// Named by its percentage; "Reset zoom" is its title.
const zoomLabel = (page: Page) => page.getByTitle("Reset zoom", { exact: true });

test("pinch zoom follows the gesture instead of jumping a full step per event", async ({
  page,
}) => {
  await expect(zoomLabel(page)).toHaveText("100%");

  // A typical pinch-out: 40 small ctrl+wheel events totalling −120 px. This
  // used to be 40 × ×1.25 steps, straight to 400%.
  const pinchOut = Array.from({ length: 40 }, (_, i) => -1 - (i % 5));
  await pinch(page, pinchOut);
  await expect(zoomLabel(page)).toHaveText("182%");

  // The same pinch back returns to where it started.
  await pinch(
    page,
    pinchOut.map((d) => -d),
  );
  await expect(zoomLabel(page)).toHaveText("100%");

  // A tiny twitch barely moves.
  await pinch(page, [-2]);
  await expect(zoomLabel(page)).toHaveText("101%");
  await zoomLabel(page).click();

  // Ctrl + a mouse-wheel notch is still exactly one button step.
  await pinch(page, [-100], 1);
  await expect(zoomLabel(page)).toHaveText("125%");
  await pinch(page, [100], 1);
  await expect(zoomLabel(page)).toHaveText("100%");

  // The browser's own page zoom never kicks in.
  const cancelled = await page
    .locator(".pdf-page-area")
    .evaluate(
      (el) =>
        !el.dispatchEvent(
          new WheelEvent("wheel", { deltaY: -3, ctrlKey: true, bubbles: true, cancelable: true }),
        ),
    );
  expect(cancelled).toBe(true);
});
