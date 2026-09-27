import assert from "node:assert/strict";
import { test } from "node:test";
import { DocumentSearch, runSearch } from "../src/lib/search/document-search.ts";

test("search ranks headings, resolves duplicates, and ignores fenced code", async () => {
  const files = [
    {
      id: "1",
      name: "notes.md",
      content:
        "# Topic\nneedle paragraph\n# Topic\nneedle two\n~~~js\n# Hidden\nneedle hidden\n~~~\n````\n```\nneedle also hidden\n````\n",
    },
  ];
  const index = new DocumentSearch();
  const hits = (await runSearch(index, files, "needle", () => false))!;
  assert.deepEqual(
    hits.map((hit) => hit.headingId),
    ["topic", "topic-1"],
  );
  assert.equal((await runSearch(index, files, "Topic", () => false))![0].score, 120);
});

test("search refreshes changed content, removes deleted files and keeps duplicate filenames distinct", async () => {
  const index = new DocumentSearch();
  const files = [
    { id: "1", name: "notes.md", content: "old" },
    { id: "2", name: "notes.md", content: "old" },
  ];
  assert.equal((await runSearch(index, files, "old", () => false))!.length, 2);
  assert.deepEqual(
    (await runSearch(index, [{ ...files[1], content: "new" }], "new", () => false))!.map(
      (hit) => hit.fileId,
    ),
    ["2"],
  );
  assert.deepEqual(
    await runSearch(index, [{ ...files[1], content: "new" }], "old", () => false),
    [],
  );
});

test("large searches stay bounded, yield to input and allow cancellation", async () => {
  const index = new DocumentSearch();
  const files = [
    {
      id: "large",
      name: "large.md",
      content: "matching text\n".repeat(100_000) + "# Matching heading\n",
    },
  ];
  let turns = 0;
  const timer = setInterval(() => turns++, 0);
  try {
    const hits = (await runSearch(index, files, "matching", () => false))!;
    assert.equal(hits.length, 60);
    assert.equal(hits[0].headingId, "matching-heading");
    assert.ok(turns > 0, "large search must yield to the event loop");
    assert.equal(await runSearch(index, files, "matching", () => true), null);
    assert.deepEqual(await runSearch(index, files, "  ", () => false), []);
  } finally {
    clearInterval(timer);
  }
});
