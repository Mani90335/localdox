// Rough work: the scratchpad model, taking work out of a pad (into a note or a
// document), and a pad's journey through storage — autosave, reload, two-tab
// merge, backup, moving documents, share links, storage accounting and draft
// recovery. The panel itself is covered by tests/e2e/rough-work.spec.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

import {
  createScratchpad,
  duplicateScratchpad,
  editScratchpad,
  insertIntoDocument,
  insertionPoints,
  linkScratchpad,
  MAX_SCRATCHPAD_CHARS,
  noteFromScratchpad,
  pageAt,
  renameScratchpad,
  scratchpadDraftId,
  scratchpadDrafts,
  scratchpadOfDraft,
  selectedWork,
  sortScratchpads,
  type Scratchpad,
} from "../src/lib/workspace/rough-work.ts";
import { searchNotes } from "../src/lib/workspace/notes.ts";
import {
  newWorkspaceRecord,
  parseWorkspaceImport,
  persistence,
  serializeWorkspace,
  ImportValidationError,
  type WorkspaceRecord,
} from "../src/lib/workspace/persistence.ts";
import { mergeWorkspaces } from "../src/lib/workspace/merge.ts";
import {
  applyToDestination,
  planTransfer,
  removeFromSource,
} from "../src/lib/workspace/workspace-transfer.ts";
import { buildWorkspaceShare } from "../src/lib/workspace/share.ts";
import { recordTextBytes, utf8Length } from "../src/lib/workspace/storage-limits.ts";
import { measureStoredBytes } from "../src/lib/workspace/storage-budget.ts";
import {
  createDraftJournal,
  hashText,
  recoverableDrafts,
} from "../src/lib/workspace/draft-journal.ts";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

const guide = { id: "guide", name: "guide.md" };

function pad(id: string, patch: Partial<Scratchpad> = {}): Scratchpad {
  return {
    id,
    title: `Pad ${id}`,
    content: `Work in ${id}: $x^2 = 4$`,
    fileId: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...patch,
  };
}

const DOC = [
  "# Algebra",
  "",
  "Solve for x.",
  "",
  "# Geometry",
  "",
  "Angles in a triangle.",
  "",
  "# Answers",
  "",
  "See below.",
  "",
].join("\n");

// ---- the model ------------------------------------------------------------------

test("new pads get unique titles and are linked to the document being read", () => {
  const first = createScratchpad([], guide, 5);
  assert.equal(first.title, "Scratchpad");
  assert.equal(first.fileId, "guide");
  assert.equal(first.fileName, "guide.md");
  assert.equal(first.content, "");
  const second = createScratchpad([first], null, 6);
  assert.equal(second.title, "Scratchpad 2");
  assert.equal(second.fileId, null);
  assert.ok(!("fileName" in second));
  assert.notEqual(first.id, second.id);
});

test("edits, renames and links return the same pad when nothing changes", () => {
  const p = pad("a");
  assert.equal(editScratchpad(p, p.content, 9), p);
  assert.equal(renameScratchpad(p, "   ", 9), p, "a blank title is not a rename");
  assert.equal(renameScratchpad(p, p.title, 9), p);
  assert.equal(linkScratchpad(p, null, 9), p);

  const edited = editScratchpad(p, "new", 9);
  assert.deepEqual([edited.content, edited.updatedAt, edited.createdAt], ["new", 9, 1_000]);
  assert.equal(
    editScratchpad(p, "x".repeat(MAX_SCRATCHPAD_CHARS + 10)).content.length,
    MAX_SCRATCHPAD_CHARS,
  );

  assert.equal(renameScratchpad(p, "  Quadratic   check  ").title, "Quadratic check");
  assert.equal(renameScratchpad(p, "t".repeat(500)).title.length, 120);

  const linked = linkScratchpad(p, guide, 9);
  assert.deepEqual([linked.fileId, linked.fileName], ["guide", "guide.md"]);
  const unlinked = linkScratchpad(linked, null, 10);
  assert.equal(unlinked.fileId, null);
  assert.ok(!("fileName" in unlinked), "an unlinked pad keeps no stale name");
});

test("a duplicate is a new pad with the same work, named so it can be told apart", () => {
  const p = pad("a", { fileId: "guide", fileName: "guide.md" });
  const copy = duplicateScratchpad(p, [p], 7);
  assert.notEqual(copy.id, p.id);
  assert.equal(copy.title, "Pad a copy");
  assert.equal(copy.content, p.content);
  assert.equal(copy.fileId, "guide");
  assert.equal(copy.createdAt, 7);
  assert.equal(duplicateScratchpad(p, [p, copy]).title, "Pad a copy 2");
});

