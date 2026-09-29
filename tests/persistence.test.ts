import assert from "node:assert/strict";
import { test } from "node:test";
import { indexedDB, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import {
  persistence,
  newWorkspaceRecord,
  WorkspaceConflictError,
} from "../src/lib/workspace/persistence.ts";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

test("workspace storage migration, incremental writes and transaction safety", async (t) => {
  const legacy = newWorkspaceRecord("Legacy workspace");
  legacy.files = [
    { id: "text", name: "notes.md", content: "# Notes\nOriginal text", deletedAt: 123 },
    {
      id: "binary",
      name: "image.png",
      content: "",
      data: "data:image/png;base64," + "a".repeat(2_000_000),
    },
  ];
  legacy.ui.fileOrder = ["binary", "text"];
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("localdox", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("workspaces", { keyPath: "id" }).put(legacy);
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });

  await t.test("aborted migration preserves the v1 database and can be retried", async () => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      const req = original.call(this, value, ...args);
      if (this.name === "workspace-summaries" && this.transaction.mode === "versionchange") {
        req.addEventListener("success", () => this.transaction.abort());
      }
      return req;
    };
    try {
      await assert.rejects(persistence.getWorkspace(legacy.id));
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("localdox");
      req.onsuccess = () => {
        const db = req.result;
        assert.equal(db.version, 1);
        assert.deepEqual([...db.objectStoreNames], ["workspaces"]);
        const tx = db.transaction("workspaces");
        const record = tx.objectStore("workspaces").get(legacy.id);
        tx.oncomplete = () => {
          assert.deepEqual(record.result, legacy);
          db.close();
          resolve();
        };
      };
      req.onerror = () => reject(req.error);
    });
  });

  await t.test("v1 upgrade preserves file bytes, order, bin state and UI", async () => {
    const { revision, ...upgraded } = (await persistence.getWorkspace(legacy.id))!;
    assert.equal(typeof revision, "string");
    assert.deepEqual(upgraded, legacy);
    const [summary] = await persistence.listWorkspaceSummaries();
    assert.equal(summary.docCount, 2);
    assert.equal("files" in summary, false);
    assert.ok(JSON.stringify(summary).length < 250);
  });

  await t.test("UI-only saves clone zero file bytes; edits write only one file", async () => {
    let workspace = (await persistence.getWorkspace(legacy.id))!;
    const writes: { id: string; bytes: number }[] = [];
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === "files") writes.push({ id: value.id, bytes: JSON.stringify(value).length });
      return original.call(this, value, ...args);
    };
    try {
      workspace = { ...workspace, ui: { ...workspace.ui, sidebarCollapsed: true } };
      await persistence.putWorkspace(workspace);
      assert.deepEqual(writes, []);
      workspace.files[0] = { ...workspace.files[0], content: "Updated text" };
      await persistence.putWorkspace(workspace);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].id, "text");
      assert.ok(writes[0].bytes < 200);
      assert.deepEqual(await persistence.getWorkspace(legacy.id), workspace);
    } finally {
      IDBObjectStore.prototype.put = original;
    }
  });

  await t.test("in-place caller edits do not mutate the saved comparison snapshot", async () => {
    const workspace = (await persistence.getWorkspace(legacy.id))!;
    workspace.files[0].name = "renamed.md";
    await persistence.putWorkspace(workspace);
    assert.equal((await persistence.getWorkspace(legacy.id))!.files[0].name, "renamed.md");
  });

  await t.test("an abort after request success rejects and rolls back every store", async () => {
    const before = (await persistence.getWorkspace(legacy.id))!;
    const beforeSummary = await persistence.listWorkspaceSummaries();
    const changed = {
      ...before,
      name: "Must not persist",
      files: [{ ...before.files[0], content: "Must roll back" }],
    };
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      const req = original.call(this, value, ...args);
      if (this.name === "workspace-summaries")
        req.addEventListener("success", () => this.transaction.abort());
      return req;
    };
    try {
      await assert.rejects(persistence.putWorkspace(changed));
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    assert.deepEqual(await persistence.getWorkspace(legacy.id), before);
    assert.deepEqual(await persistence.listWorkspaceSummaries(), beforeSummary);
    await persistence.putWorkspace(changed);
    assert.deepEqual(await persistence.getWorkspace(legacy.id), changed);
  });

  await t.test("overlapping saves from one snapshot: the second is refused, not merged", async () => {
    const workspace = (await persistence.getWorkspace(legacy.id))!;
    const first = { ...workspace, files: [{ ...workspace.files[0], content: "first" }] };
    const second = { ...workspace, files: [{ ...workspace.files[0], content: "second" }] };
    const results = await Promise.allSettled([
      persistence.putWorkspace(first),
      persistence.putWorkspace(second),
    ]);
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "rejected");
    assert.equal((await persistence.getWorkspace(legacy.id))!.files[0].content, "first");
  });

  await t.test("serial saves apply in order and each checks the previous commit", async () => {
    const workspace = (await persistence.getWorkspace(legacy.id))!;
    const writes = ["one", "two", "three"].map((content) =>
      persistence.serial(async () => {
        workspace.files = [{ ...workspace.files[0], content }];
        await persistence.putWorkspace(workspace);
      }),
    );
    await Promise.all(writes);
    assert.equal((await persistence.getWorkspace(legacy.id))!.files[0].content, "three");
  });

  await t.test("a different tab's revision refuses the write and keeps its data", async () => {
    const workspace = (await persistence.getWorkspace(legacy.id))!;
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("localdox");
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction(["workspaces", "files"], "readwrite");
      const req = tx.objectStore("workspaces").get(workspace.id);
      req.onsuccess = () =>
        tx.objectStore("workspaces").put({ ...req.result, revision: "other-tab" });
      tx.objectStore("files").put({
        ...workspace.files[0],
        workspaceId: workspace.id,
        content: "other tab",
      });
      tx.oncomplete = () => resolve();
    });
    db.close();
    await assert.rejects(
      persistence.putWorkspace(workspace),
      (error: Error) => error instanceof WorkspaceConflictError && error.reason === "changed",
    );
    const stored = (await persistence.getWorkspace(workspace.id))!;
    assert.equal(stored.revision, "other-tab");
    assert.equal(stored.files[0].content, "other tab");
    // Re-reading and writing again succeeds, and invalidates the file cache:
    // the other tab's file row is overwritten with this snapshot's content.
    stored.files[0] = { ...stored.files[0], content: "merged" };
    await persistence.putWorkspace(stored);
    assert.equal((await persistence.getWorkspace(workspace.id))!.files[0].content, "merged");
  });

  await t.test("creating over an existing id is refused", async () => {
    const existing = (await persistence.getWorkspace(legacy.id))!;
    const { revision: _r, ...fresh } = existing;
    await assert.rejects(
      persistence.putWorkspace({ ...fresh, files: [] }),
      (error: Error) => error instanceof WorkspaceConflictError && error.reason === "exists",
    );
    assert.deepEqual(await persistence.getWorkspace(legacy.id), existing);
  });

  await t.test("rename touches metadata only and bumps the revision", async () => {
    const before = (await persistence.getWorkspace(legacy.id))!;
    const writes: string[] = [];
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      writes.push(this.name);
      return original.call(this, value, ...args);
    };
    try {
      await persistence.renameWorkspace(legacy.id, "Renamed", before.revision);
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    assert.equal(writes.includes("files"), false);
    const after = (await persistence.getWorkspace(legacy.id))!;
    assert.equal(after.name, "Renamed");
    assert.notEqual(after.revision, before.revision);
    assert.equal((await persistence.listWorkspaceSummaries())[0].name, "Renamed");
    await assert.rejects(persistence.putWorkspace(before), WorkspaceConflictError);
    await assert.rejects(
      persistence.renameWorkspace(legacy.id, "Stale", before.revision),
      WorkspaceConflictError,
    );
  });

  await t.test(
    "file ids are scoped to workspaces and deletes remove only their own files",
    async () => {
      const second = newWorkspaceRecord("Second");
      second.files = [{ id: "text", name: "second.md", content: "Independent" }];
      await persistence.putWorkspace(second);
      await persistence.deleteWorkspace(legacy.id);
      assert.equal(await persistence.getWorkspace(legacy.id), undefined);
      assert.deepEqual(await persistence.getWorkspace(second.id), second);
      assert.equal((await persistence.listWorkspaceSummaries()).length, 1);
      await persistence.clearAll();
      assert.deepEqual(await persistence.listWorkspaceSummaries(), []);
      assert.equal(await persistence.getWorkspace(second.id), undefined);
    },
  );

  await persistence.destroy();
});
