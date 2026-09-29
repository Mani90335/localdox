// Local-first persistence, Excalidraw-style. No backend.
//
// - IndexedDB is the primary store: workspaces (markdown files + edits + UI
//   state) live here, keyed by workspace id.
// - localStorage holds only lightweight preferences (theme, last-opened
//   workspace). Reading progress, recent searches and sidebar width keep their
//   own small localStorage keys elsewhere; they already survive refresh.
//
// All IndexedDB access is funnelled through this module so UI components never
// touch the database directly.

import type { MathRendererType } from "@/services/math";
import {
  ImportValidationError,
  parseImportJson,
  validateWorkspaceImport,
} from "./import-schema.ts";
import { parseDerivation, remapDerivation } from "../../services/doc-conversion/types.ts";
import { storedBytes, storedFileBytes } from "./storage-limits.ts";

export interface PersistedFile {
  derivedFrom?: import("@/services/doc-conversion").Derivation;
  id: string;
  name: string;
  content: string;
  data?: string;
  mimeType?: string;
  size?: number;
  addedAt?: number;
  kind?: import("../markdown/markdown-utils").DocumentKind;
  /** Sidebar folder this file is filed under; null/undefined = top level. */
  folderId?: string | null;
  /**
   * Epoch ms the file was moved to the Bin, or null/undefined when it is live.
   *
   * The Bin replaced a separate Archive and Delete: one reversible action, with
   * the reversal window written down rather than implied. Anything older than
   * BIN_RETENTION_MS is purged when the workspace loads — there is no
   * background process in a local-first app, so "30 days" means "swept the next
   * time the app is opened after 30 days".
   */
  deletedAt?: number | null;
}

/** How long a binned document is recoverable before it is purged. */
export const BIN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** True when a binned file has outlived the recovery window. */
export function isBinExpired(deletedAt: number | null | undefined, now = Date.now()): boolean {
  return typeof deletedAt === "number" && now - deletedAt >= BIN_RETENTION_MS;
}

/**
 * A sidebar folder. Purely an organizational bucket over the flat file list —
 * files keep living in `WorkspaceRecord.files` and point back with `folderId`,
 * so a workspace whose folders are dropped (an older build, a share link)
 * degrades to the flat list rather than losing documents.
 */
export interface FolderRecord {
  /** Managed attachment folder, independent of its display name. */
  purpose?: "embed-media";
  id: string;
  name: string;
  createdAt: number;
  /**
   * Folder this one sits inside; null/undefined = top level.
   *
   * Nesting is stored the same way filing is: a flat list with a pointer up,
   * rather than folders containing folders. A record whose parent is missing
   * (deleted, or dropped by an older build that never wrote this field) is
   * rendered at the top level instead of disappearing with its documents.
   */
  parentId?: string | null;
}

/**
 * One column of the reader, holding its own ordered tabs.
 *
 * Panes own their tabs and the app derives the single "active file" from
 * whichever pane has focus. That way the sidebar, the command palette, stars
 * and the nav trail all keep asking the same question they always did, and
 * only the answer's source changes.
 */
export interface PersistedPane {
  id: string;
  /** File ids, in tab order. */
  tabs: string[];
  /** Which of `tabs` is on screen in this pane. */
  activeTabId: string | null;
}

export interface PersistedUI {
  activeFileId: string | null;
  expanded: Record<string, boolean>;
  sidebarCollapsed: boolean;
  scrollTop: number;
  fileOrder?: string[];
  /** File ids in most-recently-opened order — drives the "Recent" chip. */
  recentFileIds?: string[];
  /**
   * Split layout. Absent or empty in a workspace written before panes existed,
   * which reads as a single pane holding `activeFileId` — so an older workspace
   * opens exactly as it used to.
   */
  panes?: PersistedPane[];
  focusedPaneId?: string | null;
}

import type { Highlight } from "../markdown/dom-highlighter";
import type { SavedItem } from "./saved-items";

export interface WorkspaceRecord {
  /**
   * Storage revision this snapshot was read at (or last written as). A write
   * without one creates the workspace and fails if it already exists; a write
   * with one updates it and fails if storage has moved on. Never part of a
   * backup.
   */
  revision?: string;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  files: PersistedFile[];
  folders?: FolderRecord[];
  /**
   * Legacy `${fileId}#${subtopicId}` stars. Still written so a downgrade keeps
   * working, but `saved` is the source of truth — see `migrateBookmarks`.
   */
  bookmarks: string[];
  /** Stars on files, sections, blocks and selections. */
  saved?: SavedItem[];
  highlights?: Highlight[];
  ui: PersistedUI;
}

