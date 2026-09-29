import assert from "node:assert/strict";
import { test } from "node:test";
import { deferredModule } from "../src/lib/app/deferred-module.ts";

// B02: the reader, editor and split-view panes are fetched on demand through
// deferredModule. A preload and a render asking at once must share one
// download, and a failed download must not stick.

test("concurrent loads share one download and resolve to the module", async () => {
  let calls = 0;
  const mod = deferredModule(async () => {
    calls++;
    return { name: "reader" };
  });
  mod.preload();
  const [a, b] = await Promise.all([mod.load(), mod.load()]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.deepEqual(a, { name: "reader" });
  assert.equal(await mod.load(), a);
  assert.equal(calls, 1);
});

test("a failed download is retried by the next load", async () => {
  let calls = 0;
  const mod = deferredModule(async () => {
    calls++;
    if (calls === 1) throw new TypeError("Failed to fetch dynamically imported module");
    return { ok: true };
  });
  await assert.rejects(mod.load(), /dynamically imported module/);
  assert.deepEqual(await mod.load(), { ok: true });
  assert.equal(calls, 2);
});

test("a failed preload is not an unhandled rejection and doesn't block a later load", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    let fail = true;
    const mod = deferredModule(async () => {
      if (fail) throw new Error("offline");
      return 42;
    });
    mod.preload();
    // Let the rejection (and any unhandled-rejection report) settle.
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(unhandled, []);
    fail = false;
    assert.equal(await mod.load(), 42);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
