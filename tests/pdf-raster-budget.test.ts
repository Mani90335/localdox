// Unit tests for the PDF reader's canvas pixel budget (A08) and its bounded
// page/text caches.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  detailCovers,
  fitCanvas,
  getLivePdfPages,
  MAX_CANVAS_SIDE,
  PAGE_BUDGET_BYTES,
  pageBudgetPixels,
  pixelsToBytes,
  planDetailArea,
  planPageRaster,
  registerLivePdfPage,
  subscribeLivePdfPages,
  TOTAL_BUDGET_BYTES,
} from "../src/services/pdf-viewer/pdf-raster-budget.ts";
import { BoundedPromiseCache } from "../src/lib/bounded-promise-cache.ts";

const MiB = 1024 * 1024;
const desktop = pageBudgetPixels("desktop", 1);
const phone = pageBudgetPixels("phone", 1);

// The audit's case: at DPR 2 and 400% zoom one page's CSS box was
// 2217.5×3136, and its backing store 4435×6272 (106.1 MiB).
const AUDIT_CSS = { w: 4435 / 2, h: 6272 / 2 };

test("page budgets are 32 MiB on desktop and 16 MiB on a phone", () => {
  assert.equal(pixelsToBytes(desktop), 32 * MiB);
  assert.equal(pixelsToBytes(phone), 16 * MiB);
});

test("more pages on screen share the total budget", () => {
  // A spread still gets the full per-page budget.
  assert.equal(pageBudgetPixels("desktop", 2), desktop);
  // Two panes of spreads: four pages split 64 MiB.
  assert.equal(pixelsToBytes(pageBudgetPixels("desktop", 4)), 16 * MiB);
  assert.equal(pixelsToBytes(pageBudgetPixels("phone", 2)), 16 * MiB);
  assert.equal(pixelsToBytes(pageBudgetPixels("phone", 4)), 8 * MiB);
  for (const n of [1, 2, 3, 5, 8]) {
    for (const device of ["desktop", "phone"] as const) {
      assert.ok(pixelsToBytes(pageBudgetPixels(device, n)) * n <= TOTAL_BUDGET_BYTES[device] + n);
      assert.ok(pixelsToBytes(pageBudgetPixels(device, n)) <= PAGE_BUDGET_BYTES[device]);
    }
  }
  assert.equal(pageBudgetPixels("desktop", 0), desktop);
});

test("a page that fits is one canvas at full device resolution", () => {
  const plan = planPageRaster(554.5, 784, 2, desktop);
  assert.deepEqual(plan.base, { width: 1109, height: 1568 });
  assert.equal(plan.detailPixels, 0);
  // DPR 1 at 400%: 26.5 MiB, still under budget, still exact.
  const dpr1 = planPageRaster(AUDIT_CSS.w, AUDIT_CSS.h, 1, desktop);
  assert.deepEqual(dpr1.base, { width: 2217, height: 3136 });
  assert.equal(dpr1.detailPixels, 0);
});

test("the audit's 400% DPR 2 page stays within 32 MiB, base plus detail", () => {
  const plan = planPageRaster(AUDIT_CSS.w, AUDIT_CSS.h, 2, desktop);
  const basePixels = plan.base.width * plan.base.height;
  assert.ok(pixelsToBytes(basePixels) <= 16 * MiB, `base ${pixelsToBytes(basePixels) / MiB} MiB`);
  assert.ok(plan.detailPixels > 0);
  assert.ok(basePixels + plan.detailPixels <= desktop);
  // Aspect ratio survives the downscale.
  const ratio = plan.base.width / plan.base.height;
  assert.ok(Math.abs(ratio - AUDIT_CSS.w / AUDIT_CSS.h) < 0.002);

  // A 1,200×800 view of it gets device-resolution detail pixels.
  const visible = { minX: 500, minY: 1000, maxX: 1700, maxY: 1800 };
  const detail = planDetailArea(
    { width: AUDIT_CSS.w, height: AUDIT_CSS.h },
    visible,
    2,
    plan.detailPixels,
  );
  assert.ok(detail);
  assert.ok(detail.canvas.width * detail.canvas.height <= plan.detailPixels);
  assert.ok(Math.abs(detail.canvas.width / detail.width - 2) < 0.01, "detail at DPR 2");
  assert.ok(detail.minX <= visible.minX && detail.minY <= visible.minY);
  assert.ok(detail.minX + detail.width >= visible.maxX);
  assert.ok(detail.minY + detail.height >= visible.maxY);
});