export type SaveStatus =
  "idle" | "pending" | "saving" | "saved" | "restored" | "error" | "conflict";

export type ConflictReason = "changed" | "deleted" | "exists";

/**
 * A write was refused because storage no longer holds the revision the caller
 * read. Nothing was written; the caller still holds its snapshot and has to
 * decide, with the reader, what to do with it.
 */
export class WorkspaceConflictError extends Error {
  readonly workspaceId: string;
  readonly reason: ConflictReason;
  constructor(workspaceId: string, reason: ConflictReason = "changed") {
    super(
      reason === "deleted"
        ? "This workspace was deleted in another tab. Your copy is still open here."
        : reason === "exists"
          ? "A workspace with this identity already exists."
          : "This workspace changed in another tab. Your changes have not been saved yet.",
    );
    this.name = "WorkspaceConflictError";
    this.workspaceId = workspaceId;
    this.reason = reason;
  }
}

const DB_NAME = "localdox";
const DB_VERSION = 3;
const STORE = "workspaces";
const FILES = "files";
const SUMMARIES = "workspace-summaries";
// Binary bodies (the base64 data URL of a PDF, image, …) live apart from the
// file rows, keyed the same way. Reading a workspace's file list and text then
// never deserializes a PDF: IndexedDB has no partial reads, so a body stored
// inside its file row was loaded by every read of that row.
const BODIES = "file-bodies";

export interface WorkspaceSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  docCount: number;
  /**
   * Stored bytes of every file, Bin included (storage-limits.ts). Written with
   * each commit; rows from older builds lack it until storedBytesByWorkspace
   * fills it in.
   */
  bytes?: number;
}

type StoredWorkspace = Omit<WorkspaceRecord, "files"> & { fileIds: string[]; revision: string };
type StoredFile = Omit<PersistedFile, "data"> & { workspaceId: string };
type StoredBody = { workspaceId: string; id: string; data: string };

/** A file without its binary body: everything a list, a link or search needs. */
export type FileEntry = Omit<PersistedFile, "data">;
/** A workspace read without binary bodies (`persistence.getWorkspaceEntries`). */
export type WorkspaceEntries = Omit<WorkspaceRecord, "files"> & { files: FileEntry[] };

/** Every key of one workspace in a store keyed by [workspaceId, id]. */
function workspaceRange(workspaceId: string) {
  return IDBKeyRange.bound([workspaceId], [workspaceId, []]);
}

/** Split a file into its row and its body. */
function storedRow(workspaceId: string, file: PersistedFile): StoredFile {
  const { data: _data, ...entry } = file;
  return { ...entry, workspaceId };
}

function summaryOf(w: WorkspaceRecord, bytes: number): WorkspaceSummary {
  return {
    id: w.id,
    name: w.name,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    docCount: w.files.length,
    bytes,
  };
}

// Retain only the last workspace's file references, never a second copy of its
// document bytes. The on-disk revision guards this optimization across tabs.
// `bytes` remembers each file's stored size, so a save measures only the files
// it actually writes.
let lastWrite: {
  id: string;
  revision: string;
  files: Map<string, PersistedFile>;
  bytes: Map<string, number>;
} | null = null;

// Every write (and every read that must observe earlier writes) issued by this
// tab runs through one FIFO. Route changes remount the app, and the outgoing
// instance's final save has to land before the incoming one reads.
let queue: Promise<unknown> = Promise.resolve();

// Other tabs learn about commits here. A message is only a hint to reload;
// the revision check inside each write transaction is what prevents loss.
export type WorkspaceChange =
  | { type: "changed"; id: string; revision: string }
  | { type: "deleted"; id: string }
  | { type: "cleared" };
let channel: BroadcastChannel | null | undefined;
const listeners = new Set<(change: WorkspaceChange) => void>();

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  if (typeof BroadcastChannel === "undefined") return (channel = null);
  channel = new BroadcastChannel("localdox:workspaces");
  // Node's test runner would otherwise keep the process alive.
  (channel as unknown as { unref?: () => void }).unref?.();
  channel.onmessage = (event: MessageEvent<WorkspaceChange>) => {
    for (const listener of listeners) listener(event.data);
  };
  return channel;
}

function announce(change: WorkspaceChange) {
  try {
    getChannel()?.postMessage(change);
  } catch {
    // A closed channel only costs other tabs an early warning.
  }
}

