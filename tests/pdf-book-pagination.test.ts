// Unit tests for the PDF reader's book-pagination math: which page(s) are on
// screen for a given "current" page, and where next/prev land, under the
// "page 1 is a standalone cover, then (2,3),(4,5),… pair up" rule.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getVisiblePages,
  nextPageIndex,
  prevPageIndex,
} from "../src/services/pdf-viewer/pdf-book-pagination.ts";

test("single mode always shows exactly one page", () => {
  assert.deepEqual(getVisiblePages(1, "single", 10), [1]);
  assert.deepEqual(getVisiblePages(7, "single", 10), [7]);
  assert.deepEqual(getVisiblePages(10, "single", 10), [10]);
});

test("spread mode: page 1 is a standalone cover", () => {
  assert.deepEqual(getVisiblePages(1, "spread", 10), [1]);
});

test("spread mode: pages pair as (2,3), (4,5), … regardless of which side is current", () => {
  assert.deepEqual(getVisiblePages(2, "spread", 10), [2, 3]);
  assert.deepEqual(getVisiblePages(3, "spread", 10), [2, 3]);
  assert.deepEqual(getVisiblePages(4, "spread", 10), [4, 5]);
  assert.deepEqual(getVisiblePages(5, "spread", 10), [4, 5]);
});

test("spread mode: a trailing page with no partner renders alone", () => {
  // 10 pages: (2,3) (4,5) (6,7) (8,9) then page 10 has no partner.
  assert.deepEqual(getVisiblePages(10, "spread", 10), [10]);
  // An odd-length book: (2,3) (4,5) then page 6 has no partner.
  assert.deepEqual(getVisiblePages(6, "spread", 6), [6]);
});

test("spread mode: next steps by a full spread, skipping the cover correctly", () => {
  assert.equal(nextPageIndex(1, "spread", 10), 2); // cover -> (2,3)
  assert.equal(nextPageIndex(2, "spread", 10), 4); // (2,3) -> (4,5)
  assert.equal(nextPageIndex(3, "spread", 10), 4); // landing mid-pair still advances a full spread
  assert.equal(nextPageIndex(9, "spread", 10), 10); // (8,9) -> trailing 10 alone
  assert.equal(nextPageIndex(10, "spread", 10), 10); // already at the end
});

test("spread mode: prev steps back a full spread, landing on the cover from (2,3)", () => {
  assert.equal(prevPageIndex(10, "spread", 10), 8); // trailing 10 -> (8,9)
  assert.equal(prevPageIndex(4, "spread", 10), 2); // (4,5) -> (2,3)
  assert.equal(prevPageIndex(2, "spread", 10), 1); // (2,3) -> cover
  assert.equal(prevPageIndex(1, "spread", 10), 1); // already at the start
});

test("single mode next/prev clamp at the ends", () => {
  assert.equal(nextPageIndex(10, "single", 10), 10);
  assert.equal(prevPageIndex(1, "single", 10), 1);
  assert.equal(nextPageIndex(5, "single", 10), 6);
  assert.equal(prevPageIndex(5, "single", 10), 4);
});

test("switching layout mode mid-book re-derives visible pages from the same current page", () => {
  const current = nextPageIndex(1, "spread", 10); // -> 2, spread shows [2,3]
  assert.deepEqual(getVisiblePages(current, "spread", 10), [2, 3]);
  assert.deepEqual(getVisiblePages(current, "single", 10), [2]);
});
