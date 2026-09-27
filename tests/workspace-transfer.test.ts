// Moving documents and folders between workspaces.
//
// A workspace is a closed world — file ids, folder ids, stars and highlights
// only mean anything inside the record that holds them — so a move is a
// transplant, and the ways it can quietly lose data are what these cover:
// a folder's descendants left behind, an id collision overwriting a document
// that was already there, and annotations dropped because they live beside the
// files rather than inside them.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyToDestination,
  expandFolderIds,
  planTransfer,
  removeFromSource,
  transferCounts,
} from "../src/lib/workspace/workspace-transfer.ts";
import type { FolderRecord, PersistedFile, WorkspaceRecord } from "../src/lib/workspace/persistence.ts";
import { closeFileEverywhere } from "../src/lib/workspace/panes.ts";
import type { PaneLayout } from "../src/lib/workspace/panes.ts";

const file = (id: string, folderId: string | null = null): PersistedFile => ({
  id,
  name: `${id}.md`,
  content: `# ${id}`,
  folderId,
});

const folder = (id: string, parentId: string | null = null): FolderRecord => ({
  id,
  name: id,
  createdAt: 0,
  parentId,
});

const workspace = (over: Partial<WorkspaceRecord> = {}): WorkspaceRecord => ({
  id: "ws",
  name: "Workspace",
  createdAt: 0,
  updatedAt: 0,
  files: [],
  folders: [],
  bookmarks: [],
  saved: [],
  highlights: [],
  ui: {
    activeFileId: null,
    expanded: {},
    sidebarCollapsed: false,
    scrollTop: 0,
    fileOrder: [],
  },
  ...over,
});

// --- folder expansion ---

test("a selected folder brings its whole subtree", () => {
  const folders = [folder("a"), folder("b", "a"), folder("c", "b"), folder("other")];
  assert.deepEqual([...expandFolderIds(folders, ["a"])].sort(), ["a", "b", "c"]);
});

test("an unrelated folder is left alone", () => {
  const folders = [folder("a"), folder("b", "a"), folder("other")];
  assert.ok(!expandFolderIds(folders, ["a"]).has("other"));
});

test("a parent cycle terminates instead of hanging", () => {
  // Not reachable through the UI, but a corrupted record should not spin.
  const folders = [folder("a", "b"), folder("b", "a")];
  assert.deepEqual([...expandFolderIds(folders, ["a"])].sort(), ["a", "b"]);
});

// --- what moves ---

test("a file inside a selected folder moves with it, unselected", () => {
  const source = workspace({
    files: [file("f1", "a"), file("f2", "b"), file("outside")],
    folders: [folder("a"), folder("b", "a")],
  });
  const plan = planTransfer(source, workspace(), { fileIds: [], folderIds: ["a"] });
  assert.deepEqual(
    plan.files.map((f) => f.id).sort(),
    ["f1", "f2"],
    "a nested folder's documents must come too",
  );
  assert.ok(!plan.removeFileIds.has("outside"));
});

test("a file picked out of a folder that stays behind lands at the top level", () => {
  // Its folder is not coming, so the id it pointed at does not exist in the
  // destination; keeping it would file the document into nothing.
  const source = workspace({ files: [file("f1", "a")], folders: [folder("a")] });
  const plan = planTransfer(source, workspace(), { fileIds: ["f1"], folderIds: [] });
  assert.equal(plan.files[0].folderId, null);
  assert.equal(plan.folders.length, 0);
});

test("a moved subtree keeps its internal shape", () => {
  const source = workspace({
    files: [file("f1", "b")],
    folders: [folder("a"), folder("b", "a")],
  });
  const plan = planTransfer(source, workspace(), { fileIds: [], folderIds: ["a"] });
  const a = plan.folders.find((f) => f.name === "a")!;
  const b = plan.folders.find((f) => f.name === "b")!;
  assert.equal(a.parentId, null, "the picked folder lands at the destination root");
  assert.equal(b.parentId, a.id, "its child still points at it");
  assert.equal(plan.files[0].folderId, b.id);
});

