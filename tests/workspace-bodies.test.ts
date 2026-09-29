import assert from "node:assert/strict";
import { test } from "node:test";
import { indexedDB, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import {
  persistence,
  newWorkspaceRecord,
  type PersistedFile,
  type WorkspaceRecord,
} from "../src/lib/workspace/persistence.ts";
import { storedBytes } from "../src/lib/workspace/storage-limits.ts";
import { resolveWorkspaceArtifact } from "../src/lib/workspace/workspace-artifacts.ts";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

const BODIES = "file-bodies";
const png = (fill: string, length: number) => "data:image/png;base64," + fill.repeat(length);

function openRaw(version?: number) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("localdox", version);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Every row of one store, read outside the module under test. */
async function rawRows(store: string): Promise<Record<string, unknown>[]> {
  const db = await openRaw();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store);
      const all = tx.objectStore(store).getAll();
      tx.oncomplete = () => resolve(all.result);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Record which object stores each IndexedDB call touches while `run` runs. */
async function spyStores<T>(run: () => Promise<T>) {
  const methods = ["get", "getAll", "openCursor", "put", "delete"] as const;
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
const touches = (calls: { method: string; store: string }[], store: string, method?: string) =>
  calls.filter((call) => call.store === store && (!method || call.method === method)).length;

test("v2 → v3 moves each binary body out of its file row and changes no workspace", async (t) => {
  const workspace = newWorkspaceRecord("Stored before bodies were split");
  workspace.files = [
    { id: "note", name: "note.md", content: "# Note" },
    { id: "photo", name: "photo.png", content: "", data: png("p", 300_000), mimeType: "image/png" },
    { id: "old", name: "old.png", content: "", data: png("o", 10), deletedAt: 5 },
  ];
  const revision = "v2-revision";
  // The v2 layout, exactly as the previous build wrote it.
  const v2 = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("localdox", 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction!;
      db.createObjectStore("workspaces", { keyPath: "id" });
      db.createObjectStore("files", { keyPath: ["workspaceId", "id"] }).createIndex(
        "workspaceId",
        "workspaceId",
      );
      db.createObjectStore("workspace-summaries", { keyPath: "id" });
      const { files, ...metadata } = workspace;
      tx.objectStore("workspaces").put({
        ...metadata,
        fileIds: files.map((f) => f.id),
        revision,
      });
      for (const file of files) tx.objectStore("files").put({ ...file, workspaceId: workspace.id });
      tx.objectStore("workspace-summaries").put({
        id: workspace.id,
        name: workspace.name,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        docCount: files.length,
        bytes: storedBytes(files),
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  v2.close();

  await t.test("an aborted upgrade leaves the v2 rows, bodies included, as they were", async () => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      const req = original.call(this, value, ...args);
      if (this.name === BODIES) req.addEventListener("success", () => this.transaction.abort());
      return req;
    };
    try {
      await assert.rejects(persistence.getWorkspace(workspace.id));
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    const db = await openRaw();
    assert.equal(db.version, 2);
    assert.equal(db.objectStoreNames.contains(BODIES), false);
    db.close();
    const rows = await rawRows("files");
    assert.equal(rows.find((row) => row.id === "photo")?.data, workspace.files[1].data);
  });

  await t.test("the upgraded workspace reads back identical", async () => {
    assert.deepEqual(await persistence.getWorkspace(workspace.id), { ...workspace, revision });
  });

  await t.test("file rows no longer carry bodies; the body store holds them", async () => {
    const rows = await rawRows("files");
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => !("data" in row)));
    const bodies = await rawRows(BODIES);
    assert.deepEqual(bodies.map((body) => body.id).sort(), ["old", "photo"]);
    assert.equal(bodies.find((body) => body.id === "photo")?.data, workspace.files[1].data);
  });

  await persistence.destroy();
});

test("body-free reads, one-file reads and body writes", async (t) => {
  const open = newWorkspaceRecord("Open");
  open.files = [
    { id: "note", name: "note.md", content: "# Open note" },
    { id: "scan", name: "scan.png", content: "", data: png("s", 500_000), mimeType: "image/png" },
  ];
  const other = newWorkspaceRecord("Library");
  other.folders = [{ id: "media", name: "Media", createdAt: 0 }];
  other.files = [
    { id: "text", name: "chapter.md", content: "Searchable words", folderId: "media" },
    { id: "a", name: "a.png", content: "", data: png("a", 1_000_000), folderId: "media" },
    { id: "b", name: "b.png", content: "", data: png("b", 1_000_000), folderId: "media" },
    { id: "gone", name: "gone.png", content: "", data: png("g", 10), deletedAt: 1 },
  ];
  await persistence.putWorkspace(other);
  await persistence.putWorkspace(open);

  await t.test("entries carry names, folders and text, and never read a body", async () => {
    const { result, calls } = await spyStores(() => persistence.getWorkspaceEntries(other.id));
    assert.equal(touches(calls, BODIES), 0);
    assert.equal(result?.revision, other.revision);
    assert.deepEqual(result?.folders, other.folders);
    assert.deepEqual(
      result?.files,
      other.files.map(({ data: _data, ...entry }) => entry),
    );
    assert.equal(await persistence.getWorkspaceEntries("missing"), undefined);
  });

  await t.test(
    "reading another workspace's entries keeps the open one's saves incremental",
    async () => {
      const working = (await persistence.getWorkspace(open.id))!;
      await persistence.getWorkspaceEntries(other.id);
      working.files[0] = { ...working.files[0], content: "# Edited" };
      const { calls } = await spyStores(() => persistence.putWorkspace(working));
      assert.equal(touches(calls, "files", "put"), 1);
      assert.equal(touches(calls, BODIES, "put"), 0);
      Object.assign(open, working);
    },
  );

  await t.test("renaming, filing or binning a binary rewrites its row, not its body", async () => {
    const working = (await persistence.getWorkspace(open.id))!;
    working.files[1] = { ...working.files[1], name: "renamed.png", deletedAt: 9 };
    const { calls } = await spyStores(() => persistence.putWorkspace(working));
    assert.equal(touches(calls, "files", "put"), 1);
    assert.equal(touches(calls, BODIES), 0);
    assert.deepEqual(await persistence.getWorkspace(open.id), working);
    Object.assign(open, working);
  });

  await t.test("a changed or removed body is written; a dropped file takes its body", async () => {
    const working = (await persistence.getWorkspace(open.id))!;
    const data = png("n", 20);
    working.files[1] = { ...working.files[1], data };
    await persistence.putWorkspace(working);
    assert.equal((await persistence.getFile(open.id, "scan"))?.data, data);
    const { data: _data, ...withoutBody } = working.files[1];
    working.files[1] = withoutBody;
    await persistence.putWorkspace(working);
    assert.deepEqual(await persistence.getFile(open.id, "scan"), withoutBody);
    working.files[1] = { ...withoutBody, data };
    await persistence.putWorkspace(working);
    working.files = [working.files[0]];
    await persistence.putWorkspace(working);
    const bodies = await rawRows(BODIES);
    assert.equal(
      bodies.some((body) => body.workspaceId === open.id),
      false,
    );
    Object.assign(open, working);
  });

  await t.test("getFile reads one file and its body", async () => {
    const { result, calls } = await spyStores(() => persistence.getFile(other.id, "a"));
    assert.deepEqual(result, other.files[1]);
    assert.equal(touches(calls, BODIES, "getAll"), 0);
    assert.equal(await persistence.getFile(other.id, "missing"), undefined);
  });

  await t.test("a link into another workspace reads only the linked file's body", async () => {
    const { result, calls } = await spyStores(() =>
      resolveWorkspaceArtifact("Library/Media/b.png", open.id, "", undefined, "Open", []),
    );
    assert.equal(result?.workspaceId, other.id);
    assert.equal(result?.file.data, other.files[2].data);
    assert.equal(touches(calls, BODIES, "getAll"), 0);
    assert.equal(touches(calls, BODIES, "get"), 1);
    // By stable id too, and a binned file stays unresolvable.
    const stable = await resolveWorkspaceArtifact(`@${other.id}/a`, open.id);
    assert.equal(stable?.file.data, other.files[1].data);
    assert.equal(await resolveWorkspaceArtifact(`@${other.id}/gone`, open.id), null);
  });

  await t.test("older summary rows are measured with their bodies", async () => {
    const db = await openRaw();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("workspace-summaries", "readwrite");
      const store = tx.objectStore("workspace-summaries");
      const row = store.get(other.id);
      row.onsuccess = () => {
        const { bytes: _bytes, ...legacy } = row.result;
        store.put(legacy);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    const totals = await persistence.storedBytesByWorkspace();
    assert.equal(totals.get(other.id), storedBytes(other.files));
  });

  await t.test("deleting a workspace or clearing storage removes its bodies", async () => {
    await persistence.deleteWorkspace(other.id);
    assert.equal((await rawRows(BODIES)).length, 0);
    assert.equal((await rawRows("files")).length, 1);
    const again: WorkspaceRecord = newWorkspaceRecord("Again");
    again.files = [{ id: "x", name: "x.png", content: "", data: png("x", 5) } as PersistedFile];
    await persistence.putWorkspace(again);
    assert.equal((await rawRows(BODIES)).length, 1);
    await persistence.clearAll();
    assert.equal((await rawRows(BODIES)).length, 0);
  });

  await persistence.destroy();
});
