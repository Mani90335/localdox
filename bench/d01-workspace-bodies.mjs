// D01 A/B: an open workspace with a note + 5 MB image, another holding 4 × 25 MB
// PDFs (≈133 MB stored as base64). Seeds the v2 layout (what HEAD writes), so
// the new build's first open includes its v2 → v3 migration.
//
// Serve each build's .output with its own Nitro server (vite preview
// compresses per request and skews timing), e.g.
//   (cd <old>/.output && PORT=4751 HOST=127.0.0.1 node server/index.mjs)
//   (cd <new>/.output && PORT=4752 HOST=127.0.0.1 node server/index.mjs)
//   ROUNDS=5 node bench/d01-workspace-bodies.mjs
// See documentation/workspace-storage-layout.md.
import { chromium } from "@playwright/test";

const builds = {
  before: process.env.BEFORE_URL ?? "http://127.0.0.1:4751",
  after: process.env.AFTER_URL ?? "http://127.0.0.1:4752",
};
const ROUNDS = Number(process.env.ROUNDS ?? 3);

async function run(label, origin) {
  const browser = await chromium.launch({ args: ["--enable-precise-memory-info"] });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route(origin + "/seed", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>seed</title>" }),
  );
  await page.goto(origin + "/seed");
  await page.evaluate(async () => {
    const now = Date.now();
    const ui = (active) => ({ activeFileId: active, expanded: {}, sidebarCollapsed: false, scrollTop: 0 });
    const base = { createdAt: now, updatedAt: now, bookmarks: [], highlights: [], saved: [], folders: [] };
    const filler = "Plain paragraph text for the open note. ".repeat(250);
    const open = {
      ...base, id: "open", name: "Open", ui: ui("note"),
      files: [
        { id: "note", name: "note.md", kind: "markdown", content: "# Topic A\n\n" + filler },
        { id: "photo", name: "photo.png", kind: "image", mimeType: "image/png", content: "",
          data: "data:image/png;base64," + "iVBO".repeat(5 * 1024 * 1024 / 3) },
      ],
    };
    const library = {
      ...base, id: "library", name: "Library", ui: ui("readme"),
      files: [
        { id: "readme", name: "readme.md", kind: "markdown", content: "# Library\n\nzebraword lives here" },
        ...[1, 2, 3, 4].map((n) => ({
          id: "pdf" + n, name: `scan-${n}.pdf`, kind: "pdf", mimeType: "application/pdf", content: "",
          data: "data:application/pdf;base64," + ("JVBE" + n).repeat(25 * 1024 * 1024 / 3.75),
        })),
      ],
    };
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("localdox", 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("workspaces", { keyPath: "id" });
        db.createObjectStore("files", { keyPath: ["workspaceId", "id"] }).createIndex("workspaceId", "workspaceId");
        db.createObjectStore("workspace-summaries", { keyPath: "id" });
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["workspaces", "files", "workspace-summaries"], "readwrite");
        for (const w of [open, library]) {
          const { files, ...meta } = w;
          tx.objectStore("workspaces").put({ ...meta, fileIds: files.map((f) => f.id), revision: crypto.randomUUID() });
          for (const f of files) tx.objectStore("files").put({ ...f, workspaceId: w.id });
          let bytes = 0;
          for (const f of files) bytes += new TextEncoder().encode(f.content).byteLength + (f.data?.length ?? 0);
          tx.objectStore("workspace-summaries").put({ id: w.id, name: w.name, createdAt: now, updatedAt: now, docCount: files.length, bytes });
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => reject(tx.error);
      };
    });
    localStorage.setItem("localdox:prefs", JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false, lastWorkspaceId: "open" }));
  });

  const heading = page.getByRole("heading", { name: "Topic A", exact: true });
  let start = Date.now();
  await page.goto(origin + "/");
  await heading.waitFor({ timeout: 120_000 });
  const firstOpenMs = Date.now() - start;
  start = Date.now();
  await page.reload();
  await heading.waitFor({ timeout: 120_000 });
  const reopenMs = Date.now() - start;
  await page.waitForTimeout(1500);

  // Watch IndexedDB reads and writes from here on.
  await page.evaluate(() => {
    const w = window;
    w.bench = { largestRead: 0, readBytes: 0, putBytes: 0 };
    const size = (v) => (v == null ? 0 : JSON.stringify(v).length);
    for (const proto of [IDBObjectStore.prototype, IDBIndex.prototype])
      for (const method of ["get", "getAll", "openCursor"]) {
        const original = proto[method];
        proto[method] = function (...args) {
          const req = original.apply(this, args);
          req.addEventListener("success", () => {
            const n = size(req.result instanceof IDBCursorWithValue ? req.result.value : req.result);
            w.bench.readBytes += n;
            w.bench.largestRead = Math.max(w.bench.largestRead, n);
          });
          return req;
        };
      }
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      w.bench.putBytes += size(value);
      return put.call(this, value, ...args);
    };
  });
  const heapBefore = await page.evaluate(() => performance.memory.usedJSHeapSize);
  await page.locator("button:visible").filter({ has: page.locator("svg.lucide-search") }).first().click();
  await page.getByPlaceholder("Search all documents...").fill("zebraword");
  start = Date.now();
  await page.getByRole("checkbox", { name: "Search all workspaces" }).setChecked(true);
  await page.locator("aside").getByRole("button", { name: /^readme\.md/ }).waitFor({ timeout: 120_000 });
  const crossSearchMs = Date.now() - start;
  const heapAfter = await page.evaluate(() => performance.memory.usedJSHeapSize);
  const search = await page.evaluate(() => ({ ...window.bench }));

  // The open workspace's next save, after that search: a rename of note.md.
  await page.evaluate(() => (window.bench.putBytes = 0));
  await page.getByRole("button", { name: "Close search" }).click();
  await page.getByRole("button", { name: "Options", exact: true }).first().click();
  await page.getByText("Edit", { exact: true }).click();
  await page.getByRole("textbox", { name: "Document name" }).fill("renamed.md");
  await page.getByRole("textbox", { name: "Document name" }).press("Enter");
  await page.waitForTimeout(2500);
  const savePutBytes = await page.evaluate(() => window.bench.putBytes);
  await browser.close();
  return {
    label, firstOpenMs, reopenMs, crossSearchMs,
    searchLargestReadMB: +(search.largestRead / 1e6).toFixed(2),
    searchReadMB: +(search.readBytes / 1e6).toFixed(2),
    searchHeapDeltaMB: +((heapAfter - heapBefore) / 1e6).toFixed(1),
    nextSavePutMB: +(savePutBytes / 1e6).toFixed(2),
  };
}

const rows = [];
for (let i = 0; i < ROUNDS; i++)
  for (const [label, origin] of i % 2 ? Object.entries(builds).reverse() : Object.entries(builds))
    rows.push(await run(label, origin));
console.table(rows);
console.log(JSON.stringify(rows));