test("pads for the document being read come first, then the most recently worked on", () => {
  const pads = [
    pad("old-guide", { fileId: "guide", updatedAt: 1 }),
    pad("new-other", { updatedAt: 9 }),
    pad("new-guide", { fileId: "guide", updatedAt: 5 }),
  ];
  assert.deepEqual(
    sortScratchpads(pads, "guide").map((p) => p.id),
    ["new-guide", "old-guide", "new-other"],
  );
  assert.deepEqual(
    sortScratchpads(pads, null).map((p) => p.id),
    ["new-other", "new-guide", "old-guide"],
  );
});

test("an action applies to the selection, or to the whole pad when nothing is selected", () => {
  const text = "Try:\n\n$$a^2+b^2=c^2$$\n\nResult: $c = 5$\n";
  assert.deepEqual(selectedWork(text, 0, 0), { markdown: text.trimEnd(), whole: true });
  const start = text.indexOf("$$");
  const end = text.indexOf("$$", start + 2) + 2;
  assert.deepEqual(selectedWork(text, end, start), {
    markdown: "$$a^2+b^2=c^2$$",
    whole: false,
  });
  assert.equal(selectedWork(text, 4, 6), null, "only whitespace selected");
  assert.equal(selectedWork("   \n", 0, 0), null);
});

test("a note saved from rough work links back to the pad and is found by its title", () => {
  const p = pad("a", { title: "Quadratics", fileId: "guide", fileName: "guide.md" });
  const note = noteFromScratchpad(p, "$x = 2$", 42);
  assert.deepEqual(note.origin, { kind: "rough-work", scratchpadId: "a", title: "Quadratics" });
  assert.equal(note.fileId, "guide", "travels with the pad's document");
  assert.equal(note.content, "$x = 2$");
  assert.equal(note.createdAt, 42);
  assert.equal(noteFromScratchpad(pad("b"), "y").fileId, "", "no document, no file id");
  assert.deepEqual(
    searchNotes([note], "quadratics").map((n) => n.id),
    [note.id],
  );
});

// ---- inserting into a document ---------------------------------------------------

test("insertion is offered at the end of the reader's page, and at the end of the document", () => {
  const file = { content: DOC, name: "guide.md" };
  const [page, end] = insertionPoints(file, "algebra");
  assert.equal(page.kind, "page");
  assert.equal(page.title, "Algebra");
  assert.equal(DOC.slice(0, page.offset).trimEnd(), "# Algebra\n\nSolve for x.");
  assert.deepEqual(end, { kind: "end", offset: DOC.length });
  // Reading the whole document at once, or on its last page: one choice.
  assert.deepEqual(insertionPoints(file, null), [end]);
  assert.deepEqual(insertionPoints(file, "answers"), [end]);
  assert.deepEqual(insertionPoints(file, "no-such-page"), [end]);
  // A heading on the page stands for the page.
  const withSub = {
    content: DOC.replace("Solve for x.", "## Linear\n\nSolve for x."),
    name: "g.md",
  };
  assert.equal(insertionPoints(withSub, "linear")[0].subtopicId, "algebra");
});

test("inserted work is its own block, lands exactly at its span, and leaves the rest untouched", () => {
  const work = "$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$";
  const [page] = insertionPoints({ content: DOC, name: "guide.md" }, "algebra");
  const { content, span } = insertIntoDocument(DOC, `\n${work}\n\n`, page.offset);
  assert.equal(content.slice(span.start, span.end), work);
  assert.ok(content.startsWith("# Algebra\n\nSolve for x.\n\n$$x"), "one blank line before");
  assert.ok(content.includes(`${work}\n\n# Geometry`), "one blank line after");
  assert.equal(content.replace(`${work}\n\n`, ""), DOC, "nothing else changed");
  assert.equal(pageAt({ content, name: "guide.md" }, span.start), "algebra");

  const atEnd = insertIntoDocument(DOC, "Done.", DOC.length);
  assert.equal(atEnd.content, `${DOC.trimEnd()}\n\nDone.\n`);
  assert.equal(atEnd.content.slice(atEnd.span.start, atEnd.span.end), "Done.");
  assert.equal(pageAt({ content: atEnd.content, name: "guide.md" }, atEnd.span.start), "answers");

  const empty = insertIntoDocument("", "First", 0);
  assert.deepEqual(empty, { content: "First\n", span: { start: 0, end: 5 } });
});

// ---- storage -----------------------------------------------------------------------