function sameFile(a: PersistedFile | undefined, b: PersistedFile): boolean {
  return (
    !!a &&
    a.id === b.id &&
    a.name === b.name &&
    a.content === b.content &&
    a.data === b.data &&
    a.mimeType === b.mimeType &&
    a.size === b.size &&
    a.addedAt === b.addedAt &&
    a.kind === b.kind &&
    a.folderId === b.folderId &&
    a.deletedAt === b.deletedAt &&
    JSON.stringify(a.derivedFrom) === JSON.stringify(b.derivedFrom)
  );
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      if (blocked) {
        req.transaction!.abort();
        return;
      }
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      const bodies = db.createObjectStore(BODIES, { keyPath: ["workspaceId", "id"] });
      const putBody = (workspaceId: string, file: PersistedFile) => {
        if (file.data !== undefined) bodies.put({ workspaceId, id: file.id, data: file.data });
      };
      // Each migration is one atomic upgrade: if it aborts, the previous
      // version's data is untouched and the next open tries again.
      if (event.oldVersion >= 2) {
        // v2 → v3: move bodies out of their file rows, one row at a time.
        const cursor = req.transaction!.objectStore(FILES).openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          const file = row.value as StoredFile & { data?: string };
          if (file.data !== undefined) {
            putBody(file.workspaceId, file);
            row.update(storedRow(file.workspaceId, file));
          }
          row.continue();
        };
        return;
      }
      const files = db.createObjectStore(FILES, { keyPath: ["workspaceId", "id"] });
      files.createIndex("workspaceId", "workspaceId");
      const summaries = db.createObjectStore(SUMMARIES, { keyPath: "id" });
      // v1 → v3. Use a cursor so only one legacy workspace is materialized at
      // a time.
      const cursor = req.transaction!.objectStore(STORE).openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        const workspace = row.value as WorkspaceRecord;
        for (const file of workspace.files) {
          files.put(storedRow(workspace.id, file));
          putBody(workspace.id, file);
        }
        const { files: documents, ...metadata } = workspace;
        row.update({
          ...metadata,
          fileIds: documents.map((f) => f.id),
          revision: crypto.randomUUID(),
        });
        summaries.put(summaryOf(workspace, storedBytes(workspace.files)));
        row.continue();
      };
    };
    req.onsuccess = () => {
      const db = req.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
        lastWrite = null;
      };
      db.onclose = () => {
        dbPromise = null;
        lastWrite = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      blocked = true;
      reject(new Error("Close other Localdox tabs to finish updating local storage"));
    };
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

function request<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
  store = STORE,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req.result);
        t.onabort = () => reject(t.error ?? new Error("Local storage transaction aborted"));
        req.onerror = () => reject(req.error);
      }),
  );
}

async function deleteDatabase(): Promise<void> {
  const openDatabase = dbPromise;
  dbPromise = null;
  lastWrite = null;

  try {
    (await openDatabase)?.close();
  } catch {
    // The database may never have opened; deletion can still proceed.
  }

  if (typeof indexedDB === "undefined") return;

  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("Could not delete local database"));
    req.onblocked = () => reject(new Error("Close Localdox in other tabs before clearing storage"));
  });
  announce({ type: "cleared" });
}

/**
 * Read one workspace's metadata and file rows, and with `withBodies` its
 * binary bodies too, in one transaction.
 */
async function readWorkspace(
  id: string,
  withBodies: boolean,
): Promise<{ record: StoredWorkspace; files: PersistedFile[] } | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(withBodies ? [STORE, FILES, BODIES] : [STORE, FILES], "readonly");
    const metadata = tx.objectStore(STORE).get(id);
    const documents = tx.objectStore(FILES).index("workspaceId").getAll(id);
    const bodies = withBodies ? tx.objectStore(BODIES).getAll(workspaceRange(id)) : undefined;
    tx.onabort = () => reject(tx.error ?? new Error("Could not read workspace"));
    tx.oncomplete = () => {
      const record = metadata.result as StoredWorkspace | undefined;
      if (!record) {
        resolve(undefined);
        return;
      }
      const data = new Map(
        ((bodies?.result ?? []) as StoredBody[]).map((body) => [body.id, body.data]),
      );
      const byId = new Map<string, PersistedFile>(
        (documents.result as StoredFile[]).map(({ workspaceId: _id, ...file }) => {
          const body = data.get(file.id);
          return [file.id, body === undefined ? file : { ...file, data: body }];
        }),
      );
      const files = record.fileIds.map((fileId) => byId.get(fileId));
      if (files.some((file) => !file)) {
        reject(new Error("Workspace has a missing file"));
        return;
      }
      resolve({ record, files: files as PersistedFile[] });
    };
  });
}

