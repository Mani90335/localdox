import { test, expect, type Page } from "@playwright/test";

// A04: Raw and Stepped share one renderer decision, and Stepped plays in a
// stage a screenful tall. The audit's 500-edge chain passed the source scan
// (the GPU threshold is 600 edges). Raw moved it to the GPU engine once the
// render measured too large, but Stepped re-ran only the source scan and
// mounted the whole SVG: a 52,311 px page with the transport far below.

const chain = (edges: number) =>
  "flowchart TD\n" +
  Array.from(
    { length: edges },
    (_, i) => `  n${i + 1}[Node ${i + 1}] --> n${i + 2}[Node ${i + 2}]`,
  ).join("\n");

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    );
    // The tallest Stepped SVG ever attached, to catch one that is mounted and
    // then replaced (the 52,000 px page existed for as long as it played).
    (window as unknown as { __tallestStepped: number }).__tallestStepped = 0;
    new MutationObserver(() => {
      for (const stage of document.querySelectorAll<HTMLElement>(".explainer-stage")) {
        const height = stage.getBoundingClientRect().height;
        const w = window as unknown as { __tallestStepped: number };
        if (height > w.__tallestStepped) w.__tallestStepped = height;
      }
    }).observe(document, { childList: true, subtree: true, attributes: true });
  });
});

async function openDiagram(page: Page, source: string) {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "diagram.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(`# Diagram\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`),
    });
  const frame = page.locator(".mermaid-frame");
  await expect(frame).toBeVisible();
  return frame;
}

/** What is drawing the diagram, once something is. */
async function renderer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const frame = document.querySelector(".mermaid-frame")!;
    if (frame.querySelector("canvas")) return "canvas";
    if (frame.querySelector("img")) return "image";
    if (frame.querySelector("svg[aria-roledescription], svg[id^='mermaid']")) return "svg";
    return "none";
  });
}

async function pageHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    let el: HTMLElement | null = document.querySelector(".mermaid-frame");
    while (
      el &&
      !(
        el.scrollHeight > el.clientHeight + 1 &&
        /(auto|scroll)/.test(getComputedStyle(el).overflowY)
      )
    )
      el = el.parentElement;
    return el ? el.scrollHeight : document.documentElement.scrollHeight;
  });
}

const tallest = (page: Page) =>
  page.evaluate(() => (window as unknown as { __tallestStepped: number }).__tallestStepped);

// Both sides of the GPU threshold: 499 and 500 are raised by the measured
// render, 600 by the source scan.
for (const edges of [499, 500, 600]) {
  test(`${edges}-edge chain: Raw and Stepped use the same renderer and a bounded stage`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const frame = await openDiagram(page, chain(edges));
    await expect.poll(() => renderer(page), { timeout: 40_000 }).toBe("canvas");
    await expect(frame.getByRole("tab", { name: "Flow" })).toBeDisabled();

    await frame.getByRole("tab", { name: "Stepped" }).click();
    const play = frame.getByRole("button", { name: /^(Play|Pause) animation/ });
    await expect(play).toBeVisible({ timeout: 40_000 });
    expect(await renderer(page)).toBe("canvas");
    const viewport = page.viewportSize()!;
    const box = (await frame.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(viewport.height);
    expect(await pageHeight(page)).toBeLessThan(viewport.height * 2);
    expect(await tallest(page)).toBeLessThanOrEqual(viewport.height);
    await frame.scrollIntoViewIfNeeded();
    await expect(play).toBeInViewport();
    await expect(frame.getByText(new RegExp(`/${edges}`))).toBeVisible();

    await frame.getByRole("tab", { name: "Raw" }).click();
    await expect.poll(() => renderer(page)).toBe("canvas");
  });
}

test("Stepped chosen before Raw has measured still gets the GPU engine, never the tall SVG", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const frame = await openDiagram(page, chain(500));
  // Straight away: Raw's render (seconds of layout) has not reported yet, so
  // Stepped's own measurement has to catch it.
  await frame.getByRole("tab", { name: "Stepped" }).click();
  await expect(frame.getByRole("button", { name: /^(Play|Pause) animation/ })).toBeVisible({
    timeout: 40_000,
  });
  expect(await renderer(page)).toBe("canvas");
  expect(await tallest(page)).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(await pageHeight(page)).toBeLessThan(page.viewportSize()!.height * 2);
});

test("a tall SVG chain plays in a screenful with the camera at natural size; Raw keeps natural height", async ({
  page,
}) => {
  const frame = await openDiagram(page, chain(40));
  const rawStage = frame.locator('[aria-label^="Mermaid diagram."]');
  await expect(rawStage).toBeVisible();
  // The still picture is read by scrolling the page past it, as before.
  await expect.poll(async () => (await rawStage.boundingBox())?.height ?? 0).toBeGreaterThan(3000);

  await frame.getByRole("tab", { name: "Stepped" }).click();
  await expect(frame.getByRole("button", { name: /^(Play|Pause) animation/ })).toBeVisible();
  expect(await renderer(page)).toBe("svg");
  const stage = page.locator(".explainer-stage");
  const viewport = page.viewportSize()!;
  // min(32rem, 70vh) plus the 56 px transport gutter.
  const cap = Math.min(512, viewport.height * 0.7) + 56;
  const stageBox = (await stage.boundingBox())!;
  expect(stageBox.height).toBeLessThanOrEqual(cap + 1);
  expect(await tallest(page)).toBeLessThanOrEqual(cap + 1);

  // The camera follows: the view is the stage's width in diagram units (one
  // unit per pixel), not the whole 4,000-unit chain letterboxed to a sliver.
  await expect
    .poll(() =>
      stage.evaluate((el) => {
        const [, , width, height] = el
          .querySelector("svg")!
          .getAttribute("viewBox")!
          .split(/\s+/)
          .map(Number);
        return Math.abs(width - el.clientWidth) <= 2 && height < 1000;
      }),
    )
    .toBe(true);
  // The first steps are on screen and legible, not scaled away.
  const label = stage.getByText("Node 1", { exact: true });
  await expect(label).toBeVisible();
  expect((await label.boundingBox())!.height).toBeGreaterThan(12);
});

test("a fitted diagram keeps its fitted Stepped stage", async ({ page }) => {
  const frame = await openDiagram(
    page,
    "flowchart LR\n  A[Start] --> B[Check]\n  B --> C[Build]\n  B --> D[Test]\n  C --> E[Ship]\n  D --> E",
  );
  await frame.getByRole("tab", { name: "Stepped" }).click();
  await expect(frame.getByRole("button", { name: /^(Play|Pause) animation/ })).toBeVisible();
  const stage = page.locator(".explainer-stage");
  const style = await stage.evaluate((el) => el.style.aspectRatio);
  expect(style).toMatch(/^1 \/ 0\./);
});