function workspaceWithPads(): WorkspaceRecord {
  const ws = newWorkspaceRecord("Maths");
  ws.files = [
    { id: "guide", name: "guide.md", content: DOC },
    { id: "other", name: "other.md", content: "Other" },
  ];
  ws.scratchpads = [
    pad("p1", { fileId: "guide", fileName: "guide.md", title: "Quadratics" }),
    pad("p2", { title: "Loose ends" }),
    // Its document is gone; the pad is still the reader's.
    pad("p3", { fileId: "deleted-doc", fileName: "old.md" }),
  ];
  ws.notes = [{ ...noteFromScratchpad(ws.scratchpads[0], "$x = 2$", 3), id: "n1" }];
  return ws;
}

test("rough work and notes taken from it survive a backup export and import", async () => {
  const ws = workspaceWithPads();
  const restored = parseWorkspaceImport(await serializeWorkspace(ws));
  assert.deepEqual(restored.scratchpads, ws.scratchpads);
  assert.deepEqual(restored.notes, ws.notes, "a note's rough-work origin is kept");
});

test("a backup written before rough work existed imports with none", async () => {
  const ws = newWorkspaceRecord("Old");
  ws.files = [{ id: "doc", name: "guide.md", content: DOC }];
  const json = JSON.parse(await serializeWorkspace(ws));
  delete json.workspace.scratchpads;
  assert.deepEqual(parseWorkspaceImport(JSON.stringify(json)).scratchpads, []);
});

test("imported pads are validated: malformed fields repaired, duplicates and oversize rejected", async () => {
  const json = JSON.parse(await serializeWorkspace(workspaceWithPads()));
  json.workspace.scratchpads[0].title = "   ";
  json.workspace.scratchpads[0].updatedAt = "yesterday";
  json.workspace.scratchpads[1].fileId = 42;
  json.workspace.scratchpads[1].fileName = "stray.md";
  const repaired = parseWorkspaceImport(JSON.stringify(json)).scratchpads!;
  assert.equal(repaired[0].title, "Scratchpad");
  assert.equal(repaired[0].updatedAt, repaired[0].createdAt);
  assert.equal(repaired[1].fileId, null);
  assert.ok(!("fileName" in repaired[1]), "no name without a link");

  const dup = structuredClone(json);
  dup.workspace.scratchpads[1].id = dup.workspace.scratchpads[0].id;
  assert.throws(() => parseWorkspaceImport(JSON.stringify(dup)), ImportValidationError);

  const big = structuredClone(json);
  big.workspace.scratchpads[0].content = "x".repeat(MAX_SCRATCHPAD_CHARS + 1);
  assert.throws(() => parseWorkspaceImport(JSON.stringify(big)), ImportValidationError);
});

test("rough work survives a reload: IndexedDB stores and returns it unchanged", async () => {
  const ws = workspaceWithPads();
  await persistence.putWorkspace(ws);
  const back = await persistence.getWorkspace(ws.id);
  assert.deepEqual(back?.scratchpads, ws.scratchpads);
  // An edit is an ordinary autosave of the record.
  back!.scratchpads = back!.scratchpads!.map((p) =>
    p.id === "p2" ? editScratchpad(p, "edited", 2_000) : p,
  );
  await persistence.putWorkspace(back!);
  const again = await persistence.getWorkspace(ws.id);
  assert.equal(again?.scratchpads?.find((p) => p.id === "p2")?.content, "edited");
  // The documents were never part of it.
  assert.deepEqual(
    again?.files.map((f) => f.content),
    ws.files.map((f) => f.content),
  );
});

test("rough work and notes count toward stored bytes, saved and in memory", async () => {
  await persistence.clearAll();
  const ws = workspaceWithPads();
  const docBytes = utf8Length(DOC) + utf8Length("Other");
  const text = recordTextBytes(ws);
  assert.equal(
    text,
    utf8Length("$x = 2$") +
      ws.scratchpads!.reduce((sum, p) => sum + utf8Length(p.title) + utf8Length(p.content), 0),
  );
  await persistence.putWorkspace(ws);
  const summary = async () =>
    (await persistence.listWorkspaceSummaries()).find((s) => s.id === ws.id)?.bytes;
  assert.equal(await summary(), docBytes + text);

  // A row from an older build is re-measured with the workspace row's text too.
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
  assert.equal((await persistence.storedBytesByWorkspace()).get(ws.id), docBytes + text);

  // The open workspace is counted from memory, unsaved rough work included.
  const typing = [{ ...ws.scratchpads![0], content: "y".repeat(1_000) }];
  const open = await measureStoredBytes(() => ({
    id: ws.id,
    files: ws.files,
    notes: [],
    scratchpads: typing,
  }));
  assert.equal(open, docBytes + utf8Length("Quadratics") + 1_000);
});

