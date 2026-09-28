import assert from "node:assert/strict";
import { test } from "node:test";
import { DocumentIndex } from "../src/lib/search/document-index.ts";

test("indexes headings with resolved duplicate slugs and skips fenced code", async () => {
  const index = new DocumentIndex();
  await index.syncWorkspace("w1", [
    {
      id: "1",
      name: "notes.md",
      content:
        "# Topic\nneedle paragraph\n# Topic\nneedle two\n~~~js\n# Hidden\nneedle hidden\n~~~\n````\n```\nneedle also hidden\n````\n",
    },
  ]);

  const hits = await index.search("needle", ["w1"]);
  assert.deepEqual(new Set(hits.map((hit) => hit.headingId)), new Set(["topic", "topic-1"]));
  assert.equal(hits.length, 2, "fenced code must not be indexed");

  const noHits = await index.search("hidden", ["w1"]);
  assert.equal(noHits.length, 0, "text that only appears inside a fence must not match");

  const headingHits = await index.search("Topic", ["w1"]);
  assert.equal(headingHits[0].line, "Topic", "a heading match must outrank a body match");
});

test("re-syncing refreshes changed content and drops removed files", async () => {
  const index = new DocumentIndex();
  const files = [
    { id: "1", name: "notes.md", content: "old" },
    { id: "2", name: "notes.md", content: "old" },
  ];
  await index.syncWorkspace("w1", files);
  assert.equal((await index.search("old", ["w1"])).length, 2);

  await index.syncWorkspace("w1", [files[0], { ...files[1], content: "new" }]);
  assert.deepEqual(
    (await index.search("new", ["w1"])).map((hit) => hit.fileId),
    ["2"],
  );
  assert.deepEqual(
    (await index.search("old", ["w1"])).map((hit) => hit.fileId),
    ["1"],
  );

  await index.syncWorkspace("w1", [files[0]]);
  assert.deepEqual(await index.search("new", ["w1"]), []);
});

test("dropWorkspace removes every row for that workspace", async () => {
  const index = new DocumentIndex();
  await index.syncWorkspace("w1", [{ id: "1", name: "a.md", content: "hello world" }]);
  await index.syncWorkspace("w2", [{ id: "1", name: "b.md", content: "hello world" }]);

  await index.dropWorkspace("w1");
  assert.deepEqual((await index.search("hello", ["w1"])).length, 0);
  assert.equal((await index.search("hello", ["w2"])).length, 1);
});

test("a rename replaces filename matches and labels on every content row", async () => {
  const index = new DocumentIndex();
  const file = { id: "1", name: "alpha.md", content: "# Topic\nconstant content" };
  await index.syncWorkspace("w1", [file]);
  await index.syncWorkspace("w2", [file]);
  await index.syncWorkspace("w1", [{ ...file, name: "renamed.md" }]);

  assert.deepEqual(await index.search("alpha", ["w1"]), []);
  const renamed = await index.search("renamed", ["w1"]);
  assert.equal(renamed.length, 3, "filename, heading and body rows all use the new name");
  assert.ok(renamed.every((hit) => hit.fileName === "renamed.md"));
  assert.equal(renamed.find((hit) => hit.lineIndex === -1)?.snippet, "renamed.md");
  const content = await index.search("constant", ["w1"]);
  assert.equal(content.length, 1);
  assert.equal(content[0].fileName, "renamed.md");
  assert.equal(content[0].headingId, "topic");
  assert.ok((await index.search("alpha", ["w2"])).every((hit) => hit.fileName === "alpha.md"));
  assert.deepEqual(await index.search("renamed", ["w2"]), []);

  await index.syncWorkspace("w1", [{ ...file, name: "renamed.md" }]);
  assert.deepEqual(await index.search("renamed", ["w1"]), renamed, "no duplicate rows");
});

test("empty documents can be renamed repeatedly and removed without stale filename rows", async () => {
  const index = new DocumentIndex();
  for (const name of ["alpha.md", "renamed.md", "final.md"]) {
    await index.syncWorkspace("w", [{ id: "1", name, content: "" }]);
    assert.equal((await index.search(name, ["w"])).length, 1);
  }
  assert.deepEqual(await index.search("alpha", ["w"]), []);
  assert.deepEqual(await index.search("renamed", ["w"]), []);
  await index.syncWorkspace("w", []);
  assert.deepEqual(await index.search("final", ["w"]), []);
});

