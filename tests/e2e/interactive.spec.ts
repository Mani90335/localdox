import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

// ```interactive-react and ```interactive-html blocks run in a sandboxed frame.
//
// Before this change a React example never ran, in dev or production: its
// frame (opaque origin) loaded the app at /interactive-runtime, whose module
// scripts were blocked by CORS, and whose app shell would then have thrown on
// the service-worker registration. The frame also grew a pixel per round up
// to its 960 px cap, because it reported its own height back.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    // Frames get this script too; their storage is off-limits.
    try {
      localStorage.setItem(
        "localdox:prefs",
        JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
      );
    } catch {
      return;
    }
    const w = window as unknown as { __frameEvents: string[] };
    w.__frameEvents = [];
    addEventListener("message", (event) => {
      if (event.data?.type === "docucraft:interactive") w.__frameEvents.push(event.data.event);
    });
  });
});

async function upload(page: Page, name: string, source: string) {
  const path = test.info().outputPath(name);
  writeFileSync(path, source);
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles(path);
}

const fence = (lang: string, body: string, meta = "") => `\`\`\`${lang} ${meta}\n${body}\n\`\`\`\n`;
const frameEvents = (page: Page) =>
  page.evaluate(() => (window as unknown as { __frameEvents: string[] }).__frameEvents);

test("a React example runs, responds and keeps a settled height", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  await upload(
    page,
    "react.md",
    "# React\n\n" +
      fence(
        "interactive-react",
        `type Props = { start?: number };
export default function Counter({ start = 2 }: Props) {
  const [count, setCount] = useState<number>(start);
  return <button onClick={() => setCount((c) => c + 1)}>Count {count}</button>;
}`,
      ),
  );

  const frame = page.frameLocator('iframe[title="Interactive react preview"]');
  const button = frame.getByRole("button", { name: "Count 2" });
  await expect(button).toBeVisible();
  await button.click();
  await expect(frame.getByRole("button", { name: "Count 3" })).toBeVisible();

  // Small content: the frame stays at its minimum instead of creeping to the cap.
  const iframe = page.locator('iframe[title="Interactive react preview"]');
  await page.waitForTimeout(1000);
  const height = await iframe.evaluate((element) => element.getBoundingClientRect().height);
  expect(height).toBeLessThan(200);
  expect((await frameEvents(page)).filter((event) => event === "height").length).toBeLessThan(10);
  expect(errors).toEqual([]);
});

test("an HTML example renders its markup and scripts", async ({ page }) => {
  await upload(
    page,
    "html.md",
    "# HTML\n\n" +
      fence(
        "interactive-html",
        `<p id="out">waiting</p><script>document.getElementById("out").textContent = "ran";</script>`,
      ),
  );
  const frame = page.frameLocator('iframe[title="Interactive html preview"]');
  await expect(frame.getByText("ran")).toBeVisible();
  await page.waitForTimeout(1000);
  const height = await page
    .locator('iframe[title="Interactive html preview"]')
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(height).toBeLessThan(200);
});

test("examples can't reach the network or the app's storage", async ({ page, baseURL }) => {
  // Chromium reports a request its CSP blocked as a failed request
  // (net::ERR_BLOCKED_BY_CSP); only one that got a response has left the frame.
  const leaks: string[] = [];
  const blocked: string[] = [];
  page.context().on("requestfinished", (request) => {
    if (request.url().includes("leak-")) leaks.push(request.url());
  });
  page.context().on("requestfailed", (request) => {
    if (request.url().includes("leak-"))
      blocked.push(`${request.url()} ${request.failure()?.errorText}`);
  });
  await upload(
    page,
    "sandbox.md",
    "# Sandbox\n\n" +
      fence(
        "interactive-react",
        `export default function Probe() {
  const [result, setResult] = useState("probing");
  useEffect(() => {
    const outcomes: string[] = [];
    new Image().src = "${baseURL}/leak-image";
    try { const xhr = new XMLHttpRequest(); xhr.open("GET", "${baseURL}/leak-xhr"); xhr.send(); } catch { outcomes.push("xhr blocked"); }
    try { fetch("${baseURL}/leak-fetch"); } catch { outcomes.push("fetch blocked"); }
    try { localStorage.getItem("localdox:prefs"); } catch { outcomes.push("storage blocked"); }
    setResult(outcomes.join(", ") || "none blocked");
  }, []);
  return <p>{result}</p>;
}`,
      ) +
      "\n" +
      fence("interactive-html", `<img src="${baseURL}/leak-html-image" alt="" />`),
  );
  const frame = page.frameLocator('iframe[title="Interactive react preview"]');
  await expect(frame.getByText(/fetch blocked, storage blocked/)).toBeVisible();
  await expect(page.locator('iframe[title="Interactive html preview"]')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(leaks).toEqual([]);
  expect(blocked.sort()).toEqual(
    ["leak-html-image", "leak-image", "leak-xhr"].map((name) => `${baseURL}/${name} csp`),
  );
});

test("a compile error is reported in the block", async ({ page }) => {
  await upload(
    page,
    "broken.md",
    "# Broken\n\n" +
      fence("interactive-react", `export default function Broken() { return <div>; }`),
  );
  const alert = page.locator(".interactive-error");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Preview error");
});

// R05: a playground compiles (in a worker) once typing pauses, not per
// keystroke. Before, each keystroke compiled on the reader's thread, remounted
// the example (losing its state) and flashed an error for every half-typed
// line; an HTML playground reloaded its frame per keystroke.

const clearFrameEvents = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __frameEvents: string[] }).__frameEvents = [];
  });

