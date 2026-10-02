import assert from "node:assert/strict";
import { test } from "node:test";
import { indexedDB, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { binaryBody, portableData } from "../src/lib/workspace/binary.ts";
import { persistence, newWorkspaceRecord } from "../src/lib/workspace/persistence.ts";
import { resolveWorkspaceArtifact } from "../src/lib/workspace/workspace-artifacts.ts";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

const SPLIT = "file-bodies";
const png = (fill: string, length: number) => "data:image/png;base64," + fill.repeat(length);

function openRaw() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("localdox");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Record which object stores each put/get touches while `run` runs. */
async function spyStores<T>(run: () => Promise<T>) {
  const methods = ["get", "put"] as const;
  const calls: { method: string; store: string }[] = [];
  const originals = methods.map((method) => IDBObjectStore.prototype[method]);
  methods.forEach((method, index) => {
    const original = originals[index] as (...args: unknown[]) => unknown;
    (IDBObjectStore.prototype as unknown as Record<string, unknown>)[method] = function (
      this: IDBObjectStore,
      ...args: unknown[]
    ) {
      calls.push({ method, store: this.name });
      return original.apply(this, args);
    };
  });
  try {
    return { result: await run(), calls };
  } finally {
    methods.forEach((method, index) => {
      (IDBObjectStore.prototype as unknown as Record<string, unknown>)[method] = originals[index];
    });
  }
}
const count = (calls: { method: string; store: string }[], store: string, method: string) =>
  calls.filter((call) => call.store === store && call.method === method).length;

test("the interim split-body v3 folds its bodies back into file rows", async (t) => {
  const workspace = newWorkspaceRecord("Written by the split-body build");
  const photo = png("p", 3000);
  workspace.files = [
    { id: "note", name: "note.md", content: "# Note" },
    { id: "photo", name: "photo.png", content: "", mimeType: "image/png" },
  ];
  // That build's layout: rows without `data`, bodies in their own store.
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("localdox", 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      const { files, ...metadata } = workspace;
      db.createObjectStore("workspaces", { keyPath: "id" }).put({
        ...metadata,
        fileIds: files.map((f) => f.id),
        revision: "split",
      });
      const rows = db.createObjectStore("files", { keyPath: ["workspaceId", "id"] });
      rows.createIndex("workspaceId", "workspaceId");
      for (const file of files) rows.put({ ...file, workspaceId: workspace.id });
      db.createObjectStore(SPLIT, { keyPath: ["workspaceId", "id"] }).put({
        workspaceId: workspace.id,
        id: "photo",
        data: photo,
      });
      db.createObjectStore("workspace-summaries", { keyPath: "id" }).put({
        id: workspace.id,
        name: workspace.name,
        docCount: 2,
        bytes: 6 + photo.length,
      });
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });

  await t.test("an aborted fold leaves the split layout intact", async () => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      const req = original.call(this, value, ...args);
      if (this.name === "files") req.addEventListener("success", () => this.transaction.abort());
      return req;
    };
    try {
      await assert.rejects(persistence.getWorkspace(workspace.id));
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    const db = await openRaw();
    assert.equal(db.version, 3);
    assert.ok(db.objectStoreNames.contains(SPLIT));
    db.close();
  });

  await t.test("the retry restores every body as a Blob and drops the store", async () => {
    const loaded = (await persistence.getWorkspace(workspace.id))!;
    assert.equal(loaded.revision, "split");
    assert.equal(loaded.files[0].data, undefined);
    assert.equal(typeof loaded.files[1].data, "object");
    assert.equal(await portableData(loaded.files[1].data), photo);
    const db = await openRaw();
    assert.equal(db.version, 4);
    assert.equal(db.objectStoreNames.contains(SPLIT), false);
    db.close();
    // Totals are measured again, from Blob sizes: 3,000 base64 characters are 2,250 bytes.
    assert.equal((await persistence.storedBytesByWorkspace()).get(workspace.id), 6 + 2250);
  });

  await persistence.destroy();
});

