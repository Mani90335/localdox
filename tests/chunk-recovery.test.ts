import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  AUTO_RELOAD_WINDOW_MS,
  failedAssetUrl,
  isChunkLoadError,
  planRecovery,
  probeAsset,
} from "../src/lib/app/stale-chunk.ts";
import {
  AT_RISK_PROMPT,
  holdReload,
  prepareReload,
  registerReloadGuard,
  reloadConfirmed,
  reloadSafely,
  resetReloadGuardForTests,
  type ReloadGuard,
} from "../src/lib/app/safe-reload.ts";

// B04: a failed chunk used to reload the page at once, over unsaved work, and
// even when offline. These pin down when a reload is automatic, when it is
// only offered, and that it never starts before the pending save is written.

const ORIGIN = "https://localdox.web.app";

afterEach(resetReloadGuardForTests);

test("recognises chunk download failures from each engine, and nothing else", () => {
  for (const message of [
    `Failed to fetch dynamically imported module: ${ORIGIN}/assets/SettingsPage-Ab12.js`,
    `error loading dynamically imported module: ${ORIGIN}/assets/x.js`,
    "Importing a module script failed.",
    "Unable to preload CSS for /assets/viewer-9f.css",
  ]) {
    assert.equal(isChunkLoadError(new TypeError(message)), true, message);
  }
  assert.equal(isChunkLoadError(new Error("Cannot read properties of undefined")), false);
  assert.equal(isChunkLoadError(null), false);
});

test("finds the failed build file, same-origin only", () => {
  assert.equal(
    failedAssetUrl(
      new TypeError(`Failed to fetch dynamically imported module: ${ORIGIN}/assets/a-1.js`),
      ORIGIN,
    ),
    `${ORIGIN}/assets/a-1.js`,
  );
  assert.equal(
    failedAssetUrl(new Error("Unable to preload CSS for /assets/b-2.css"), ORIGIN),
    `${ORIGIN}/assets/b-2.css`,
  );
  assert.equal(failedAssetUrl(new TypeError("Importing a module script failed."), ORIGIN), null);
  assert.equal(
    failedAssetUrl(
      new TypeError("Failed to fetch dynamically imported module: https://evil.test/assets/a.js"),
      ORIGIN,
    ),
    null,
  );
});

const answer = (status: number, type: string) => async () => ({
  ok: status >= 200 && status < 300,
  headers: new Headers({ "content-type": type }),
});

test("probe: HTML fallback or an error status means a newer build is deployed", async () => {
  const url = `${ORIGIN}/assets/a.js`;
  assert.equal(
    await probeAsset(url, { fetch: answer(200, "text/html; charset=utf-8"), online: true }),
    "missing",
  );
  assert.equal(
    await probeAsset(url, { fetch: answer(404, "text/plain"), online: true }),
    "missing",
  );
  assert.equal(
    await probeAsset(url, { fetch: answer(200, "text/javascript"), online: true }),
    "present",
  );
});

test("probe: offline, unreachable or unanswered all count as offline; it bypasses caches", async () => {
  const url = `${ORIGIN}/assets/a.js`;
  let calls = 0;
  const spy = async () => {
    calls++;
    return { ok: true, headers: new Headers() };
  };
  assert.equal(await probeAsset(url, { fetch: spy, online: false }), "offline");
  assert.equal(calls, 0, "no request when the browser knows it is offline");

  const refused = async () => {
    throw new TypeError("Failed to fetch");
  };
  assert.equal(await probeAsset(url, { fetch: refused, online: true }), "offline");

  const hangs = (_: string, init: RequestInit) =>
    new Promise<never>((_, reject) =>
      init.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      ),
    );
  assert.equal(await probeAsset(url, { fetch: hangs, online: true, timeoutMs: 20 }), "offline");

  let seen: RequestInit | undefined;
  await probeAsset(url, {
    fetch: async (_, init) => {
      seen = init;
      return { ok: true, headers: new Headers({ "content-type": "text/javascript" }) };
    },
    online: true,
  });
  assert.equal(seen?.method, "HEAD");
  assert.equal(seen?.cache, "no-store");
  assert.equal(await probeAsset(null, { fetch: spy, online: true }), "unknown");
});

