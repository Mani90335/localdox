import assert from "node:assert/strict";
import { test } from "node:test";
import { indexedDB, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { applyToDestination, planTransfer, removeFromSource } from "../src/lib/workspace/workspace-transfer.ts";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

// Two independently imported module instances stand in for two browser tabs:
// each has its own caches and write queue, and they share only the database.
type Persistence = typeof import("../src/lib/workspace/persistence.ts");
const tabA: Persistence = await import("../src/lib/workspace/persistence.ts?tab=a");
const tabB: Persistence = await import("../src/lib/workspace/persistence.ts?tab=b");

test("a UI-only save in tab B cannot erase tab A's edit (A01)", async () => {
  const w = tabA.newWorkspaceRecord("Two tabs");
  w.files = [{ id: "note", name: "note.md", content: "original" }];
  await tabA.persistence.putWorkspace(w);

  const inA = (await tabA.persistence.getWorkspace(w.id))!;
  const inB = (await tabB.persistence.getWorkspace(w.id))!;
  inA.files[0] = { ...inA.files[0], content: "new edit from tab A" };
  await tabA.persistence.putWorkspace(inA);

  inB.ui = { ...inB.ui, sidebarCollapsed: true };
  await assert.rejects(
    tabB.persistence.putWorkspace(inB),
    (error: Error) => error instanceof tabB.WorkspaceConflictError && error.reason === "changed",
  );
  assert.equal(
    (await tabA.persistence.getWorkspace(w.id))!.files[0].content,
    "new edit from tab A",
  );

  // A background read in tab B (search, the attachment picker) must not
  // quietly "catch up" B's stale snapshot and let it through.
  await tabB.persistence.getWorkspace(w.id);
  await assert.rejects(tabB.persistence.putWorkspace(inB), tabB.WorkspaceConflictError);

  // Once B re-reads, its write is based on A's edit and succeeds.
  const fresh = (await tabB.persistence.getWorkspace(w.id))!;
  fresh.ui = { ...fresh.ui, sidebarCollapsed: true };
  await tabB.persistence.putWorkspace(fresh);
  const final = (await tabA.persistence.getWorkspace(w.id))!;
  assert.equal(final.files[0].content, "new edit from tab A");
  assert.equal(final.ui.sidebarCollapsed, true);
  await tabA.persistence.clearAll();
});

test("tab A deletes while tab B saves: the workspace is not resurrected", async () => {
  const w = tabA.newWorkspaceRecord("Doomed");
  w.files = [{ id: "note", name: "note.md", content: "text" }];
  await tabA.persistence.putWorkspace(w);
  const inB = (await tabB.persistence.getWorkspace(w.id))!;

  await tabA.persistence.deleteWorkspace(w.id);
  inB.files[0] = { ...inB.files[0], content: "late edit" };
  await assert.rejects(
    tabB.persistence.putWorkspace(inB),
    (error: Error) => error instanceof tabB.WorkspaceConflictError && error.reason === "deleted",
  );
  assert.equal(await tabA.persistence.getWorkspace(w.id), undefined);
  assert.deepEqual(await tabA.persistence.listWorkspaceSummaries(), []);

  // B still holds its snapshot and can deliberately keep it as a new workspace.
  const { revision: _gone, ...copy } = inB;
  await tabB.persistence.putWorkspace({ ...copy, id: crypto.randomUUID(), name: "Doomed (kept)" });
  assert.equal((await tabA.persistence.listWorkspaceSummaries()).length, 1);
  await tabA.persistence.clearAll();
});

test("other tabs are told about commits; the database check is still authoritative", async () => {
  const seen: string[] = [];
  const w = tabA.newWorkspaceRecord("Broadcast");
  const stop = tabB.persistence.subscribe((change) => {
    if ("id" in change && change.id === w.id) seen.push(change.type);
  });
  await tabA.persistence.putWorkspace(w);
  await tabA.persistence.deleteWorkspace(w.id);
  // BroadcastChannel delivery is asynchronous.
  for (let i = 0; i < 20 && seen.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
  stop();
  assert.deepEqual(seen, ["changed", "deleted"]);
});

test("a move commits both workspaces atomically or neither (D04)", async () => {
  const source = tabA.newWorkspaceRecord("Source");
  source.files = [
    { id: "keep", name: "keep.md", content: "stays" },
    { id: "move", name: "move.md", content: "travels" },
  ];
  source.saved = [{ id: "star", fileId: "move", kind: "file", title: "move.md", createdAt: 1 }];
  const destination = tabA.newWorkspaceRecord("Destination");
  await tabA.persistence.putWorkspace(source);
  await tabA.persistence.putWorkspace(destination);

  const plan = planTransfer(source, destination, { fileIds: ["move"], folderIds: [] });
  const nextSource = removeFromSource(source, plan);
  const nextDestination = applyToDestination(destination, plan);

  // Fail the transaction after the destination's rows are queued.
  const original = IDBObjectStore.prototype.put;
  let summaries = 0;
  IDBObjectStore.prototype.put = function (value, ...args) {
    const req = original.call(this, value, ...args);
    if (this.name === "workspace-summaries" && ++summaries === 2)
      req.addEventListener("success", () => this.transaction.abort());
    return req;
  };
  try {
    await assert.rejects(tabA.persistence.putWorkspaces([nextSource, nextDestination]));
  } finally {
    IDBObjectStore.prototype.put = original;
  }
  assert.deepEqual(
    (await tabA.persistence.getWorkspace(source.id))!.files.map((f) => f.id),
    ["keep", "move"],
  );
  assert.deepEqual((await tabA.persistence.getWorkspace(destination.id))!.files, []);

  // A stale revision on either side refuses the whole move.
  const staleDestination = { ...nextDestination, revision: "stale" };
  await assert.rejects(
    tabA.persistence.putWorkspaces([nextSource, staleDestination]),
    tabA.WorkspaceConflictError,
  );
  assert.equal((await tabA.persistence.getWorkspace(source.id))!.files.length, 2);

  await tabA.persistence.putWorkspaces([nextSource, nextDestination]);
  const after = {
    source: (await tabA.persistence.getWorkspace(source.id))!,
    destination: (await tabA.persistence.getWorkspace(destination.id))!,
  };
  assert.deepEqual(after.source.files.map((f) => f.id), ["keep"]);
  assert.deepEqual(after.source.saved, []);
  assert.deepEqual(after.destination.files.map((f) => f.name), ["move.md"]);
  assert.equal(after.destination.saved?.length, 1);
  // Both records now carry their committed revisions for the next write.
  assert.equal(nextSource.revision, after.source.revision);
  assert.equal(nextDestination.revision, after.destination.revision);
  await tabA.persistence.destroy();
});
