import { test } from "node:test";
import assert from "node:assert/strict";
import { findMatchesOnPage } from "../src/services/pdf-viewer/pdf-search-matches.ts";

test("PDF search preserves UTF-16 offsets, skips marked content and matches across spans", () => {
  const items = [
    { type: "beginMarkedContent" },
    { str: "İ 😀 tar" },
    { str: "get target" },
    { type: "endMarkedContent" },
  ];
  assert.deepEqual(findMatchesOnPage(2, items, "TARGET", { current: 10 }), [
    {
      id: 10,
      pageNumber: 2,
      highlights: [
        { itemIndex: 0, charIndex: 5, length: 3 },
        { itemIndex: 1, charIndex: 0, length: 3 },
      ],
    },
    { id: 11, pageNumber: 2, highlights: [{ itemIndex: 1, charIndex: 4, length: 6 }] },
  ]);
});
test("PDF search retains empty span indices and treats regex punctuation literally", () => {
  assert.deepEqual(
    findMatchesOnPage(1, [{ str: "" }, { str: "[x]+ [x]+" }], "[x]+", { current: 0 }).map(
      (m) => m.highlights,
    ),
    [[{ itemIndex: 1, charIndex: 0, length: 4 }], [{ itemIndex: 1, charIndex: 5, length: 4 }]],
  );
  assert.deepEqual(findMatchesOnPage(1, [{ str: "abc" }], " ", { current: 0 }), []);
});
