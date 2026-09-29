import { test, expect, type Page } from "@playwright/test";

async function openSearch(page: Page, query: string) {
  await page
    .locator("button:visible")
    .filter({ has: page.locator("svg.lucide-search") })
    .first()
    .click();
  await page.getByPlaceholder("Search all documents...").fill(query);
}

async function upload(page: Page) {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "alpha.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Topic\n\nconstant content\n"),
    });
  await expect(page.getByRole("heading", { name: "Topic", exact: true })).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
});

for (const fallback of [false, true]) {
  test(`unchanged searches follow renames, edits and Bin moves (${fallback ? "fallback" : "worker"})`, async ({
    page,
    context,
  }) => {
    if (fallback)
      await page.addInitScript(() => {
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
          constructor(url: string | URL, options?: WorkerOptions) {
            if (String(url).includes("document-index")) throw new Error("Test: worker unavailable");
            super(url, options);
          }
        };
      });
    await upload(page);
    await page.getByRole("button", { name: "Options", exact: true }).first().click();
    await page.getByText("Edit", { exact: true }).click();
    await openSearch(page, "constant");
    const results = page.locator("aside");
    await expect(results.getByRole("button", { name: /^alpha\.md/ })).toBeVisible();

    await page.getByRole("textbox", { name: "Document name" }).fill("renamed.md");
    await page.getByRole("textbox", { name: "Document name" }).press("Enter");
    await expect(results.getByRole("button", { name: /^renamed\.md/ })).toBeVisible();
    await expect(results.getByRole("button", { name: /^alpha\.md/ })).toHaveCount(0);
    await expect(page.getByPlaceholder("Search all documents...")).toHaveValue("constant");

    await page.getByPlaceholder("Search all documents...").fill("alpha");
    await expect(results).toContainText('No results for "alpha"');
    await page.getByPlaceholder("Search all documents...").fill("renamed");
    await expect(results.getByRole("button", { name: /^renamed\.md/ }).first()).toBeVisible();

    await page.getByPlaceholder("Search all documents...").fill("constant");
    await expect(results.getByRole("button", { name: /^renamed\.md/ })).toBeVisible();
    await page.locator("textarea").fill("# Topic\n\nreplacement text\n");
    await expect(results).toContainText('No results for "constant"');
    await page.locator("textarea").fill("# Topic\n\nconstant restored\n");
    await expect(
      results.getByRole("button", { name: "constant restored", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Done · Preview" }).click();

    // Another real tab bins the file while the query stays open in this tab.
    const other = await context.newPage();
    await other.goto("/");
    await expect(other.getByText("constant restored", { exact: true })).toBeVisible();
    await other.getByRole("button", { name: "Options", exact: true }).first().click();
    await other.getByText("Move to Bin", { exact: true }).click();
    await expect(results).toContainText('No results for "constant"');
    await expect(page.getByPlaceholder("Search all documents...")).toHaveValue("constant");
  });
}

test("an unchanged query refreshes when initial worker indexing finishes after the search", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const deferred: Array<() => void> = [];
    let held = true;
    Object.assign(window, {
      releaseSearchSync: () => {
        held = false;
        deferred.splice(0).forEach((send) => send());
      },
    });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private searchWorker: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.searchWorker = String(url).includes("document-index");
      }
      postMessage(message: unknown) {
        const send = () => super.postMessage(message);
        if (held && this.searchWorker && (message as { type?: string }).type === "sync")
          deferred.push(send);
        else send();
      }
    };
  });
  await upload(page);
  await openSearch(page, "constant");
  // Indexing in progress is not "no results".
  await expect(page.locator("aside").getByRole("status")).toHaveText("Indexing documents…");
  await expect(page.locator("aside")).not.toContainText("No results");
  await page.evaluate(() =>
    (window as unknown as { releaseSearchSync(): void }).releaseSearchSync(),
  );
  await expect(
    page.locator("aside").getByRole("button", { name: "constant content", exact: true }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Search all documents...")).toHaveValue("constant");
});

