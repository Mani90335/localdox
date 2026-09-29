import assert from "node:assert/strict";
import { test } from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { persistence, newWorkspaceRecord } from "../src/lib/workspace/persistence.ts";
import {
  StorageLimitError,
  storedBytes,
  storedFileBytes,
  utf8Length,
} from "../src/lib/workspace/storage-limits.ts";
import { measureStoredBytes, reserveStorage } from "../src/lib/workspace/storage-budget.ts";
import { estimateStoredBytes } from "../src/lib/markdown/document-utils.ts";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

// A 20,000-byte quota makes the cap exactly 1,000 bytes.
let quota: number | undefined = 20_000;
Object.defineProperty(navigator, "storage", {
  configurable: true,
  value: { estimate: async () => ({ quota, usage: 999_999 }) },
});

const doc = (id: string, content: string, data?: string) => ({
  id,
  name: `${id}.md`,
  content,
  data,
});

async function summaryBytes(id: string) {
  return (await persistence.listWorkspaceSummaries()).find((s) => s.id === id)?.bytes;
}

async function clear() {
  await persistence.clearAll();
}

test("utf8Length counts UTF-8 bytes, lone surrogates as U+FFFD", () => {
  assert.equal(utf8Length(""), 0);
  assert.equal(utf8Length("plain"), 5);
  assert.equal(utf8Length("café"), 5);
  assert.equal(utf8Length("日本"), 6);
  assert.equal(utf8Length("😀"), 4);
  assert.equal(utf8Length("a\ud800b"), 5);
});

test("a document counts its text as UTF-8 and its binary as stored, never its size field", () => {
  const png = { content: "", data: "data:image/png;base64,QUJD", size: 3 };
  assert.equal(storedFileBytes(png), 26);
  // CSV keeps both its text and its original bytes.
  const csv = { content: "é,1", data: "data:text/csv;base64,w6ksMQ==", size: 4 };
  assert.equal(storedFileBytes(csv), 4 + csv.data.length);
  assert.equal(storedBytes([png, csv, { content: "", size: 10_000 }]), 26 + 4 + csv.data.length);
});

test("the pre-read estimate matches what importDocumentFile stores", () => {
  const bytes = new Uint8Array(1_000);
  const dataUrl = (type: string, n: number) =>
    `data:${type};base64,`.length + Buffer.from(new Uint8Array(n)).toString("base64").length;
  assert.equal(
    estimateStoredBytes(new File([bytes], "a.png", { type: "image/png" })),
    dataUrl("image/png", 1_000),
  );
  assert.equal(
    estimateStoredBytes(new File([bytes.subarray(0, 998)], "b.pdf", { type: "application/pdf" })),
    dataUrl("application/pdf", 998),
  );
  assert.equal(
    estimateStoredBytes(new File([bytes], "c.bin")),
    dataUrl("application/octet-stream", 1_000),
  );
  assert.equal(estimateStoredBytes(new File(["# hi"], "d.md", { type: "text/markdown" })), 4);
  assert.equal(
    estimateStoredBytes(new File(["a,b"], "e.csv", { type: "text/csv" })),
    3 + dataUrl("text/csv", 3),
  );
});

test("each commit keeps its workspace's stored total on the summary row", async () => {
  await clear();
  const ws = newWorkspaceRecord("Totals");
  ws.files = [doc("a", "héllo"), doc("b", "", "data:image/png;base64," + "A".repeat(400))];
  await persistence.putWorkspace(ws);
  assert.equal(await summaryBytes(ws.id), 6 + 422);

  // An edit re-measures only what changed; the total follows it.
  ws.files = [doc("a", "héllo wörld"), ws.files[1]];
  await persistence.putWorkspace(ws);
  assert.equal(await summaryBytes(ws.id), 13 + 422);

  // Removing a file (emptying the Bin) frees its bytes.
  ws.files = [ws.files[0]];
  await persistence.putWorkspace(ws);
  assert.equal(await summaryBytes(ws.id), 13);

  // Another tab's commit (no cached revision) is measured from scratch.
  const fresh = await persistence.getWorkspace(ws.id);
  fresh!.files.push(doc("c", "ccc"));
  await persistence.putWorkspace(fresh!);
  assert.equal(await summaryBytes(ws.id), 16);

  // A rename keeps the total.
  await persistence.renameWorkspace(ws.id, "Renamed");
  assert.equal(await summaryBytes(ws.id), 16);
});

