// Encrypted-at-rest storage for API keys, no passphrase required.
//
// Strategy: generate one AES-GCM CryptoKey with extractable=false and persist
// the CryptoKey object itself in IndexedDB. Non-extractable keys are structured-
// cloneable — the browser stores the raw material opaquely and never exposes it
// to JS, so we get real encryption that survives refresh without ever asking the
// user for a passphrase. API-key ciphertext lives in the same IDB db.
//
// If WebCrypto or IndexedDB is unavailable, callers fall back to obfuscated
// localStorage (see keys.ts) and surface a "less secure" warning.

const DB_NAME = "localdox-ai";
const DB_VERSION = 1;
const KEY_STORE = "crypto-key";
const SECRET_STORE = "secrets";
const MASTER_KEY_ID = "master";

export type StorageMode = "encrypted" | "insecure-fallback";

interface EncryptedRecord {
  id: string;
  iv: number[];
  data: number[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

function hasWebCrypto(): boolean {
  return (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof indexedDB !== "undefined"
  );
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
      if (!db.objectStoreNames.contains(SECRET_STORE)) {
        db.createObjectStore(SECRET_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function idbRequest<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

let masterKeyPromise: Promise<CryptoKey> | null = null;

async function getMasterKey(): Promise<CryptoKey> {
  if (masterKeyPromise) return masterKeyPromise;
  masterKeyPromise = (async () => {
    const existing = await idbRequest<CryptoKey | undefined>(KEY_STORE, "readonly", (s) =>
      s.get(MASTER_KEY_ID),
    );
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await idbRequest<IDBValidKey>(KEY_STORE, "readwrite", (s) => s.put(key, MASTER_KEY_ID));
    return key;
  })();
  return masterKeyPromise;
}

/** Whether encrypted storage is possible in this environment. */
export function encryptedStorageAvailable(): boolean {
  return hasWebCrypto();
}

export async function encryptSecret(id: string, plaintext: string): Promise<void> {
  const key = await getMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const record: EncryptedRecord = {
    id,
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(cipher)),
  };
  await idbRequest<IDBValidKey>(SECRET_STORE, "readwrite", (s) => s.put(record));
}

export async function decryptSecret(id: string): Promise<string | null> {
  const record = await idbRequest<EncryptedRecord | undefined>(SECRET_STORE, "readonly", (s) =>
    s.get(id),
  );
  if (!record) return null;
  const key = await getMasterKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(record.iv) },
    key,
    new Uint8Array(record.data),
  );
  return new TextDecoder().decode(plain);
}

export async function deleteSecret(id: string): Promise<void> {
  await idbRequest<undefined>(SECRET_STORE, "readwrite", (s) => s.delete(id));
}

export async function listSecretIds(): Promise<string[]> {
  const keys = await idbRequest<IDBValidKey[]>(SECRET_STORE, "readonly", (s) => s.getAllKeys());
  return keys.map(String);
}
