/**
 * A synchronous, per-document record of editor drafts that have not yet been
 * committed to IndexedDB.
 *
 * The editor keeps typing to itself for a short pause and the app waits
 * another pause before writing, and an IndexedDB transaction started from
 * `pagehide` is not guaranteed to finish. Closing the tab inside that window
 * used to lose the tail of the text. `localStorage` is written synchronously,
 * so a draft staged here survives a closed tab, a crash or a killed process;
 * the next load offers it back.
 *
 * An entry is removed only once a committed workspace record holds exactly its
 * text (see `settle`), never merely because the editor handed the text on.
 */

export const DRAFT_PREFIX = "localdox:draft:";
/** Drafts larger than this are not journalled; localStorage is ~5 MB per origin. */
export const MAX_DRAFT_CHARS = 1_000_000;

export interface DraftEntry {
  v: 1;
  workspaceId: string;
  fileId: string;
  fileName: string;
  text: string;
  /** Hash of the stored content this draft was typed against. */
  base: string;
  /** The tab that wrote it; a live tab's drafts are not offered elsewhere. */
  session: string;
  updatedAt: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** FNV-1a over UTF-16 code units, plus the length. Identifies, doesn't protect. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length.toString(36)}.${(hash >>> 0).toString(36)}`;
}

const keyOf = (workspaceId: string, fileId: string) => `${DRAFT_PREFIX}${workspaceId}:${fileId}`;

function parse(raw: string | null): DraftEntry | null {
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as DraftEntry;
    return entry?.v === 1 &&
      typeof entry.workspaceId === "string" &&
      typeof entry.fileId === "string" &&
      typeof entry.text === "string" &&
      typeof entry.base === "string"
      ? entry
      : null;
  } catch {
    return null;
  }
}

export interface DraftJournal {
  readonly session: string;
  /** Record the latest draft in memory; `flush` makes it durable. */
  stage(entry: Omit<DraftEntry, "v" | "session" | "updatedAt">): void;
  /** Write every staged draft now. Returns false if any could not be stored. */
  flush(): boolean;
  /** Forget a draft the reader abandoned (or one that has been recovered elsewhere). */
  discard(workspaceId: string, fileId: string): void;
  /**
   * A workspace record was committed. Drafts it already holds are removed;
   * the rest are re-based on what storage now holds for their document.
   */
  settle(workspaceId: string, files: { id: string; content: string }[]): void;
  /** Durable drafts for a workspace, staged ones included. */
  list(workspaceId: string): DraftEntry[];
  /** Whether anything for this workspace is staged or stored. */
  has(workspaceId: string): boolean;
}