test("a landing folder re-parents the whole selection under it", () => {
  const source = workspace({ files: [file("f1")], folders: [folder("a")] });
  const plan = planTransfer(source, workspace(), { fileIds: ["f1"], folderIds: ["a"] }, "dest-1");
  assert.equal(plan.files[0].folderId, "dest-1");
  assert.equal(plan.folders[0].parentId, "dest-1");
});

// --- id collisions ---

test("a colliding file id is reassigned rather than overwriting the destination", () => {
  const source = workspace({ files: [file("dup")] });
  const destination = workspace({ files: [file("dup")] });
  const plan = planTransfer(source, destination, { fileIds: ["dup"], folderIds: [] });
  assert.notEqual(plan.files[0].id, "dup");
  assert.equal(plan.renamedFileIds.get("dup"), plan.files[0].id);
  // The source still knows it by the original id, or it could not be removed.
  assert.ok(plan.removeFileIds.has("dup"));
});

test("a non-colliding id is kept, so a move and a move back is the same document", () => {
  const source = workspace({ files: [file("f1")] });
  const plan = planTransfer(source, workspace(), { fileIds: ["f1"], folderIds: [] });
  assert.equal(plan.files[0].id, "f1");
});

test("a colliding folder id is reassigned and its children follow the new id", () => {
  const source = workspace({
    files: [file("f1", "dup")],
    folders: [folder("dup"), folder("child", "dup")],
  });
  const destination = workspace({ folders: [folder("dup")] });
  const plan = planTransfer(source, destination, { fileIds: [], folderIds: ["dup"] });
  const moved = plan.folders.find((f) => f.name === "dup")!;
  assert.notEqual(moved.id, "dup");
  assert.equal(plan.folders.find((f) => f.name === "child")!.parentId, moved.id);
  assert.equal(plan.files[0].folderId, moved.id);
});

// --- annotations ---

test("stars and highlights travel with their document", () => {
  const source = workspace({
    files: [file("f1"), file("f2")],
    saved: [
      { id: "s1", fileId: "f1", kind: "file", title: "x", createdAt: 0 },
      { id: "s2", fileId: "f2", kind: "file", title: "y", createdAt: 0 },
    ],
    highlights: [{ id: "h1", fileId: "f1", text: "t", color: "yellow" }],
  });
  const plan = planTransfer(source, workspace(), { fileIds: ["f1"], folderIds: [] });
  assert.deepEqual(
    plan.saved.map((s) => s.id),
    ["s1"],
    "only the moved document's stars come across",
  );
  assert.equal(plan.highlights.length, 1);
});

test("annotations are rewritten when their file id is reassigned", () => {
  // The case that silently loses a reader's work: the file is renumbered to
  // dodge a collision and its stars keep pointing at an id that no longer
  // exists in either workspace.
  const source = workspace({
    files: [file("dup")],
    saved: [{ id: "s1", fileId: "dup", kind: "file", title: "x", createdAt: 0 }],
    highlights: [{ id: "h1", fileId: "dup", text: "t", color: "yellow" }],
  });
  const destination = workspace({ files: [file("dup")] });
  const plan = planTransfer(source, destination, { fileIds: ["dup"], folderIds: [] });
  const newId = plan.files[0].id;
  assert.equal(plan.saved[0].fileId, newId);
  assert.equal(plan.highlights[0].fileId, newId);
});

// --- applying ---

test("the destination keeps what it had and gains what moved", () => {
  const source = workspace({ files: [file("f1")] });
  const destination = workspace({ files: [file("existing")], ui: { ...workspace().ui, fileOrder: ["existing"] } });
  const plan = planTransfer(source, destination, { fileIds: ["f1"], folderIds: [] });
  const next = applyToDestination(destination, plan);
  assert.deepEqual(next.files.map((f) => f.id), ["existing", "f1"]);
  assert.deepEqual(next.ui.fileOrder, ["existing", "f1"], "moved files join the order");
});

