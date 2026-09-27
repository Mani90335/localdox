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
import { parseDerivation } from "../../services/doc-conversion/types.ts";

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

export type SaveStatus = "idle" | "saving" | "saved" | "restored";

export class WorkspaceConflictError extends Error {
  constructor() {
    super(
      "This workspace changed in another tab. Export any unsaved edits, then reload before continuing.",
    );
    this.name = "WorkspaceConflictError";
  }
}

const DB_NAME = "localdox";
const DB_VERSION = 2;
const STORE = "workspaces";
const FILES = "files";
const SUMMARIES = "workspace-summaries";

export interface WorkspaceSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  docCount: number;
}

type StoredWorkspace = Omit<WorkspaceRecord, "files"> & { fileIds: string[]; revision: string };
type StoredFile = PersistedFile & { workspaceId: string };

function summaryOf(w: WorkspaceRecord): WorkspaceSummary {
  return {
    id: w.id,
    name: w.name,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    docCount: w.files.length,
  };
}

// Retain only the last workspace's file references, never a second copy of its
// document bytes. The on-disk revision guards this optimization across tabs.
let lastWrite: { id: string; revision: string; files: Map<string, PersistedFile> } | null = null;
const knownRevisions = new Map<string, string>();

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
    req.onupgradeneeded = () => {
      if (blocked) {
        req.transaction!.abort();
        return;
      }
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      const files = db.createObjectStore(FILES, { keyPath: ["workspaceId", "id"] });
      files.createIndex("workspaceId", "workspaceId");
      const summaries = db.createObjectStore(SUMMARIES, { keyPath: "id" });
      // One atomic migration: an aborted upgrade leaves the v1 data intact.
      // Use a cursor so only one legacy workspace is materialized at a time.
      const cursor = req.transaction!.objectStore(STORE).openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        const workspace = row.value as WorkspaceRecord;
        for (const file of workspace.files) files.put({ ...file, workspaceId: workspace.id });
        const { files: documents, ...metadata } = workspace;
        row.update({
          ...metadata,
          fileIds: documents.map((f) => f.id),
          revision: crypto.randomUUID(),
        });
        summaries.put(summaryOf(workspace));
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
  knownRevisions.clear();
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
}