test("plan: reload by itself only when nothing unsaved, online, and not already tried", () => {
  const now = 10 * AUTO_RELOAD_WINDOW_MS;
  assert.deepEqual(planRecovery({ probe: "missing", idle: true, lastAutoReloadAt: null, now }), {
    kind: "reload",
  });
  assert.deepEqual(planRecovery({ probe: "present", idle: true, lastAutoReloadAt: null, now }), {
    kind: "reload",
  });
  // Unsaved work: never automatic.
  assert.deepEqual(planRecovery({ probe: "missing", idle: false, lastAutoReloadAt: null, now }), {
    kind: "offer",
    reason: "updated",
  });
  // Offline: a reload can't fetch the file either.
  assert.deepEqual(planRecovery({ probe: "offline", idle: true, lastAutoReloadAt: null, now }), {
    kind: "offer",
    reason: "offline",
  });
  // One automatic reload per window, whatever the error message was.
  assert.deepEqual(
    planRecovery({ probe: "missing", idle: true, lastAutoReloadAt: now - 1_000, now }),
    { kind: "offer", reason: "updated" },
  );
  assert.deepEqual(
    planRecovery({ probe: "unknown", idle: true, lastAutoReloadAt: now - 1_000, now }),
    { kind: "offer", reason: "failed" },
  );
  assert.deepEqual(
    planRecovery({
      probe: "missing",
      idle: true,
      lastAutoReloadAt: now - AUTO_RELOAD_WINDOW_MS,
      now,
    }),
    { kind: "reload" },
  );
});

function guard(state: { unsaved: boolean; lost?: boolean; saveMs?: number; saveOk?: boolean }) {
  const log: string[] = [];
  const value: ReloadGuard = {
    flush: () =>
      new Promise((resolve) =>
        setTimeout(() => {
          if (state.saveOk !== false) state.unsaved = false;
          log.push("saved");
          resolve(state.saveOk !== false);
        }, state.saveMs ?? 5),
      ),
    idle: () => !state.unsaved,
    atRisk: () => state.unsaved && (state.lost ?? true),
  };
  return { value, log };
}

test("prepareReload writes pending work before judging it", async () => {
  const state = { unsaved: true };
  const g = guard(state);
  registerReloadGuard(g.value);
  assert.equal(await prepareReload(), "clean");
  assert.deepEqual(g.log, ["saved"]);
});

test("prepareReload: a refused save is at risk; journalled editor text is recoverable", async () => {
  registerReloadGuard(guard({ unsaved: true, saveOk: false }).value);
  assert.equal(await prepareReload(), "at-risk");

  registerReloadGuard({
    flush: async () => true,
    idle: () => false,
    atRisk: () => false,
  });
  assert.equal(await prepareReload(), "recoverable");
});

test("prepareReload gives up waiting on a stuck save, and reports it at risk", async () => {
  registerReloadGuard(guard({ unsaved: true, saveMs: 300 }).value);
  assert.equal(await prepareReload(30), "at-risk");
});

test("an unmounted page's final write is still awaited", async () => {
  let done = false;
  holdReload(new Promise((resolve) => setTimeout(() => resolve((done = true)), 20)));
  assert.equal(await prepareReload(), "clean");
  assert.equal(done, true);

  // And a failed one can't hang or throw.
  holdReload(Promise.reject(new Error("aborted")));
  assert.equal(await prepareReload(), "clean");
});

test("the unregister function only removes its own guard", async () => {
  const first = registerReloadGuard(guard({ unsaved: true, saveOk: false }).value);
  registerReloadGuard(guard({ unsaved: false }).value);
  first();
  assert.equal(await prepareReload(), "clean");
});

test("reloadSafely: saves first, then reloads", async () => {
  const state = { unsaved: true };
  const g = guard(state);
  registerReloadGuard(g.value);
  let prompted = false;
  const reloaded = await reloadSafely({
    reload: () => g.log.push("reload"),
    confirm: () => (prompted = true),
  });
  assert.equal(reloaded, true);
  assert.equal(prompted, false);
  assert.deepEqual(g.log, ["saved", "reload"]);
  assert.equal(reloadConfirmed(), false);
});

test("reloadSafely: asks before dropping unsaveable changes, and respects 'stay'", async () => {
  registerReloadGuard(guard({ unsaved: true, saveOk: false }).value);
  const asked: string[] = [];
  let reloads = 0;
  const stayed = await reloadSafely({
    reload: () => reloads++,
    confirm: (message) => {
      asked.push(message);
      return false;
    },
  });
  assert.equal(stayed, false);
  assert.equal(reloads, 0);
  assert.deepEqual(asked, [AT_RISK_PROMPT]);
  assert.equal(reloadConfirmed(), false);

  const went = await reloadSafely({ reload: () => reloads++, confirm: () => true });
  assert.equal(went, true);
  assert.equal(reloads, 1);
  // The page's beforeunload prompt stands down for a reload already agreed to.
  assert.equal(reloadConfirmed(), true);
});
