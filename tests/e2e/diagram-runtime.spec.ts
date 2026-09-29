import { test, expect, type Page } from "@playwright/test";

// R02: Mermaid is one global. Every render used to call initialize() with its
// own settings, and a render reads them again while it draws, so a normal
// diagram next to a large one was drawn with the large one's settings
// (htmlLabels off: plain-text labels) and cached that way. Mermaid jobs now
// run one at a time, each with its own configuration. Mindmaps, whose layout
// grows far faster than their size, are held as source past 200 nodes until
// the reader asks for them.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    );
    // Every main-thread task over 50 ms, from the first script on.
    const w = window as unknown as { __longTasks: number[] };
    w.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  });
});

async function openMarkdown(page: Page, markdown: string) {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "diagrams.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(markdown),
    });
}

const fence = (source: string) => `\`\`\`mermaid\n${source}\n\`\`\`\n`;

/**
 * Small, with Markdown labels: 13 nodes and 12 edge labels, each an HTML label
 * in a foreignObject. Drawn with another diagram's settings it has none.
 */
const small = (tag: string) =>
  "flowchart LR\n" +
  Array.from({ length: 12 }, (_, i) => `  ${tag}${i}["**Step ${i}**"] --> ${tag}${i + 1}`).join(
    "\n",
  );
const HTML_LABELS = 25;

/** Past the performance-mode line count: flattened to an image, drawn with htmlLabels off. */
const largeSequence = (word: string) =>
  "sequenceDiagram\n" +
  Array.from({ length: 1_600 }, (_, i) => `  P${i % 8}->>P${(i + 3) % 8}: ${word} ${i}`).join("\n");

/** Past the GPU threshold: the stage reads Mermaid's theme with performance settings. */
const gpuChain =
  "flowchart TD\n" +
  Array.from({ length: 700 }, (_, i) => `  g${i}[G ${i}] --> g${i + 1}[G ${i + 1}]`).join("\n");

const mindmap = (nodes: number) =>
  "mindmap\n  root((Topics))\n" +
  Array.from({ length: nodes - 2 }, (_, i) => `    Topic ${i}`).join("\n");

/** Each frame once drawn: `flowchart-v2:<HTML labels>`, `image` or `canvas`. */
async function drawnFrames(page: Page, expected: number): Promise<string[]> {
  let frames: string[] = [];
  await expect
    .poll(
      async () => {
        frames = await page.evaluate(() =>
          [...document.querySelectorAll(".mermaid-frame")].map((frame) => {
            const svg = frame.querySelector("svg[aria-roledescription]");
            if (svg) {
              const labels = frame.querySelectorAll("svg foreignObject").length;
              return `${svg.getAttribute("aria-roledescription")}:${labels}`;
            }
            if (frame.querySelector("canvas")) return "canvas";
            if (frame.querySelector("img")) return "image";
            return "pending";
          }),
        );
        return frames.length === expected && !frames.includes("pending");
      },
      { timeout: 45_000 },
    )
    .toBe(true);
  return frames;
}

// On HEAD the small diagrams lost their HTML labels in 7 of 15 loads across
// these layouts (always with the small one first), so each loads three times.
const layouts = {
  "beside performance-mode images": [
    small("a"),
    largeSequence("message"),
    small("b"),
    largeSequence("note"),
  ],
  "beside a GPU diagram": [gpuChain, small("a"), small("b")],
};

for (const [name, blocks] of Object.entries(layouts)) {
  test(`small diagrams ${name} keep their own Mermaid settings`, async ({ page }) => {
    test.setTimeout(120_000);
    const loads: string[][] = [];
    for (let load = 0; load < 3; load++) {
      await openMarkdown(page, `# Diagrams\n\n${blocks.map(fence).join("\n")}`);
      const frames = await drawnFrames(page, blocks.length);
      loads.push(frames.filter((frame) => frame.startsWith("flowchart")));
    }
    expect(loads).toEqual(Array(3).fill(Array(2).fill(`flowchart-v2:${HTML_LABELS}`)));

    // One Mermaid job at a time: the recorded jobs never overlap.
    const jobs = await page.evaluate(() =>
      performance
        .getEntriesByType("measure")
        .filter((entry) => entry.name.startsWith("mermaid:"))
        .map((entry) => ({
          name: entry.name,
          start: entry.startTime,
          end: entry.startTime + entry.duration,
        }))
        .sort((a, b) => a.start - b.start),
    );
    expect(jobs.filter((job) => job.name === "mermaid:render").length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < jobs.length; i++) {
      expect(jobs[i].start).toBeGreaterThanOrEqual(jobs[i - 1].end - 0.5);
    }
  });
}

test("a mindmap past the node limit is shown as source, and drawn only on request", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openMarkdown(page, `# Map\n\n${fence(mindmap(1_000))}\nAfter the map.\n`);
  const frame = page.locator(".mermaid-frame");
  await expect(frame.getByText("Diagram not drawn yet")).toBeVisible();
  await expect(frame.getByText(/more than 200 nodes/)).toBeVisible();
  const source = frame.getByRole("region", { name: "Diagram source" });
  await expect(source).toContainText("Topic 997");
  // Inside the card, not bled out to the reading column's code-block width.
  const [box, card] = await Promise.all([source.boundingBox(), frame.boundingBox()]);
  expect(box!.x).toBeGreaterThanOrEqual(card!.x);
  expect(box!.x + box!.width).toBeLessThanOrEqual(card!.x + card!.width);
  await expect(page.getByText("After the map.")).toBeVisible();

  // Stepped and Flow wait for the picture.
  await expect(frame.getByRole("tab", { name: "Stepped" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(frame.getByRole("tab", { name: "Flow" })).toHaveAttribute("aria-disabled", "true");

  // Nothing was laid out: no Mermaid job ran and the page never blocked for long.
  await page.waitForTimeout(1_500);
  const state = await page.evaluate(() => ({
    jobs: performance.getEntriesByType("measure").filter((e) => e.name.startsWith("mermaid:"))
      .length,
    longest: Math.max(0, ...(window as unknown as { __longTasks: number[] }).__longTasks),
  }));
  expect(state.jobs).toBe(0);
  expect(state.longest).toBeLessThan(1_000);
});

test("Draw anyway renders a held mindmap and keeps the choice for this block", async ({ page }) => {
  test.setTimeout(90_000);
  // Just past the limit, so drawing it is quick enough for a test.
  await openMarkdown(page, `# Map\n\n${fence(mindmap(230))}`);
  const frame = page.locator(".mermaid-frame");
  await expect(frame.getByText("Diagram not drawn yet")).toBeVisible();
  await frame.getByRole("button", { name: "Draw anyway" }).click();
  await expect(frame.getByText("Diagram not drawn yet")).toHaveCount(0);
  // The mindmap itself (as live SVG, or flattened to an image if it measures
  // too large), not an icon in the header.
  await expect(frame.locator("svg[aria-roledescription='mindmap'], img[alt]").first()).toBeVisible({
    timeout: 45_000,
  });
  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByName("mermaid:render").length))
    .toBe(1);

  // Full screen reuses the render: no second layout.
  await frame.getByRole("button", { name: "Fullscreen" }).click();
  await expect(frame.getByRole("button", { name: "Exit full screen" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(frame.getByText("Diagram not drawn yet")).toHaveCount(0);
  expect(await page.evaluate(() => performance.getEntriesByName("mermaid:render").length)).toBe(1);
});