test("phone budget holds at DPR 3 and 400%", () => {
  const css = { w: 390 * 4, h: 552 * 4 };
  const plan = planPageRaster(css.w, css.h, 3, phone);
  assert.ok(plan.base.width * plan.base.height + plan.detailPixels <= phone);
  // The whole phone screen at DPR 3 is 2.46 M pixels, more than the detail
  // share: detail drops below DPR 3 rather than exceeding the budget.
  const detail = planDetailArea(
    { width: css.w, height: css.h },
    { minX: 0, minY: 0, maxX: 390, maxY: 700 },
    3,
    plan.detailPixels,
  );
  assert.ok(detail);
  assert.ok(detail.canvas.width * detail.canvas.height <= plan.detailPixels);
  assert.ok(detail.canvas.width / detail.width < 3 && detail.canvas.width / detail.width > 2.5);
  assert.equal(detail.minX, 0);
  assert.equal(detail.width, 390);
});

test("fitCanvas never exceeds its pixel or side limits", () => {
  for (const [w, h, s, max] of [
    [2217.5, 3136, 2, desktop],
    [1000, 1000, 3, 1_000_000],
    [333.3, 777.7, 2.625, 123_457],
    [40000, 200, 1, Infinity],
    [100, 60000, 2, desktop],
  ] as const) {
    const c = fitCanvas(w, h, s, max);
    assert.ok(c.width * c.height <= max, `${w}×${h}@${s}: ${c.width}×${c.height}`);
    assert.ok(c.width <= MAX_CANVAS_SIDE && c.height <= MAX_CANVAS_SIDE);
    assert.ok(c.width <= Math.ceil(w * s) && c.height <= Math.ceil(h * s));
  }
  assert.deepEqual(fitCanvas(0.2, 0.2, 1, 10), { width: 1, height: 1 });
});

test("detail area adds margin when the budget allows and clamps to the page", () => {
  const page = { width: 4000, height: 6000 };
  const visible = { minX: 1000, minY: 1000, maxX: 2000, maxY: 2000 };
  const roomy = planDetailArea(page, visible, 1, 9_000_000);
  assert.ok(roomy);
  // Up to one visible size of margin per side.
  assert.deepEqual([roomy.minX, roomy.minY, roomy.width, roomy.height], [0, 0, 3000, 3000]);
  const tight = planDetailArea(page, visible, 1, 1_000_000);
  assert.ok(tight);
  assert.deepEqual([tight.minX, tight.width], [1000, 1000]);
  // Off-page and zero-budget views need nothing.
  assert.equal(planDetailArea(page, { minX: 5000, minY: 0, maxX: 6000, maxY: 10 }, 1, 1e6), null);
  assert.equal(planDetailArea(page, visible, 1, 0), null);
  // A view larger than the page is clamped to it.
  const edge = planDetailArea(
    { width: 800, height: 600 },
    { minX: -50, minY: -50, maxX: 900, maxY: 700 },
    2,
    4e6,
  );
  assert.ok(edge);
  assert.deepEqual([edge.minX, edge.minY, edge.width, edge.height], [0, 0, 800, 600]);
});

test("detailCovers keeps an area until the view nears an inner edge", () => {
  const page = { width: 4000, height: 6000 };
  const area = { minX: 500, minY: 500, width: 2000, height: 2000 };
  assert.equal(detailCovers(area, { minX: 1000, minY: 1000, maxX: 2000, maxY: 2000 }, page), true);
  // Visible region escapes the area.
  assert.equal(detailCovers(area, { minX: 1800, minY: 1000, maxX: 2800, maxY: 2000 }, page), false);
  // Still inside, but within a quarter-view of the right edge.
  assert.equal(detailCovers(area, { minX: 1400, minY: 1000, maxX: 2400, maxY: 2000 }, page), false);
  // At the page's own edge no margin is needed.
  const corner = { minX: 0, minY: 0, width: 1000, height: 1000 };
  assert.equal(detailCovers(corner, { minX: 0, minY: 0, maxX: 700, maxY: 700 }, page), true);
});