export const persistence = {
  /**
   * The whole workspace, binary bodies included: what the open workspace
   * holds and writes back. Anything that only lists, links or searches
   * should use `getWorkspaceEntries`.
   */
  async getWorkspace(id: string): Promise<WorkspaceRecord | undefined> {
    const read = await readWorkspace(id, true);
    if (!read) return undefined;
    const { fileIds: _ids, revision, ...workspace } = read.record;
    lastWrite = {
      id,
      revision,
      files: new Map(read.files.map((file) => [file.id, { ...file }])),
      bytes: new Map(),
    };
    return { ...workspace, revision, files: read.files };
  },
  /**
   * A workspace's metadata, folders and files with their text, but no binary
   * bodies. Cost follows the text, not the stored PDFs and images, and the
   * open workspace's write cache is left alone.
   */
  async getWorkspaceEntries(id: string): Promise<WorkspaceEntries | undefined> {
    const read = await readWorkspace(id, false);
    if (!read) return undefined;
    const { fileIds: _ids, ...workspace } = read.record;
    return { ...workspace, files: read.files };
  },
  /** One file with its body, or undefined if it isn't stored. */
  async getFile(workspaceId: string, fileId: string): Promise<PersistedFile | undefined> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([FILES, BODIES], "readonly");
      const row = tx.objectStore(FILES).get([workspaceId, fileId]);
      const body = tx.objectStore(BODIES).get([workspaceId, fileId]);
      tx.onabort = () => reject(tx.error ?? new Error("Could not read file"));
      tx.oncomplete = () => {
        const stored = row.result as StoredFile | undefined;
        if (!stored) {
          resolve(undefined);
          return;
        }
        const { workspaceId: _id, ...file } = stored;
        const data = (body.result as StoredBody | undefined)?.data;
        resolve(data === undefined ? file : { ...file, data });
      };
    });
  },
  /**
   * Create (no `revision`) or update (matching `revision`) one workspace.
   * Resolves once the transaction has committed and stores the new revision
   * on `w`, so the caller's next write is checked against it.
   */
  async putWorkspace(w: WorkspaceRecord): Promise<string> {
    const [revision] = await persistence.putWorkspaces([w]);
    return revision;
  },
  /**
   * Write several workspaces in one transaction: all commit or none do. Each
   * record is checked against its own expected revision, so a move can never
   * report success after writing only one side.
   */
  async putWorkspaces(records: WorkspaceRecord[]): Promise<string[]> {
    // Snapshot before awaiting; callers may keep editing their objects.
    const snapshots = records.map((w) => ({ ...w, files: w.files.map((file) => ({ ...file })) }));
    if (new Set(snapshots.map((w) => w.id)).size !== snapshots.length)
      throw new Error("A workspace can only be written once per transaction");
    const db = await openDb();
    const sizes = snapshots.map(() => new Map<string, number>());
    const revisions = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction([STORE, FILES, BODIES, SUMMARIES], "readwrite");
      const next = snapshots.map(() => crypto.randomUUID());
      let failure: unknown;
      snapshots.forEach((w, index) => {
        const current = tx.objectStore(STORE).get(w.id);
        current.onsuccess = () => {
          if (failure) return;
          try {
            const previous = current.result as StoredWorkspace | undefined;
            if (w.revision === undefined && previous)
              throw new WorkspaceConflictError(w.id, "exists");
            if (w.revision !== undefined && !previous)
              throw new WorkspaceConflictError(w.id, "deleted");
            if (previous && previous.revision !== w.revision)
              throw new WorkspaceConflictError(w.id, "changed");
            const cached =
              lastWrite?.id === w.id && lastWrite.revision === previous?.revision
                ? lastWrite
                : undefined;
            const fileStore = tx.objectStore(FILES);
            const bodyStore = tx.objectStore(BODIES);
            const nextIds = new Set(w.files.map((file) => file.id));
            for (const id of previous?.fileIds ?? []) {
              if (nextIds.has(id)) continue;
              fileStore.delete([w.id, id]);
              bodyStore.delete([w.id, id]);
            }
            let bytes = 0;
            for (const file of w.files) {
              const before = cached?.files.get(file.id);
              const unchanged = sameFile(before, file);
              if (!unchanged) {
                fileStore.put(storedRow(w.id, file));
                // Renaming, filing or binning a PDF rewrites its row, not its
                // body. Without a cached copy the stored body is unknown, so
                // it is written (or cleared) too.
                if (!before || before.data !== file.data) {
                  if (file.data === undefined) bodyStore.delete([w.id, file.id]);
                  else bodyStore.put({ workspaceId: w.id, id: file.id, data: file.data });
                }
              }
              const size =
                (unchanged ? cached!.bytes.get(file.id) : undefined) ?? storedFileBytes(file);
              sizes[index].set(file.id, size);
              bytes += size;
            }
            const { files, revision: _expected, ...metadata } = w;
            tx.objectStore(STORE).put({
              ...metadata,
              fileIds: files.map((file) => file.id),
              revision: next[index],
            });
            tx.objectStore(SUMMARIES).put(summaryOf(w, bytes));
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      });
      tx.onabort = () => reject(failure ?? tx.error ?? new Error("Could not save workspace"));
      tx.oncomplete = () => resolve(next);
    });
    snapshots.forEach((w, index) => {
      records[index].revision = revisions[index];
      lastWrite = {
        id: w.id,
        revision: revisions[index],
        files: new Map(w.files.map((file) => [file.id, file])),
        bytes: sizes[index],
      };
      announce({ type: "changed", id: w.id, revision: revisions[index] });
    });
    return revisions;
  },
  /**
   * Rename without reading or rewriting any document. With `expectedRevision`
   * the rename is refused if storage has moved on; returns the new revision.
   */
  async renameWorkspace(id: string, name: string, expectedRevision?: string): Promise<string> {
    const db = await openDb();
    const revision = crypto.randomUUID();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, SUMMARIES], "readwrite");
      let failure: unknown;
      const current = tx.objectStore(STORE).get(id);
      current.onsuccess = () => {
        const previous = current.result as StoredWorkspace | undefined;
        if (!previous || (expectedRevision !== undefined && previous.revision !== expectedRevision)) {
          failure = new WorkspaceConflictError(id, previous ? "changed" : "deleted");
          tx.abort();
          return;
        }
        tx.objectStore(STORE).put({ ...previous, name, revision });
        const summary = tx.objectStore(SUMMARIES).get(id);
        summary.onsuccess = () => {
          if (summary.result) tx.objectStore(SUMMARIES).put({ ...summary.result, name });
        };
      };
      tx.onabort = () => reject(failure ?? tx.error ?? new Error("Could not rename workspace"));
      tx.oncomplete = () => resolve();
    });
    if (lastWrite?.id === id) lastWrite = { ...lastWrite, revision };
    announce({ type: "changed", id, revision });
    return revision;
  },
  async deleteWorkspace(id: string): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, FILES, BODIES, SUMMARIES], "readwrite");
      tx.objectStore(FILES).delete(workspaceRange(id));
      tx.objectStore(BODIES).delete(workspaceRange(id));
      tx.objectStore(STORE).delete(id);
      tx.objectStore(SUMMARIES).delete(id);
      tx.onabort = () => reject(tx.error ?? new Error("Could not delete workspace"));
      tx.oncomplete = () => resolve();
    });
    if (lastWrite?.id === id) lastWrite = null;
    announce({ type: "deleted", id });
  },
  /**
   * Run `task` after every earlier queued task has settled. Writes from this
   * tab go through here so they commit in the order they were issued, and
   * reads that must see them (a route's hydrate) queue behind them.
   */
  serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  },
  /** Commits made by other tabs. Returns an unsubscribe function. */
  subscribe(listener: (change: WorkspaceChange) => void): () => void {
    getChannel();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  listWorkspaceSummaries() {
    return request<WorkspaceSummary[]>("readonly", (s) => s.getAll(), SUMMARIES);
  },
  /**
   * Stored bytes per workspace, from the summary rows. A row written by an
   * older build has no total yet: its files are measured once, one row at a
   * time through a cursor, and the total is written back in the same
   * transaction.
   */
  async storedBytesByWorkspace(): Promise<Map<string, number>> {
    const summaries = await persistence.listWorkspaceSummaries();
    const totals = new Map<string, number>();
    const missing: string[] = [];
    for (const summary of summaries) {
      if (typeof summary.bytes === "number") totals.set(summary.id, summary.bytes);
      else missing.push(summary.id);
    }
    if (missing.length === 0) return totals;
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([FILES, BODIES, SUMMARIES], "readwrite");
      for (const id of missing) {
        let bytes = 0;
        const rows = tx.objectStore(FILES).index("workspaceId").openCursor(id);
        rows.onsuccess = () => {
          const row = rows.result;
          if (row) {
            bytes += storedFileBytes(row.value as StoredFile);
            row.continue();
            return;
          }
          const bodies = tx.objectStore(BODIES).openCursor(workspaceRange(id));
          bodies.onsuccess = () => {
            const body = bodies.result;
            if (body) {
              bytes += (body.value as StoredBody).data.length;
              body.continue();
              return;
            }
            record();
          };
        };
        const record = () => {
          const summary = tx.objectStore(SUMMARIES).get(id);
          summary.onsuccess = () => {
            const current = summary.result as WorkspaceSummary | undefined;
            if (!current) return;
            tx.objectStore(SUMMARIES).put({ ...current, bytes });
            totals.set(id, bytes);
          };
        };
      }
      tx.onabort = () => reject(tx.error ?? new Error("Could not measure local storage"));
      tx.oncomplete = () => resolve();
    });
    return totals;
  },
  async clearAll(): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const stores = [STORE, FILES, BODIES, SUMMARIES];
      const tx = db.transaction(stores, "readwrite");
      for (const store of stores) tx.objectStore(store).clear();
      tx.onabort = () => reject(tx.error ?? new Error("Could not clear storage"));
      tx.oncomplete = () => {
        lastWrite = null;
        announce({ type: "cleared" });
        resolve();
      };
    });
  },
  destroy() {
    return deleteDatabase();
  },
};