export const persistence = {
  async getWorkspace(id: string): Promise<WorkspaceRecord | undefined> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE, FILES], "readonly");
      const metadata = tx.objectStore(STORE).get(id);
      const documents = tx.objectStore(FILES).index("workspaceId").getAll(id);
      tx.onabort = () => reject(tx.error ?? new Error("Could not read workspace"));
      tx.oncomplete = () => {
        const record = metadata.result as StoredWorkspace | undefined;
        if (!record) {
          resolve(undefined);
          return;
        }
        const { fileIds, revision, ...workspace } = record;
        const byId = new Map<string, PersistedFile>(
          (documents.result as StoredFile[]).map(({ workspaceId: _id, ...file }) => [
            file.id,
            file,
          ]),
        );
        const files = fileIds.map((fileId) => byId.get(fileId));
        if (files.some((file) => !file)) {
          reject(new Error("Workspace has a missing file"));
          return;
        }
        lastWrite = {
          id,
          revision,
          files: new Map([...byId].map(([key, file]) => [key, { ...file }])),
        };
        knownRevisions.set(id, revision);
        resolve({ ...workspace, files: files as PersistedFile[] });
      };
    });
  },
  async putWorkspace(w: WorkspaceRecord, options?: { rejectStale?: boolean }): Promise<void> {
    // Snapshot metadata before awaiting; callers may rename/move files in place.
    const files = w.files.map((file) => ({ ...file }));
    const { files: _files, ...metadata } = w;
    const revision = crypto.randomUUID();
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE, FILES, SUMMARIES], "readwrite");
      const current = tx.objectStore(STORE).get(w.id);
      current.onsuccess = () => {
        try {
          const previous = current.result as StoredWorkspace | undefined;
          // A conversion must not write an old UI snapshot over changes from
          // another tab (or recreate a workspace that another tab deleted).
          if (
            options?.rejectStale &&
            (!previous || knownRevisions.get(w.id) !== previous.revision)
          ) {
            throw new WorkspaceConflictError();
          }
          const cached =
            lastWrite?.id === w.id && lastWrite.revision === previous?.revision
              ? lastWrite.files
              : undefined;
          const fileStore = tx.objectStore(FILES);
          const nextIds = new Set(files.map((file) => file.id));
          for (const id of previous?.fileIds ?? []) {
            if (!nextIds.has(id)) fileStore.delete([w.id, id]);
          }
          for (const file of files) {
            if (!sameFile(cached?.get(file.id), file))
              fileStore.put({ ...file, workspaceId: w.id });
          }
          tx.objectStore(STORE).put({
            ...metadata,
            fileIds: files.map((file) => file.id),
            revision,
          });
          tx.objectStore(SUMMARIES).put(summaryOf({ ...w, files }));
        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
      tx.onabort = () => reject(tx.error ?? new Error("Could not save workspace"));
      tx.oncomplete = () => {
        lastWrite = { id: w.id, revision, files: new Map(files.map((file) => [file.id, file])) };
        knownRevisions.set(w.id, revision);
        resolve();
      };
    });
  },
  async deleteWorkspace(id: string): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE, FILES, SUMMARIES], "readwrite");
      const cursor = tx.objectStore(FILES).index("workspaceId").openKeyCursor(id);
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        tx.objectStore(FILES).delete(row.primaryKey);
        row.continue();
      };
      tx.objectStore(STORE).delete(id);
      tx.objectStore(SUMMARIES).delete(id);
      tx.onabort = () => reject(tx.error ?? new Error("Could not delete workspace"));
      tx.oncomplete = () => {
        if (lastWrite?.id === id) lastWrite = null;
        knownRevisions.delete(id);
        resolve();
      };
    });
  },
  listWorkspaceSummaries() {
    return request<WorkspaceSummary[]>("readonly", (s) => s.getAll(), SUMMARIES);
  },
  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    const list = await persistence.listWorkspaceSummaries();
    const workspaces = await Promise.all(list.map((w) => persistence.getWorkspace(w.id)));
    return workspaces.filter((w): w is WorkspaceRecord => !!w);
  },
  async clearAll(): Promise<void> {
    knownRevisions.clear();
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE, FILES, SUMMARIES], "readwrite");
      for (const store of [STORE, FILES, SUMMARIES]) tx.objectStore(store).clear();
      tx.onabort = () => reject(tx.error ?? new Error("Could not clear storage"));
      tx.oncomplete = () => {
        lastWrite = null;
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

export function serializeWorkspace(w: WorkspaceRecord): string {
  return JSON.stringify({ format: "localdox-workspace", version: 1, workspace: w }, null, 2);
}

/** Parse an exported workspace JSON into a fresh record (new id, no clobber). */
export function parseWorkspaceImport(json: string): WorkspaceRecord {
  const data = JSON.parse(json);
  const w = data?.workspace ?? data;
  if (!w || !Array.isArray(w.files)) {
    throw new Error("Not a valid workspace file");
  }
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: typeof w.name === "string" && w.name.trim() ? w.name : "Imported workspace",
    createdAt: typeof w.createdAt === "number" ? w.createdAt : now,
    updatedAt: now,
    files: w.files
      .filter((f: any) => f && typeof f.content === "string")
      .map((f: any) => ({
        id: typeof f.id === "string" ? f.id : crypto.randomUUID(),
        name: typeof f.name === "string" ? f.name : "untitled.md",
        content: f.content,
        data: typeof f.data === "string" ? f.data : undefined,
        mimeType: typeof f.mimeType === "string" ? f.mimeType : undefined,
        size: typeof f.size === "number" ? f.size : undefined,
        addedAt: typeof f.addedAt === "number" ? f.addedAt : undefined,
        kind: typeof f.kind === "string" ? f.kind : undefined,
        derivedFrom: parseDerivation(f.derivedFrom),
        folderId: typeof f.folderId === "string" ? f.folderId : null,
      })),
    folders: Array.isArray(w.folders)
      ? (w.folders as Partial<FolderRecord & { parentId?: unknown }>[])
          .filter((f) => f && typeof f.id === "string" && typeof f.name === "string")
          .map((f) => ({
            purpose: f.purpose === "embed-media" ? "embed-media" as const : undefined,
            id: f.id as string,
            name: f.name as string,
            createdAt: typeof f.createdAt === "number" ? f.createdAt : now,
            // Nesting has to survive a share link or a re-import. Dropping this
            // would silently flatten every subfolder into the top level.
            parentId: typeof f.parentId === "string" ? f.parentId : null,
          }))
      : [],
    bookmarks: Array.isArray(w.bookmarks)
      ? w.bookmarks.filter((b: any) => typeof b === "string")
      : [],
    highlights: Array.isArray(w.highlights) ? w.highlights : [],
    ui: {
      activeFileId: typeof w.ui?.activeFileId === "string" ? w.ui.activeFileId : null,
      expanded: typeof w.ui?.expanded === "object" ? w.ui.expanded : {},
      sidebarCollapsed: typeof w.ui?.sidebarCollapsed === "boolean" ? w.ui.sidebarCollapsed : false,
      scrollTop: typeof w.ui?.scrollTop === "number" ? w.ui.scrollTop : 0,
      fileOrder: Array.isArray(w.ui?.fileOrder) ? w.ui.fileOrder : [],
      recentFileIds: Array.isArray(w.ui?.recentFileIds) ? w.ui.recentFileIds : [],
      // The split layout has to survive a reload or a share link. Dropping it
      // here would silently collapse every workspace back to one pane.
      panes: Array.isArray(w.ui?.panes)
        ? (w.ui.panes as Partial<PersistedPane>[])
            .filter((pane) => pane && typeof pane.id === "string" && Array.isArray(pane.tabs))
            .map((pane) => ({
              id: pane.id as string,
              tabs: (pane.tabs as unknown[]).filter((id): id is string => typeof id === "string"),
              activeTabId: typeof pane.activeTabId === "string" ? pane.activeTabId : null,
            }))
        : [],
      focusedPaneId: typeof w.ui?.focusedPaneId === "string" ? w.ui.focusedPaneId : null,
    },
  };
}
