import { test, expect, type Page, type Locator } from "@playwright/test";

// R01: an animated diagram used to re-render its React controls every frame
// and keep drawing, off screen or not, for as long as the document was open.
// Three Stepped diagrams cost 180 renders a second with none of them visible,
// and playback started on its own even when the system asked for reduced
// motion.

/** A branching flowchart whose walkthrough runs well past the test windows. */
const flow = (edges: number) =>
  "flowchart LR\n" +
  Array.from(
    { length: edges },
    (_, i) =>
      `  n${Math.floor((i + 1) / 2)}[Step ${Math.floor((i + 1) / 2)}] --> n${i + 1}[Step ${i + 1}]`,
  ).join("\n");
const chain = (edges: number) =>
  "flowchart TD\n" +
  Array.from(
    { length: edges },
    (_, i) => `  n${i + 1}[Node ${i + 1}] --> n${i + 2}[Node ${i + 2}]`,
  ).join("\n");
const filler = Array.from(
  { length: 40 },
  (_, i) => `Paragraph ${i}. ${"Lorem ipsum dolor sit amet. ".repeat(12)}`,
).join("\n\n");

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    );
    // Count frame callbacks, and what they change, from before the app loads.
    const w = window as unknown as { __r01: { raf: number; fill: number; svg: number } };
    w.__r01 = { raf: 0, fill: 0, svg: 0 };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      raf((now) => {
        w.__r01.raf++;
        callback(now);
      });
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as Element;
        if (target.parentElement?.parentElement?.getAttribute("role") === "slider") w.__r01.fill++;
        else if (target.closest?.(".explainer-stage svg, .ma-container svg")) w.__r01.svg++;
      }
    }).observe(document, { subtree: true, attributes: true });
  });
});

async function openDocument(page: Page, markdown: string) {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "players.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(markdown),
    });
  const frame = page.locator(".mermaid-frame").first();
  await expect(frame).toBeVisible();
  return frame;
}

/** What changed over `ms`: frame callbacks, scrubber renders, diagram writes. */
async function over(page: Page, ms: number) {
  const read = () =>
    page.evaluate(() => ({ ...(window as unknown as { __r01: Record<string, number> }).__r01 }));
  const before = await read();
  await page.waitForTimeout(ms);
  const after = await read();
  return {
    raf: after.raf - before.raf,
    fill: after.fill - before.fill,
    svg: after.svg - before.svg,
  };
}

const playButton = (frame: Locator) =>
  frame.getByRole("button", { name: /^(Play|Pause) animation/ });
const position = (frame: Locator) => frame.getByRole("slider", { name: "Playback position" });
const seconds = async (frame: Locator) =>
  Number(await position(frame).getAttribute("aria-valuenow"));

async function scrollToEnd(page: Page) {
  await page.getByRole("heading", { name: "The end" }).scrollIntoViewIfNeeded();
}

test("Stepped draws every frame but renders its controls ~10 times a second, and stops off screen", async ({
  page,
}) => {
  const frame = await openDocument(
    page,
    `# Players\n\n\`\`\`mermaid\n${flow(40)}\n\`\`\`\n\n${filler}\n\n## The end\n`,
  );
  await frame.getByRole("tab", { name: "Stepped" }).click();
  await expect(playButton(frame)).toHaveAttribute("aria-label", /^Pause/);
  await page.waitForTimeout(500);

  const playing = await over(page, 2000);
  // The picture still animates at frame rate…
  expect(playing.svg).toBeGreaterThan(60);
  // …but the controls render at the publish rate, not 60 times a second.
  expect(playing.fill).toBeGreaterThan(8);
  expect(playing.fill).toBeLessThanOrEqual(30);

  await scrollToEnd(page);
  await expect(frame).not.toBeInViewport();
  await page.waitForTimeout(300);
  const hidden = await over(page, 1500);
  expect(hidden).toEqual({ raf: expect.any(Number), fill: 0, svg: 0 });
  expect(hidden.raf).toBeLessThan(10);
  const heldAt = await seconds(frame);

  // Back on screen it is still playing, from where it was.
  await frame.scrollIntoViewIfNeeded();
  await expect(playButton(frame)).toHaveAttribute("aria-label", /^Pause/);
  await expect.poll(async () => (await over(page, 400)).svg).toBeGreaterThan(5);
  expect(await seconds(frame)).toBeLessThanOrEqual(heldAt + 2);
});