// A07: search worker lifecycle. The worker wrapper below lets a test hold
// the replies to syncs of a named file's workspace, answer searches with the
// worker protocol's error reply, or hold searches, all without touching the
// app's code. Replies are held rather than requests so the worker still sees
// every message in the order the app sent it.
const searchWorkerControls = () => {
  const state = {
    holdSyncOf: "" as string,
    failSearches: false,
    holdSearches: false,
    deferred: [] as Array<() => void>,
  };
  Object.assign(window, {
    searchWorker: {
      set(patch: Partial<typeof state>) {
        Object.assign(state, patch);
      },
      release() {
        state.holdSyncOf = "";
        state.deferred.splice(0).forEach((deliver) => deliver());
      },
    },
  });
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    private search: boolean;
    private held = new Set<number>();
    private wrapped = new Map<unknown, EventListener>();
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      this.search = String(url).includes("document-index");
    }
    postMessage(message: unknown) {
      const request = message as {
        reqId: number;
        type: string;
        files?: { name: string }[];
      };
      if (this.search && request.type === "search" && state.failSearches) {
        setTimeout(() =>
          this.dispatchEvent(
            new MessageEvent("message", {
              data: { reqId: request.reqId, type: "error", message: "Test: search failed" },
            }),
          ),
        );
        return;
      }
      if (this.search && request.type === "search" && state.holdSearches) return;
      if (
        this.search &&
        request.type === "sync" &&
        state.holdSyncOf &&
        request.files?.some((file) => file.name === state.holdSyncOf)
      )
        this.held.add(request.reqId);
      super.postMessage(message);
    }
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: unknown,
    ) {
      if (type !== "message" || !this.search || typeof listener !== "function")
        return super.addEventListener(type, listener, options as AddEventListenerOptions);
      const wrapped: EventListener = (event) => {
        const reqId = (event as MessageEvent).data?.reqId;
        if (state.holdSyncOf && this.held.has(reqId))
          state.deferred.push(() => listener.call(this, event));
        else listener.call(this, event);
      };
      this.wrapped.set(listener, wrapped);
      super.addEventListener(type, wrapped, options as AddEventListenerOptions);
    }
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: unknown,
    ) {
      super.removeEventListener(
        type,
        (this.wrapped.get(listener) ?? listener) as EventListener,
        options as EventListenerOptions,
      );
    }
  };
};

type Controls = {
  searchWorker: {
    set(patch: { holdSyncOf?: string; failSearches?: boolean; holdSearches?: boolean }): void;
    release(): void;
  };
};

async function controlSearchWorker(
  page: Page,
  patch: Parameters<Controls["searchWorker"]["set"]>[0],
) {
  await page.evaluate((p) => (window as unknown as Controls).searchWorker.set(p), patch);
}

const archive = {
  format: "localdox-workspace",
  version: 2,
  workspace: {
    id: "archive",
    name: "Archive",
    createdAt: 1,
    updatedAt: 1,
    folders: [],
    files: [
      {
        id: "archived",
        name: "archived.md",
        content: "# Archived\n\nold shelved note\n",
        kind: "markdown",
        addedAt: 1,
      },
    ],
    bookmarks: [],
    saved: [],
    highlights: [],
    ui: { activeFileId: "archived", expanded: {}, sidebarCollapsed: false, scrollTop: 0 },
  },
};

/** alpha.md in the first workspace, then "Archive" imported and current, so
 *  alpha.md is only reachable through "Search all workspaces". */
async function twoWorkspaces(page: Page, backup = archive) {
  await upload(page);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Workspace" }).click();
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles({
    name: "archive.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string[]>((resolve, reject) => {
            const request = indexedDB.open("localdox");
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const all = request.result
                .transaction("workspaces")
                .objectStore("workspaces")
                .getAll();
              all.onsuccess = () => {
                request.result.close();
                resolve(all.result.map((w: { name: string }) => w.name));
              };
            };
          }),
      ),
    )
    .toContain("Archive");
  await page.goto("/");
  // Which workspace reopens depends on whether the import's switch was
  // saved before navigating; either way, end up in Archive.
  const switchToArchive = page.getByRole("button", { name: "A Archive" });
  await expect(
    switchToArchive.or(page.getByRole("button", { name: "Settings for Archive" })),
  ).toBeVisible();
  if (await switchToArchive.isVisible()) await switchToArchive.click();
  await expect(page.getByRole("heading", { name: "Archived", exact: true })).toBeVisible();
}

async function setAllWorkspaces(page: Page, on: boolean) {
  await page.getByRole("checkbox", { name: "Search all workspaces" }).setChecked(on);
}

