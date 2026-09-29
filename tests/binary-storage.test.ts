import assert from "node:assert/strict";
import { test } from "node:test";
import { indexedDB, IDBKeyRange, IDBCursor, IDBObjectStore } from "fake-indexeddb";
import {
  binaryBody,
  dataBlob,
  dataBuffer,
  dataFingerprint,
  portableData,
  sameData,
  migrateData,
} from "../src/lib/workspace/binary.ts";
import { importDocumentFile } from "../src/lib/markdown/document-utils.ts";
import {
  persistence,
  newWorkspaceRecord,
  parseWorkspaceImport,
  serializeWorkspace,
} from "../src/lib/workspace/persistence.ts";
import { parseSharedFiles, serializeSharedFiles } from "../src/lib/workspace/share.ts";
import { storedFileBytes } from "../src/lib/workspace/storage-limits.ts";
import { mergeWorkspaces } from "../src/lib/workspace/merge.ts";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

test("binary imports retain exact bytes and MIME without reading/base64 encoding", async () => {
  const bytes = new Uint8Array([0, 255, 128, 10]);
  const file = new File([bytes], "scan.pdf", { type: "application/pdf" });
  file.arrayBuffer = async () => {
    throw new Error("Import must retain the Blob");
  };
  const imported = await importDocumentFile(file);
  assert.equal(imported.content, "");
  assert.equal(typeof imported.data, "object");
  assert.equal(dataBlob(imported.data)!.type, "application/pdf");
  assert.deepEqual(new Uint8Array((await dataBuffer(imported.data))!), bytes);
  assert.equal(storedFileBytes(imported), bytes.length);
  const csv = await importDocumentFile(
    new File(["\ufeffa,b\r\n1,2"], "bom.csv", { type: "text/csv" }),
  );
  assert.equal(await dataBlob(csv.data)!.text(), "a,b\r\n1,2");
  assert.deepEqual(
    new Uint8Array((await dataBuffer(csv.data))!),
    new TextEncoder().encode("\ufeffa,b\r\n1,2"),
  );
});