test("summaries from older builds are measured once and written back", async () => {
  await clear();
  const ws = newWorkspaceRecord("Legacy");
  ws.files = [doc("a", "x".repeat(300)), doc("b", "", "data:;base64,AAAA")];
  await persistence.putWorkspace(ws);
  // What an older build left behind: a summary with no total.
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("localdox");
    req.onsuccess = () => {
      const tx = req.result.transaction("workspace-summaries", "readwrite");
      const store = tx.objectStore("workspace-summaries");
      const row = store.get(ws.id);
      row.onsuccess = () => {
        const { bytes: _bytes, ...rest } = row.result;
        store.put(rest);
      };
      tx.oncomplete = () => {
        req.result.close();
        resolve();
      };
      tx.onabort = () => reject(tx.error);
    };
  });
  assert.equal(await summaryBytes(ws.id), undefined);
  const totals = await persistence.storedBytesByWorkspace();
  assert.equal(totals.get(ws.id), 300 + 17);
  assert.equal(await summaryBytes(ws.id), 300 + 17);
});

test("usage counts every workspace, with the open one taken from memory", async () => {
  await clear();
  const saved = newWorkspaceRecord("Saved");
  saved.files = [doc("a", "a".repeat(300))];
  await persistence.putWorkspace(saved);
  const open = newWorkspaceRecord("Open");
  open.files = [doc("b", "b".repeat(200))];
  await persistence.putWorkspace(open);

  assert.equal(await measureStoredBytes(), 500);
  // Unsaved edits in the open workspace replace its saved total, not add to it.
  const editing = [doc("b", "b".repeat(250))];
  assert.equal(await measureStoredBytes(() => ({ id: open.id, files: editing })), 550);
  // A workspace not yet created counts its files on top.
  assert.equal(await measureStoredBytes(() => ({ id: null, files: editing })), 750);
});

test("a reservation refuses what doesn't fit and holds room for concurrent imports", async () => {
  await clear();
  const other = newWorkspaceRecord("Other");
  other.files = [doc("a", "a".repeat(300))];
  await persistence.putWorkspace(other);
  const files = [doc("b", "b".repeat(100))];
  const open = () => ({ id: "open", files });

  // 300 + 100 used: 600 fits, exactly.
  const first = await reserveStorage(600, open);
  // Held: a second import is checked against 1,000 already spoken for.
  const refused = await reserveStorage(1, open).catch((error) => error);
  assert.ok(refused instanceof StorageLimitError);
  assert.deepEqual([refused.needed, refused.used, refused.cap], [1, 1_000, 1_000]);
  assert.match(refused.message, /Not enough space\. This needs 1 B, and 0 B of the 1000 B/);

  // Shrinking to the parsed size always succeeds and frees the difference.
  await first.resize(500);
  const second = await reserveStorage(100, open);
  // Growing past the cap is refused, and gives the room back.
  await assert.rejects(first.resize(501), StorageLimitError);
  const third = await reserveStorage(500, open);
  second.release();
  third.release();
  third.release();
  (await reserveStorage(600, open)).release();

  // Nothing is enforced when the browser can't report a quota.
  quota = undefined;
  (await reserveStorage(1_000_000, open)).release();
  quota = 20_000;
});

test("a measurement that straddles a release is retaken", async () => {
  await clear();
  const original = persistence.storedBytesByWorkspace;
  const first = await reserveStorage(600);
  let calls = 0;
  let resolveStale!: (totals: Map<string, number>) => void;
  persistence.storedBytesByWorkspace = () => {
    calls++;
    // First read: taken before the import committed, so its bytes are in
    // neither storage nor (once released) the reservations.
    if (calls === 1) return new Promise((resolve) => (resolveStale = resolve));
    return Promise.resolve(new Map([["imported", 600]]));
  };
  try {
    const pending = reserveStorage(500).catch((error) => error);
    while (!resolveStale) await new Promise((resolve) => setImmediate(resolve));
    first.release();
    resolveStale(new Map());
    assert.ok((await pending) instanceof StorageLimitError);
    assert.equal(calls, 2);
  } finally {
    persistence.storedBytesByWorkspace = original;
  }
});