test("two tabs keep each other's pads; the same pad changed differently in both conflicts", () => {
  const base = workspaceWithPads();
  const mine = { ...base, scratchpads: [...base.scratchpads!, pad("mine")] };
  const theirs = {
    ...base,
    revision: "r2",
    // The other tab deleted the pad's document; the pad stays.
    files: base.files.filter((f) => f.id !== "guide"),
    scratchpads: [
      editScratchpad(base.scratchpads![0], "Edited in the other tab", 9_000),
      base.scratchpads![1],
      base.scratchpads![2],
      pad("theirs"),
    ],
  };
  const merged = mergeWorkspaces(base, mine, theirs)!;
  assert.deepEqual(merged.scratchpads!.map((p) => p.id).sort(), [
    "mine",
    "p1",
    "p2",
    "p3",
    "theirs",
  ]);
  assert.equal(merged.scratchpads!.find((p) => p.id === "p1")!.content, "Edited in the other tab");

  const clash = {
    ...mine,
    scratchpads: [editScratchpad(base.scratchpads![0], "Mine instead", 9_500)],
  };
  assert.equal(mergeWorkspaces(base, clash, theirs), null);
});

test("moving a document carries the pads linked to it; other pads stay", () => {
  const source = workspaceWithPads();
  const destination = newWorkspaceRecord("Archive");
  destination.files = [{ id: "guide", name: "taken.md", content: "" }];
  const plan = planTransfer(source, destination, { fileIds: ["guide"], folderIds: [] });
  const newId = plan.renamedFileIds.get("guide")!;
  assert.ok(newId && newId !== "guide");
  assert.deepEqual(
    plan.scratchpads.map((p) => [p.id, p.fileId]),
    [["p1", newId]],
  );
  assert.deepEqual(
    applyToDestination(destination, plan).scratchpads!.map((p) => p.id),
    ["p1"],
  );
  assert.deepEqual(
    removeFromSource(source, plan).scratchpads!.map((p) => p.id),
    ["p2", "p3"],
  );
});

test("share links never carry rough work, even with annotations included", () => {
  const ws = workspaceWithPads();
  for (const includeAnnotations of [false, true]) {
    const shared = buildWorkspaceShare(ws, { fileIds: ["guide"], includeAnnotations });
    assert.equal(shared.scratchpads, undefined);
    assert.ok(!JSON.stringify(shared).includes("Quadratics"));
  }
});

// ---- draft recovery ------------------------------------------------------------------

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

test("pad drafts journal under ids of their own and settle when a commit holds them", () => {
  assert.equal(scratchpadOfDraft(scratchpadDraftId("p1")), "p1");
  assert.equal(scratchpadOfDraft("guide"), null, "a document's entry is not a pad's");

  const storage = memoryStorage();
  const journal = createDraftJournal({ storage, session: "tab-1" });
  const p = pad("p1");
  journal.stage({
    workspaceId: "ws",
    fileId: scratchpadDraftId(p.id),
    fileName: `${p.title} (rough work)`,
    text: "typed",
    base: hashText(p.content),
  });
  journal.flush();
  // A commit that doesn't have the text yet keeps the entry…
  journal.settle("ws", scratchpadDrafts([p]));
  assert.equal(storage.map.size, 1);
  // …and one that does removes it.
  journal.settle("ws", scratchpadDrafts([{ ...p, content: "typed" }]));
  assert.equal(storage.map.size, 0);
});

test("a closed tab's rough work is offered back, and marked when its pad is gone", () => {
  const storage = memoryStorage();
  const old = createDraftJournal({ storage, session: "closed-tab" });
  const kept = pad("kept");
  for (const [id, text] of [
    ["kept", "unsaved work"],
    ["deleted", "work on a deleted pad"],
    ["stale", "already saved"],
  ]) {
    old.stage({
      workspaceId: "ws",
      fileId: scratchpadDraftId(id),
      fileName: `${id} (rough work)`,
      text,
      base: hashText(kept.content),
    });
  }
  old.flush();

  const now = createDraftJournal({ storage, session: "new-tab" });
  const { offer, stale } = recoverableDrafts(
    now.list("ws"),
    scratchpadDrafts([kept, pad("stale", { content: "already saved" })]),
    { session: now.session, live: new Set() },
  );
  const byPad = new Map(offer.map((entry) => [scratchpadOfDraft(entry.fileId), entry]));
  assert.equal(byPad.get("kept")?.missing, false);
  assert.equal(byPad.get("kept")?.changedSince, false, "restorable in place");
  assert.equal(byPad.get("deleted")?.missing, true, "restored as a new pad");
  assert.deepEqual(
    stale.map((entry) => scratchpadOfDraft(entry.fileId)),
    ["stale"],
  );
});