test("legacy decoding and portable encoding preserve chunk boundaries and padding", async () => {
  for (const length of [0, 1, 2, 3, 24575, 24576, 24577, 32769, 65537]) {
    const bytes = Uint8Array.from({ length }, (_, i) => i % 256);
    const expected = `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
    const body = binaryBody(new Blob([bytes], { type: "application/pdf" }));
    assert.equal(await portableData(body), expected);
    assert.deepEqual(new Uint8Array((await dataBuffer(expected))!), bytes);
    assert.equal(await dataFingerprint(body), await dataFingerprint(expected));
    assert.ok(sameData(body, structuredClone(body)));
    assert.ok(!sameData(body, binaryBody(body.blob)));
  }
  assert.deepEqual(
    new Uint8Array((await dataBuffer("data:application/octet-stream,%FF%00%C3%A9"))!),
    new Uint8Array([255, 0, 195, 169]),
  );
  assert.equal(migrateData("unreadable historical bytes"), "unreadable historical bytes");
});

test("v2 migration, incremental Blob writes, rollback, backup and sharing", async (t) => {
  const workspace = newWorkspaceRecord("Binary migration");
  const legacyData = "data:application/pdf;base64,AP+A";
  workspace.files = [
    { id: "pdf", name: "scan.pdf", content: "", data: legacyData, kind: "pdf", deletedAt: 123 },
  ];
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("localdox", 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      const { files, ...metadata } = workspace;
      db.createObjectStore("workspaces", { keyPath: "id" }).put({
        ...metadata,
        fileIds: ["pdf"],
        revision: "legacy",
      });
      const store = db.createObjectStore("files", { keyPath: ["workspaceId", "id"] });
      store.createIndex("workspaceId", "workspaceId");
      store.put({ ...files[0], workspaceId: workspace.id });
      db.createObjectStore("workspace-summaries", { keyPath: "id" }).put({
        id: workspace.id,
        name: workspace.name,
        docCount: 1,
        bytes: legacyData.length,
      });
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });

  await t.test("an aborted upgrade leaves v2 and its binary intact", async () => {
    const update = IDBCursor.prototype.update;
    IDBCursor.prototype.update = function (value) {
      const req = update.call(this, value);
      req.addEventListener("success", () => (this.source as IDBObjectStore).transaction.abort());
      return req;
    };
    try {
      await assert.rejects(persistence.getWorkspace(workspace.id));
    } finally {
      IDBCursor.prototype.update = update;
    }
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("localdox");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        assert.equal(db.version, 2);
        const tx = db.transaction("files");
        const row = tx.objectStore("files").get([workspace.id, "pdf"]);
        tx.oncomplete = () => {
          assert.equal(row.result.data, legacyData);
          db.close();
          resolve();
        };
      };
    });
  });

  await t.test(
    "retry keeps IDs, revision, Bin and exact bytes; summaries use Blob size",
    async () => {
      const loaded = (await persistence.getWorkspace(workspace.id))!;
      assert.equal(loaded.revision, "legacy");
      assert.equal(loaded.files[0].deletedAt, 123);
      assert.equal(typeof loaded.files[0].data, "object");
      assert.equal(await portableData(loaded.files[0].data), legacyData);
      assert.equal((await persistence.storedBytesByWorkspace()).get(workspace.id), 3);
    },
  );

  await t.test("fresh structured clones and UI-only saves cause zero payload puts", async () => {
    const writes: string[] = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === "files") writes.push(value.id);
      return put.call(this, value, ...args);
    };
    try {
      const first = (await persistence.getWorkspace(workspace.id))!;
      first.ui.sidebarCollapsed = true;
      await persistence.putWorkspace(first); // Warm the comparison snapshot.
      writes.length = 0;
      const fresh = (await persistence.getWorkspace(workspace.id))!;
      assert.notEqual(fresh.files[0].data, first.files[0].data);
      assert.ok(sameData(fresh.files[0].data, first.files[0].data));
      fresh.ui.scrollTop = 42;
      await persistence.putWorkspace(fresh);
      assert.deepEqual(writes, []);
      fresh.files[0] = { ...fresh.files[0], data: binaryBody(new Blob(["edited"])) };
      await persistence.putWorkspace(fresh);
      assert.deepEqual(writes, ["pdf"]);
      assert.equal(
        await dataBlob((await persistence.getWorkspace(workspace.id))!.files[0].data)!.text(),
        "edited",
      );
    } finally {
      IDBObjectStore.prototype.put = put;
    }
  });

  await t.test("cross-tab merges use stable binary IDs and detect competing edits", async () => {
    const base = (await persistence.getWorkspace(workspace.id))!;
    const mine = structuredClone(base);
    const theirs = structuredClone(base);
    mine.files[0].name = "renamed.pdf";
    theirs.ui.scrollTop = 55;
    assert.equal(mergeWorkspaces(base, mine, theirs)!.files[0].name, "renamed.pdf");
    mine.files[0].data = binaryBody(new Blob(["mine"]));
    theirs.files[0].data = binaryBody(new Blob(["theirs"]));
    assert.equal(mergeWorkspaces(base, mine, theirs), null);
  });

  await t.test("aborted binary transactions leave bodies and summaries unchanged", async () => {
    const before = (await persistence.getWorkspace(workspace.id))!;
    const summary = await persistence.listWorkspaceSummaries();
    const changed = structuredClone(before);
    changed.files[0].data = binaryBody(new Blob(["must roll back"]));
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      const req = put.call(this, value, ...args);
      if (this.name === "workspace-summaries")
        req.addEventListener("success", () => this.transaction.abort());
      return req;
    };
    try {
      await assert.rejects(persistence.putWorkspace(changed));
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    const after = (await persistence.getWorkspace(workspace.id))!;
    assert.equal(after.revision, before.revision);
    assert.ok(sameData(after.files[0].data, before.files[0].data));
    assert.deepEqual(await persistence.listWorkspaceSummaries(), summary);
  });

  await t.test("normalization cannot replace a newer edit during the pending commit", async () => {
    const loaded = (await persistence.getWorkspace(workspace.id))!;
    loaded.files[0].data = legacyData;
    const edit = "data:application/pdf;base64,bmV3";
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      const req = put.call(this, value, ...args);
      if (this.name === "workspace-summaries")
        req.addEventListener("success", () => {
          loaded.files[0].data = edit;
        });
      return req;
    };
    try {
      await persistence.putWorkspace(loaded);
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    assert.equal(loaded.files[0].data, edit);
    assert.equal(
      await portableData((await persistence.getWorkspace(workspace.id))!.files[0].data),
      legacyData,
    );
    await persistence.putWorkspace(loaded);
    assert.equal(
      await portableData((await persistence.getWorkspace(workspace.id))!.files[0].data),
      edit,
    );
  });

  await t.test("backup clear/import/reload and shared files retain Blob bytes", async () => {
    const loaded = (await persistence.getWorkspace(workspace.id))!;
    const json = await serializeWorkspace(loaded);
    assert.equal(typeof JSON.parse(json).workspace.files[0].data, "string");
    const expected = await portableData(loaded.files[0].data);
    const shared = parseSharedFiles(await serializeSharedFiles(loaded.files, "Sender"));
    assert.equal(typeof shared.files[0].data, "object");
    assert.equal(await portableData(shared.files[0].data), expected);
    await persistence.destroy();
    const restored = parseWorkspaceImport(json);
    await persistence.putWorkspace(restored);
    assert.equal(
      await portableData((await persistence.getWorkspace(restored.id))!.files[0].data),
      expected,
    );
    assert.equal(restored.files[0].deletedAt, 123);
    await persistence.destroy();
  });
});