test("the GPU Stepped player stops off screen too", async ({ page }) => {
  test.setTimeout(90_000);
  const frame = await openDocument(
    page,
    `# Players\n\n\`\`\`mermaid\n${chain(600)}\n\`\`\`\n\n${filler}\n\n## The end\n`,
  );
  await frame.getByRole("tab", { name: "Stepped" }).click();
  await expect(playButton(frame)).toHaveAttribute("aria-label", /^Pause/, { timeout: 40_000 });
  await expect(frame.locator("canvas").first()).toBeVisible();
  const playing = await over(page, 1500);
  expect(playing.raf).toBeGreaterThan(40);
  expect(playing.fill).toBeLessThanOrEqual(25);

  await scrollToEnd(page);
  await expect(frame).not.toBeInViewport();
  await page.waitForTimeout(300);
  expect((await over(page, 1500)).raf).toBeLessThan(10);
  await frame.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await over(page, 400)).raf).toBeGreaterThan(10);
});

test("a background tab runs no player frames and resumes when it returns", async ({ page }) => {
  const frame = await openDocument(page, `# Players\n\n\`\`\`mermaid\n${flow(40)}\n\`\`\`\n`);
  await frame.getByRole("tab", { name: "Stepped" }).click();
  await expect(playButton(frame)).toHaveAttribute("aria-label", /^Pause/);
  const setHidden = (hidden: boolean) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => (hidden ? "hidden" : "visible"),
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await setHidden(true);
  await page.waitForTimeout(200);
  const hidden = await over(page, 1000);
  expect(hidden.svg).toBe(0);
  expect(hidden.fill).toBe(0);
  await setHidden(false);
  await expect.poll(async () => (await over(page, 400)).svg).toBeGreaterThan(5);
});

test("Flow holds still off screen and moves again on screen", async ({ page }) => {
  const frame = await openDocument(
    page,
    `# Players\n\n\`\`\`mermaid\nflowchart LR\n  A[Start] --> B[Check]\n  B --> C[Build]\n  B --> D[Test]\n  C --> E[Ship]\n  D --> E\n\`\`\`\n\n${filler}\n\n## The end\n`,
  );
  await frame.getByRole("tab", { name: "Flow" }).click();
  await expect(frame.locator(".ma-container svg")).toBeVisible();
  await expect.poll(async () => (await over(page, 500)).svg).toBeGreaterThan(20);

  await scrollToEnd(page);
  await expect(frame).not.toBeInViewport();
  await page.waitForTimeout(300);
  expect((await over(page, 1000)).svg).toBe(0);
  await frame.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await over(page, 500)).svg).toBeGreaterThan(20);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("Stepped opens paused on the whole picture and plays on request", async ({ page }) => {
    const frame = await openDocument(page, `# Players\n\n\`\`\`mermaid\n${flow(40)}\n\`\`\`\n`);
    await frame.getByRole("tab", { name: "Stepped" }).click();
    const button = playButton(frame);
    // Read at once: a walkthrough left to play would also end on "Play".
    await expect(button).toBeVisible();
    expect(await button.getAttribute("aria-label")).toMatch(/^Play animation/);
    await expect(frame.getByText("The whole picture")).toBeVisible();
    expect(await seconds(frame)).toBeGreaterThan(20);
    const stage = page.locator(".explainer-stage");
    await expect(stage.getByText("Step 40", { exact: true })).toBeVisible();
    expect(await stage.locator(".explainer-hidden").count()).toBe(0);
    expect((await over(page, 1000)).svg).toBe(0);

    // Play walks through it from the top.
    await button.click();
    await expect(frame.getByText("The whole picture")).toBeHidden();
    await expect(button).toHaveAttribute("aria-label", /^Pause animation/);
    await expect.poll(async () => (await over(page, 400)).svg).toBeGreaterThan(5);
  });
});
