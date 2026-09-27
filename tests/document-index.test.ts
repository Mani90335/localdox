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