test("other workspaces are indexed again after search is closed and reopened", async ({ page }) => {
  await twoWorkspaces(page);
  const results = page.locator("aside");
  await openSearch(page, "constant");
  await setAllWorkspaces(page, true);
  await expect(results.getByRole("button", { name: /^alpha\.md/ })).toBeVisible();

  // Closing search ends that worker; the next one starts empty.
  await page.getByRole("button", { name: "Close search" }).click();
  await expect(page.getByPlaceholder("Search all documents...")).toHaveCount(0);
  await openSearch(page, "constant");
  await setAllWorkspaces(page, true);
  await expect(results.getByRole("button", { name: /^alpha\.md/ })).toBeVisible();
  await page.getByPlaceholder("Search all documents...").fill("shelved");
  await expect(results.getByRole("button", { name: /^archived\.md/ })).toBeVisible();
});

test("searching all workspaces leaves the open workspace's next save at one file", async ({
  page,
}) => {
  // Archive (the open workspace) also holds an image.
  const scan = {
    id: "scan",
    name: "scan.png",
    kind: "image",
    mimeType: "image/png",
    content: "",
    data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHUlEQVR4nGP4z8BAEmIY1TCqYVTDqIZRDcNWAwCvRf8BjqzjYQAAAABJRU5ErkJggg==",
    addedAt: 1,
  };
  await twoWorkspaces(page, {
    ...archive,
    workspace: { ...archive.workspace, files: [...archive.workspace.files, scan] },
  });
  await page.evaluate(() => {
    const w = window as unknown as { fileWrites: string[] };
    w.fileWrites = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === "files") w.fileWrites.push((value as { name: string }).name);
      return put.call(this, value, ...args);
    };
  });
  const writes = () =>
    page.evaluate(() => (window as unknown as { fileWrites: string[] }).fileWrites);
  // Indexing alpha.md reads the other workspace; that must not make the open
  // one forget what it last saved.
  const results = page.locator("aside");
  await openSearch(page, "constant");
  await setAllWorkspaces(page, true);
  await expect(results.getByRole("button", { name: /^alpha\.md/ })).toBeVisible();
  await expect(results.getByText(/Indexing \d+ other workspace/)).toHaveCount(0);
  await page.getByRole("button", { name: "Close search" }).click();

  await page.getByRole("button", { name: "Options", exact: true }).first().click();
  await page.getByText("Edit", { exact: true }).click();
  await page.getByRole("textbox", { name: "Document name" }).fill("kept.md");
  await page.getByRole("textbox", { name: "Document name" }).press("Enter");
  await expect.poll(writes).toContain("kept.md");
  await page.waitForTimeout(1000);
  expect(await writes()).toEqual(["kept.md"]);
});

test("turning all-workspaces off while another workspace is indexing settles the indicator", async ({
  page,
}) => {
  await page.addInitScript(searchWorkerControls);
  await twoWorkspaces(page);
  const results = page.locator("aside");
  await controlSearchWorker(page, { holdSyncOf: "alpha.md" });
  await openSearch(page, "constant");
  await setAllWorkspaces(page, true);
  await expect(results.getByText("Indexing 1 other workspace…")).toBeVisible();

  await setAllWorkspaces(page, false);
  await expect(results.getByText(/Indexing \d+ other workspace/)).toHaveCount(0);
  await expect(results).toContainText('No results for "constant"');
  await page.evaluate(() => (window as unknown as Controls).searchWorker.release());
  await expect(results.getByText(/Indexing \d+ other workspace/)).toHaveCount(0);
  // The late sync was followed by the drop, so alpha.md stays out.
  await page.getByPlaceholder("Search all documents...").fill("content");
  await expect(results).toContainText('No results for "content"');

  await setAllWorkspaces(page, true);
  await expect(results.getByRole("button", { name: /^alpha\.md/ })).toBeVisible();
  await expect(results.getByText(/Indexing \d+ other workspace/)).toHaveCount(0);
});

test("a search the worker reports as failed is shown and can be retried", async ({ page }) => {
  await page.addInitScript(searchWorkerControls);
  await upload(page);
  await controlSearchWorker(page, { failSearches: true });
  await openSearch(page, "constant");
  const results = page.locator("aside");
  await expect(results.getByRole("alert")).toContainText("Search couldn’t run.");
  await expect(results.getByText("Searching…")).toHaveCount(0);
  await expect(results).not.toContainText("No results");

  await controlSearchWorker(page, { failSearches: false });
  await results.getByRole("button", { name: "Try again" }).click();
  await expect(
    results.getByRole("button", { name: "constant content", exact: true }),
  ).toBeVisible();
  await expect(results.getByRole("alert")).toHaveCount(0);
});