test("a Blob-body v3 opens as v4 unchanged", async () => {
  const workspace = newWorkspaceRecord("Blob bodies");
  const body = binaryBody(new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }));
  workspace.files = [{ id: "pdf", name: "a.pdf", content: "", data: body }];
  await persistence.putWorkspace(workspace);
  await persistence.destroy().catch(() => undefined);
  // Recreate it as v3 as the Blob build wrote it, then open with this build.
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("localdox", 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      const { files, ...metadata } = workspace;
      db.createObjectStore("workspaces", { keyPath: "id" }).put({
        ...metadata,
        fileIds: ["pdf"],
        revision: "blob",
      });
      const rows = db.createObjectStore("files", { keyPath: ["workspaceId", "id"] });
      rows.createIndex("workspaceId", "workspaceId");
      rows.put({ ...files[0], workspaceId: workspace.id });
      db.createObjectStore("workspace-summaries", { keyPath: "id" });
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
  const loaded = (await persistence.getWorkspace(workspace.id))!;
  assert.equal(loaded.revision, "blob");
  assert.equal((loaded.files[0].data as typeof body).id, body.id);
  await persistence.destroy();
});

test("entries, one-file reads and the open workspace's write cache", async (t) => {
  const open = newWorkspaceRecord("Open");
  open.files = [
    { id: "note", name: "note.md", content: "# Open note" },
    { id: "scan", name: "scan.png", content: "", data: png("s", 5000), mimeType: "image/png" },
  ];
  const other = newWorkspaceRecord("Library");
  other.folders = [{ id: "media", name: "Media", createdAt: 0 }];
  other.files = [
    { id: "text", name: "chapter.md", content: "Searchable words", folderId: "media" },
    { id: "a", name: "a.png", content: "", data: png("a", 100), folderId: "media" },
    { id: "b", name: "b.png", content: "", data: png("b", 100), folderId: "media" },
    { id: "gone", name: "gone.png", content: "", data: png("g", 10), deletedAt: 1 },
  ];
  // A save replaces the caller's data URLs with Blob bodies; keep the originals.
  const urls = new Map(other.files.map((file) => [file.id, file.data]));
  const entries = other.files.map(({ data: _data, ...entry }) => entry);
  await persistence.putWorkspace(other);
  await persistence.putWorkspace(open);

  await t.test("entries carry names, folders and text, and no bodies", async () => {
    const read = (await persistence.getWorkspaceEntries(other.id))!;
    assert.equal(read.revision, other.revision);
    assert.deepEqual(read.folders, other.folders);
    assert.deepEqual(read.files, entries);
    assert.equal(await persistence.getWorkspaceEntries("missing"), undefined);
  });

  await t.test(
    "reading another workspace's entries keeps the open one's saves incremental",
    async () => {
      const working = (await persistence.getWorkspace(open.id))!;
      await persistence.getWorkspaceEntries(other.id);
      working.files[0] = { ...working.files[0], content: "# Edited" };
      const { calls } = await spyStores(() => persistence.putWorkspace(working));
      assert.equal(count(calls, "files", "put"), 1);
    },
  );

  await t.test("getFile reads one file with its body", async () => {
    const file = (await persistence.getFile(other.id, "a"))!;
    assert.equal(file.name, "a.png");
    assert.equal(await portableData(file.data), urls.get("a"));
    assert.equal(await persistence.getFile(other.id, "missing"), undefined);
  });

  await t.test("a link into another workspace reads exactly one file", async () => {
    const { result, calls } = await spyStores(() =>
      resolveWorkspaceArtifact("Library/Media/b.png", open.id, "", undefined, "Open", []),
    );
    assert.equal(result?.workspaceId, other.id);
    assert.equal(await portableData(result?.file.data), urls.get("b"));
    assert.equal(count(calls, "files", "get"), 1);
    const stable = await resolveWorkspaceArtifact(`@${other.id}/a`, open.id);
    assert.equal(await portableData(stable?.file.data), urls.get("a"));
    assert.equal(await resolveWorkspaceArtifact(`@${other.id}/gone`, open.id), null);
  });

  await persistence.destroy();
});
