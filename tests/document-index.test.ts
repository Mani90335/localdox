import assert from "node:assert/strict";
import { test } from "node:test";
import { DocumentIndex } from "../src/lib/search/document-index.ts";
import { SEARCH_RESULT_LIMIT } from "../src/lib/search/schema.ts";

/** Hits for `query`, as a plain array. */
async function find(index: DocumentIndex, query: string, workspaceIds: string[]) {
  return (await index.search(query, workspaceIds)).hits;
}

test("finds every occurrence, each with its heading, including inside fenced code", async () => {
  const index = new DocumentIndex();
  await index.syncWorkspace("w1", [
    {
      id: "1",
      name: "notes.md",
      content:
        "# Topic\nneedle paragraph\n# Topic\nneedle two\n~~~js\n# Not a heading\nneedle in code\n~~~\n",
    },
  ]);

  const hits = await find(index, "needle", ["w1"]);
  assert.deepEqual(
    hits.map((hit) => [hit.line, hit.headingId, hit.lineIndex]),
    [
      ["needle paragraph", "topic", 1],
      ["needle two", "topic-1", 3],
      ["needle in code", "topic-1", 6],
    ],
  );
  assert.equal((await find(index, "Not a heading", ["w1"]))[0].headingId, "topic-1");
});

test("returns only lines that contain the query — no typo, stem, heading or filename matches", async () => {
  const index = new DocumentIndex();
  await index.syncWorkspace("w1", [
    {
      id: "1",
      name: "worker-guide.md",
      content: [
        "# Worker setup",
        "Nothing relevant on this line.",
        "Copyright Titus Wormer",
        "Versions v2.2.0 and v2.1.1",
        "The worker starts here.",
        "Running workers in parallel.",
      ].join("\n"),
    },
  ]);
  const hits = await find(index, "worker", ["w1"]);
  assert.deepEqual(
    hits.map((hit) => hit.lineIndex),
    [-1, 0, 4, 5],
    "the filename, the heading and the two lines saying it — not every line under them",
  );
  assert.deepEqual(await find(index, "e2e", ["w1"]), [], "no fuzzy match against v2.2.0");
  assert.deepEqual(await find(index, "wormers", ["w1"]), []);
  assert.deepEqual(await find(index, "run", ["w1"]).then((h) => h.map((x) => x.line)), [
    "Running workers in parallel.",
  ]);
});

test("a phrase matches only where its words appear together", async () => {
  const index = new DocumentIndex();
  await index.syncWorkspace("w1", [
    {
      id: "1",
      name: "a.md",
      content: "the search index is here\nsearch the index\nindex search",
    },
  ]);
  assert.deepEqual(
    (await find(index, "search index", ["w1"])).map((hit) => hit.line),
    ["the search index is here"],
  );
});

test("matches the text a reader sees, not the markdown around it", async () => {
  const index = new DocumentIndex();
  await index.syncWorkspace("w1", [
    {
      id: "1",
      name: "a.md",
      content: [
        "The **bold** word and [a link](https://example.com/hidden-url).",
        "| key | value |",
        "|-----|-------|",
        "| alpha | beta |",
        "- [ ] a task item",
        "> quoted `code span`",
        "[ref]: https://example.com/hidden-ref",
        "Author: Ada <ada@example.com> and <https://ada.dev>",
        "snake_case_name stays",
      ].join("\n"),
    },
  ]);
  const line = async (query: string) => (await find(index, query, ["w1"])).map((hit) => hit.line);
  assert.deepEqual(await line("bold word"), ["The bold word and a link."]);
  assert.deepEqual(await line("hidden"), [], "URLs aren't on the page");
  assert.deepEqual(await line("alpha"), ["alpha\tbeta"]);
  assert.deepEqual(await line("alpha beta"), [], "cells are separate boxes on the page");
  assert.deepEqual(await line("key"), ["key\tvalue"], "the divider row isn't a match");
  assert.deepEqual(await line("ada@example"), ["Author: Ada ada@example.com and https://ada.dev"]);
  assert.deepEqual(await line("task"), ["a task item"]);
  assert.deepEqual(await line("quoted code"), ["quoted code span"]);
  assert.deepEqual(await line("snake_case_name"), ["snake_case_name stays"]);
});

test("each occurrence on a line is its own hit, with its position in the snippet", async () => {
  const index = new DocumentIndex();
  await index.syncWorkspace("w1", [
    { id: "1", name: "a.md", content: "the cat sat near the CAT flap" },
  ]);
  const hits = await find(index, "cat", ["w1"]);
  assert.deepEqual(
    hits.map((hit) => [
      hit.occurrence,
      hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength),
    ]),
    [
      [0, "cat"],
      [1, "CAT"],
    ],
  );
});

test("files rank by their best match; hits within a file stay in document order", async () => {
  const index = new DocumentIndex();
  await index.syncWorkspace("w1", [
    { id: "partial", name: "a.md", content: "concatenate\nconcat" },
    { id: "body", name: "b.md", content: "one cat\nanother cat" },
    { id: "heading", name: "c.md", content: "intro\n# Cat care\nlast cat" },
    { id: "name", name: "cat-notes.md", content: "nothing here" },
  ]);
  const hits = await find(index, "cat", ["w1"]);
  assert.deepEqual(
    [...new Set(hits.map((hit) => hit.fileId))],
    ["name", "heading", "body", "partial"],
  );
  assert.deepEqual(
    hits.filter((hit) => hit.fileId === "heading").map((hit) => hit.lineIndex),
    [1, 2],
  );
});

