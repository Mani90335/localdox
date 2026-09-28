import { test, expect, type Page } from "@playwright/test";

// R06: Ask AI output belongs to the request that is running, streamed text is
// rendered in batches, closing the panel cancels the request, and blocked or
// cut-off answers say so.
//
// Gemini's streaming endpoint is replaced in the page by a stream the test
// feeds chunk by chunk (window.__ai), so nothing leaves the machine.

declare global {
  interface Window {
    __ai: {
      requests: {
        aborted: () => boolean;
        push: (chunk: unknown) => void;
        close: () => void;
      }[];
    };
  }
}

test.beforeEach(async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: true }),
    );
    window.__ai = { requests: [] };
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes(":streamGenerateContent")) return realFetch(input, init);
      const enc = new TextEncoder();
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      let open = true;
      const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
      const signal = init?.signal;
      signal?.addEventListener("abort", () => {
        if (open) controller.error(new DOMException("The user aborted a request.", "AbortError"));
        open = false;
      });
      window.__ai.requests.push({
        aborted: () => !!signal?.aborted,
        push: (chunk) => {
          if (open) controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        },
        close: () => {
          if (open) controller.close();
          open = false;
        },
      });
      return Promise.resolve(
        new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      );
    };
  });

  // Save a Gemini key; its validation call is answered locally.
  await page.route("https://generativelanguage.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"models":[]}' }),
  );
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Ask AI" }).click();
  const row = page.locator("div.px-4.py-3").filter({ hasText: "Google Gemini" });
  await row.getByPlaceholder("Paste API key").fill("test-gemini-key");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row.getByRole("button", { name: "Remove Google Gemini key" })).toBeVisible();

  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Notes\n\nSome text to ask about.\n"),
    });
  await expect(page.getByRole("heading", { name: "Notes", exact: true })).toBeVisible();
});

const panel = (page: Page) =>
  page.locator("aside").filter({ has: page.getByPlaceholder("Ask anything about the content…") });

async function askFreeform(page: Page, question = "What is this?") {
  // Ask AI opens from the reader's text-selection menu.
  await page
    .locator("article p")
    .filter({ hasText: "Some text" })
    .first()
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  const box = panel(page).getByPlaceholder("Ask anything about the content…");
  await box.fill(question);
  await box.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__ai.requests.length)).toBeGreaterThan(0);
}

const chunk = (text: string, finishReason?: string) => ({
  candidates: [
    {
      content: { role: "model", parts: text ? [{ text }] : [] },
      ...(finishReason ? { finishReason } : {}),
    },
  ],
});

test("streamed tokens render in batches, not once per token", async ({ page }) => {
  await askFreeform(page);
  const output = panel(page).locator(".docs-prose");
  await expect(output).toBeVisible();

  const { commits, tokens } = await page.evaluate(async (count) => {
    const aside = [...document.querySelectorAll("aside")].find((a) =>
      a.querySelector('textarea[placeholder^="Ask anything"]'),
    )!;
    const target = aside.querySelector(".docs-prose")!;
    let commits = 0;
    const observer = new MutationObserver(() => commits++);
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    const request = window.__ai.requests[0];
    // One token every few milliseconds, each in its own task, like a fast model.
    for (let i = 0; i < count; i++) {
      request.push({ candidates: [{ content: { role: "model", parts: [{ text: `w${i} ` }] } }] });
      await new Promise((r) => setTimeout(r, 4));
    }
    await new Promise((r) => setTimeout(r, 200));
    observer.disconnect();
    return { commits, tokens: count };
  }, 300);

  await page.evaluate(() => {
    const request = window.__ai.requests[0];
    request.push({ candidates: [{ content: { role: "model", parts: [] }, finishReason: "STOP" }] });
    request.close();
  });
  await expect(output).toContainText("w0 w1 w2");
  await expect(output).toContainText("w299");
  // ~1.2 s of streaming at one update per 50 ms is ~25 renders; per token is 300.
  expect(commits).toBeLessThan(tokens / 5);
  await expect(panel(page).getByRole("button", { name: "Copy" })).toBeVisible();
});

test("Stop keeps the partial answer and ignores later chunks", async ({ page }) => {
  await askFreeform(page);
  await page.evaluate(() =>
    window.__ai.requests[0].push({
      candidates: [{ content: { parts: [{ text: "First part" }] } }],
    }),
  );
  const output = panel(page).locator(".docs-prose");
  await expect(output).toHaveText("First part");

  await panel(page).getByRole("button", { name: "Stop" }).click();
  await expect(panel(page).getByRole("status")).toHaveText(
    "Stopped. The answer above is incomplete.",
  );
  expect(await page.evaluate(() => window.__ai.requests[0].aborted())).toBe(true);
  await page.evaluate(() =>
    window.__ai.requests[0].push({ candidates: [{ content: { parts: [{ text: " LATE" }] } }] }),
  );
  await page.waitForTimeout(200);
  await expect(output).toHaveText("First part");
  await expect(panel(page).getByRole("button", { name: "Send" })).toBeVisible();
  await expect(panel(page).getByText(/Something went wrong|failed/i)).toHaveCount(0);
});

test("closing the panel cancels the request", async ({ page }) => {
  await askFreeform(page);
  await page.evaluate(() =>
    window.__ai.requests[0].push({ candidates: [{ content: { parts: [{ text: "Working" }] } }] }),
  );
  await expect(panel(page).locator(".docs-prose")).toHaveText("Working");
  await panel(page).getByRole("button", { name: "Close" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__ai.requests[0].aborted())).toBe(true);
});

test("a blocked answer is reported, and a cut-off answer is flagged", async ({ page }) => {
  await askFreeform(page);
  await page.evaluate(() => {
    const r = window.__ai.requests[0];
    r.push({ candidates: [{ content: { parts: [{ text: "Partial" }] } }] });
    r.push({ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] });
    r.close();
  });
  await expect(panel(page).getByText("Gemini withheld the answer (safety).")).toBeVisible();

  const box = panel(page).getByPlaceholder("Ask anything about the content…");
  await box.fill("Again");
  await box.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__ai.requests.length)).toBe(2);
  await page.evaluate(
    ([a, b]) => {
      const r = window.__ai.requests[1];
      r.push(a);
      r.push(b);
      r.close();
    },
    [chunk("A long answer that"), chunk(" stops", "MAX_TOKENS")],
  );
  await expect(panel(page).locator(".docs-prose")).toHaveText("A long answer that stops");
  await expect(panel(page).getByRole("status")).toHaveText(/length limit and may be cut off/);
});
