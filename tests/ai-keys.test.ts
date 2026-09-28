import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { indexedDB as fakeIndexedDB, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";

Object.assign(globalThis, { indexedDB: fakeIndexedDB, IDBKeyRange });

// Each query-string import is a separate module instance with its own cached
// connection and master key: a stand-in for a separate browser tab.
type Store = typeof import("../src/services/ai/crypto-store.ts");
let tabCounter = 0;
const openTab = (): Promise<Store> =>
  import(`../src/services/ai/crypto-store.ts?tab=${++tabCounter}`);

function deleteAiDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = fakeIndexedDB.deleteDatabase("localdox-ai");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("delete blocked by an open connection"));
  });
}

afterEach(async () => {
  globalThis.indexedDB = fakeIndexedDB;
  await deleteAiDb();
});

test("two fresh tabs racing to create the master key end up sharing one (D06)", async () => {
  const [a, b] = await Promise.all([openTab(), openTab()]);
  await Promise.all([a.encryptSecret("key:a", "secret-a"), b.encryptSecret("key:b", "secret-b")]);

  // A tab opened after a reload sees only what was committed. Both secrets
  // must still decrypt, so neither tab sealed its secret with a lost key.
  const later = await openTab();
  assert.equal(await later.decryptSecret("key:a"), "secret-a");
  assert.equal(await later.decryptSecret("key:b"), "secret-b");
  assert.equal(await a.decryptSecret("key:b"), "secret-b");
  assert.equal(await b.decryptSecret("key:a"), "secret-a");
});

test("many tabs racing still store exactly one master key", async () => {
  const tabs = await Promise.all(Array.from({ length: 6 }, openTab));
  await Promise.all(tabs.map((t, i) => t.encryptSecret(`key:${i}`, `value-${i}`)));
  const later = await openTab();
  for (let i = 0; i < tabs.length; i++) {
    assert.equal(await later.decryptSecret(`key:${i}`), `value-${i}`);
  }
});

test("a secret write is acknowledged only after its transaction commits", async () => {
  const tab = await openTab();
  await tab.encryptSecret("key:warmup", "creates the master key");

  // Let the put itself succeed, then abort the transaction before commit, as
  // a quota failure or a closing tab would.
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
    const req = put.apply(this, args);
    req.addEventListener("success", () => this.transaction.abort());
    return req;
  };
  try {
    await assert.rejects(tab.encryptSecret("key:gemini", "never stored"));
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  assert.equal(await tab.decryptSecret("key:gemini"), null);
  assert.deepEqual(await tab.listSecretIds(), ["key:warmup"]);
});

test("a failed open is retried on the next call instead of cached forever", async () => {
  const tab = await openTab();
  globalThis.indexedDB = {
    open() {
      throw new Error("storage temporarily unavailable");
    },
  } as unknown as IDBFactory;
  await assert.rejects(tab.encryptSecret("key:a", "x"), /temporarily unavailable/);
  await assert.rejects(tab.listSecretIds(), /temporarily unavailable/);

  globalThis.indexedDB = fakeIndexedDB;
  await tab.encryptSecret("key:a", "x");
  assert.equal(await tab.decryptSecret("key:a"), "x");
});

test("an open tab steps aside when another deletes the database, then recovers", async () => {
  const tab = await openTab();
  await tab.encryptSecret("key:old", "sealed with the first key");

  // Without a versionchange handler this delete is blocked by tab's connection.
  await deleteAiDb();

  // The old master key went with the database. A new secret must be sealed
  // with a key that is actually saved, or it is unreadable after reload.
  await tab.encryptSecret("key:new", "sealed after the reset");
  const later = await openTab();
  assert.equal(await later.decryptSecret("key:new"), "sealed after the reset");
  assert.equal(await later.decryptSecret("key:old"), null);
});

test("setKey that fails to persist does not leave the key cached as saved", async () => {
  const keys = await import("../src/services/ai/keys.ts?tab=keys");
  assert.equal(keys.storageMode(), "encrypted");
  await keys.setKey("gemini", "warmup-key");
  await keys.removeKey("gemini");

  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
    const req = put.apply(this, args);
    req.addEventListener("success", () => this.transaction.abort());
    return req;
  };
  try {
    await assert.rejects(keys.setKey("gemini", "  failed-key  "));
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  assert.equal(await keys.getKey("gemini"), null);
  assert.deepEqual(await keys.listConfigured(), []);

  await keys.setKey("gemini", "  good-key  ");
  assert.equal(await keys.getKey("gemini"), "good-key");
  assert.deepEqual(await keys.listConfigured(), ["gemini"]);
});