test("the source loses exactly what moved, and its annotations with it", () => {
  const source = workspace({
    files: [file("f1", "a"), file("stays")],
    folders: [folder("a"), folder("keep")],
    saved: [
      { id: "s1", fileId: "f1", kind: "file", title: "x", createdAt: 0 },
      { id: "s2", fileId: "stays", kind: "file", title: "y", createdAt: 0 },
    ],
    highlights: [{ id: "h1", fileId: "f1", text: "t", color: "yellow" }],
  });
  const plan = planTransfer(source, workspace(), { fileIds: [], folderIds: ["a"] });
  const left = removeFromSource(source, plan);
  assert.deepEqual(left.files.map((f) => f.id), ["stays"]);
  assert.deepEqual(left.folders!.map((f) => f.id), ["keep"]);
  assert.deepEqual(left.saved!.map((s) => s.id), ["s2"], "the stayed file keeps its star");
  assert.equal(left.highlights!.length, 0);
});

test("an empty selection moves nothing", () => {
  const source = workspace({ files: [file("f1")] });
  const plan = planTransfer(source, workspace(), { fileIds: [], folderIds: [] });
  assert.deepEqual(transferCounts(plan), { files: 0, folders: 0, saved: 0, highlights: 0 });
  assert.deepEqual(removeFromSource(source, plan).files.map((f) => f.id), ["f1"]);
});

test("a file selected directly and via its folder is moved once", () => {
  const source = workspace({ files: [file("f1", "a")], folders: [folder("a")] });
  const plan = planTransfer(source, workspace(), { fileIds: ["f1"], folderIds: ["a"] });
  assert.equal(plan.files.length, 1);
});

// --- panes ---
//
// A moved document must stop being open here. A pane left holding a tab whose
// file no longer exists in this workspace paints an empty column the reader has
// no obvious way to close.

test("a moved document closes in every pane holding it", () => {
  const layout: PaneLayout = {
    panes: [
      { id: "p1", tabs: ["a", "gone"], activeTabId: "gone" },
      { id: "p2", tabs: ["gone", "b"], activeTabId: "b" },
    ],
    focusedPaneId: "p1",
  };
  const next = closeFileEverywhere(layout, ["gone"]);
  assert.ok(next.panes.every((pane) => !pane.tabs.includes("gone")));
  assert.equal(next.panes[0].activeTabId, "a", "the pane falls back to a surviving tab");
});

test("a pane emptied by the move collapses, and focus survives", () => {
  const layout: PaneLayout = {
    panes: [
      { id: "p1", tabs: ["stays"], activeTabId: "stays" },
      { id: "p2", tabs: ["gone"], activeTabId: "gone" },
    ],
    focusedPaneId: "p2",
  };
  const next = closeFileEverywhere(layout, ["gone"]);
  assert.equal(next.panes.length, 1);
  assert.equal(next.focusedPaneId, "p1", "focus cannot point at a pane that is gone");
});

test("moving everything leaves one empty pane rather than none", () => {
  const layout: PaneLayout = {
    panes: [{ id: "p1", tabs: ["a", "b"], activeTabId: "a" }],
    focusedPaneId: "p1",
  };
  const next = closeFileEverywhere(layout, ["a", "b"]);
  assert.equal(next.panes.length, 1);
  assert.equal(next.panes[0].activeTabId, null);
});

test("closing nothing returns the layout untouched", () => {
  const layout: PaneLayout = {
    panes: [{ id: "p1", tabs: ["a"], activeTabId: "a" }],
    focusedPaneId: "p1",
  };
  assert.equal(closeFileEverywhere(layout, []), layout);
});

test("counts describe what the reader is about to move", () => {
  const source = workspace({
    files: [file("f1", "a"), file("f2", "a")],
    folders: [folder("a"), folder("b", "a")],
    saved: [{ id: "s1", fileId: "f1", kind: "file", title: "x", createdAt: 0 }],
  });
  const plan = planTransfer(source, workspace(), { fileIds: [], folderIds: ["a"] });
  assert.deepEqual(transferCounts(plan), { files: 2, folders: 2, saved: 1, highlights: 0 });
});