export function createDraftJournal({
  storage,
  session = crypto.randomUUID(),
  now = Date.now,
}: {
  storage: StorageLike | null;
  session?: string;
  now?: () => number;
}): DraftJournal {
  const staged = new Map<string, DraftEntry>();
  // Keys this journal knows to be on disk, so `settle` after every save does
  // not have to scan the whole of localStorage.
  const stored = new Set<string>();

  const storedKeys = (workspaceId: string) => {
    const keys: string[] = [];
    if (!storage) return keys;
    const prefix = `${DRAFT_PREFIX}${workspaceId}:`;
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(prefix)) keys.push(key);
      }
    } catch {
      // Blocked storage reads as empty.
    }
    return keys;
  };

  const read = (key: string) => {
    try {
      return parse(storage?.getItem(key) ?? null);
    } catch {
      return null;
    }
  };

  const remove = (key: string) => {
    staged.delete(key);
    stored.delete(key);
    try {
      storage?.removeItem(key);
    } catch {
      // Nothing more to do; a leftover entry is offered and can be discarded.
    }
  };

  const write = (key: string, entry: DraftEntry) => {
    if (!storage || entry.text.length > MAX_DRAFT_CHARS) return false;
    try {
      storage.setItem(key, JSON.stringify(entry));
      stored.add(key);
      return true;
    } catch {
      return false;
    }
  };

  const journal: DraftJournal = {
    session,
    stage(entry) {
      staged.set(keyOf(entry.workspaceId, entry.fileId), {
        ...entry,
        v: 1,
        session,
        updatedAt: now(),
      });
    },
    flush() {
      let ok = true;
      for (const [key, entry] of staged) {
        if (write(key, entry)) staged.delete(key);
        else ok = false;
      }
      return ok;
    },
    discard(workspaceId, fileId) {
      remove(keyOf(workspaceId, fileId));
    },
    settle(workspaceId, files) {
      const content = new Map(files.map((f) => [f.id, f.content]));
      const prefix = `${DRAFT_PREFIX}${workspaceId}:`;
      const keys = new Set([...staged.keys(), ...stored].filter((k) => k.startsWith(prefix)));
      for (const key of keys) {
        const entry = staged.get(key) ?? read(key);
        if (!entry) {
          stored.delete(key);
          continue;
        }
        const committed = content.get(entry.fileId);
        if (committed === undefined) continue;
        if (committed === entry.text) {
          remove(key);
          continue;
        }
        const base = hashText(committed);
        if (base === entry.base) continue;
        if (staged.has(key)) staged.set(key, { ...entry, base });
        else write(key, { ...entry, base });
      }
    },
    list(workspaceId) {
      const byKey = new Map<string, DraftEntry>();
      for (const key of storedKeys(workspaceId)) {
        const entry = read(key);
        if (entry && entry.workspaceId === workspaceId) byKey.set(key, entry);
      }
      for (const [key, entry] of staged) {
        if (entry.workspaceId === workspaceId) byKey.set(key, entry);
      }
      return [...byKey.values()];
    },
    has(workspaceId) {
      const prefix = `${DRAFT_PREFIX}${workspaceId}:`;
      for (const key of staged.keys()) if (key.startsWith(prefix)) return true;
      for (const key of stored) if (key.startsWith(prefix)) return true;
      return false;
    },
  };
  return journal;
}

/**
 * Sessions whose tab is still open, as far as the Web Locks API can tell.
 * Each journal holds a lock named after its session for as long as the page
 * lives; the browser releases it when the tab closes or crashes.
 */
const LOCK_PREFIX = "localdox:session:";

export function holdSessionLock(session: string) {
  try {
    void navigator.locks
      ?.request(`${LOCK_PREFIX}${session}`, () => new Promise<never>(() => {}))
      .catch(() => {});
  } catch {
    // No Web Locks: every other session's drafts are offered, which is safe
    // because restoring never overwrites a document that changed since.
  }
}

export async function liveSessions(): Promise<Set<string>> {
  try {
    const state = await navigator.locks?.query();
    const names = [...(state?.held ?? []), ...(state?.pending ?? [])]
      .map((lock) => lock.name ?? "")
      .filter((name) => name.startsWith(LOCK_PREFIX))
      .map((name) => name.slice(LOCK_PREFIX.length));
    return new Set(names);
  } catch {
    return new Set();
  }
}

/**
 * Which drafts to offer back after a load: those from tabs that are gone, that
 * still differ from what storage holds. `stale` lists entries that can be
 * dropped outright because storage already has their text.
 */
export function recoverableDrafts(
  entries: DraftEntry[],
  files: { id: string; content: string; deletedAt?: number | null }[],
  { session, live }: { session: string; live: Set<string> },
): { offer: (DraftEntry & { changedSince: boolean; missing: boolean })[]; stale: DraftEntry[] } {
  const byId = new Map(files.map((f) => [f.id, f]));
  const offer: (DraftEntry & { changedSince: boolean; missing: boolean })[] = [];
  const stale: DraftEntry[] = [];
  for (const entry of entries) {
    if (entry.session === session || live.has(entry.session)) continue;
    const file = byId.get(entry.fileId);
    if (file && file.content === entry.text) {
      stale.push(entry);
      continue;
    }
    offer.push({
      ...entry,
      missing: !file || !!file.deletedAt,
      changedSince: !file || hashText(file.content) !== entry.base,
    });
  }
  offer.sort((a, b) => b.updatedAt - a.updatedAt);
  return { offer, stale };
}

let shared: DraftJournal | null = null;

/** The page's journal. One per tab, so every editor and the saver agree on the session. */
export function draftJournal(): DraftJournal {
  if (shared) return shared;
  let storage: StorageLike | null = null;
  try {
    storage = typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    storage = null;
  }
  shared = createDraftJournal({ storage });
  if (typeof navigator !== "undefined") holdSessionLock(shared.session);
  return shared;
}