test("re-syncing refreshes changed content and drops removed files", async () => {
  const index = new DocumentIndex();
  const files = [
    { id: "1", name: "notes.md", content: "old" },
    { id: "2", name: "notes.md", content: "old" },
  ];
  await index.syncWorkspace("w1", files);
  assert.equal((await find(index, "old", ["w1"])).length, 2);

  await index.syncWorkspace("w1", [files[0], { ...files[1], content: "new" }]);
  assert.deepEqual(
    (await find(index, "new", ["w1"])).map((hit) => hit.fileId),
    ["2"],
  );
  assert.deepEqual(
    (await find(index, "old", ["w1"])).map((hit) => hit.fileId),
    ["1"],
  );

  await index.syncWorkspace("w1", [files[0]]);
  assert.deepEqual(await find(index, "new", ["w1"]), []);
});

test("dropWorkspace removes every row for that workspace", async () => {
  const index = new DocumentIndex();
  await index.syncWorkspace("w1", [{ id: "1", name: "a.md", content: "hello world" }]);
  await index.syncWorkspace("w2", [{ id: "1", name: "b.md", content: "hello world" }]);

  await index.dropWorkspace("w1");
  assert.deepEqual((await find(index, "hello", ["w1"])).length, 0);
  assert.equal((await find(index, "hello", ["w2"])).length, 1);
});

test("a rename replaces the filename match and the label on every content hit", async () => {
  const index = new DocumentIndex();
  const file = { id: "1", name: "alpha.md", content: "# Topic\nconstant content" };
  await index.syncWorkspace("w1", [file]);
  await index.syncWorkspace("w2", [file]);
  await index.syncWorkspace("w1", [{ ...file, name: "renamed.md" }]);

  assert.deepEqual(await find(index, "alpha", ["w1"]), []);
  const renamed = await find(index, "renamed", ["w1"]);
  assert.equal(renamed.length, 1, "only the filename says renamed");
  assert.equal(renamed[0].lineIndex, -1);
  assert.equal(renamed[0].snippet, "renamed.md");
  const content = await find(index, "constant", ["w1"]);
  assert.equal(content.length, 1);
  assert.equal(content[0].fileName, "renamed.md");
  assert.equal(content[0].headingId, "topic");
  assert.ok((await find(index, "alpha", ["w2"])).every((hit) => hit.fileName === "alpha.md"));
  assert.deepEqual(await find(index, "renamed", ["w2"]), []);

  await index.syncWorkspace("w1", [{ ...file, name: "renamed.md" }]);
  assert.deepEqual(await find(index, "renamed", ["w1"]), renamed, "no duplicate hits");
});

test("empty documents can be renamed repeatedly and removed without stale filename hits", async () => {
  const index = new DocumentIndex();
  for (const name of ["alpha.md", "renamed.md", "final.md"]) {
    await index.syncWorkspace("w", [{ id: "1", name, content: "" }]);
    assert.equal((await find(index, name, ["w"])).length, 1);
  }
  assert.deepEqual(await find(index, "alpha", ["w"]), []);
  assert.deepEqual(await find(index, "renamed", ["w"]), []);
  await index.syncWorkspace("w", []);
  assert.deepEqual(await find(index, "final", ["w"]), []);
});

test("search is scoped to the requested workspace ids, in the order given", async () => {
  const index = new DocumentIndex();
  await index.syncWorkspace("w1", [{ id: "1", name: "a.md", content: "shared term" }]);
  await index.syncWorkspace("w2", [{ id: "1", name: "b.md", content: "shared term here, shared" }]);

  assert.equal((await find(index, "shared", ["w1"])).length, 1);
  assert.deepEqual(
    (await find(index, "shared", ["w1", "w2"])).map((hit) => hit.workspaceId),
    ["w1", "w2", "w2"],
  );
});

test("a large file returns every match up to the limit and reports the true total", async () => {
  const index = new DocumentIndex();
  await index.syncWorkspace("w1", [
    {
      id: "large",
      name: "large.md",
      content: "matching text\n".repeat(5000) + "# Matching heading\n",
    },
  ]);
  const { hits, total } = await index.search("matching", ["w1"]);
  assert.equal(total, 5001);
  assert.equal(hits.length, SEARCH_RESULT_LIMIT);
  assert.deepEqual(await find(index, "  ", ["w1"]), []);
  assert.equal((await index.search("heading", ["w1"])).total, 1);
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
  assert.equal((await find(index, "original", ["w1"])).length, 0);
  assert.equal((await find(index, "draftone", ["w1"])).length, 0, "no stale draft rows");
  assert.equal(new Set((await find(index, "drafttwo", ["w1"])).map((hit) => hit.fileId)).size, 40);
});

test("a drop sent during a sync removes every row, and the workspace can be synced again", async () => {
  const index = new DocumentIndex();
  const [synced, dropped] = await Promise.all([
    index.syncWorkspace("w1", corpus("other")),
    index.dropWorkspace("w1"),
  ]);
  assert.deepEqual(await find(index, "other", ["w1"]), [], "no orphaned rows");
  assert.ok(dropped > synced, "the drop applies after the sync");

  await index.syncWorkspace("w1", corpus("again"));
  assert.equal(new Set((await find(index, "again", ["w1"])).map((hit) => hit.fileId)).size, 40);
  assert.deepEqual(await find(index, "other", ["w1"]), []);
});

test("a search sent during a sync sees the whole sync", async () => {
  const index = new DocumentIndex();
  const sync = index.syncWorkspace("w1", corpus("partial", 100));
  const hits = await find(index, "partial", ["w1"]);
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
  const after = find(index, "alpha", ["w1"]);
  await assert.rejects(broken);
  assert.equal((await after).length, 1, "the queue keeps going after a failure");
});