async function typeAtEnd(page: Page, text: string) {
  const editor = page.getByLabel("Interactive component source");
  await editor.click();
  await editor.evaluate((element: HTMLTextAreaElement) =>
    element.setSelectionRange(element.value.length, element.value.length),
  );
  await page.keyboard.type(text, { delay: 40 });
}

test("a playground runs edits once typing pauses, compiled in a worker", async ({ page }) => {
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  await upload(
    page,
    "playground.md",
    "# Playground\n\n" +
      fence(
        "interactive-react",
        `export default function Counter() {
  const [count, setCount] = useState(2);
  return <button onClick={() => setCount((c) => c + 1)}>Count {count}</button>;
}`,
        "playground",
      ),
  );
  const frame = page.frameLocator('iframe[title="Interactive react preview"]');
  await frame.getByRole("button", { name: "Count 2" }).click();
  await expect(frame.getByRole("button", { name: "Count 3" })).toBeVisible();
  expect(workers.some((url) => /compiler\.worker/.test(url))).toBe(true);

  // Every keystroke leaves valid code; none of them runs while typing.
  await clearFrameEvents(page);
  await typeAtEnd(page, "\n// Counts clicks");
  expect(await frameEvents(page)).not.toContain("ready");
  await expect(frame.getByRole("button", { name: "Count 3" })).toBeVisible();

  // Once typing pauses: one run with the new code (a fresh mount).
  await expect(frame.getByRole("button", { name: "Count 2" })).toBeVisible();
  await page.waitForTimeout(600);
  expect((await frameEvents(page)).filter((event) => event === "ready")).toHaveLength(1);
});

test("a half-typed line shows its error only once typing pauses", async ({ page }) => {
  await upload(
    page,
    "errors.md",
    "# Errors\n\n" +
      fence(
        "interactive-react",
        `export default function A() { return <p>fine</p>; }`,
        "playground",
      ),
  );
  const frame = page.frameLocator('iframe[title="Interactive react preview"]');
  await expect(frame.getByText("fine")).toBeVisible();
  const alert = page.locator(".interactive-error");

  await typeAtEnd(page, "\nconst total = [1, 2");
  await expect(alert).toHaveCount(0);
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Preview error");
  // The last good run stays on screen meanwhile.
  await expect(frame.getByText("fine")).toBeVisible();

  await clearFrameEvents(page);
  await typeAtEnd(page, "];");
  await expect(alert).toHaveCount(0);
  await expect.poll(() => frameEvents(page)).toContain("ready");
});

test("an HTML playground reloads its frame once typing pauses", async ({ page }) => {
  await upload(
    page,
    "html-playground.md",
    "# HTML\n\n" + fence("interactive-html", `<p>Hello</p>`, "playground"),
  );
  const frame = page.frameLocator('iframe[title="Interactive html preview"]');
  await expect(frame.getByText("Hello")).toBeVisible();
  await clearFrameEvents(page);
  await typeAtEnd(page, "<p>World</p>");
  expect(await frameEvents(page)).not.toContain("booted");
  await expect(frame.getByText("World")).toBeVisible();
  await page.waitForTimeout(600);
  expect((await frameEvents(page)).filter((event) => event === "booted")).toHaveLength(1);
});