// ---- scroll position (localStorage, per workspace) ----
//
// Scroll position used to ride along in the workspace record, which meant every
// scroll-stop wrote the entire workspace back to IndexedDB — every document's
// text plus every binary file's base64 data URL, structured-cloned in one go.
// In a workspace holding a few PDFs that is tens of megabytes of copying on the
// main thread, every time the reader stopped scrolling.
//
// It is one number. It lives in localStorage now, keyed per workspace, and the
// workspace record is only written when the workspace itself actually changes.
// `WorkspaceRecord.ui.scrollTop` is still populated on save so exports and
// share links keep working.

const SCROLL_KEY_PREFIX = "localdox:scroll:";

export function saveScrollTop(workspaceId: string, top: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SCROLL_KEY_PREFIX + workspaceId, String(Math.round(top)));
  } catch {
    /* storage unavailable — the position is simply not restored next time */
  }
}

export function loadScrollTop(workspaceId: string): number | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SCROLL_KEY_PREFIX + workspaceId);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function emptyUI(): PersistedUI {
  return {
    activeFileId: null,
    expanded: {},
    sidebarCollapsed: false,
    scrollTop: 0,
    fileOrder: [],
    recentFileIds: [],
    panes: [],
    focusedPaneId: null,
  };
}

export function newWorkspaceRecord(name: string): WorkspaceRecord {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    files: [],
    folders: [],
    bookmarks: [],
    saved: [],
    highlights: [],
    ui: emptyUI(),
  };
}