test("live page registry notifies and never double-unregisters", () => {
  const before = getLivePdfPages();
  let calls = 0;
  const unsubscribe = subscribeLivePdfPages(() => calls++);
  const a = registerLivePdfPage();
  const b = registerLivePdfPage();
  assert.equal(getLivePdfPages(), before + 2);
  a();
  a();
  assert.equal(getLivePdfPages(), before + 1);
  b();
  assert.equal(getLivePdfPages(), before);
  assert.equal(calls, 4);
  unsubscribe();
});

test("BoundedPromiseCache evicts least-recently-used entries and releases them", async () => {
  const evicted: number[] = [];
  const cache = new BoundedPromiseCache<number, string>({
    maxEntries: 3,
    onEvict: (_value, key) => evicted.push(key),
  });
  let created = 0;
  const make = (n: number) => {
    created++;
    return Promise.resolve(`page ${n}`);
  };
  await cache.get(1, make);
  await cache.get(2, make);
  await cache.get(3, make);
  await cache.get(1, make); // touch 1: 2 is now oldest
  await cache.get(4, make);
  await Promise.resolve();
  assert.deepEqual(evicted, [2]);
  assert.equal(cache.size, 3);
  assert.equal(created, 4);
  assert.equal(await cache.get(1, make), "page 1");
  assert.equal(created, 4, "hit reuses the cached promise");
  cache.clear();
  await Promise.resolve();
  assert.deepEqual(evicted.sort(), [1, 2, 3, 4]);
  assert.equal(cache.size, 0);
});

test("BoundedPromiseCache evicts a rejected promise so the next call retries", async () => {
  const cache = new BoundedPromiseCache<number, string>({ maxEntries: 10 });
  let attempts = 0;
  const flaky = () =>
    ++attempts === 1 ? Promise.reject(new Error("transient")) : Promise.resolve("ok");
  await assert.rejects(cache.get(7, flaky), /transient/);
  assert.equal(cache.has(7), false);
  assert.equal(await cache.get(7, flaky), "ok");
  assert.equal(attempts, 2);
});

test("a late rejection doesn't evict the entry that replaced it", async () => {
  const cache = new BoundedPromiseCache<number, string>({ maxEntries: 1 });
  let rejectOld!: (err: Error) => void;
  const old = cache.get(1, () => new Promise<string>((_, reject) => (rejectOld = reject)));
  await cache.get(2, () => Promise.resolve("two")); // evicts 1
  const fresh = cache.get(1, () => Promise.resolve("one again")); // evicts 2
  rejectOld(new Error("late"));
  await assert.rejects(old);
  assert.equal(await fresh, "one again");
  assert.equal(cache.has(1), true);
});

test("BoundedPromiseCache bounds total weight, keeping the newest entry", async () => {
  const cache = new BoundedPromiseCache<number, number[]>({
    maxEntries: 100,
    maxWeight: 10,
    weigh: (items) => items.length,
  });
  await cache.get(1, () => Promise.resolve([1, 2, 3, 4]));
  await cache.get(2, () => Promise.resolve([1, 2, 3, 4]));
  assert.equal(cache.weight, 8);
  await cache.get(3, () => Promise.resolve([1, 2, 3, 4]));
  await Promise.resolve();
  assert.equal(cache.has(1), false);
  assert.equal(cache.weight, 8);
  // A single oversized entry is still kept (it is the one in use).
  await cache.get(4, () => Promise.resolve(new Array(50).fill(0)));
  await Promise.resolve();
  assert.equal(cache.has(4), true);
  assert.equal(cache.size, 1);
  assert.equal(cache.weight, 50);
});
