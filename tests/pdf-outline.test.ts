// Unit tests for the PDF outline model and its lazy destination resolver
// (R03): the reader used to resolve every entry up front, recursively and in
// parallel, and render the whole tree expanded.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildOutline,
  destKey,
  flattenOutline,
  initialExpanded,
  OUTLINE_INITIAL_ROWS,
  PdfOutlineResolver,
  windowRange,
  type OutlineDestSource,
  type RawOutlineEntry,
} from "../src/services/pdf-viewer/pdf-outline.ts";

const ref = (num: number) => ({ num, gen: 0 });

/** `chapters` × `sections` entries; each points at its own page reference. */
function book(chapters: number, sections: number, count?: number): RawOutlineEntry[] {
  let n = 0;
  return Array.from({ length: chapters }, (_, c) => ({
    title: `Chapter ${c + 1}`,
    dest: [ref(n++), { name: "XYZ" }],
    count,
    items: Array.from({ length: sections }, (_, s) => ({
      title: `Section ${c + 1}.${s + 1}`,
      dest: [ref(n++), { name: "Fit" }],
      items: [],
    })),
  }));
}

/** A fake pdf.js document: ref `n` is on page index `n`, with call counts and manual release. */
function fakeSource(options: { gate?: boolean } = {}) {
  const calls = { getPageIndex: 0, getDestination: 0 };
  const waiting: (() => void)[] = [];
  const hold = () =>
    options.gate ? new Promise<void>((release) => waiting.push(release)) : Promise.resolve();
  const source: OutlineDestSource = {
    async getDestination(name) {
      calls.getDestination++;
      await hold();
      if (name === "missing") return null;
      if (name === "broken") throw new Error("bad name tree");
      return [ref(Number(name.replace("page", ""))), { name: "Fit" }];
    },
    async getPageIndex(target) {
      calls.getPageIndex++;
      await hold();
      const { num } = target as { num: number };
      if (num < 0) throw new Error("not a page");
      return num;
    },
  };
  const releaseAll = async () => {
    for (let i = 0; i < 100 && waiting.length > 0; i++) {
      waiting.splice(0).forEach((release) => release());
      await flush();
    }
  };
  return { source, calls, waiting, releaseAll };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("buildOutline maps titles, ids, destinations and closed flags without resolving anything", () => {
  const outline = buildOutline([
    { title: "A", dest: "named", count: -2, items: [{ title: "A.1", dest: [ref(3)], items: [] }] },
    { title: null, dest: null, items: null },
  ]);
  assert.deepEqual(outline, [
    {
      id: "0",
      title: "A",
      dest: "named",
      closed: true,
      items: [{ id: "0.0", title: "A.1", dest: [ref(3)], closed: false, items: [] }],
    },
    { id: "1", title: "", dest: null, closed: false, items: [] },
  ]);
});

test("buildOutline and flattenOutline handle a 20,000-level chain without recursion", () => {
  let raw: RawOutlineEntry = { title: "leaf", dest: [ref(0)], items: [] };
  for (let i = 0; i < 20_000; i++) raw = { title: `level ${i}`, dest: [ref(i)], items: [raw] };
  const outline = buildOutline([raw]);
  const all = new Set<string>();
  let node = outline[0];
  while (node) {
    all.add(node.id);
    node = node.items[0];
  }
  const rows = flattenOutline(outline, all);
  assert.equal(rows.length, 20_001);
  assert.equal(rows.at(-1)!.level, 20_001);
  assert.equal(rows.at(-1)!.node.title, "leaf");
});

test("a small outline opens fully expanded, except entries the PDF marks closed", () => {
  const outline = buildOutline([...book(3, 4), ...book(1, 4, -4)]);
  const expanded = initialExpanded(outline);
  assert.deepEqual([...expanded].sort(), ["0", "1", "2"]);
  assert.equal(flattenOutline(outline, expanded).length, 4 + 3 * 4);
});

test("a huge outline opens bounded: breadth first, never past the row budget", () => {
  // 50 chapters × 200 sections = 10,050 entries; the audit's worry was
  // mounting all of them.
  const outline = buildOutline(book(50, 200));
  const expanded = initialExpanded(outline);
  assert.equal(expanded.size, 0);
  assert.equal(flattenOutline(outline, expanded).length, 50);

  // Room for some chapters: expands in order until the next would overflow.
  const medium = buildOutline(book(10, 30));
  const some = initialExpanded(medium);
  assert.deepEqual([...some], ["0", "1", "2", "3", "4", "5"]);
  const rows = flattenOutline(medium, some).length;
  assert.equal(rows, 10 + 6 * 30);
  assert.ok(rows <= OUTLINE_INITIAL_ROWS);

  // A single root with a long child list still opens its first level when it fits.
  const single = buildOutline([{ title: "Book", dest: null, items: book(150, 0) }]);
  assert.deepEqual([...initialExpanded(single)], ["0"]);
});

test("flattenOutline reports tree positions for aria-level/posinset/setsize", () => {
  const outline = buildOutline(book(2, 2));
  const rows = flattenOutline(outline, new Set(["1"]));
  assert.deepEqual(
    rows.map((r) => [r.node.id, r.level, r.posInSet, r.setSize, r.parentId]),
    [
      ["0", 1, 1, 2, null],
      ["1", 1, 2, 2, null],
      ["1.0", 2, 1, 2, "1"],
      ["1.1", 2, 2, 2, "1"],
    ],
  );
});

test("windowRange mounts the rows in view plus overscan, clamped to the list", () => {
  assert.deepEqual(windowRange(0, 0, 500, 28, 10), { first: 0, last: -1 });
  assert.deepEqual(windowRange(10_000, 0, 560, 28, 10), { first: 0, last: 30 });
  assert.deepEqual(windowRange(10_000, 28 * 5000, 560, 28, 10), { first: 4990, last: 5030 });
  assert.deepEqual(windowRange(100, 28 * 5000, 560, 28, 10), { first: 99, last: 99 });
});

test("destKey identifies names, page references and page indexes", () => {
  assert.equal(destKey("intro"), "name:intro");
  assert.equal(destKey([ref(7), { name: "XYZ" }]), "ref:7R0");
  assert.equal(destKey([{ num: 7, gen: 2 }]), "ref:7R2");
  assert.equal(destKey([4, { name: "Fit" }]), "index:4");
  assert.equal(destKey([]), null);
  assert.equal(destKey([{ name: "Fit" }]), null);
});

test("nothing resolves until asked; each destination resolves once and is cached", async () => {
  const { source, calls } = fakeSource();
  const resolver = new PdfOutlineResolver(source);
  const outline = buildOutline(book(100, 100));
  assert.equal(calls.getPageIndex, 0, "building the outline resolves nothing");

  assert.equal(resolver.peek(outline[3].dest), undefined);
  assert.equal(await resolver.resolve(outline[3].dest), 3 * 101 + 1);
  assert.equal(await resolver.resolve(outline[3].dest), 3 * 101 + 1);
  assert.equal(resolver.peek(outline[3].dest), 3 * 101 + 1);
  assert.equal(calls.getPageIndex, 1);
});

test("named destinations, page indexes and broken destinations resolve safely", async () => {
  const { source, calls } = fakeSource();
  const resolver = new PdfOutlineResolver(source);
  assert.equal(await resolver.resolve("page9"), 10);
  assert.equal(await resolver.resolve("missing"), null);
  assert.equal(await resolver.resolve("broken"), null);
  assert.equal(await resolver.resolve([ref(-1)]), null);
  assert.equal(await resolver.resolve([5, { name: "Fit" }]), 6);
  assert.equal(await resolver.resolve([-1]), null);
  assert.equal(await resolver.resolve([]), null);
  assert.equal(await resolver.resolve(null), null);
  assert.equal(resolver.peek(null), null);
  assert.equal(resolver.peek("broken"), null, "a failure is cached as an inert entry");
  // Two names for one page share nothing but still resolve.
  assert.equal(await resolver.resolve("page9"), 10);
  assert.equal(calls.getDestination, 3);
});

test("at most `concurrency` look-ups run at once", async () => {
  const { source, calls, waiting, releaseAll } = fakeSource({ gate: true });
  const resolver = new PdfOutlineResolver(source, 4);
  const outline = buildOutline(book(40, 0));
  resolver.prefetch(outline.map((n) => n.dest));
  await flush();
  assert.equal(calls.getPageIndex, 4);
  assert.equal(waiting.length, 4);
  await releaseAll();
  assert.equal(calls.getPageIndex, 40);
  assert.equal(resolver.lookups, 40);
  assert.deepEqual(
    outline.map((n) => resolver.peek(n.dest)),
    outline.map((_, i) => i + 1),
  );
});

test("prefetch drops queued rows that scrolled away; a click jumps the queue and is never dropped", async () => {
  const { source, calls, releaseAll } = fakeSource({ gate: true });
  const resolver = new PdfOutlineResolver(source, 2);
  const outline = buildOutline(book(1000, 0));

  resolver.prefetch(outline.slice(0, 30).map((n) => n.dest));
  const clicked = resolver.resolve(outline[900].dest);
  // The user scrolls: the old window is replaced by a new one.
  resolver.prefetch(outline.slice(500, 530).map((n) => n.dest));
  await releaseAll();

  assert.equal(await clicked, 901);
  // 2 running when the scroll happened, the click, and the new window.
  assert.equal(calls.getPageIndex, 2 + 1 + 30);
  assert.equal(resolver.peek(outline[10].dest), undefined, "a dropped row isn't cached");
  assert.equal(resolver.peek(outline[510].dest), 511);

  // Dropped rows can still be asked for later.
  const later = resolver.resolve(outline[10].dest);
  await releaseAll();
  assert.equal(await later, 11);
});

test("a click on a queued row promotes it past the rest of the window", async () => {
  const { source, releaseAll } = fakeSource({ gate: true });
  const resolver = new PdfOutlineResolver(source, 1);
  const outline = buildOutline(book(50, 0));
  const order: number[] = [];
  resolver.subscribe(() => {
    for (let i = 0; i < 50; i++)
      if (resolver.peek(outline[i].dest) !== undefined && !order.includes(i)) order.push(i);
  });
  resolver.prefetch(outline.map((n) => n.dest));
  const clicked = resolver.resolve(outline[40].dest);
  resolver.prefetch([]); // scrolled away: the click survives
  await releaseAll();
  assert.equal(await clicked, 41);
  assert.deepEqual(order, [0, 40]);
});

test("dispose stops work and notifications; late results aren't cached", async () => {
  const { source, calls, releaseAll } = fakeSource({ gate: true });
  const resolver = new PdfOutlineResolver(source, 2);
  const outline = buildOutline(book(10, 0));
  let notified = 0;
  resolver.subscribe(() => notified++);
  const first = resolver.resolve(outline[0].dest);
  resolver.prefetch(outline.map((n) => n.dest));
  resolver.dispose();
  await releaseAll();
  assert.equal(await first, null);
  assert.equal(notified, 0);
  assert.equal(calls.getPageIndex, 2);
  assert.equal(resolver.peek(outline[0].dest), undefined);
  assert.equal(await resolver.resolve(outline[5].dest), null);
});