// ---- lightweight preferences (localStorage) ----

// One light and one dark palette, both WCAG-checked (see styles.css). The set
// was five; sepia/nord/black were dropped so there is one obvious choice per
// ambient light level rather than three near-identical dark variants.
export type ThemePref = "light" | "dark";

// Themes whose surfaces are dark — used to keep the legacy `.dark` class in sync
// so dark-only rules (code highlighting, katex, mermaid) still apply.
export const DARK_THEMES: readonly ThemePref[] = ["dark"];
export const READER_THEMES: readonly ThemePref[] = ["light", "dark"];

export function isDarkTheme(theme: ThemePref): boolean {
  return DARK_THEMES.includes(theme);
}

/** Stored prefs predating the trim name themes that no longer exist. Map each
 *  to whichever survivor matches its brightness, so an existing reader's screen
 *  does not invert under them. */
function migrateTheme(theme: unknown): ThemePref {
  if (theme === "light" || theme === "dark") return theme;
  if (theme === "sepia") return "light";
  if (theme === "nord" || theme === "black") return "dark";
  return DEFAULT_PREFS.theme;
}

// How a multi-section markdown document is laid out for reading.
// "paginated" = one section per page with prev/next; "single" = whole doc scrolls.
export type ReadingMode = "paginated" | "single";