test("a search worker that crashes mid-search falls back and still answers", async ({ page }) => {
  await page.addInitScript(searchWorkerControls);
  await upload(page);
  await page.getByRole("button", { name: "Options", exact: true }).first().click();
  await page.getByText("Edit", { exact: true }).click();
  const workerStarted = page.waitForEvent("worker", (w) => w.url().includes("document-index"));
  await openSearch(page, "constant");
  const results = page.locator("aside");
  await expect(
    results.getByRole("button", { name: "constant content", exact: true }),
  ).toBeVisible();
  const worker = await workerStarted;

  await controlSearchWorker(page, { holdSearches: true });
  await page.getByPlaceholder("Search all documents...").fill("topic");
  await expect(results.getByText("Searching…")).toBeVisible();
  const closed = new Promise<void>((resolve) => worker.once("close", () => resolve()));
  await worker.evaluate(() => {
    setTimeout(() => {
      throw new Error("Test: search worker crashed");
    });
  });
  await closed;
  await expect(results.getByRole("button", { name: "Topic", exact: true })).toBeVisible();
  await expect(results.getByText("Searching…")).toHaveCount(0);

  // The main-thread index keeps following edits.
  await page.locator("textarea").fill("# Topic\n\nfreshly typed\n");
  await page.getByPlaceholder("Search all documents...").fill("freshly");
  await expect(results.getByRole("button", { name: "freshly typed", exact: true })).toBeVisible();
});

type HighlightRegistry = { highlights: Map<string, Iterable<Range>> };

/** Clicks a search result and returns the passage its jump flashed: the
 *  matched text and a little of what follows it. */
async function jumpTo(page: Page, result: ReturnType<Page["locator"]>) {
  await page.evaluate(() =>
    (CSS as unknown as HighlightRegistry).highlights.delete("dc-saved-flash"),
  );
  await result.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          [
            ...((CSS as unknown as HighlightRegistry).highlights.get("dc-saved-flash") ?? []),
          ][0]?.toString() ?? "",
      ),
    )
    .not.toBe("");
  return page.evaluate(() => {
    const range = [
      ...((CSS as unknown as HighlightRegistry).highlights.get("dc-saved-flash") ?? []),
    ][0] as Range;
    const after = document.createRange();
    after.selectNodeContents(range.endContainer.parentElement!.closest("p, li, td, pre")!);
    after.setStart(range.endContainer, range.endOffset);
    return { text: range.toString(), after: after.toString().slice(0, 9).trimEnd() };
  });
}

test("search lists exactly the occurrences of the query and lands on the one clicked", async ({
  page,
}) => {
  const filler = Array.from({ length: 400 }, (_, i) => `Haystack line ${i} with nothing to find.`);
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        [
          "# Guide",
          "",
          ...filler.slice(0, 200),
          "",
          "## Noodle shop",
          "",
          "The noodle shop is not what we want.",
          "",
          "The **needle** is here, and a second needle follows.",
          "",
          "| name | note |",
          "|------|------|",
          "| row  | needle cell |",
          "",
          "```js",
          "const needle = 1;",
          "```",
          "",
          ...filler.slice(200),
          "",
          "# Appendix",
          "",
          "Final needle mention.",
        ].join("\n"),
      ),
    });
  await expect(page.getByRole("heading", { name: "Guide", exact: true })).toBeVisible();
  await openSearch(page, "needle");
  const results = page.locator("aside");
  await expect(results.getByText("5 results in 1 file")).toBeVisible();
  const rows = results.locator("button[title] mark");
  await expect(rows).toHaveText(["needle", "needle", "needle", "needle", "needle"]);
  await expect(results).not.toContainText("Noodle");

  // The second occurrence on a line with two.
  const result = (n: number) => results.locator("button[title]:has(mark)").nth(n);
  expect(await jumpTo(page, result(1))).toEqual({ text: "needle", after: " follows." });

  // One on another page of the document.
  expect(await jumpTo(page, result(4))).toEqual({ text: "needle", after: " mention." });
  await expect(page.getByRole("article").getByText("Final needle mention.")).toBeVisible();

  // And back, into the fenced code.
  expect(await jumpTo(page, result(3))).toEqual({ text: "needle", after: " = 1;" });
});