test("search is scoped to the requested workspace ids", async () => {
  const index = new DocumentIndex();
  await index.syncWorkspace("w1", [{ id: "1", name: "a.md", content: "shared term" }]);
  await index.syncWorkspace("w2", [{ id: "1", name: "b.md", content: "shared term" }]);

  assert.equal((await index.search("shared", ["w1"])).length, 1);
  assert.equal((await index.search("shared", ["w1", "w2"])).length, 2);
});

test("fuzzy matching tolerates a one-letter typo", async () => {
  const index = new DocumentIndex();
  await index.syncWorkspace("w1", [{ id: "1", name: "a.md", content: "the quick brown fox" }]);
  assert.ok((await index.search("quixk", ["w1"])).length > 0);
});

test("a large file indexes without throwing and results stay bounded", async () => {
  const index = new DocumentIndex();
  await index.syncWorkspace("w1", [
    {
      id: "large",
      name: "large.md",
      content: "matching text\n".repeat(5000) + "# Matching heading\n",
    },
  ]);
  const hits = await index.search("matching", ["w1"]);
  assert.ok(hits.length > 0 && hits.length <= 200);
  assert.deepEqual(await index.search("  ", ["w1"]), []);
});

// A07: the worker starts a handler per message without waiting for the last
// one, and a sync yields between batches. These run operations the way the
// worker does: all started at once, never awaited in between.

/** More files than one insert batch, so a sync yields partway through. */
function corpus(tag: string, count = 40) {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i),
    name: `f${i}.md`,
    content: `${tag} line ${i}`,
  }));
}

test("overlapping syncs of one workspace apply in order and the last one wins", async () => {
  const index = new DocumentIndex();
  await index.syncWorkspace("w1", corpus("original"));
  const results = await Promise.allSettled([
    index.syncWorkspace("w1", corpus("draftone")),
    index.syncWorkspace("w1", corpus("drafttwo")),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "fulfilled"],
    "neither sync may fail on a duplicate row id",
  );
  assert.equal((await index.search("original", ["w1"])).length, 0);
  assert.equal((await index.search("draftone", ["w1"])).length, 0, "no stale draft rows");
  assert.equal(new Set((await index.search("drafttwo", ["w1"])).map((hit) => hit.fileId)).size, 40);
});

test("a drop sent during a sync removes every row, and the workspace can be synced again", async () => {
  const index = new DocumentIndex();
  const [synced, dropped] = await Promise.all([
    index.syncWorkspace("w1", corpus("other")),
    index.dropWorkspace("w1"),
  ]);
  assert.deepEqual(await index.search("other", ["w1"]), [], "no orphaned rows");
  assert.ok(dropped > synced, "the drop applies after the sync");

  await index.syncWorkspace("w1", corpus("again"));
  assert.equal(new Set((await index.search("again", ["w1"])).map((hit) => hit.fileId)).size, 40);
  assert.deepEqual(await index.search("other", ["w1"]), []);
});

test("a search sent during a sync sees the whole sync", async () => {
  const index = new DocumentIndex();
  const sync = index.syncWorkspace("w1", corpus("partial", 100));
  const hits = await index.search("partial", ["w1"]);
  await sync;
  assert.equal(new Set(hits.map((hit) => hit.fileId)).size, 100);
});

test("the generation advances only when rows change and a failed op doesn't block later ones", async () => {
  const index = new DocumentIndex();
  const files = [{ id: "1", name: "a.md", content: "alpha" }];
  const first = await index.syncWorkspace("w1", files);
  assert.equal(await index.syncWorkspace("w1", files), first, "an unchanged sync");
  const renamed = await index.syncWorkspace("w1", [{ ...files[0], name: "b.md" }]);
  assert.ok(renamed > first);
  assert.equal(await index.dropWorkspace("never-synced"), renamed);

  const broken = index.syncWorkspace("w2", [
    { id: "x", name: "x.md", content: null as unknown as string },
  ]);
  const after = index.search("alpha", ["w1"]);
  await assert.rejects(broken);
  assert.equal((await after).length, 1, "the queue keeps going after a failure");
});