// Reading typeface. Each maps to a --font-body / --font-heading pair in styles.css.
// One built-in face — Atkinson Hyperlegible, drawn for maximum letterform
// distinction — plus whatever the reader uploads themselves. The other bundled
// families were dropped: picking between five similar faces is not a decision
// worth putting in front of someone who wants to read.
export type ReadingFont = "hyperlegible" | "custom" | "google";
export const READING_FONTS: readonly ReadingFont[] = ["hyperlegible", "custom", "google"];

/** Old prefs name faces that are no longer bundled. They all collapse onto the
 *  one remaining built-in; "custom" only survives if a font is actually stored,
 *  and "google" only if a family name was saved alongside it — both of which
 *  the caller checks separately. */
function migrateFont(font: unknown): ReadingFont {
  if (font === "custom") return "custom";
  if (font === "google") return "google";
  return "hyperlegible";
}

export interface Prefs {
  theme: ThemePref;
  /**
   * Colour diagram nodes by what they mean — green for success, red for
   * failure, amber for a decision — rather than leaving every box the same
   * neutral fill. Applies to Raw and Stepped; Flow keeps the animator's own
   * palette, which already colours by packet.
   */
  diagramColors: boolean;
  /**
   * Let Stepped diagrams move the camera: close in on the part being drawn,
   * glide between parts, and pull back to the whole at the end. Off keeps the
   * whole diagram framed throughout. Reduced-motion system settings also hold
   * it still, whatever this says.
   */
  diagramCamera: boolean;
  /**
   * Stepped diagrams play arrows the author numbered (`A -->|1| B`) in that
   * order first. Off walks every diagram in the automatic order.
   */
  diagramFollowNumbers: boolean;
  /** Stepped diagrams show each arrow's step number on it as it is drawn. */
  diagramNumbers: boolean;
  /**
   * Whether the AI features exist at all.
   *
   * Off hides every AI surface — the Ask AI panel and its sidebar entry, the
   * Ask AI row on the selection popover, the settings tab — rather than
   * greying them out. A reader who does not want AI in their reader should not
   * have to look at it.
   */
  aiEnabled: boolean;
  /** Show uploaded attachment folders in the sidebar. Files remain available when hidden. */
  showEmbedMedia: boolean;
  lastWorkspaceId: string | null;
  // The reader's name, asked once and remembered for personalized greetings.
  name: string | null;
  // True once the reader has answered the name prompt (set a name or skipped),
  // so the greeting modal never asks again.
  namePrompted: boolean;
  readingMode: ReadingMode;
  readingFont: ReadingFont;
  /**
   * The Google Fonts family backing `readingFont: "google"`.
   *
   * Only the name is kept — the face itself is fetched from Google's CDN on
   * boot. Null whenever the reader has never named one, which is also what
   * makes the "google" choice inert until they do.
   */
  googleFont: string | null;
  /**
   * Which engine typesets math.
   *
   * "auto" is KaTeX with a MathJax fallback for what KaTeX cannot draw, and is
   * right for nearly everyone. "mathjax" forces the high-coverage engine for a
   * document full of exotic LaTeX; "temml" renders to MathML, which some screen
   * readers navigate better than KaTeX's HTML. See `src/services/math/renderer.ts`.
   */
  mathRenderer: MathRendererType;
  /** Number display equations and resolve `\ref`/`\eqref` against them. */
  mathNumbering: boolean;
  /**
   * MathJax's accessibility explorer: keyboard navigation of an expression's
   * sub-tree, with each part spoken. Loads a speech-rule engine on first use,
   * so it is opt-in.
   */
  mathExplorer: boolean;
  /**
   * How wide the reading/editing column gets, as a percentage of the space
   * available next to the sidebar.
   *
   * Because it is a percentage of that space rather than a fixed pixel width,
   * it already tracks the sidebar being collapsed or expanded on its own —
   * only the slider itself needs a setting. 100 fills all the available
   * width; the low end keeps a narrow, book-like column.
   */
  contentWidth: number;
}

/** The column can't get narrower than this, or wider than this. */
export const CONTENT_WIDTH_MIN = 40;
export const CONTENT_WIDTH_MAX = 100;

function clampContentWidth(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_PREFS.contentWidth;
  return Math.min(CONTENT_WIDTH_MAX, Math.max(CONTENT_WIDTH_MIN, n));
}

