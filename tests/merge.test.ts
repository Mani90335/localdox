import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeWorkspaces } from "../src/lib/workspace/merge.ts";
import { newWorkspaceRecord, type WorkspaceRecord } from "../src/lib/workspace/persistence.ts";

function base(): WorkspaceRecord {
  const w = newWorkspaceRecord("Shared");
  w.revision = "r1";
  w.files = [
    { id: "a", name: "a.md", content: "A" },
    { id: "b", name: "b.md", content: "B" },
  ];
  w.ui.fileOrder = ["a", "b"];
  w.saved = [{ id: "s1", fileId: "a", kind: "file", title: "a.md", createdAt: 1 }];
  return w;
}

const clone = (w: WorkspaceRecord): WorkspaceRecord => structuredClone(w);

test("view-only changes on both sides merge; this tab's view wins", () => {
  const b = base();
  const mine = clone(b);
  mine.ui.recentFileIds = ["b", "a"];
  const theirs = clone(b);
  theirs.revision = "r2";
  theirs.ui.sidebarCollapsed = true;
  theirs.ui.recentFileIds = ["a"];
  const merged = mergeWorkspaces(b, mine, theirs)!;
  assert.equal(merged.revision, "r2");
  assert.deepEqual(merged.ui.recentFileIds, ["b", "a"]);
  assert.equal(merged.files.length, 2);
});

test("edits to different files both survive", () => {
  const b = base();
  const mine = clone(b);
  mine.files[0].content = "A from this tab";
  const theirs = clone(b);
  theirs.files[1].content = "B from the other tab";
  const merged = mergeWorkspaces(b, mine, theirs)!;
  assert.deepEqual(
    merged.files.map((file) => file.content),
    ["A from this tab", "B from the other tab"],
  );
});

test("the same file changed differently on both sides is a conflict", () => {
  const b = base();
  const mine = clone(b);
  mine.files[0].content = "mine";
  const theirs = clone(b);
  theirs.files[0].content = "theirs";
  assert.equal(mergeWorkspaces(b, mine, theirs), null);
});

test("identical changes on both sides are not a conflict", () => {
  const b = base();
  const mine = clone(b);
  mine.files[0].content = "same";
  const theirs = clone(b);
  theirs.files[0].content = "same";
  assert.equal(mergeWorkspaces(b, mine, theirs)!.files[0].content, "same");
});

test("additions on either side are kept, in this tab's order then theirs", () => {
  const b = base();
  const mine = clone(b);
  mine.files.unshift({ id: "m", name: "mine.md", content: "M" });
  mine.ui.fileOrder = ["m", "a", "b"];
  const theirs = clone(b);
  theirs.files.push({ id: "t", name: "theirs.md", content: "T" });
  theirs.saved!.push({ id: "s2", fileId: "t", kind: "file", title: "theirs.md", createdAt: 2 });
  const merged = mergeWorkspaces(b, mine, theirs)!;
  assert.deepEqual(merged.files.map((f) => f.id), ["m", "a", "b", "t"]);
  assert.deepEqual(merged.ui.fileOrder, ["m", "a", "b", "t"]);
  assert.deepEqual(merged.saved!.map((s) => s.id), ["s1", "s2"]);
});

test("a delete merges when the other side left the record alone", () => {
  const b = base();
  const mine = clone(b);
  mine.files = mine.files.filter((f) => f.id !== "a");
  mine.saved = [];
  const theirs = clone(b);
  theirs.files[1].content = "B changed";
  const merged = mergeWorkspaces(b, mine, theirs)!;
  assert.deepEqual(merged.files.map((f) => f.id), ["b"]);
  assert.equal(merged.files[0].content, "B changed");
  assert.deepEqual(merged.saved, []);
});

test("deleted on one side and edited on the other is a conflict", () => {
  const b = base();
  const mine = clone(b);
  mine.files = mine.files.filter((f) => f.id !== "a");
  const theirs = clone(b);
  theirs.files[0].content = "edited";
  assert.equal(mergeWorkspaces(b, mine, theirs), null);
  assert.equal(mergeWorkspaces(b, theirs, mine), null);
});

test("stars and highlights pointing at a file deleted by the other tab are dropped", () => {
  const b = base();
  const mine = clone(b);
  mine.highlights = [{ id: "h", fileId: "b", text: "B", color: "yellow" }];
  mine.ui.panes = [{ id: "p", tabs: ["a", "b"], activeTabId: "b" }];
  const theirs = clone(b);
  theirs.files = theirs.files.filter((f) => f.id !== "b");
  const merged = mergeWorkspaces(b, mine, theirs)!;
  assert.deepEqual(merged.files.map((f) => f.id), ["a"]);
  assert.deepEqual(merged.highlights, []);
  assert.deepEqual(merged.ui.panes, [{ id: "p", tabs: ["a"], activeTabId: null }]);
});
