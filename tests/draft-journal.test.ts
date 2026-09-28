import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDraftJournal,
  hashText,
  MAX_DRAFT_CHARS,
  recoverableDrafts,
  DRAFT_PREFIX,
} from "../src/lib/workspace/draft-journal.ts";

/** A Storage stand-in that can be made to fail, like a full or blocked localStorage. */
function memoryStorage() {
  const map = new Map<string, string>();
  let failing = false;
  return {
    map,
    fail(on: boolean) {
      failing = on;
    },
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem(k: string, v: string) {
      if (failing) throw new DOMException("full", "QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
  };
}

const draft = (text: string, base = hashText("saved")) => ({
  workspaceId: "ws",
  fileId: "a",
  fileName: "a.md",
  text,
  base,
});

test("a staged draft reaches storage only on flush, and survives a new journal (reload)", () => {
  const storage = memoryStorage();
  const tab = createDraftJournal({ storage, session: "tab-1" });
  tab.stage(draft("typed"));
  assert.equal(storage.map.size, 0, "staging is memory-only");
  assert.equal(tab.list("ws")[0]?.text, "typed", "but visible to list");
  assert.equal(tab.flush(), true);
  assert.equal(storage.map.size, 1);

  // The tab is gone; a fresh page reads what the old one wrote.
  const next = createDraftJournal({ storage, session: "tab-2" });
  const [entry] = next.list("ws");
  assert.equal(entry.text, "typed");
  assert.equal(entry.session, "tab-1");
  assert.deepEqual(next.list("other"), [], "workspaces are kept apart");
});

test("settle forgets drafts the committed record holds and re-bases the rest", () => {
  const storage = memoryStorage();
  const tab = createDraftJournal({ storage, session: "s" });
  tab.stage(draft("v1"));
  tab.stage({ ...draft("b-draft"), fileId: "b", fileName: "b.md" });
  tab.flush();

  // The app committed "v1" for a, but b's latest text is still in flight.
  tab.settle("ws", [
    { id: "a", content: "v1" },
    { id: "b", content: "b-older" },
  ]);
  const left = tab.list("ws");
  assert.deepEqual(
    left.map((e) => e.fileId),
    ["b"],
  );
  assert.equal(left[0].base, hashText("b-older"), "base follows what storage now holds");
  assert.equal(tab.has("ws"), true);

  tab.settle("ws", [{ id: "b", content: "b-draft" }]);
  assert.deepEqual(tab.list("ws"), []);
  assert.equal(tab.has("ws"), false);
  assert.equal(storage.map.size, 0);
});

test("settle also clears drafts still only staged, and ignores files the record lacks", () => {
  const storage = memoryStorage();
  const tab = createDraftJournal({ storage, session: "s" });
  tab.stage(draft("same"));
  tab.settle("ws", [{ id: "a", content: "same" }]);
  assert.equal(tab.flush(), true);
  assert.equal(storage.map.size, 0, "a committed draft is never written afterwards");

  tab.stage(draft("orphan"));
  tab.flush();
  tab.settle("ws", []);
  assert.equal(tab.list("ws").length, 1, "a missing file keeps its draft to be offered");
});

test("discard removes staged and stored copies", () => {
  const storage = memoryStorage();
  const tab = createDraftJournal({ storage, session: "s" });
  tab.stage(draft("x"));
  tab.flush();
  tab.stage(draft("xy"));
  tab.discard("ws", "a");
  tab.flush();
  assert.equal(storage.map.size, 0);
  assert.deepEqual(tab.list("ws"), []);
});

test("storage failures are reported, keep the draft staged, and succeed on a later flush", () => {
  const storage = memoryStorage();
  const tab = createDraftJournal({ storage, session: "s" });
  storage.fail(true);
  tab.stage(draft("kept"));
  assert.equal(tab.flush(), false);
  assert.equal(tab.list("ws")[0]?.text, "kept");
  storage.fail(false);
  assert.equal(tab.flush(), true);
  assert.equal(storage.map.size, 1);

  // Oversized drafts are not written at all rather than evicting others.
  tab.stage({ ...draft("x".repeat(MAX_DRAFT_CHARS + 1)), fileId: "big" });
  assert.equal(tab.flush(), false);
  assert.equal(storage.map.size, 1);

  // No storage at all (blocked cookies/site data): nothing throws.
  const none = createDraftJournal({ storage: null, session: "s" });
  none.stage(draft("y"));
  assert.equal(none.flush(), false);
  none.settle("ws", [{ id: "a", content: "y" }]);
  assert.deepEqual(none.list("ws"), []);
});

test("corrupt or foreign entries are ignored", () => {
  const storage = memoryStorage();
  storage.map.set(`${DRAFT_PREFIX}ws:a`, "{not json");
  storage.map.set(`${DRAFT_PREFIX}ws:b`, JSON.stringify({ v: 2, text: "future" }));
  storage.map.set("localdox:prefs", "{}");
  const tab = createDraftJournal({ storage, session: "s" });
  assert.deepEqual(tab.list("ws"), []);
});

test("recovery offers only drafts from gone tabs that storage lacks", () => {
  const storage = memoryStorage();
  const now = () => 1000;
  for (const [session, fileId, text] of [
    ["dead", "a", "lost tail"],
    ["dead", "b", "B saved"],
    ["alive", "c", "still typing"],
    ["mine", "d", "my own"],
    ["dead", "e", "was binned"],
    ["dead", "f", "file gone"],
  ]) {
    const j = createDraftJournal({ storage, session, now });
    j.stage({ workspaceId: "ws", fileId, fileName: `${fileId}.md`, text, base: hashText("old") });
    j.flush();
  }
  const files = [
    { id: "a", content: "old" },
    { id: "b", content: "B saved" },
    { id: "c", content: "old" },
    { id: "d", content: "old" },
    { id: "e", content: "old", deletedAt: 5 },
  ];
  const reader = createDraftJournal({ storage, session: "mine" });
  const { offer, stale } = recoverableDrafts(reader.list("ws"), files, {
    session: "mine",
    live: new Set(["alive"]),
  });
  assert.deepEqual(offer.map((e) => [e.fileId, e.changedSince, e.missing]).sort(), [
    ["a", false, false],
    ["e", false, true],
    ["f", true, true],
  ]);
  assert.deepEqual(
    stale.map((e) => e.fileId),
    ["b"],
  );

  // The saved document moved on after the draft started: it must not be
  // restored over, so it is flagged for a copy.
  const changed = recoverableDrafts(reader.list("ws"), [{ id: "a", content: "newer" }], {
    session: "mine",
    live: new Set(),
  });
  assert.equal(changed.offer.find((e) => e.fileId === "a")?.changedSince, true);
});

test("hashText distinguishes content and length", () => {
  assert.equal(hashText("abc"), hashText("abc"));
  assert.notEqual(hashText("abc"), hashText("abd"));
  assert.notEqual(hashText(""), hashText("\u0000"));
});