const PREFS_KEY = "localdox:prefs";
const DEFAULT_PREFS: Prefs = {
  theme: "dark",
  diagramColors: true,
  diagramCamera: true,
  diagramFollowNumbers: true,
  diagramNumbers: true,
  aiEnabled: true,
  showEmbedMedia: true,
  lastWorkspaceId: null,
  name: null,
  namePrompted: false,
  readingMode: "paginated",
  readingFont: "hyperlegible",
  googleFont: null,
  mathRenderer: "auto",
  mathNumbering: true,
  mathExplorer: false,
  contentWidth: 50,
};

export function loadPrefs(): Prefs {
  if (typeof localStorage === "undefined") return { ...DEFAULT_PREFS };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const stored = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    // Themes and faces were trimmed; a pref naming a removed one has to be
    // mapped on read or it would set a `data-theme` no stylesheet answers.
    return {
      ...stored,
      showEmbedMedia: stored.showEmbedMedia !== false,
      theme: migrateTheme(stored.theme),
      readingFont: migrateFont(stored.readingFont),
      contentWidth: clampContentWidth(stored.contentWidth),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(patch: Partial<Prefs>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    /* storage unavailable — preferences stay in memory */
  }
}

// ---- import / export (JSON) ----

export { ImportValidationError };

/**
 * Backup format version. v1 omitted `saved` and file `deletedAt` on import, so
 * stars, notes and the Bin did not survive a restore; v2 carries every field of
 * `WorkspaceRecord` except the storage revision. Both versions (and the older
 * unwrapped record) remain readable.
 */
export const BACKUP_VERSION = 2;

/** A complete, faithful backup — Bin, stars, notes and layout included. */
export function serializeWorkspace(w: WorkspaceRecord): string {
  const { revision: _revision, ...workspace } = w;
  return JSON.stringify(
    { format: "localdox-workspace", version: BACKUP_VERSION, workspace },
    null,
    2,
  );
}

/**
 * Validate a backup completely before anything is written. Keeps the source
 * workspace id so the caller can detect a second import of the same backup;
 * the caller must give it a fresh id before storing it alongside the original.
 */
export function parseWorkspaceImport(json: string): WorkspaceRecord {
  const data = parseImportJson(json) as { format?: unknown; version?: unknown; workspace?: unknown };
  if (data && typeof data === "object" && "format" in data) {
    if (data.format !== "localdox-workspace")
      throw new ImportValidationError("This file is not a Localdox workspace backup.");
    if (typeof data.version !== "number" || data.version < 1 || data.version > BACKUP_VERSION)
      throw new ImportValidationError(
        "This backup was made by a newer version of Localdox. Update the app to open it.",
      );
  }
  const w = validateWorkspaceImport(
    data && typeof data === "object" && "workspace" in data ? data.workspace : data,
  );
  const now = Date.now();
  const fileIds = new Map(w.files.map((file) => [file.id, file.id]));
  return {
    id: w.id ?? crypto.randomUUID(),
    name: w.name,
    createdAt: w.createdAt ?? now,
    updatedAt: now,
    files: w.files.map((file) => {
      const record: PersistedFile = {
        id: file.id,
        name: file.name,
        content: file.content,
        folderId: file.folderId ?? null,
      };
      if (file.data !== undefined) record.data = file.data;
      if (file.mimeType !== undefined) record.mimeType = file.mimeType;
      if (file.size !== undefined) record.size = file.size;
      if (file.addedAt !== undefined) record.addedAt = file.addedAt;
      if (file.kind !== undefined) record.kind = file.kind;
      if (file.deletedAt != null) record.deletedAt = file.deletedAt;
      const derivedFrom = remapDerivation(parseDerivation(file.derivedFrom), fileIds);
      if (derivedFrom) record.derivedFrom = derivedFrom;
      return record;
    }),
    folders: w.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      createdAt: folder.createdAt,
      parentId: folder.parentId ?? null,
      ...(folder.purpose ? { purpose: folder.purpose } : {}),
    })),
    bookmarks: w.bookmarks,
    ...(w.saved ? { saved: w.saved } : {}),
    highlights: w.highlights,
    ui: {
      activeFileId: w.ui.activeFileId,
      expanded: w.ui.expanded,
      sidebarCollapsed: w.ui.sidebarCollapsed,
      scrollTop: w.ui.scrollTop,
      fileOrder: w.ui.fileOrder ?? [],
      recentFileIds: w.ui.recentFileIds ?? [],
      panes: w.ui.panes ?? [],
      focusedPaneId: w.ui.focusedPaneId ?? null,
    },
  };
}
