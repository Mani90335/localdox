// The reader's own uploaded typeface.
//
// Font binaries are far too large for the localStorage prefs blob, so the file
// itself lives in IndexedDB and only the *name* rides along in prefs. On boot
// the stored blob is registered with the FontFace API under one fixed family
// name, which `[data-font="custom"]` in styles.css points at — so switching to
// the custom face is the same one-attribute swap as every built-in font.

/** The family name the CSS refers to. Fixed, so the stylesheet can name it. */
export const CUSTOM_FONT_FAMILY = "Localdox Custom";

const DB_NAME = "localdox-fonts";
const DB_VERSION = 1;
const STORE = "fonts";
const KEY = "reading";

export interface CustomFontRecord {
  /** Original filename, shown in settings so the reader knows what is loaded. */
  name: string;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** Kept in its own database rather than the workspace one: clearing workspaces
 *  must not drop the reader's font, and a separate file needs no version bump
 *  of the store that holds their documents. */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function request<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function getCustomFont(): Promise<CustomFontRecord | undefined> {
  return request<CustomFontRecord | undefined>("readonly", (s) => s.get(KEY)).catch(
    () => undefined,
  );
}

export function putCustomFont(record: CustomFontRecord): Promise<void> {
  return request<IDBValidKey>("readwrite", (s) => s.put(record, KEY)).then(() => {});
}

export function deleteCustomFont(): Promise<void> {
  return request<undefined>("readwrite", (s) => s.delete(KEY)).then(() => {});
}

/** Accepted upload types. woff2 is included because it is strictly better than
 *  ttf when the reader happens to have one, and costs nothing to allow. */
export const CUSTOM_FONT_ACCEPT = ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2";

const VALID_EXTENSION = /\.(ttf|otf|woff2?)$/i;

export function isSupportedFontFile(file: File): boolean {
  return VALID_EXTENSION.test(file.name);
}

/** Registers a blob as the custom family. Replaces whatever was registered
 *  before, so re-uploading swaps the face without a reload. */
export async function registerCustomFont(blob: Blob): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const buffer = await blob.arrayBuffer();
  const face = new FontFace(CUSTOM_FONT_FAMILY, buffer);
  await face.load();
  // Drop any previous registration first: FontFaceSet keeps both otherwise and
  // the older face wins for glyphs the new one also defines.
  document.fonts.forEach((existing) => {
    if (existing.family === CUSTOM_FONT_FAMILY) document.fonts.delete(existing);
  });
  document.fonts.add(face);
}

export function unregisterCustomFont(): void {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  document.fonts.forEach((existing) => {
    if (existing.family === CUSTOM_FONT_FAMILY) document.fonts.delete(existing);
  });
}

/** Load and register the stored font, if there is one. Called on boot so a
 *  custom face is on screen before the reader opens anything. */
export async function restoreCustomFont(): Promise<CustomFontRecord | undefined> {
  const record = await getCustomFont();
  if (!record) return undefined;
  try {
    await registerCustomFont(record.blob);
  } catch {
    // A corrupt or unsupported file is not worth surfacing on boot; the
    // fallback stack is already rendering.
    return undefined;
  }
  return record;
}
