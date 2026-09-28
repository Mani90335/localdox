// Encrypted-at-rest storage for API keys, no passphrase required.
//
// Strategy: generate one AES-GCM CryptoKey with extractable=false and persist
// the CryptoKey object itself in IndexedDB. Non-extractable keys are structured-
// cloneable — the browser stores the raw material opaquely and never exposes it
// to JS, so key ciphertext on disk is useless without this origin's key. It is
// not an XSS boundary: any script running on this origin can call decryptSecret.
// API-key ciphertext lives in the same IDB db.
//
// Every write resolves only once its transaction has committed, so a caller
// that reports "saved" is telling the truth.
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
let masterKeyPromise: Promise<CryptoKey> | null = null;

function hasWebCrypto(): boolean {
  return (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof indexedDB !== "undefined"
  );
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  let blocked = false;
  const opening: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
      if (!db.objectStoreNames.contains(SECRET_STORE)) {
        db.createObjectStore(SECRET_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (blocked) {
        db.close();
        return;
      }
      // Another tab is upgrading or deleting the database: step aside instead
      // of blocking it. The master key may be gone after that, so forget it
      // too, or new secrets would be sealed with a key that is no longer saved.
      db.onversionchange = () => {
        db.close();
        if (dbPromise === guarded) dbPromise = null;
        masterKeyPromise = null;
      };
      db.onclose = () => {
        if (dbPromise === guarded) dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("Could not open key storage"));
    req.onblocked = () => {
      blocked = true;
      reject(new Error("Close other Localdox tabs to finish updating key storage"));
    };
  });
  // A failed open must not poison every later call for the rest of the session.
  const guarded: Promise<IDBDatabase> = opening.catch((error) => {
    if (dbPromise === guarded) dbPromise = null;
    throw error;
  });
  dbPromise = guarded;
  return guarded;
}

/** Runs one request and resolves with its result once the transaction commits. */
function transact<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req.result);
        t.onabort = () =>
          reject(t.error ?? req.error ?? new Error("Key storage transaction aborted"));
      }),
  );
}

async function loadOrCreateMasterKey(): Promise<CryptoKey> {
  const existing = await transact<CryptoKey | undefined>(KEY_STORE, "readonly", (s) =>
    s.get(MASTER_KEY_ID),
  );
  if (existing) return existing;
  // Generating is async, and awaiting inside a transaction would let it
  // auto-commit, so make a candidate first. The check-and-install below shares
  // one readwrite transaction, which IndexedDB serialises against every other
  // tab's: exactly one key is ever stored, and a tab that lost the race adopts
  // the winner instead of sealing secrets with a key nobody kept.
  const candidate = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  const db = await openDb();
  return new Promise<CryptoKey>((resolve, reject) => {
    const t = db.transaction(KEY_STORE, "readwrite");
    const store = t.objectStore(KEY_STORE);
    let winner = candidate;
    const current = store.get(MASTER_KEY_ID);
    current.onsuccess = () => {
      if (current.result) winner = current.result as CryptoKey;
      else store.add(candidate, MASTER_KEY_ID);
    };
    t.oncomplete = () => resolve(winner);
    t.onabort = () => reject(t.error ?? new Error("Could not save the encryption key"));
  });
}

function getMasterKey(): Promise<CryptoKey> {
  if (masterKeyPromise) return masterKeyPromise;
  const loading: Promise<CryptoKey> = loadOrCreateMasterKey().catch((error) => {
    if (masterKeyPromise === loading) masterKeyPromise = null;
    throw error;
  });
  masterKeyPromise = loading;
  return loading;
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
  await transact<IDBValidKey>(SECRET_STORE, "readwrite", (s) => s.put(record));
}

export async function decryptSecret(id: string): Promise<string | null> {
  const record = await transact<EncryptedRecord | undefined>(SECRET_STORE, "readonly", (s) =>
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
  await transact<undefined>(SECRET_STORE, "readwrite", (s) => s.delete(id));
}

export async function listSecretIds(): Promise<string[]> {
  const keys = await transact<IDBValidKey[]>(SECRET_STORE, "readonly", (s) => s.getAllKeys());
  return keys.map(String);
}
