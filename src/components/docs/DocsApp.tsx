import { ConversionContext } from "@/services/doc-conversion/ConversionContext";
import { ensureEmbedMediaFolder } from "@/lib/workspace/embed-media";
import type { DocumentUpdate } from "@/services/office-editing";
import { Fragment, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Menu, X, Search, Undo2, Settings } from "lucide-react";

import {
  ESCAPE_DEPTH,
  NavHistoryContext,
  useNavHistoryState,
  type NavEntry,
} from "@/hooks/use-nav-history";
import { Sidebar, AddMenu, DEFAULT_VIEW, type SidebarView } from "./workspace/Sidebar";
import { MarkdownViewer } from "./viewer/MarkdownViewer";
import { PaneDocument } from "./viewer/PaneDocument";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSearchIndex } from "@/hooks/use-search-index";
import type { PendingSearch, SearchHit } from "@/lib/search/schema";
import type { SearchPanelState } from "./workspace/sidebar/SearchPanel";
import { Header } from "./docs-app/Header";
import { EmptyWorkspace } from "./docs-app/EmptyWorkspace";
import { DragDropOverlay } from "./docs-app/DragDropOverlay";
import { useReaderPreferences } from "./docs-app/use-reader-preferences";
import {
  useSidebarCollapseAnimation,
  SIDEBAR_WIDTH,
} from "./docs-app/use-sidebar-collapse-animation";
import { toMdFile, uniqueFileName, findDuplicate } from "./docs-app/file-helpers";
import { availableWorkspaceName, resolveWorkspaceName } from "./docs-app/workspace-naming";
import { ConflictBanner } from "./docs-app/ConflictBanner";
import { SaveErrorBanner } from "./docs-app/SaveErrorBanner";
import { ChunkFailedNotice, LazyBoundary } from "./docs-app/LazyBoundary";
import { SaveIndicator, type SaveState } from "./docs-app/SaveIndicator";
import { DraftRecoveryBanner, type RecoveredDraft } from "./docs-app/DraftRecoveryBanner";
import { DraftJournalContext } from "./editor/draft-journal-context";
import {
  draftJournal,
  hashText,
  liveSessions,
  recoverableDrafts,
  type DraftEntry,
} from "@/lib/workspace/draft-journal";
import { mergeWorkspaces } from "@/lib/workspace/merge";
import {
  activeFileOf,
  closeFileEverywhere,
  closeTab,
  hydratePanes,
  openInPane,
  revealInPane,
  singlePane,
  splitPane,
  toPersisted,
  type PaneLayout,
} from "@/lib/workspace/panes";
import {
  applyToDestination,
  removeFromSource,
  planTransfer,
  transferCounts,
} from "@/lib/workspace/workspace-transfer";
import { WorkspaceMenu } from "./workspace/WorkspaceMenu";
import { WorkspaceSheet } from "./workspace/WorkspaceSheet";
import { MoveToWorkspaceDialog } from "./workspace/MoveToWorkspaceDialog";
import type { AskAiPrefill } from "@/services/ai";

// Code-split surfaces. None of these is on the path to reading a document — the
// settings page, the search palette, the AI panel and the binary-document
// viewers are all reached by an explicit action — so none of them belongs in
// the download that stands between the reader and their first paint. Each is
// mounted only once it is actually asked for, so the fetch overlaps the
// interaction that triggered it.
const DocumentViewer = lazy(() =>
  import("./viewer/DocumentViewer").then((m) => ({ default: m.DocumentViewer })),
);
/**
 * How many columns the split view will go to.
 *
 * Not a design preference — a legibility floor. Past this, on any ordinary
 * display, a column is narrower than a line of prose wants to be. A wide
 * monitor comfortably carries four.
 */
const MAX_PANES = 4;

const SavedPage = lazy(() => import("./pages/SavedPage").then((m) => ({ default: m.SavedPage })));

const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

/** The settings section a caller asked for, handed over the route change that
 *  opens the dialog. DocsApp is the route component, so it remounts on the way
 *  to /settings and nothing held inside it survives to be read at mount. */
let pendingSettingsTab: "workspace" | undefined;
const AskAiPanel = lazy(() =>
  import("@/services/ai/AskAiPanel").then((m) => ({ default: m.AskAiPanel })),
);
const SharePreviewDialog = lazy(() =>
  import("./workspace/SharePreviewDialog").then((m) => ({ default: m.SharePreviewDialog })),
);
const SharedFilesDialog = lazy(() =>
  import("./workspace/SharedFilesDialog").then((m) => ({ default: m.SharedFilesDialog })),
);
import type { MdFile, MdChunk } from "@/lib/markdown/markdown-utils";
// Type only: the writers behind it are a dynamic import at the call site, so
// the OOXML builder is never on the path to the first paint.
import type { ExportFormat } from "@/services/markdown-export";
import type { Highlight } from "@/lib/markdown/dom-highlighter";
import {
  isBinExpired,
  WorkspaceConflictError,
  type ConflictReason,
} from "@/lib/workspace/persistence";
import { fileSubtopics, readingMinutes } from "@/lib/markdown/markdown-utils";
import {
  DISCARD_PROMPT,
  getDocumentKind,
  importDocumentFile,
  SUPPORTED_ACCEPT,
} from "@/lib/markdown/document-utils";
import { clearArtifactResolutionCache } from "@/lib/workspace/workspace-artifacts";
import { warmAppFonts } from "@/lib/fonts/fonts";
import { toast } from "sonner";
import { holdReload, registerReloadGuard, reloadConfirmed } from "@/lib/app/safe-reload";
import { useHistory } from "@/hooks/use-history";
import {
  isEditableTarget,
  hasModKey,
  requestIdleCallbackSafe,
  cancelIdleCallbackSafe,
} from "@/lib/platform/keyboard";
import {
  persistence,
  loadPrefs,
  savePrefs,
  newWorkspaceRecord,
  serializeWorkspace,
  parseWorkspaceImport,
  saveScrollTop,
  loadScrollTop,
  ImportValidationError,
  type PersistedFile,
  type FolderRecord,
  type WorkspaceRecord,
  type WorkspaceSummary,
  type SaveStatus,
  type ThemePref,
} from "@/lib/workspace/persistence";
import {
  findSaved,
  migrateBookmarks,
  newSavedId,
  savedKey,
  toLegacyBookmarks,
  type SavedDraft,
  type SavedEntry,
  type SavedItem,
} from "@/lib/workspace/saved-items";
import {
  copyLink,
  fetchShare,
  parseSharedFiles,
  uploadShare,
  SHARE_HASH,
  SHARE_FILES_HASH,
  type SharedFilesPayload,
} from "@/lib/workspace/share";
import type { ShareRequest } from "./workspace/SharePreviewDialog";
import { MAX_UPLOAD_BYTES, getMaxStorageBytes, formatBytes } from "@/lib/workspace/storage-limits";
import {
  useDocumentConversion,
  ConversionActions,
  CONVERTER_VERSION,
  markdownCopyName,
  remapDerivation,
  sameSource,
  type ConversionResult,
  type ConversionSource,
} from "@/services/doc-conversion";

type Theme = ThemePref;

// Shared empties, so "this file has no highlights / nothing saved" is always the
// same array. A fresh `[]` would be a new prop identity on every render.
const EMPTY_HIGHLIGHTS: Highlight[] = [];
const EMPTY_SAVED: SavedItem[] = [];

interface WorkspaceLite {
  id: string;
  name: string;
  docCount?: number;
}

/**
 * Import a `#share=` link at most once per page load. The restore effect can
 * run twice for one visit (a StrictMode re-run, or a route swap remounting the
 * app) while the first import is still awaiting the network, and the hash is
 * only cleared after it lands — so both runs share this one import instead of
 * each writing its own copy of the workspace.
 */
const sharedWorkspaceImports = new Map<string, Promise<WorkspaceRecord>>();
function importSharedWorkspaceOnce(key: string): Promise<WorkspaceRecord> {
  let pending = sharedWorkspaceImports.get(key);
  if (!pending) {
    pending = (async () => {
      const ws = parseWorkspaceImport(await fetchShare(key));
      ws.id = crypto.randomUUID();
      // This runs during boot, before anything is on screen, so a name clash
      // is settled by numbering rather than by a modal prompt the reader would
      // meet before the app has even drawn.
      const already = await persistence.listWorkspaceSummaries();
      ws.name = availableWorkspaceName(`${ws.name} (Shared)`, already);
      await persistence.serial(() => persistence.putWorkspace(ws));
      toast.success("Shared workspace imported successfully!", { id: "share-import" });
      return ws;
    })();
    // A failed import may be retried by reloading the same link.
    pending.catch(() => sharedWorkspaceImports.delete(key));
    sharedWorkspaceImports.set(key, pending);
  }
  return pending;
}

export function DocsApp() {
  const [files, setFiles] = useState<MdFile[]>([]);
  const officeDirtyPanes = useRef(new Set<string>());
  // Sidebar folders. Flat buckets over the file list — a file's `folderId` says
  // which one it sits in, so folders can appear and disappear without touching
  // the documents themselves.
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  /**
   * The split layout. Panes own their tabs; the app's single "active file" is
   * derived from whichever pane has focus.
   *
   * Deriving it rather than storing it separately is what keeps this change
   * small: the sidebar, the command palette, stars, the nav trail and the
   * persistence snapshot all still read one `activeFileId`, and none of them
   * has to learn what a pane is. `setActiveFileId` survives as a shim that
   * opens the file in the focused pane, so every existing caller is unchanged.
   */
  const [paneLayout, setPaneLayout] = useState<PaneLayout>(() => singlePane(null));
  const activeFileId = activeFileOf(paneLayout);
  /* Two readable columns need roughly 2x the ~360px a document wants at its
     narrowest, plus the handle between them — below that a split is worse than
     no split, so the panes stack top to bottom instead of getting thinner. */
  const splitStacks = useMediaQuery("(max-width: 767px)");
  const mobileNavigation = useMediaQuery("(max-width: 1023px)");
  const setActiveFileId = useCallback((fileId: string | null) => {
    setPaneLayout((layout) => {
      if (fileId === null) {
        // Closing the last document rather than opening one: clear the focused
        // pane's selection without disturbing the other panes' tabs.
        return {
          ...layout,
          panes: layout.panes.map((pane) =>
            pane.id === layout.focusedPaneId ? { ...pane, activeTabId: null } : pane,
          ),
        };
      }
      // Not `openInPane`: a document already showing in another column belongs
      // to that column. Cloning it into the focused pane put the same file on
      // screen twice, and actions addressed to it — "Edit" above all — then
      // fired in every copy at once.
      return revealInPane(layout, fileId);
    });
  }, []);

  // `markDirty` is declared much further down, after the persistence machinery
  // it belongs to. These callbacks sit up here with the pane state they act on,
  // so they reach it through a ref rather than forcing either block to move.
  const markDirtyRef = useRef<() => void>(() => {});

  /** Which pane the reader is working in — clicking anywhere in one focuses it. */
  const focusPane = useCallback((paneId: string) => {
    setPaneLayout((layout) =>
      layout.focusedPaneId === paneId ? layout : { ...layout, focusedPaneId: paneId },
    );
  }, []);

  /** What the side-by-side columns are showing, other than the focused one. */
  const splitFileIds = useMemo(
    () =>
      paneLayout.panes
        .filter((pane) => pane.id !== paneLayout.focusedPaneId)
        .map((pane) => pane.activeTabId)
        .filter((id): id is string => !!id),
    [paneLayout],
  );

  /** Put a document in a column beside the one being read. */
  const openBeside = useCallback((fileId: string) => {
    if (
      officeDirtyPanes.current.size &&
      !window.confirm("There are unsaved document edits. Change the layout and discard them?")
    )
      return;
    setPaneLayout((layout) => {
      const from = layout.focusedPaneId ?? layout.panes[0]?.id;
      if (!from) return openInPane(layout, fileId);
      // Already in a column of its own: focus that one rather than opening a
      // second copy of the same document.
      const existing = layout.panes.find((pane) => pane.id !== from && pane.tabs.includes(fileId));
      if (existing) return openInPane(layout, fileId, existing.id);
      // Otherwise a new column. There is no two-column cap: on a wide display
      // comparing four documents is the whole point. The ceiling is only what
      // stays legible — below roughly this width a column is no longer reading,
      // it is a sliver.
      if (layout.panes.length >= MAX_PANES) {
        const last = layout.panes[layout.panes.length - 1];
        return openInPane(layout, fileId, last.id);
      }
      return splitPane(layout, from, fileId);
    });
    markDirtyRef.current();
  }, []);

  /**
   * Close a whole pane, folding its documents back into the one beside it.
   *
   * The documents themselves stay open — they are listed in the sidebar, not
   * owned by the pane — so closing a column is only ever about the layout.
   */
  const closePane = useCallback((paneId: string) => {
    if (
      officeDirtyPanes.current.size &&
      !window.confirm("There are unsaved document edits. Close this pane and discard them?")
    )
      return;
    setPaneLayout((layout) => {
      if (layout.panes.length <= 1) return layout;
      const panes = layout.panes.filter((pane) => pane.id !== paneId);
      const focusedPaneId = panes.some((p) => p.id === layout.focusedPaneId)
        ? layout.focusedPaneId
        : panes[0].id;
      return { panes, focusedPaneId };
    });
    markDirtyRef.current();
  }, []);

  // A just-created blank document: the viewer opens straight into its editor so
  // the reader can paste markdown in without hunting for the Edit button.
  const [autoEditFileId, setAutoEditFileId] = useState<string | null>(null);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerOpenerRef = useRef<HTMLElement | null>(null);
  const drawerContentRef = useRef<HTMLDivElement | null>(null);
  const openDrawer = useCallback(() => {
    if (!drawerOpen) {
      drawerOpenerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setDrawerOpen(true);
  }, [drawerOpen]);
  // CSS hiding a modal leaves its focus trap and scroll lock active. Close it
  // when the docked sidebar takes over, including when browser zoom changes.
  useEffect(() => {
    if (!mobileNavigation) setDrawerOpen(false);
  }, [mobileNavigation]);
  const {
    theme,
    setTheme,
    cycleTheme,
    readingMode,
    setReadingMode,
    readingFont,
    setReadingFont,
    googleFont,
    setGoogleFont,
    diagramColors,
    setDiagramColors,
    diagramCamera,
    setDiagramCamera,
    diagramFollowNumbers,
    setDiagramFollowNumbers,
    diagramNumbers,
    setDiagramNumbers,
    showEmbedMedia,
    setShowEmbedMedia,
    aiEnabled,
    setAiEnabled,
    mathRenderer,
    setMathRenderer,
    mathNumbering,
    setMathNumbering,
    mathExplorer,
    setMathExplorer,
    contentWidth,
    setContentWidth,
    mathPreferences,
  } = useReaderPreferences();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCrossWorkspace, setSearchCrossWorkspace] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [highlightQuery, setHighlightQuery] = useState<string | null>(null);
  /**
   * A search hit the reader just opened, held until the viewer has scrolled to
   * it. Cleared through `onSearchShown` so it is not replayed on re-render.
   */
  const [pendingSearch, setPendingSearch] = useState<({ fileId: string } & PendingSearch) | null>(
    null,
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // File ids in most-recently-opened order — drives the "Recent" chip.
  const [recentFileIds, setRecentFileIds] = useState<string[]>([]);

  // Persistence-facing state.
  const [booting, setBooting] = useState(true);
  const [workspaces, setWorkspaces] = useState<WorkspaceLite[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  // Why the last write failed. Unlike `saveStatus`, which the next edit moves
  // on to "pending", this stays until a write actually commits.
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveErrorRef = useRef<string | null>(null);
  saveErrorRef.current = saveError;
  const [retryingSave, setRetryingSave] = useState(false);
  // Mirrors `editorDirtyRef` for rendering: an editor holding text it has not
  // handed to the app yet is a pending change too.
  const [editorDirty, setEditorDirty] = useState(false);
  // Every editor on the page journals into the same per-tab draft journal.
  const journal = useMemo(() => draftJournal(), []);
  const journalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleJournalFlush = useCallback(() => {
    if (journalTimer.current) clearTimeout(journalTimer.current);
    journalTimer.current = setTimeout(() => journal.flush(), 250);
  }, [journal]);
  // Stars. Not just files any more: a star can point at a section, a table, a
  // code block or a passage the reader selected. Legacy `${fileId}#${sectionId}`
  // bookmarks are read as saved items on hydrate (see `migrateBookmarks`).
  const [saved, setSaved] = useState<SavedItem[]>([]);
  /** A saved item the reader just opened — handed to the viewer to scroll to. */
  const [pendingSaved, setPendingSaved] = useState<SavedItem | null>(null);
  // Highlights are the one reader action with no other way back — a mis-drag
  // silently replaces whatever it overlaps — so they get an undo stack.
  // `resetHighlights` loads a workspace without making the previous one's
  // highlights reachable by pressing undo.
  const {
    state: highlights,
    set: setHighlights,
    amend: amendHighlights,
    reset: resetHighlights,
    undo: undoHighlights,
    redo: redoHighlights,
    canUndo: canUndoHighlights,
    canRedo: canRedoHighlights,
  } = useHistory<Highlight[]>([]);
  // File whose highlights are shown in isolation via the "Show highlights only"
  // menu item; null when the modal is closed.
  // Files arriving from a `#share-files=` link, held until the reader picks
  // between a new workspace and the one they already have open.
  const [incomingShare, setIncomingShare] = useState<SharedFilesPayload | null>(null);
  const [importingShare, setImportingShare] = useState(false);
  // Ask AI panel: open state + the selection/action it was seeded from.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrefill, setAiPrefill] = useState<AskAiPrefill | null>(null);
  // Sidebar chip + sort state, shared across the desktop header, the mobile
  // chip row, and the mobile three-dots menu (rendered outside <Sidebar>).
  const [sidebarView, setSidebarView] = useState<SidebarView>(DEFAULT_VIEW);

  // Home page + personalization.
  const location = useLocation();
  const navigate = useNavigate();
  const showSettings = location.pathname === "/settings";
  // Saved is a page of its own rather than a tab inside settings: it is
  // something the reader comes back to and reads, not a preference they set
  // once. Settings keeps only the clear-everything control.
  const showSaved = location.pathname === "/saved";

  // Navigation history. Owned here because this is where every destination —
  // the route, the open file, the section, the search term — actually lives.
  // `apply` is the only thing that moves the app backwards or forwards; the
  // refs it reads are assigned further down, so it is written as a ref-reading
  // callback rather than closing over state directly.
  const applyNavEntryRef = useRef<(entry: NavEntry) => void>(() => {});
  const applyNavEntry = useCallback((entry: NavEntry) => applyNavEntryRef.current(entry), []);
  const captureNavScroll = useCallback(() => window.scrollY, []);
  const navHistory = useNavHistoryState({
    apply: applyNavEntry,
    captureScroll: captureNavScroll,
  });
  // Read by callbacks that must not be recreated when the history changes.
  const navHistoryRef = useRef(navHistory);
  navHistoryRef.current = navHistory;
  const highlightQueryRef = useRef(highlightQuery);
  highlightQueryRef.current = highlightQuery;
  const [userName, setUserName] = useState<string | null>(null);
  const firstVisitRef = useRef(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Refs the (async, debounced) save reads from, so it always writes the latest
  // state without being recreated on every render.
  const snapshotRef = useRef({
    files,
    folders,
    activeFileId,
    paneLayout,
    expanded,
    sidebarCollapsed,
    saved,
    highlights,
    recentFileIds,
  });
  snapshotRef.current = {
    files,
    folders,
    activeFileId,
    paneLayout,
    expanded,
    sidebarCollapsed,
    saved,
    highlights,
    recentFileIds,
  };
  const scrollRef = useRef(0);
  const activeFileNameRef = useRef<string | null>(null);
  const readingModeRef = useRef(readingMode);
  const workspaceIdRef = useRef<string | null>(null);
  const workspaceNameRef = useRef("My workspace");
  const createdAtRef = useRef(Date.now());
  const hydratedRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredFlash = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { sidebarWrapRef, sidebarInnerRef } = useSidebarCollapseAnimation(sidebarCollapsed);

  // Warm the UI font after first contentful paint. Markdown plugins stay
  // demand-loaded; idle importing them still adds download and execution work
  // to every session, even when the reader never opens code or equations.
  useEffect(() => {
    let idle = 0;
    const start = () => {
      idle = requestIdleCallbackSafe(() => {
        warmAppFonts();
      });
    };

    // No PerformanceObserver (or no paint timing) — fall back to the old
    // behaviour rather than never warming at all.
    if (typeof PerformanceObserver !== "function") {
      start();
      return () => cancelIdleCallbackSafe(idle);
    }

    // If FCP already happened before this effect ran, warm immediately.
    const painted = performance
      .getEntriesByType("paint")
      .some((entry) => entry.name === "first-contentful-paint");
    if (painted) {
      start();
      return () => cancelIdleCallbackSafe(idle);
    }

    const observer = new PerformanceObserver((list) => {
      if (!list.getEntries().some((entry) => entry.name === "first-contentful-paint")) return;
      observer.disconnect();
      start();
    });
    try {
      observer.observe({ type: "paint", buffered: true });
    } catch {
      start();
    }

    return () => {
      observer.disconnect();
      cancelIdleCallbackSafe(idle);
    };
  }, []);

  // ---- persistence core ----

  // Storage revision the in-memory workspace is based on. Every write sends it
  // and storage refuses the write if another tab has committed since, so a
  // stale snapshot can never silently replace newer work (see persistence.ts).
  const storageRevisionRef = useRef<string | undefined>(undefined);
  const buildRecord = useCallback((): WorkspaceRecord => {
    const s = snapshotRef.current;
    return {
      id: workspaceIdRef.current ?? crypto.randomUUID(),
      revision: storageRevisionRef.current,
      name: workspaceNameRef.current,
      createdAt: createdAtRef.current,
      updatedAt: Date.now(),
      files: s.files.map((f) => ({
        id: f.id,
        name: f.name,
        content: f.content,
        data: f.data,
        mimeType: f.mimeType,
        size: f.size,
        addedAt: f.addedAt,
        kind: f.kind,
        folderId: f.folderId ?? null,
        deletedAt: f.deletedAt,
        derivedFrom: f.derivedFrom,
      })),
      folders: s.folders,
      // `bookmarks` is the legacy projection of `saved`, still written so an
      // older build reading this workspace keeps its file/section stars.
      bookmarks: toLegacyBookmarks(s.saved),
      saved: s.saved,
      highlights: s.highlights,
      ui: {
        activeFileId: s.activeFileId,
        expanded: s.expanded,
        sidebarCollapsed: s.sidebarCollapsed,
        scrollTop: scrollRef.current,
        fileOrder: s.files.map((f) => f.id),
        recentFileIds: s.recentFileIds,
        panes: toPersisted(s.paneLayout),
        focusedPaneId: s.paneLayout.focusedPaneId,
      },
    };
  }, []);

  // Writing a workspace means structured-cloning every document in it, so a
  // redundant write is one of the most expensive things this app can do.
  // `mutationRef` counts user mutations and `savedMutationRef` records the count
  // at the last successful write; a save with nothing new to say is skipped.
  const mutationRef = useRef(0);
  const savedMutationRef = useRef(0);
  const workspaceConflictRef = useRef(false);
  // `storedRecordRef` is what storage holds at `storageRevisionRef`;
  // `baseRecordRef` is the snapshot this tab's state was last reconciled with.
  // They are the same object until another tab commits, and the difference
  // between them is exactly what that tab changed (see merge.ts).
  const storedRecordRef = useRef<WorkspaceRecord | null>(null);
  const baseRecordRef = useRef<WorkspaceRecord | null>(null);
  // Set by `hydrateWorkspace`, which is declared after the writer.
  const adoptRef = useRef<(ws: WorkspaceRecord) => void>(() => {});
  // Why the last write was refused. While set, nothing is written; the banner
  // offers to keep this tab's version as a copy or to load the saved one.
  const [conflict, setConflict] = useState<ConflictReason | null>(null);

  const enterConflict = useCallback((reason: ConflictReason) => {
    workspaceConflictRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setConflict(reason);
    setSaveStatus("conflict");
  }, []);

  /**
   * Write the active workspace now. Only call from inside `persistence.serial`,
   * so writes from this tab commit in the order they were made.
   */
  const writeActive = useCallback(
    async (silent: boolean, force: boolean): Promise<boolean> => {
      if (workspaceConflictRef.current) return false;
      if (!workspaceIdRef.current) return true;
      if (!force && mutationRef.current === savedMutationRef.current) {
        // Nothing changed since the last write. Still settle the indicator, so
        // a "Saving…" left over from a coalesced burst doesn't stick.
        if (!silent)
          setSaveStatus((status) =>
            status === "saving" || status === "pending" ? "saved" : status,
          );
        return true;
      }
      const id = workspaceIdRef.current;
      const pending = mutationRef.current;
      if (!silent) setSaveStatus("saving");
      const mine = buildRecord();
      // A refusal means another tab committed first. Re-read, merge this tab's
      // changes onto theirs, and try again; only a real collision stops here.
      for (let attempt = 0; attempt < 3; attempt++) {
        const base = baseRecordRef.current;
        const stored = storedRecordRef.current;
        const merging = !!base && !!stored && base !== stored;
        const record = merging ? mergeWorkspaces(base, mine, stored) : { ...mine };
        if (!record) {
          enterConflict("changed");
          return false;
        }
        record.revision = storageRevisionRef.current;
        try {
          await persistence.putWorkspace(record);
        } catch (error) {
          if (workspaceIdRef.current !== id) return false;
          if (error instanceof WorkspaceConflictError && error.reason === "changed") {
            const latest = await persistence.getWorkspace(id);
            if (workspaceIdRef.current !== id) return false;
            if (!latest) {
              enterConflict("deleted");
              return false;
            }
            storedRecordRef.current = latest;
            storageRevisionRef.current = latest.revision;
            continue;
          }
          if (error instanceof WorkspaceConflictError) {
            enterConflict(error.reason);
            return false;
          }
          setSaveStatus("error");
          console.error("Could not save workspace", error);
          // Stays on screen until a write commits; see SaveErrorBanner.
          setSaveError(
            error instanceof DOMException && error.name === "QuotaExceededError"
              ? "This browser is out of storage space for Localdox. Free up space or remove large files, then retry. Until then, keep this tab open or export a backup."
              : "Your latest changes could not be written to this device. Retry, or keep this tab open and export a backup.",
          );
          return false;
        }
        // Journalled drafts this record now holds are safe to forget.
        if (journal.has(id)) journal.settle(id, record.files);
        if (workspaceIdRef.current !== id) return true;
        storageRevisionRef.current = record.revision;
        storedRecordRef.current = record;
        baseRecordRef.current = merging ? mine : record;
        savedMutationRef.current = Math.max(savedMutationRef.current, pending);
        if (pending === mutationRef.current) setSaveStatus("saved");
        // The ref too, now: a reload may be decided before the next render.
        saveErrorRef.current = null;
        setSaveError(null);
        // Show the other tab's changes here too, unless the reader has changed
        // something since this snapshot was taken; the next save merges again.
        if (
          merging &&
          mutationRef.current === pending &&
          !editorDirtyRef.current &&
          !officeDirtyPanes.current.size
        )
          adoptRef.current(record);
        return true;
      }
      enterConflict("changed");
      return false;
    },
    [buildRecord, enterConflict, journal],
  );

  /**
   * Save the active workspace, queued behind every earlier write from this
   * tab. `force` writes even when no mutation was counted — used right after a
   * caller has put new state into `snapshotRef` itself.
   */
  const persistNow = useCallback(
    (silent: boolean, force = false) => persistence.serial(() => writeActive(silent, force)),
    [writeActive],
  );

  // Called by every user mutation. Shows "Changes pending", then writes after a
  // pause; the write itself switches the indicator to "Saving…".
  const markDirty = useCallback(() => {
    if (!hydratedRef.current || !workspaceIdRef.current || workspaceConflictRef.current) return;
    mutationRef.current++;
    setSaveStatus("pending");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persistNow(false), 700);
  }, [persistNow]);
  // Published for the pane callbacks, which are declared above this point and
  // would otherwise have to close over a variable that does not exist yet.
  markDirtyRef.current = markDirty;

  const hydrateWorkspace = useCallback(
    // `background`: another tab saved this workspace while this one was idle.
    // Adopt its data without moving the reader's scroll or flashing a status.
    (ws: WorkspaceRecord, { background = false }: { background?: boolean } = {}) => {
      storageRevisionRef.current = ws.revision;
      storedRecordRef.current = ws;
      baseRecordRef.current = ws;
      workspaceConflictRef.current = false;
      setConflict(null);
      saveErrorRef.current = null;
      setSaveError(null);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const wsFolders = ws.folders ?? [];
      const folderIds = new Set(wsFolders.map((f) => f.id));
      // A file can outlive its folder (an older export, a share link that carried
      // files but no folders). Those fall back to the top level instead of
      // vanishing into a folder that is never rendered.
      const parsed: MdFile[] = ws.files.map((f) => {
        const file = toMdFile(f);
        return file.folderId && folderIds.has(file.folderId) ? file : { ...file, folderId: null };
      });

      if (ws.ui?.fileOrder && ws.ui.fileOrder.length > 0) {
        const order = new Map(ws.ui.fileOrder.map((id, index) => [id, index]));
        parsed.sort((a, b) => {
          return (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity);
        });
      }

      // Sweep the Bin on the way in. There is no background process in a
      // local-first app, so "deletes after 30 days" means the next time the
      // workspace is opened past that mark — which is also the only moment the
      // reader could have noticed it still being there.
      const swept = parsed.filter((f) => !isBinExpired(f.deletedAt));
      setFiles(swept);
      setFolders(wsFolders);
      setAutoEditFileId(null);
      // Panes come back with the workspace. A record written before panes
      // existed has none, which hydrates as a single pane holding whatever was
      // open — so an older workspace opens exactly as it used to.
      setPaneLayout(
        hydratePanes(
          ws.ui?.panes,
          ws.ui?.focusedPaneId,
          new Set(swept.map((f) => f.id)),
          ws.ui?.activeFileId ?? swept[0]?.id ?? null,
        ),
      );
      setRecentFileIds(ws.ui?.recentFileIds ?? []);
      setExpanded(ws.ui?.expanded ?? {});
      setSidebarCollapsed(!!ws.ui?.sidebarCollapsed);
      setSaved(ws.saved?.length ? ws.saved : migrateBookmarks(ws.bookmarks ?? [], parsed));
      resetHighlights((ws.highlights ?? []).filter((h) => typeof h.text === "string"));
      setWorkspaceId(ws.id);
      workspaceIdRef.current = ws.id;
      workspaceNameRef.current = ws.name;
      createdAtRef.current = ws.createdAt ?? Date.now();
      // The live position is tracked in localStorage (see `saveScrollTop`); the
      // record's own value is the fallback for an imported or shared workspace
      // that has never been scrolled on this device.
      const st = background ? scrollRef.current : (loadScrollTop(ws.id) ?? ws.ui?.scrollTop ?? 0);
      scrollRef.current = st;
      // A freshly hydrated workspace is exactly what is on disk — unless the
      // Bin sweep just dropped expired files. That removal is written straight
      // back, so the expired bytes are actually reclaimed rather than lingering
      // until the reader happens to change something else.
      mutationRef.current = swept.length === parsed.length ? 0 : 1;
      savedMutationRef.current = 0;
      if (mutationRef.current) saveTimer.current = setTimeout(() => void persistNow(true), 0);
      if (background) return;
      // Restore the exact scroll after the document has painted. Runs after the
      // viewer's own mount effects, so it wins.
      setTimeout(() => window.scrollTo({ top: st }), 350);
      setSaveStatus("restored");
      if (restoredFlash.current) clearTimeout(restoredFlash.current);
      restoredFlash.current = setTimeout(
        () => setSaveStatus((s) => (s === "restored" ? "saved" : s)),
        2500,
      );
    },
    [resetHighlights, persistNow],
  );
  adoptRef.current = (ws) => hydrateWorkspace(ws, { background: true });

  const refreshWorkspaceList = useCallback(async () => {
    const list = await persistence.listWorkspaceSummaries();
    list.sort((a, b) => a.createdAt - b.createdAt);
    setWorkspaces(list);
  }, []);

  // Restore the previous session on first load.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const prefs = loadPrefs();
        setUserName(prefs.name);
        firstVisitRef.current = !prefs.name;

        let hashSharedWs: WorkspaceRecord | null = null;
        if (window.location.hash.startsWith(SHARE_HASH)) {
          try {
            hashSharedWs = await importSharedWorkspaceOnce(
              window.location.hash.slice(SHARE_HASH.length),
            );
            window.history.replaceState(
              null,
              "",
              window.location.pathname + window.location.search,
            );
          } catch (e) {
            console.error("Failed to import shared workspace", e);
            toast.error("Invalid or corrupted shared workspace link.", { id: "share-import" });
          }
        }

        // Queued behind any write still in flight — including the final save of
        // the route this instance replaced — so it reads what that route saw.
        const { list, ws } = await persistence.serial(async () => {
          const list = await persistence.listWorkspaceSummaries();
          if (list.length === 0 && !hashSharedWs) return { list, ws: undefined };
          const selected = list.find((w) => w.id === prefs.lastWorkspaceId) ?? list[0];
          return { list, ws: hashSharedWs ?? (await persistence.getWorkspace(selected.id)) };
        });
        if (list.length === 0 && !hashSharedWs) {
          if (!alive) return;
          setWorkspaces([]);
          setWorkspaceId(null);
          workspaceIdRef.current = null;
          setSaveStatus("idle");
        } else {
          if (!alive) return;
          if (!ws) throw new Error("The selected workspace could not be loaded");
          list.sort((a, b) => a.createdAt - b.createdAt);
          setWorkspaces(list);
          hydrateWorkspace(ws);
          savePrefs({ lastWorkspaceId: ws.id });
        }
      } catch (error) {
        console.error("Could not restore local workspace", error);
        if (alive)
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not open local storage. Please reload to retry.",
          );
      } finally {
        if (alive) {
          hydratedRef.current = true;
          setBooting(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist scroll position and flush pending edits on tab hide / unload.
  //
  // The scroll handler used to schedule a full workspace write. It now records
  // the position in localStorage instead — one small string, no clone of the
  // document set — and the IndexedDB write is left to real mutations.
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      // Reading scrollY is cheap, but doing it inside the scroll event competes
      // with the browser's own scrolling work; sample it on the next frame.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        scrollRef.current = window.scrollY;
        if (!hydratedRef.current) return;
        if (scrollTimer.current) clearTimeout(scrollTimer.current);
        scrollTimer.current = setTimeout(() => {
          const id = workspaceIdRef.current;
          if (id) saveScrollTop(id, scrollRef.current);
        }, 400);
      });
    };
    const flush = () => {
      // First, synchronously: the IndexedDB write below may never finish if
      // the page is being torn down, but a journalled draft is already on disk.
      if (journalTimer.current) clearTimeout(journalTimer.current);
      journal.flush();
      if (!hydratedRef.current) return;
      const id = workspaceIdRef.current;
      if (id) saveScrollTop(id, scrollRef.current);
      // Held so a reload that starts meanwhile waits for it (safe-reload.ts).
      holdReload(persistNow(true));
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      flush();
      // Only when storage is known not to hold the latest state. Ordinary
      // pending edits are journalled or about to be written, and prompting on
      // every close would teach readers to ignore the prompt.
      // A reload the reader already confirmed (safe-reload.ts) isn't asked twice.
      if ((saveErrorRef.current || workspaceConflictRef.current) && !reloadConfirmed())
        event.preventDefault();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Every route mounts its own instance of this component. A save still
      // waiting on its debounce is queued now, ahead of the next route's read,
      // instead of firing later from an instance nobody is looking at.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flush();
    };
  }, [persistNow, journal]);

  // ---- file + navigation actions (each marks the workspace dirty) ----

  const addFiles = useCallback(
    async (fileList: File[], attachments = false): Promise<MdFile[]> => {
      if (fileList.length === 0) return [];

      // Reject any single file over the per-file cap before touching disk.
      const oversize = fileList.filter((f) => f.size > MAX_UPLOAD_BYTES);
      if (oversize.length) {
        const names = oversize.map((f) => f.name).join(", ");
        toast.error(
          `${names} exceeds the ${formatBytes(MAX_UPLOAD_BYTES)} per-file limit. Please upload a smaller file.`,
        );
      }
      const accepted = fileList.filter((f) => f.size <= MAX_UPLOAD_BYTES);
      if (accepted.length === 0) return [];

      // Enforce the hard total-storage ceiling (5% of the browser quota).
      const maxStorage = await getMaxStorageBytes();
      if (maxStorage != null) {
        const usedBytes = snapshotRef.current.files.reduce((sum, f) => sum + (f.size ?? 0), 0);
        const incomingBytes = accepted.reduce((sum, f) => sum + f.size, 0);
        if (usedBytes + incomingBytes > maxStorage) {
          toast.error(
            `Storage full — this application is strictly capped at ${formatBytes(maxStorage)}. Remove some files before uploading more.`,
          );
          return [];
        }
      }

      const total = accepted.length;
      const toastId = toast.loading(`Uploading ${total} file${total > 1 ? "s" : ""}...`);

      try {
        let loaded = 0;
        const parsed: MdFile[] = await Promise.all(
          accepted.map(async (f) => {
            const imported = await importDocumentFile(f);
            loaded++;
            toast.loading(
              `Uploading ${total} file${total > 1 ? "s" : ""}... ${Math.round((loaded / total) * 100)}%`,
              { id: toastId },
            );
            return imported;
          }),
        );

        // Duplicate check runs after parsing, because "the same file" means the
        // same bytes, not the same filename. A re-upload of something already
        // here is dropped; a genuinely different document arriving under a
        // taken name is kept, under a name the reader chooses.
        const kept: MdFile[] = [];
        const skipped: string[] = [];
        const existing: MdFile[] = [];
        // Grows as the batch is processed, so two identical files picked in one
        // go are caught against each other, not just against what is stored.
        const pool = [...snapshotRef.current.files];

        for (const file of parsed) {
          const dup = findDuplicate(file, pool);
          if (dup?.kind === "content") {
            skipped.push(file.name);
            if (attachments) {
              if (!dup.file.deletedAt) existing.push(dup.file);
            }
            continue;
          }
          if (dup?.kind === "name") {
            const taken = new Set(pool.map((f) => f.name));
            const suggestion = uniqueFileName(file.name, taken);
            const answer = window.prompt(
              `“${file.name}” already exists in this workspace and the contents differ. ` +
                `Enter a name for the new copy, or cancel to skip it:`,
              suggestion,
            );
            const chosen = answer?.trim();
            if (!chosen) {
              skipped.push(file.name);
              continue;
            }
            file.name = uniqueFileName(chosen, taken);
            file.kind = getDocumentKind(file.name, file.mimeType);
          }
          kept.push(file);
          pool.push(file);
        }

        if (skipped.length) {
          const label =
            skipped.length === 1 ? `“${skipped[0]}”` : `${skipped.length} duplicate files`;
          toast.info(`Skipped ${label} — already in this workspace.`);
        }
        if (kept.length === 0) {
          toast.dismiss(toastId);
          return existing;
        }

        let nextFolders = snapshotRef.current.folders;
        if (attachments) {
          const organized = ensureEmbedMediaFolder(nextFolders);
          nextFolders = organized.folders;
          for (const file of kept) file.folderId = organized.folder.id;
        }
        const nextFiles = [...snapshotRef.current.files, ...kept];
        // Keep the currently open file if one is open; otherwise open the first
        // of the just-uploaded batch.
        const nextActiveFileId = snapshotRef.current.activeFileId ?? kept[0]?.id ?? null;

        if (!workspaceIdRef.current) {
          const id = crypto.randomUUID();
          workspaceIdRef.current = id;
          storageRevisionRef.current = undefined;
          workspaceNameRef.current = "My workspace";
          createdAtRef.current = Date.now();
          setWorkspaceId(id);
          setWorkspaces([{ id, name: workspaceNameRef.current, docCount: nextFiles.length }]);
          savePrefs({ lastWorkspaceId: id });
        }

        // The home and reader are separate route components. Persist before
        // navigating so the reader's new DocsApp instance can hydrate the upload.
        snapshotRef.current = {
          ...snapshotRef.current,
          files: nextFiles,
          folders: nextFolders,
          activeFileId: nextActiveFileId,
        };
        setFiles(nextFiles);
        setFolders(nextFolders);
        setActiveFileId(nextActiveFileId);
        setSaveStatus("saving");
        if (!(await persistNow(false, true))) {
          // The files are open in this tab but not on disk. Stay here: another
          // route would hydrate from storage and they would be gone.
          toast.error("The files are open but could not be saved to this device yet.", {
            id: toastId,
          });
          return [...kept, ...existing];
        }

        toast.success(`Successfully uploaded ${kept.length} file${kept.length > 1 ? "s" : ""}!`, {
          id: toastId,
        });
        if (!attachments) navigate({ to: "/" }); // Attachments keep the editor open.
        return [...kept, ...existing];
      } catch {
        setSaveStatus((status) => (status === "saving" ? "idle" : status));
        toast.error("Could not upload the selected file(s). Please try again.", { id: toastId });
        return [];
      }
    },
    [navigate, persistNow],
  );

  const importAttachments = useCallback((files: File[]) => addFiles(files, true), [addFiles]);

  const handleFileInput = useCallback(
    (list: FileList | null) => {
      if (!list) return;
      const picked = Array.from(list);
      if (picked.length) addFiles(picked);
    },
    [addFiles],
  );

  const [globalDrag, setGlobalDrag] = useState(false);

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes("Files")) {
        setGlobalDrag(true);
      }
    };
    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (e.clientX === 0 && e.clientY === 0) {
        setGlobalDrag(false);
      }
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setGlobalDrag(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        handleFileInput(e.dataTransfer.files);
      }
    };

    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [handleFileInput]);

  const activeFile = useMemo(
    () => files.find((f) => f.id === activeFileId) ?? null,
    [files, activeFileId],
  );
  activeFileNameRef.current = activeFile?.name ?? null;
  readingModeRef.current = readingMode;

  // Identity of the workspace's file set, used to invalidate the artifact
  // resolution cache and to key embed rendering. Built by walking every file, so
  // it is memoized rather than recomputed on every render of the app shell.
  const workspaceRevision = useMemo(
    () =>
      files
        .map((file) => `${file.id}:${file.name}:${file.content.length}:${file.data?.length ?? 0}`)
        .join("|"),
    [files],
  );

  const { prevFile, nextFile } = useMemo(() => {
    const idx = activeFile ? files.findIndex((f) => f.id === activeFile.id) : -1;
    return {
      prevFile: idx > 0 ? files[idx - 1] : null,
      nextFile: idx >= 0 && idx < files.length - 1 ? files[idx + 1] : null,
    };
  }, [files, activeFile]);

  // `files` is read through a ref by the callbacks below so that selecting,
  // deleting or downloading a document doesn't have to be a new function on
  // every render — those go straight into <Sidebar>, which is memoized and
  // would otherwise re-render its entire list whenever anything here changed.
  const filesRef = useRef(files);
  filesRef.current = files;
  const activeFileIdRef = useRef(activeFileId);
  activeFileIdRef.current = activeFileId;
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  /**
   * Whether the open editor holds unsaved changes, reported by the viewer.
   *
   * Navigation asks this before it moves. Only a genuinely changed draft
   * prompts — leaving an untouched editor stays silent, which is what keeps the
   * prompt meaningful when it does appear.
   */
  const editorDirtyRef = useRef(false);
  const syncEditorDirty = useCallback(
    () => setEditorDirty(editorDirtyRef.current || officeDirtyPanes.current.size > 0),
    [],
  );
  const confirmDiscardDraft = useCallback((fileId?: string) => {
    // Re-opening the document already on screen is not leaving it.
    if (!editorDirtyRef.current && !officeDirtyPanes.current.size) return true;
    if (fileId && fileId === activeFileIdRef.current) return true;
    return window.confirm(DISCARD_PROMPT);
  }, []);

  const handleSelect = useCallback(
    (
      fileId: string,
      headingId?: string,
      query?: string,
      matchedLine?: string,
      occurrence?: number,
      lineIndex?: number,
    ) => {
      if (!confirmDiscardDraft(fileId)) return;
      setActiveFileId(fileId);
      if (query !== undefined) setHighlightQuery(query || null);
      // A search hit knows the line it matched, so the viewer can scroll to the
      // passage instead of to the heading above it. Always a fresh object, so
      // running the same search twice still moves the reader the second time.
      setPendingSearch(
        matchedLine
          ? {
              fileId,
              text: matchedLine,
              query: query?.trim() || "",
              occurrence: occurrence ?? 0,
              lineIndex: lineIndex ?? -1,
            }
          : null,
      );

      let targetHeadingId = headingId;
      if (!targetHeadingId) {
        const file = filesRef.current.find((f) => f.id === fileId);
        const subs = file ? fileSubtopics(file) : [];
        targetHeadingId = subs?.[0]?.id || "preamble";
      }
      setActiveHeadingId(targetHeadingId);

      if (pathnameRef.current !== "/") {
        navigate({ to: "/" });
      }

      setDrawerOpen(false);
      markDirty();
      // Every in-app way of opening a document funnels through here — the
      // sidebar, the palette, stars, internal links, the header's file stepper —
      // so this is the one place the trail has to be recorded.
      navHistoryRef.current.push({
        path: "/",
        fileId,
        headingId: targetHeadingId,
        query: query !== undefined ? query || null : highlightQueryRef.current,
      });
    },
    [navigate, markDirty],
  );

  const commitConversion = useCallback(
    async (source: ConversionSource, result: ConversionResult, targetWorkspaceId: string) => {
      const limit = await getMaxStorageBytes();
      const current = snapshotRef.current;
      if (
        workspaceIdRef.current !== targetWorkspaceId ||
        !sameSource(
          current.files.find((f) => f.id === source.id),
          source,
        )
      )
        return;
      const size = new TextEncoder().encode(result.markdown).byteLength;
      // Account for decoded text and stored base64, rather than trusting stale
      // import sizes after a document has been edited.
      const used = current.files.reduce(
        (sum, file) =>
          sum + new TextEncoder().encode(file.content).byteLength + (file.data?.length ?? 0),
        0,
      );
      if (limit !== null && used + size > limit)
        throw new Error(
          "Not enough local storage for the Markdown copy. Free some space and try again.",
        );
      const liveSource = current.files.find((f) => f.id === source.id)!;
      const derivative: MdFile = {
        id: crypto.randomUUID(),
        name: markdownCopyName(
          source.name,
          current.files.map((f) => f.name),
        ),
        content: result.markdown,
        mimeType: "text/markdown",
        kind: "markdown",
        size,
        addedAt: Date.now(),
        folderId: liveSource.folderId,
        derivedFrom: {
          sourceFileId: source.id,
          sourceName: source.name,
          inputHash: result.inputHash,
          converter: "anydoc",
          converterVersion: CONVERTER_VERSION,
          convertedAt: Date.now(),
        },
      };
      const nextFiles = [...current.files];
      nextFiles.splice(nextFiles.findIndex((f) => f.id === source.id) + 1, 0, derivative);
      snapshotRef.current = { ...current, files: nextFiles };
      filesRef.current = nextFiles;
      setFiles(nextFiles);
      markDirty();
      if (!(await persistNow(false, true))) {
        if (workspaceIdRef.current === targetWorkspaceId) {
          const remaining = snapshotRef.current.files.filter((f) => f.id !== derivative.id);
          snapshotRef.current = { ...snapshotRef.current, files: remaining };
          filesRef.current = remaining;
          setFiles(remaining);
          markDirty();
        }
        throw new Error("The Markdown copy could not be saved. The original is unchanged.");
      }
      if (workspaceIdRef.current !== targetWorkspaceId) return;
      if (
        activeFileIdRef.current === source.id &&
        pathnameRef.current === "/" &&
        !editorDirtyRef.current
      )
        handleSelect(derivative.id);
      toast.success(`Created ${derivative.name}`, {
        description: "Embedded images remain in the original.",
        action: {
          label: "Open Markdown",
          onClick: () => {
            if (workspaceIdRef.current === targetWorkspaceId) handleSelect(derivative.id);
          },
        },
      });
    },
    [handleSelect, markDirty, persistNow],
  );

  const conversion = useDocumentConversion({ workspaceId, files, commit: commitConversion });
  const conversionActions = (file: MdFile) => (
    <ConversionActions
      file={file}
      files={files}
      runningId={conversion.runningId}
      onCancel={conversion.cancel}
      onOpen={handleSelect}
      onCompare={openBeside}
    />
  );

  const removeFile = useCallback(
    (id: string) => {
      const files = filesRef.current;
      const index = files.findIndex((f) => f.id === id);
      const fileToRestore = files[index];
      const activeWas = activeFileIdRef.current;

      if (!fileToRestore) return;

      setFiles((prev) => prev.filter((f) => f.id !== id));
      if (activeWas === id) {
        setActiveFileId(files.find((f) => f.id !== id)?.id ?? null);
      }
      markDirty();

      toast("File deleted", {
        description: fileToRestore.name,
        duration: 6000,
        icon: <Undo2 className="h-4 w-4" />,
        className: "bg-background/60 backdrop-blur-xl border border-border/50 shadow-2xl",
        action: {
          label: "Undo",
          onClick: () => {
            setFiles((prev) => {
              const newFiles = [...prev];
              newFiles.splice(index, 0, fileToRestore);
              return newFiles;
            });
            if (activeWas === id) {
              setActiveFileId(id);
            }
            markDirty();
          },
        },
      });
    },
    [markDirty],
  );

  /**
   * Send a document to the Bin, or bring it back.
   *
   * This replaced a separate Archive and Delete. Two ways to make a file
   * disappear, one of them irreversible and the other easy to mistake for it,
   * is one way too many: binning is the single gesture, and it is undoable for
   * thirty days from a place the reader can actually find.
   */
  const moveToBin = useCallback(
    (id: string) => {
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, deletedAt: Date.now() } : f)));
      markDirty();
    },
    [markDirty],
  );

  const restoreFromBin = useCallback(
    (id: string) => {
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, deletedAt: null } : f)));
      markDirty();
    },
    [markDirty],
  );

  /** Delete for good — from the Bin, where the reader has already been warned. */
  const deleteForever = useCallback(
    (id: string) => {
      setFiles((prev) => prev.filter((f) => f.id !== id));
      markDirty();
    },
    [markDirty],
  );

  const emptyBin = useCallback(() => {
    setFiles((prev) => prev.filter((f) => !f.deletedAt));
    markDirty();
  }, [markDirty]);

  /**
   * Write a document out in the format the reader chose.
   *
   * Word and PDF both have to render every diagram in the document before a
   * single byte can be written, which on a long document is seconds of work.
   * A silent wait reads as a dead click, so the conversion is announced and the
   * toast is resolved in place — the same pattern upload already uses.
   */
  const downloadFile = useCallback(async (id: string, format: ExportFormat = "original") => {
    const file = filesRef.current.find((f) => f.id === id);
    if (!file) return;

    const { exportDocument, FORMAT_LABEL } = await import("@/services/markdown-export");
    // Only the converting formats are slow enough to be worth a spinner;
    // handing back bytes the app already holds is instant and a toast for it
    // would be noise.
    const slow = format === "docx" || format === "pdf" || format === "html";
    const toastId = slow
      ? toast.loading(`Preparing ${FORMAT_LABEL[format]}…`, {
          description: file.name,
        })
      : undefined;

    try {
      const result = await exportDocument(file, format, {
        workspaceId: workspaceIdRef.current,
        workspaceName: workspaceNameRef.current,
        workspaceFiles: snapshotRef.current.files,
        workspaceFolders: snapshotRef.current.folders,
        sourceFile: file,
      });
      if (toastId === undefined) return;
      // PDF hands off to the browser's print dialog rather than dropping a
      // file, so saying "downloaded" would be a lie the reader can see.
      toast.success(
        result.kind === "printed" ? "Ready to save as PDF" : `Downloaded ${result.filename}`,
        {
          id: toastId,
          description:
            result.kind === "printed"
              ? 'Choose "Save as PDF" as the destination in the print dialog.'
              : undefined,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Export failed.";
      if (toastId === undefined) toast.error(message);
      else toast.error("Export failed", { id: toastId, description: message });
    }
  }, []);

  /**
   * Export a selection of documents, one file each.
   *
   * A batch is reported as one outcome rather than one toast per file: five
   * stacked "Downloaded …" toasts tell the reader nothing they cannot see in
   * their downloads folder, while "4 of 5" and the name of the one that failed
   * is the part they cannot get anywhere else.
   */
  const downloadFiles = useCallback(async (ids: string[], format: ExportFormat) => {
    const selected = ids
      .map((id) => filesRef.current.find((f) => f.id === id))
      .filter((file): file is MdFile => Boolean(file));
    if (!selected.length) return;

    const { exportDocuments, FORMAT_LABEL, isBatchable } =
      await import("@/services/markdown-export");

    // PDF goes through the browser's modal print dialog, so a batch would queue
    // one per file and make the reader name each by hand. Saying so is better
    // than starting something they would have to sit through.
    if (!isBatchable(format)) {
      toast.error(`${FORMAT_LABEL[format]} exports one document at a time`, {
        description: "Export the documents individually, or choose another format.",
      });
      return;
    }

    const total = selected.length;
    const toastId = toast.loading(`Exporting 0 of ${total} as ${FORMAT_LABEL[format]}…`);
    try {
      const result = await exportDocuments(
        selected,
        format,
        (done) => {
          toast.loading(`Exporting ${done} of ${total} as ${FORMAT_LABEL[format]}…`, {
            id: toastId,
          });
        },
        {
          workspaceId: workspaceIdRef.current,
          workspaceName: workspaceNameRef.current,
          workspaceFiles: snapshotRef.current.files,
          workspaceFolders: snapshotRef.current.folders,
        },
      );

      if (!result.failed.length) {
        toast.success(`Exported ${result.ok} document${result.ok === 1 ? "" : "s"}`, {
          id: toastId,
        });
        return;
      }
      // Name the first failure rather than only counting them: with one bad
      // document in a batch of ten, the name is the whole of the useful part.
      const [first] = result.failed;
      const others = result.failed.length - 1;
      toast.warning(`Exported ${result.ok} of ${total}`, {
        id: toastId,
        description:
          `${first.name}: ${first.reason}` +
          (others > 0 ? ` (and ${others} other${others === 1 ? "" : "s"})` : ""),
      });
    } catch (error) {
      toast.error("Export failed", {
        id: toastId,
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }, []);

  const renameFile = useCallback(
    (id: string, newName: string) => {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, name: newName, kind: getDocumentKind(newName, f.mimeType) } : f,
        ),
      );
      markDirty();
    },
    [markDirty],
  );

  /**
   * Blank markdown document, created from the sidebar's New menu. It opens
   * immediately in the viewer's editor so the reader can paste markdown into
   * it; from there the normal autosave path takes over.
   */
  const createFile = useCallback(
    (folderId?: string | null, documentKind: "markdown" | "mermaid" | "board" = "markdown") => {
      const taken = new Set(snapshotRef.current.files.map((f) => f.name));
      const isMermaid = documentKind === "mermaid";
      const isBoard = documentKind === "board";
      const extension = isBoard ? ".excalidraw" : isMermaid ? ".mmd" : ".md";
      const suggested = uniqueFileName(
        isBoard ? "board.excalidraw" : isMermaid ? "animation.mmd" : "new.md",
        taken,
      );

      // Ask for the name up front. Creating the document and leaving the reader
      // to find Rename in a menu meant every new file started as "new.md", and
      // a workspace filled up with documents named after nothing.
      const entered = window.prompt("Name for the new file:", suggested);
      // Cancel means cancel — no document, rather than one with the default name.
      if (entered === null) return;
      const trimmed = entered.trim();
      // The extension is what routes a document to its viewer and editor, so it
      // is appended when the reader leaves it off rather than left to chance.
      const withExtension =
        !trimmed || trimmed === extension
          ? suggested
          : trimmed.toLowerCase().endsWith(extension)
            ? trimmed
            : `${trimmed}${extension}`;
      // A name already in use would make two documents indistinguishable in the
      // sidebar, so it is disambiguated the same way the default one is.
      const name = taken.has(withExtension) ? uniqueFileName(withExtension, taken) : withExtension;
      const id = `${name}-${crypto.randomUUID().slice(0, 8)}`;
      const content = isMermaid
        ? `---
flow:
  speed: 260
  loop:
    - route: [Start, Process, Done]
      color: blue
    - wait: 400
---
flowchart LR
  Start[Start] --> Process[Process]
  Process --> Done[Done]
`
        : "";
      const doc: MdFile = {
        id,
        name,
        content,
        mimeType: isBoard
          ? "application/vnd.excalidraw+json"
          : isMermaid
            ? "text/vnd.mermaid"
            : "text/markdown",
        size: content.length,
        addedAt: Date.now(),
        kind: documentKind,
        folderId: folderId ?? null,
        headings: [],
      };
      // Creating the very first document also creates the workspace it lives
      // in, the same way the first upload does — otherwise nothing persists.
      if (!workspaceIdRef.current) {
        const workspace = crypto.randomUUID();
        workspaceIdRef.current = workspace;
        workspaceNameRef.current = "My workspace";
        createdAtRef.current = Date.now();
        setWorkspaceId(workspace);
        setWorkspaces([{ id: workspace, name: workspaceNameRef.current, docCount: 1 }]);
        savePrefs({ lastWorkspaceId: workspace });
      }

      setFiles((prev) => [...prev, doc]);
      setActiveFileId(id);
      setActiveHeadingId(null);
      // A board opens straight onto its canvas — the canvas *is* its editor, so
      // there is no separate edit mode to request.
      if (!isBoard) setAutoEditFileId(id);
      setDrawerOpen(false);
      if (location.pathname !== "/") navigate({ to: "/" });
      markDirty();
      toast.success(`Created ${name}`, {
        description: isBoard
          ? "Draw, drop in images, and sketch diagrams. Changes save automatically."
          : isMermaid
            ? "Edit the flow script and Mermaid source, then preview the animation."
            : "Paste your markdown, then Save.",
      });
    },
    [location.pathname, navigate, markDirty],
  );

  const createMermaidFile = useCallback(
    (folderId?: string | null) => createFile(folderId, "mermaid"),
    [createFile],
  );

  const createBoardFile = useCallback(
    (folderId?: string | null) => createFile(folderId, "board"),
    [createFile],
  );

  const createFolder = useCallback(
    (name: string, parentId?: string | null) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const folder: FolderRecord = {
        id: crypto.randomUUID(),
        name: trimmed,
        createdAt: Date.now(),
        parentId: parentId ?? null,
      };
      setFolders((prev) => [...prev, folder]);
      markDirty();
      toast.success(`Created folder "${trimmed}"`);
    },
    [markDirty],
  );

  /**
   * Re-parent a folder, refusing moves that would detach a subtree.
   *
   * Dropping a folder onto its own descendant would leave that whole branch
   * pointing in a loop — unreachable from the top level, and invisible in a
   * sidebar that renders downward from the roots.
   */
  const moveFolderToFolder = useCallback(
    (folderId: string, parentId: string | null) => {
      if (folderId === parentId) return;
      setFolders((prev) => {
        if (parentId) {
          const parentOf = new Map(prev.map((f) => [f.id, f.parentId ?? null]));
          for (let at: string | null = parentId; at; at = parentOf.get(at) ?? null) {
            if (at === folderId) return prev;
          }
        }
        return prev.map((f) => (f.id === folderId ? { ...f, parentId } : f));
      });
      markDirty();
    },
    [markDirty],
  );

  const renameFolder = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: trimmed } : f)));
      markDirty();
    },
    [markDirty],
  );

  /**
   * Deleting a folder keeps everything inside it.
   *
   * Its documents return to the top level, and so do any folders nested under
   * it — re-parenting the children rather than deleting the subtree, so a
   * mis-click never takes a branch of the workspace with it.
   */
  const deleteFolder = useCallback(
    (id: string) => {
      setFolders((prev) =>
        prev
          .filter((f) => f.id !== id)
          .map((f) => (f.parentId === id ? { ...f, parentId: null } : f)),
      );
      setFiles((prev) => prev.map((f) => (f.folderId === id ? { ...f, folderId: null } : f)));
      markDirty();
    },
    [markDirty],
  );

  const moveFileToFolder = useCallback(
    (fileId: string, folderId: string | null) => {
      setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, folderId } : f)));
      markDirty();
    },
    [markDirty],
  );

  const reorderFile = useCallback(
    (oldIndex: number, newIndex: number) => {
      setFiles((prev) => {
        const next = [...prev];
        const [moved] = next.splice(oldIndex, 1);
        next.splice(newIndex, 0, moved);
        return next;
      });
      markDirty();
    },
    [markDirty],
  );

  const addHighlight = useCallback(
    (hl: Omit<Highlight, "id" | "fileId">, fileId: string) => {
      setHighlights((prev) => {
        const overlaps = prev.filter(
          (p) =>
            p.fileId === fileId &&
            p.subtopicId === hl.subtopicId &&
            typeof p.start === "number" &&
            typeof p.end === "number" &&
            typeof hl.start === "number" &&
            typeof hl.end === "number" &&
            !(hl.end <= p.start || hl.start >= p.end),
        );
        const withoutOverlaps = prev.filter((p) => !overlaps.includes(p));
        return [...withoutOverlaps, { id: crypto.randomUUID(), fileId, ...hl }];
      });
      markDirty();
    },
    [markDirty],
  );

  const updateHighlight = useCallback(
    (id: string, patch: Partial<{ color: string; label: string }>) => {
      setHighlights((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)));
      markDirty();
    },
    [markDirty],
  );

  const removeHighlight = useCallback(
    (id: string) => {
      setHighlights((prev) => prev.filter((h) => h.id !== id));
      markDirty();
    },
    [markDirty],
  );

  // The viewer re-anchors highlights whose text moved (the document was edited)
  // and hands back the corrected offsets. Not an undoable step — the reader
  // didn't do it — but persisted, so the repair survives a reload.
  const repairHighlights = useCallback(
    (patches: Array<{ id: string; patch: Partial<Highlight> }>) => {
      if (!patches.length) return;
      const byId = new Map(patches.map((p) => [p.id, p.patch]));
      amendHighlights((prev) => {
        let changed = false;
        const next = prev.map((h) => {
          const patch = byId.get(h.id);
          if (!patch) return h;
          const merged = { ...h, ...patch };
          if ((Object.keys(patch) as Array<keyof Highlight>).every((k) => h[k] === merged[k])) {
            return h;
          }
          changed = true;
          return merged;
        });
        return changed ? next : prev;
      });
      markDirty();
    },
    [amendHighlights, markDirty],
  );

  // Undo/redo for highlights. Cmd on macOS, Ctrl elsewhere; redo accepts both
  // the Windows form (Ctrl+Y) and the macOS one (Cmd+Shift+Z).
  //
  // Two things are deliberately left alone: a focused input or textarea keeps
  // its native undo (the markdown editor lives in one), and if there is nothing
  // to undo the event is not consumed, so the browser's own undo still works.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hasModKey(e)) return;
      if (isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();

      const isRedo = key === "y" || (key === "z" && e.shiftKey);
      const isUndo = key === "z" && !e.shiftKey;
      if (!isRedo && !isUndo) return;

      if (isRedo) {
        if (!canRedoHighlights) return;
        e.preventDefault();
        redoHighlights();
        toast("Redid highlight change");
      } else {
        if (!canUndoHighlights) return;
        e.preventDefault();
        undoHighlights();
        toast("Undid highlight change");
      }
      markDirty();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canUndoHighlights, canRedoHighlights, undoHighlights, redoHighlights, markDirty]);

  const toggleFile = useCallback(
    (fileId: string) => {
      setExpanded((e) => ({ ...e, [fileId]: !(e[fileId] ?? fileId === activeFileId) }));
      markDirty();
    },
    [activeFileId, markDirty],
  );

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => !c);
    markDirty();
  }, [markDirty]);

  // Star or unstar one thing. Identity is what the star points at (file,
  // section anchor, or the passage's text), never a generated id — re-saving
  // the same table has to find the existing star, not add a second one.
  const toggleSaved = useCallback(
    (fileId: string, draft: SavedDraft) => {
      setSaved((prev) => {
        const key = savedKey({ fileId, ...draft });
        const hit = prev.find((s) => savedKey(s) === key);
        return hit
          ? prev.filter((s) => s.id !== hit.id)
          : [...prev, { ...draft, id: newSavedId(), fileId, createdAt: Date.now() }];
      });
      markDirty();
    },
    [markDirty],
  );

  const removeSaved = useCallback(
    (id: string) => {
      setSaved((prev) => prev.filter((s) => s.id !== id));
      markDirty();
    },
    [markDirty],
  );

  const sortFilesByName = useCallback(() => {
    setFiles((prev) => {
      const next = [...prev].sort((a, b) => a.name.localeCompare(b.name));
      return next;
    });
    markDirty();
  }, [markDirty]);

  const openFromHome = useCallback(
    async (fileId: string, subtopicId?: string) => {
      const file = filesRef.current.find((item) => item.id === fileId);
      if (!file) return;

      const chunks = fileSubtopics(file);
      const targetSubtopicId = subtopicId ?? chunks[0]?.id ?? "preamble";

      // Collapse sidebar to show only the document
      setSidebarCollapsed(true);

      // Home and reader are separate route instances. Save the selection before
      // navigating so the reader hydrates the document the user chose, rather
      // than the workspace's previously open document.
      snapshotRef.current = {
        ...snapshotRef.current,
        activeFileId: fileId,
      };
      setActiveFileId(fileId);
      setActiveHeadingId(targetSubtopicId);

      if (workspaceIdRef.current) {
        setSaveStatus("saving");
        await persistNow(false, true);
      }

      navigate({ to: "/" });
    },
    [navigate, persistNow],
  );

  const handleDocumentSave = useCallback(
    (fileId: string, update: DocumentUpdate) => {
      setFiles((previous) =>
        previous.map((file) =>
          file.id === fileId
            ? { ...file, ...update, data: update.data, headings: undefined, subtopics: undefined }
            : file,
        ),
      );
      markDirty();
    },
    [markDirty],
  );

  const handleContentChange = useCallback(
    (fileId: string, content: string) => {
      // Structure is dropped rather than recomputed. This fires on every pause
      // in typing, and re-parsing the whole document here put an O(document)
      // scan on the autosave path; whatever next reads the sections derives
      // them from the new content and caches the result.
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? {
                ...f,
                content,
                data: undefined,
                size: new TextEncoder().encode(content).byteLength,
                headings: undefined,
                subtopics: undefined,
              }
            : f,
        ),
      );
      markDirty();
    },
    [markDirty],
  );

  // ---- recovered drafts ----
  //
  // Edits journalled by a tab that has since gone (closed, crashed, killed)
  // and that storage never received. Checked whenever a workspace opens;
  // drafts from tabs still open elsewhere are theirs to save.
  const [recovered, setRecovered] = useState<(DraftEntry & { asCopy: boolean })[]>([]);
  useEffect(() => {
    setRecovered([]);
    if (booting || !workspaceId) return;
    const id = workspaceId;
    const entries = journal.list(id);
    if (entries.length === 0) return;
    let alive = true;
    void liveSessions().then((live) => {
      if (!alive || workspaceIdRef.current !== id) return;
      const { offer, stale } = recoverableDrafts(entries, snapshotRef.current.files, {
        session: journal.session,
        live,
      });
      for (const entry of stale) journal.discard(id, entry.fileId);
      setRecovered(offer.map((entry) => ({ ...entry, asCopy: entry.changedSince })));
    });
    return () => {
      alive = false;
    };
  }, [booting, workspaceId, journal]);

  const discardRecovered = useCallback(
    (fileId: string) => {
      const id = workspaceIdRef.current;
      if (id) journal.discard(id, fileId);
      setRecovered((list) => list.filter((entry) => entry.fileId !== fileId));
    },
    [journal],
  );

  const restoreRecovered = useCallback(
    (fileId: string) => {
      const id = workspaceIdRef.current;
      const entry = recovered.find((e) => e.fileId === fileId);
      if (!id || !entry) return;
      const current = snapshotRef.current.files.find((f) => f.id === fileId);
      // Checked again now rather than trusted from when the offer was made:
      // restoring in place must never overwrite a version saved since.
      const inPlace = !!current && !current.deletedAt && hashText(current.content) === entry.base;
      let targetId = fileId;
      let targetName = current?.name ?? entry.fileName;
      if (inPlace) {
        handleContentChange(fileId, entry.text);
      } else {
        const taken = new Set(snapshotRef.current.files.map((f) => f.name));
        const dot = entry.fileName.lastIndexOf(".");
        const stem = dot > 0 ? entry.fileName.slice(0, dot) : entry.fileName;
        const extension = dot > 0 ? entry.fileName.slice(dot) : ".md";
        const name = uniqueFileName(`${stem} (recovered)${extension}`, taken);
        targetId = `${name}-${crypto.randomUUID().slice(0, 8)}`;
        targetName = name;
        const doc: MdFile = {
          id: targetId,
          name,
          content: entry.text,
          mimeType: current?.mimeType ?? "text/markdown",
          size: new TextEncoder().encode(entry.text).byteLength,
          addedAt: Date.now(),
          kind: current?.kind,
          folderId: current && !current.deletedAt ? (current.folderId ?? null) : null,
        };
        setFiles((prev) => [...prev, doc]);
        markDirty();
      }
      // Re-owned by this tab until the write holding it commits (`settle`).
      journal.stage({
        workspaceId: id,
        fileId: targetId,
        fileName: targetName,
        text: entry.text,
        base: inPlace && current ? hashText(current.content) : hashText(""),
      });
      if (targetId !== fileId) journal.discard(id, fileId);
      journal.flush();
      setRecovered((list) => list.filter((e) => e.fileId !== fileId));
      setActiveFileId(targetId);
      setActiveHeadingId(null);
      toast.success(
        inPlace
          ? `Restored your edits to “${entry.fileName}”.`
          : "Your edits were restored as a copy.",
      );
    },
    [recovered, handleContentChange, journal, markDirty, setActiveFileId],
  );

  useEffect(() => {
    if (!activeFile) return;
    const hash = window.location.hash.slice(1);
    if (hash) {
      setScrollTarget(hash);
      setTimeout(() => setScrollTarget(null), 100);
    }
  }, [activeFileId]);

  // Track most-recently-opened files for the "Recent" chip. Every open path
  // sets activeFileId, so keying on it captures them all. Persisted to IndexedDB.
  useEffect(() => {
    if (!activeFileId) return;
    setRecentFileIds((prev) => {
      if (prev[0] === activeFileId) return prev;
      return [activeFileId, ...prev.filter((id) => id !== activeFileId)].slice(0, 30);
    });
    markDirty();
  }, [activeFileId, markDirty]);

  const nextReadingMin = nextFile ? readingMinutes(nextFile.content) : null;

  // ---- workspace management ----

  const switchWorkspace = useCallback(
    async (id: string) => {
      if (id === workspaceIdRef.current) return;
      if (!(await persistNow(true))) return;
      const ws = await persistence.serial(() => persistence.getWorkspace(id));
      if (!ws) return;
      hydrateWorkspace(ws);
      savePrefs({ lastWorkspaceId: id });
    },
    [persistNow, hydrateWorkspace],
  );

  // ---- other tabs ----
  //
  // A commit in another tab is announced here. It is only a hint: the revision
  // check inside every write is what actually prevents a stale overwrite. An
  // idle tab quietly adopts the other tab's data; a tab holding unsaved work
  // goes straight to the conflict banner instead of waiting to fail a save.
  const hasUnsavedWork = useCallback(
    () =>
      mutationRef.current !== savedMutationRef.current ||
      editorDirtyRef.current ||
      officeDirtyPanes.current.size > 0,
    [],
  );

  // Anything that reloads the page (stale-chunk recovery) saves through here
  // first, and learns what a reload would still cost. See safe-reload.ts.
  useEffect(() => {
    let journalled = true;
    return registerReloadGuard({
      flush: () => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        if (journalTimer.current) clearTimeout(journalTimer.current);
        journalled = journal.flush();
        return persistNow(false);
      },
      idle: () => !hasUnsavedWork() && !saveErrorRef.current && !workspaceConflictRef.current,
      // Editor text is in the draft journal, which offers it back after the
      // reload; everything else unsaved exists only in this tab.
      atRisk: () =>
        mutationRef.current !== savedMutationRef.current ||
        officeDirtyPanes.current.size > 0 ||
        !!saveErrorRef.current ||
        workspaceConflictRef.current ||
        (editorDirtyRef.current && !journalled),
    });
  }, [hasUnsavedWork, journal, persistNow]);

  useEffect(
    () =>
      persistence.subscribe((change) => {
        const id = workspaceIdRef.current;
        if (!hydratedRef.current) return;
        void refreshWorkspaceList();
        if (!id || workspaceConflictRef.current) return;
        if (change.type === "cleared" || (change.type === "deleted" && change.id === id)) {
          enterConflict("deleted");
          return;
        }
        if (change.type !== "changed" || change.id !== id) return;
        if (change.revision === storageRevisionRef.current) return;
        void persistence.serial(async () => {
          const latest = await persistence.getWorkspace(id);
          if (workspaceIdRef.current !== id || workspaceConflictRef.current) return;
          if (!latest) return enterConflict("deleted");
          if (latest.revision === storageRevisionRef.current) return;
          if (hasUnsavedWork()) {
            // This tab's pending save will merge onto the other tab's commit
            // (and only stop for the reader if both changed the same thing).
            storedRecordRef.current = latest;
            storageRevisionRef.current = latest.revision;
            return;
          }
          // Keep this tab's own view — which documents are open, what is
          // expanded — and take everything else from storage.
          const view = buildRecord().ui;
          hydrateWorkspace(
            {
              ...latest,
              ui: { ...latest.ui, ...view, fileOrder: latest.ui.fileOrder },
            },
            { background: true },
          );
        });
      }),
    [buildRecord, enterConflict, hasUnsavedWork, hydrateWorkspace, refreshWorkspaceList],
  );

  const [resolvingConflict, setResolvingConflict] = useState(false);

  /** Save this tab's version as a new workspace and carry on in it. */
  const keepMyVersion = useCallback(async () => {
    setResolvingConflict(true);
    try {
      const mine = buildRecord();
      const existing = await persistence.listWorkspaceSummaries();
      const copy: WorkspaceRecord = {
        ...mine,
        id: crypto.randomUUID(),
        revision: undefined,
        name: availableWorkspaceName(
          conflict === "deleted" ? mine.name : `${mine.name} (my changes)`,
          existing,
        ),
        createdAt: Date.now(),
      };
      await persistence.serial(() => persistence.putWorkspace(copy));
      await refreshWorkspaceList();
      hydrateWorkspace(copy, { background: true });
      setSaveStatus("saved");
      savePrefs({ lastWorkspaceId: copy.id });
      toast.success(`Your version is saved as “${copy.name}”.`, {
        description: conflict === "deleted" ? undefined : "The other tab's version is unchanged.",
      });
    } catch (error) {
      console.error("Could not keep this tab's version", error);
      toast.error("Your version could not be saved. Export this workspace as a backup.", {
        id: "workspace-save-error",
      });
    } finally {
      setResolvingConflict(false);
    }
  }, [buildRecord, conflict, hydrateWorkspace, refreshWorkspaceList]);

  /** Drop this tab's unsaved version and show what storage holds. */
  const loadSavedVersion = useCallback(async () => {
    setResolvingConflict(true);
    try {
      const id = workspaceIdRef.current;
      const latest = id ? await persistence.serial(() => persistence.getWorkspace(id)) : undefined;
      if (latest) {
        hydrateWorkspace(latest);
        return;
      }
      const list = await persistence.listWorkspaceSummaries();
      await refreshWorkspaceList();
      const next = list[0] ? await persistence.getWorkspace(list[0].id) : undefined;
      if (next) {
        hydrateWorkspace(next);
        savePrefs({ lastWorkspaceId: next.id });
        return;
      }
      // Nothing left anywhere: back to the empty first-run state.
      workspaceConflictRef.current = false;
      setConflict(null);
      workspaceIdRef.current = null;
      storageRevisionRef.current = undefined;
      setWorkspaceId(null);
      setFiles([]);
      setFolders([]);
      setSaved([]);
      setSaveStatus("idle");
    } finally {
      setResolvingConflict(false);
    }
  }, [hydrateWorkspace, refreshWorkspaceList]);

  const conflictBanner = conflict ? (
    <ConflictBanner
      reason={conflict}
      busy={resolvingConflict}
      onKeepBoth={() => void keepMyVersion()}
      onUseSaved={() => void loadSavedVersion()}
    />
  ) : null;

  /**
   * What the sidebar asked to move, held while the reader picks a destination.
   *
   * The selection has to survive the menu closing — by the time the dialog is
   * on screen the rows it came from are gone — so it lives here rather than in
   * the sidebar's own state.
   */
  const [pendingMove, setPendingMove] = useState<{
    fileIds: string[];
    folderIds: string[];
  } | null>(null);
  const [moving, setMoving] = useState(false);

  /**
   * Everything the move will actually touch, expanded from the selection.
   *
   * Computed here rather than in the dialog so the count the reader confirms is
   * produced by the same code that performs the move — a folder's contents
   * included. A dialog counting only what was clicked would understate it.
   */
  const pendingMoveSummary = useMemo(() => {
    if (!pendingMove) return { files: 0, folders: 0 };
    const plan = planTransfer(
      { files: filesRef.current, folders, saved, highlights },
      { files: [], folders: [] },
      pendingMove,
    );
    return { files: plan.files.length, folders: plan.folders.length };
  }, [pendingMove, folders, saved, highlights]);

  /**
   * Move documents and folders into another workspace.
   *
   * Both workspaces are written in one transaction, each checked against the
   * revision it was read at: either the documents are in the destination and
   * gone from here, or nothing changed at all. It runs inside the write queue,
   * so no save from this tab can land between reading the destination and
   * committing the move.
   */
  const moveToWorkspace = useCallback(
    async (destinationId: string) => {
      const selection = pendingMove;
      if (!selection) return;

      setMoving(true);
      const toastId = toast.loading("Moving…");
      try {
        const result = await persistence.serial(async () => {
          if (workspaceConflictRef.current)
            throw new Error("Resolve the conflict with another tab first.");
          const destination = await persistence.getWorkspace(destinationId);
          if (!destination) throw new Error("That workspace no longer exists.");

          // The source is this tab's current snapshot, unsaved edits included,
          // so the move also saves them — nothing is written back over it later.
          const pending = mutationRef.current;
          const current = buildRecord();
          const plan = planTransfer(current, destination, selection);
          if (!plan.files.length && !plan.folders.length) return null;

          const layout = closeFileEverywhere(snapshotRef.current.paneLayout, [
            ...plan.removeFileIds,
          ]);
          const source = removeFromSource(current, plan);
          source.ui = {
            ...source.ui,
            panes: toPersisted(layout),
            focusedPaneId: layout.focusedPaneId,
            activeFileId: activeFileOf(layout),
            fileOrder: source.files.map((file) => file.id),
          };
          try {
            await persistence.putWorkspaces([source, applyToDestination(destination, plan)]);
          } catch (error) {
            if (error instanceof WorkspaceConflictError && error.workspaceId === source.id)
              enterConflict(error.reason);
            throw error;
          }
          storageRevisionRef.current = source.revision;
          storedRecordRef.current = source;
          baseRecordRef.current = source;
          savedMutationRef.current = Math.max(savedMutationRef.current, pending);
          return { plan, destination };
        });
        if (!result) {
          toast.info("Nothing to move", { id: toastId });
          return;
        }
        const { plan, destination } = result;

        // Storage already holds this state; bring the view in line with it.
        setFiles((prev) => prev.filter((file) => !plan.removeFileIds.has(file.id)));
        setFolders((prev) => prev.filter((folder) => !plan.removeFolderIds.has(folder.id)));
        setSaved((prev) => prev.filter((item) => !plan.removeFileIds.has(item.fileId)));
        setHighlights((prev) => prev.filter((item) => !plan.removeFileIds.has(item.fileId)));
        // A moved document must not stay open in a pane pointing at a file this
        // workspace no longer has.
        setPaneLayout((prev) => closeFileEverywhere(prev, [...plan.removeFileIds]));
        await refreshWorkspaceList();

        const counts = transferCounts(plan);
        const parts = [
          counts.files ? `${counts.files} document${counts.files === 1 ? "" : "s"}` : null,
          counts.folders ? `${counts.folders} folder${counts.folders === 1 ? "" : "s"}` : null,
        ].filter(Boolean);
        toast.success(`Moved ${parts.join(" and ")} to ${destination.name}`, { id: toastId });
      } catch (error) {
        toast.error("Move failed — nothing was moved", {
          id: toastId,
          description:
            error instanceof WorkspaceConflictError
              ? "One of the workspaces changed in another tab."
              : error instanceof Error
                ? error.message
                : undefined,
        });
      } finally {
        setMoving(false);
        setPendingMove(null);
      }
    },
    [pendingMove, buildRecord, enterConflict, refreshWorkspaceList, setHighlights],
  );

  const openEmbeddedArtifact = useCallback(
    async (fileId: string, targetWorkspaceId: string) => {
      if (targetWorkspaceId !== workspaceIdRef.current) await switchWorkspace(targetWorkspaceId);
      setActiveFileId(fileId);
      setActiveHeadingId("preamble");
      setDrawerOpen(false);
      if (location.pathname !== "/") navigate({ to: "/" });
    },
    [location.pathname, navigate, switchWorkspace],
  );

  useEffect(() => {
    clearArtifactResolutionCache();
  }, [workspaceRevision]);

  // The workspace list held in state is a render-time convenience; name checks
  // read the store directly so a workspace created in another tab still counts.
  const storedWorkspaces = useCallback(() => persistence.listWorkspaceSummaries(), []);

  const newWorkspace = useCallback(
    async (name?: string) => {
      const asked = name || window.prompt("Enter new workspace name:");
      if (!asked) return;
      const finalName = resolveWorkspaceName(asked, await storedWorkspaces());
      if (!finalName) return;
      if (!(await persistNow(true))) return;
      const ws = newWorkspaceRecord(finalName);
      await persistence.serial(() => persistence.putWorkspace(ws));
      await refreshWorkspaceList();
      hydrateWorkspace(ws);
      savePrefs({ lastWorkspaceId: ws.id });
    },
    [persistNow, refreshWorkspaceList, hydrateWorkspace, storedWorkspaces],
  );

  const importWorkspace = useCallback(
    async (file: File) => {
      try {
        const ws = parseWorkspaceImport(await file.text());
        const existing = await storedWorkspaces();

        // The same export imported twice would otherwise overwrite the copy
        // already here (`put` keys on id), silently discarding whatever has
        // been read, highlighted or saved in it since.
        const sameRecord = existing.find((w) => w.id === ws.id);
        if (sameRecord) {
          const keepBoth = window.confirm(
            `“${sameRecord.name}” has already been imported. ` +
              `Import it again as a separate copy?\n\n` +
              `Cancel leaves the workspace you already have untouched.`,
          );
          if (!keepBoth) {
            await switchWorkspace(sameRecord.id);
            return;
          }
          ws.id = crypto.randomUUID();
        }

        const finalName = resolveWorkspaceName(ws.name, existing, {
          excludeId: ws.id,
          whatIsIt: "A workspace",
        });
        if (!finalName) return; // reader cancelled the rename — import nothing
        ws.name = finalName;

        if (!(await persistNow(true))) return;
        await persistence.serial(() => persistence.putWorkspace(ws));
        await refreshWorkspaceList();
        hydrateWorkspace(ws);
        savePrefs({ lastWorkspaceId: ws.id });
      } catch (error) {
        setSaveStatus("idle");
        // Validation runs before anything is written, so nothing was imported.
        toast.error(
          error instanceof ImportValidationError
            ? `Nothing was imported. ${error.message}`
            : "Nothing was imported. That file isn't a valid workspace backup.",
          { id: "workspace-import-error" },
        );
      }
    },
    [persistNow, refreshWorkspaceList, hydrateWorkspace, storedWorkspaces, switchWorkspace],
  );

  /** Save a workspace backup (full, or a share selection) as a .json download. */
  const downloadJson = useCallback((json: string, name: string) => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.trim().replace(/\s+/g, "-").toLowerCase() || "workspace"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const exportWorkspace = useCallback(() => {
    const rec = buildRecord();
    downloadJson(serializeWorkspace(rec), rec.name);
  }, [buildRecord, downloadJson]);

  // Sharing uploads to a third party, so it never happens straight from a menu
  // click: both entry points open SharePreviewDialog, which names the
  // destination, lists the files, keeps the Bin and annotations out by default
  // and offers a local download instead. Backup export stays separate above.
  const [shareRequest, setShareRequest] = useState<ShareRequest | null>(null);

  const shareWorkspace = useCallback(() => {
    const record = buildRecord();
    if (record.files.length === 0) {
      toast.info("This workspace has no files to share yet.");
      return;
    }
    setShareRequest({ mode: "workspace", record, fileIds: record.files.map((f) => f.id) });
  }, [buildRecord]);

  /**
   * Share one file or a hand-picked set of them. Unlike the workspace link,
   * this one asks the recipient where the files should land — see
   * `SharedFilesDialog` and `acceptSharedFiles`.
   */
  const shareFiles = useCallback(
    (fileIds: string[]) => {
      const record = buildRecord();
      const ids = record.files.filter((f) => fileIds.includes(f.id)).map((f) => f.id);
      if (ids.length > 0) setShareRequest({ mode: "files", record, fileIds: ids });
    },
    [buildRecord],
  );

  const uploadShareLink = useCallback(async (mode: ShareRequest["mode"], json: string) => {
    const key = await uploadShare(json);
    const hash = mode === "workspace" ? SHARE_HASH : SHARE_FILES_HASH;
    // Always the app root: a link made from /settings or /saved should open the
    // reader for the recipient, not the sender's current page.
    return `${new URL(import.meta.env.BASE_URL ?? "/", window.location.origin).href}${hash}${key}`;
  }, []);

  const shareFile = useCallback((fileId: string) => shareFiles([fileId]), [shareFiles]);

  // ---- receiving a #share-files= link ----
  //
  // Nothing is written on arrival: the payload is held here until the reader
  // picks a destination in SharedFilesDialog.

  const loadIncomingShare = useCallback(async () => {
    const hash = window.location.hash;
    if (!hash.startsWith(SHARE_FILES_HASH)) return;
    // Drop the hash first, so a refresh or a failed fetch doesn't re-prompt.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    try {
      toast.loading("Opening shared files...", { id: "incoming-share" });
      const json = await fetchShare(hash.slice(SHARE_FILES_HASH.length));
      setIncomingShare(parseSharedFiles(json));
      toast.dismiss("incoming-share");
    } catch (e) {
      console.error("Failed to read shared files link", e);
      toast.error("Invalid or expired shared files link.", { id: "incoming-share" });
    }
  }, []);

  useEffect(() => {
    void loadIncomingShare();
    // A link opened from another tab on this origin only changes the hash.
    const onHashChange = () => void loadIncomingShare();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [loadIncomingShare]);

  const acceptSharedFiles = useCallback(
    async (target: "new" | "current", fileIds: string[], newName: string) => {
      const payload = incomingShare;
      if (!payload) return;
      const picked = payload.files.filter((f) => fileIds.includes(f.id));
      if (picked.length === 0) return;

      setImportingShare(true);
      try {
        // The same file can arrive twice (re-shared, or shared back); fresh ids
        // keep both copies addressable.
        const importedIds = new Map(picked.map((f) => [f.id, crypto.randomUUID()]));
        const stamped: PersistedFile[] = picked.map((f) => ({
          ...f,
          id: importedIds.get(f.id)!,
          derivedFrom: remapDerivation(f.derivedFrom, importedIds),
          addedAt: f.addedAt ?? Date.now(),
          // Folders don't travel with a share link; shared files land at the
          // top level rather than pointing at a folder that isn't here.
          folderId: null,
        }));

        const incomingBytes = stamped.reduce((sum, f) => sum + (f.size ?? f.content.length), 0);
        const maxStorage = await getMaxStorageBytes();
        if (maxStorage != null) {
          const usedBytes = snapshotRef.current.files.reduce((sum, f) => sum + (f.size ?? 0), 0);
          if (usedBytes + incomingBytes > maxStorage) {
            toast.error(
              `Storage full — this application is strictly capped at ${formatBytes(maxStorage)}. Remove some files before importing shared ones.`,
            );
            return;
          }
        }

        if (target === "new") {
          if (!(await persistNow(true))) return;
          const ws = newWorkspaceRecord(newName.trim() || payload.sourceName);
          ws.files = stamped;
          ws.ui.activeFileId = stamped[0].id;
          ws.ui.fileOrder = stamped.map((f) => f.id);
          await persistence.serial(() => persistence.putWorkspace(ws));
          await refreshWorkspaceList();
          hydrateWorkspace(ws);
          savePrefs({ lastWorkspaceId: ws.id });
        } else {
          const taken = new Set(snapshotRef.current.files.map((f) => f.name));
          const added = stamped.map((f) => {
            const name = uniqueFileName(f.name, taken);
            taken.add(name);
            return toMdFile({ ...f, name });
          });
          const nextFiles = [...snapshotRef.current.files, ...added];
          const nextActiveFileId = snapshotRef.current.activeFileId ?? added[0].id;

          // Dropping into "the current workspace" before one exists (a first
          // visit opened straight from a link) creates it, as an upload would.
          if (!workspaceIdRef.current) {
            const id = crypto.randomUUID();
            workspaceIdRef.current = id;
            storageRevisionRef.current = undefined;
            workspaceNameRef.current = payload.sourceName;
            createdAtRef.current = Date.now();
            setWorkspaceId(id);
            savePrefs({ lastWorkspaceId: id });
          }

          snapshotRef.current = {
            ...snapshotRef.current,
            files: nextFiles,
            activeFileId: nextActiveFileId,
          };
          setFiles(nextFiles);
          setActiveFileId(nextActiveFileId);
          setSaveStatus("saving");
          if (!(await persistNow(false, true))) throw new Error("Shared files could not be saved");
          await refreshWorkspaceList();
        }

        setIncomingShare(null);
        toast.success(
          `Added ${stamped.length} shared file${stamped.length > 1 ? "s" : ""} to ${
            target === "new" ? newName.trim() || payload.sourceName : workspaceNameRef.current
          }.`,
        );
        if (location.pathname !== "/") navigate({ to: "/" });
      } catch (e) {
        console.error("Failed to import shared files", e);
        setSaveStatus((status) => (status === "saving" ? "idle" : status));
        toast.error("Could not import the shared files. Please try again.");
      } finally {
        setImportingShare(false);
      }
    },
    [
      incomingShare,
      persistNow,
      refreshWorkspaceList,
      hydrateWorkspace,
      buildRecord,
      location.pathname,
      navigate,
    ],
  );

  const deleteWorkspace = useCallback(
    async (id: string) => {
      const active = id === workspaceIdRef.current;
      if (active) {
        // Its pending save must not run after the delete and trip over the
        // missing record.
        if (saveTimer.current) clearTimeout(saveTimer.current);
        savedMutationRef.current = mutationRef.current;
      }
      const { list, next } = await persistence.serial(async () => {
        await persistence.deleteWorkspace(id);
        let list: WorkspaceSummary[] = await persistence.listWorkspaceSummaries();
        if (list.length === 0) {
          const ws = newWorkspaceRecord("My workspace");
          await persistence.putWorkspace(ws);
          list = await persistence.listWorkspaceSummaries();
        }
        list.sort((a, b) => a.createdAt - b.createdAt);
        return { list, next: active ? await persistence.getWorkspace(list[0].id) : undefined };
      });
      setWorkspaces(list);
      if (active) {
        if (!next) throw new Error("Workspace could not be loaded");
        hydrateWorkspace(next);
        savePrefs({ lastWorkspaceId: next.id });
      }
    },
    [hydrateWorkspace],
  );

  const renameWorkspace = useCallback(
    async (id: string, newName: string) => {
      const existing = await storedWorkspaces();
      const current = existing.find((w) => w.id === id);
      if (!current) return;
      const finalName = resolveWorkspaceName(newName, existing, { excludeId: id });
      if (!finalName || finalName === current.name) return;
      const active = id === workspaceIdRef.current;
      try {
        await persistence.serial(async () => {
          if (!active) {
            await persistence.renameWorkspace(id, finalName);
            return;
          }
          // The open workspace is renamed through its own revision, so a tab
          // holding an older copy cannot quietly write the old name back.
          if (!(await writeActive(true, false))) throw new Error("Save pending changes first");
          storageRevisionRef.current = await persistence.renameWorkspace(
            id,
            finalName,
            storageRevisionRef.current,
          );
          workspaceNameRef.current = finalName;
        });
      } catch (error) {
        if (error instanceof WorkspaceConflictError && active) enterConflict(error.reason);
        toast.error("The workspace could not be renamed.");
      }
      await refreshWorkspaceList();
    },
    [enterConflict, refreshWorkspaceList, storedWorkspaces, writeActive],
  );

  const clearAllStorage = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    if (restoredFlash.current) clearTimeout(restoredFlash.current);

    // Stop lifecycle handlers from writing the current snapshot back while the
    // database is being deleted and the page is reloading.
    hydratedRef.current = false;
    workspaceIdRef.current = null;

    try {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // Continue with IndexedDB deletion when Web Storage is unavailable.
      }
      await persistence.destroy();
      window.location.reload();
    } catch (error) {
      console.error("Could not clear all browser storage", error);
      alert("Some data could not be cleared. Close Localdox in other tabs and try again.");
    }
  }, []);

  // Rows for the Saved list: newest first, each carrying the name of the file it
  // came from. Stars whose file is gone are dropped rather than shown as dead
  // rows — removing a file already removes its content.
  const savedEntries: SavedEntry[] = useMemo(
    () =>
      saved
        .map((item) => {
          const file = files.find((f) => f.id === item.fileId);
          return file ? { ...item, fileName: file.name } : null;
        })
        .filter(Boolean as unknown as (v: SavedEntry | null) => v is SavedEntry)
        .sort((a, b) => b.createdAt - a.createdAt),
    [saved, files],
  );

  // The header star saves whatever page the reader is on: the current section
  // when one is selected, otherwise the document itself.
  const activePageDraft = useCallback((): SavedDraft | null => {
    if (!activeFile) return null;
    if (!activeHeadingId) {
      return { kind: "file", title: activeFile.name };
    }
    const chunks = fileSubtopics(activeFile);
    const chunk = chunks.find((c) => c.id === activeHeadingId);
    return {
      kind: "section",
      title: chunk?.title ?? activeFile.name,
      headingId: activeHeadingId,
      subtopicId: activeHeadingId,
    };
  }, [activeFile, activeHeadingId]);

  const activePageSaved = activeFile
    ? findSaved(saved, {
        fileId: activeFile.id,
        kind: activeHeadingId ? "section" : "file",
        headingId: activeHeadingId ?? undefined,
      })
    : undefined;

  const toggleActivePageSaved = useCallback(() => {
    const draft = activePageDraft();
    if (activeFile && draft) toggleSaved(activeFile.id, draft);
  }, [activeFile, activePageDraft, toggleSaved]);

  // ---- props for the viewer, held to stable identities ----
  //
  // Each of these used to be built inline in the JSX below. A `.filter()` or a
  // `.map()` in a prop returns a new array every render, so <MarkdownViewer>
  // saw changed props on every render of this component no matter what actually
  // changed — which made memoizing it pointless and re-ran its highlight
  // painting and plugin work each time.

  const activeFileHighlights = useMemo(
    () => (activeFile ? highlights.filter((h) => h.fileId === activeFile.id) : EMPTY_HIGHLIGHTS),
    [highlights, activeFile],
  );

  const activeFileSaved = useMemo(
    () => (activeFile ? saved.filter((s) => s.fileId === activeFile.id) : EMPTY_SAVED),
    [saved, activeFile],
  );

  const addHighlightToActive = useCallback(
    (hl: Omit<Highlight, "id" | "fileId">) => {
      if (activeFile) addHighlight(hl, activeFile.id);
    },
    [addHighlight, activeFile],
  );

  const toggleSavedOnActive = useCallback(
    (draft: SavedDraft) => {
      if (activeFile) toggleSaved(activeFile.id, draft);
    },
    [toggleSaved, activeFile],
  );

  const shareActiveFile = useCallback(() => {
    if (activeFile) shareFile(activeFile.id);
  }, [shareFile, activeFile]);

  const navFromViewer = useCallback(
    (fileId: string, subtopicId: string | null) => handleSelect(fileId, subtopicId || undefined),
    [handleSelect],
  );

  const navToFile = useCallback(
    (fileId: string) => handleSelect(fileId, undefined),
    [handleSelect],
  );

  const toggleActiveDocumentSaved = useCallback(() => {
    if (activeFile) toggleSaved(activeFile.id, { kind: "file", title: activeFile.name });
  }, [toggleSaved, activeFile]);

  // The collapsed rail's "New folder" — the expanded sidebar asks for the name
  // itself, so the rail has to do the same before it can create one.
  const promptNewFolderFromRail = useCallback(() => {
    const name = window.prompt("Folder name:", "New folder");
    if (name && name.trim()) createFolder(name.trim());
  }, [createFolder]);

  const consumeStartInEdit = useCallback(() => setAutoEditFileId(null), []);

  // "Edit" from a file's sidebar menu: open the document if it isn't already,
  // then ask the viewer to start in its editor. Reuses the same channel a
  // newly-created blank document travels through.
  const editFile = useCallback(
    (fileId: string) => {
      if (fileId !== activeFileIdRef.current) handleSelect(fileId);
      setAutoEditFileId(fileId);
    },
    // handleSelect is redefined every render; calling the latest one is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  /** Rename from the name field the editor puts above the source. */
  const renameActiveFile = useCallback(
    (name: string) => {
      const id = activeFileIdRef.current;
      if (id) renameFile(id, name);
    },
    [renameFile],
  );

  const clearPendingSaved = useCallback(() => setPendingSaved(null), []);
  const clearPendingSearch = useCallback(() => setPendingSearch(null), []);

  const nextReadingMinutes = useMemo(
    () => (nextFile ? readingMinutes(nextFile.content) : null),
    [nextFile],
  );

  // The AI panel only needs each document's text. Mapping in the JSX rebuilt
  // this array — and every object in it — on every render of the app.
  const aiFiles = useMemo(
    () => files.map((f) => ({ id: f.id, name: f.name, content: f.content })),
    [files],
  );

  const aiActiveFile = useMemo(
    () =>
      activeFile ? { id: activeFile.id, name: activeFile.name, content: activeFile.content } : null,
    [activeFile],
  );

  const aiActiveSection = useMemo(() => {
    if (!activeFile) return null;
    const subs = fileSubtopics(activeFile);
    const section = subs.find((s) => s.id === activeHeadingId);
    return section ? { title: section.title, content: section.content } : null;
  }, [activeFile, activeHeadingId]);

  // Opening a star: go to its file and page first, then hand the item to the
  // viewer, which scrolls to the passage and flashes it once it has rendered.
  const openSaved = useCallback(
    async (item: SavedItem) => {
      const target = item.headingId ?? item.subtopicId ?? undefined;
      if (showSettings) await openFromHome(item.fileId, target);
      else handleSelect(item.fileId, target);
      setPendingSaved(item);
      setDrawerOpen(false);
    },
    // handleSelect is redefined every render; calling the latest one is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openFromHome, showSettings],
  );

  const goHome = useCallback(() => navigate({ to: "/" }), [navigate]);
  // An optional tab lands the dialog straight on a section — "All workspaces"
  // in the workspace menus opens it on workspace settings rather than making
  // you find the tab yourself.
  //
  // Held outside the component: opening settings is a route change, and this
  // component *is* the route, so it remounts on the way there and any state or
  // ref holding the request is wiped before the dialog mounts to read it.
  const openSettings = useCallback(
    (tab?: "workspace") => {
      pendingSettingsTab = tab;
      navigate({ to: "/settings" });
      navHistoryRef.current.push({ path: "/settings", fileId: null, headingId: null });
    },
    [navigate],
  );

  // Closing the dialog is a route change back to the reader. Going through the
  // trail rather than straight to "/" keeps whatever document was open, and
  // means the close button, Escape, the backdrop and back all do one thing.
  const closeSettings = useCallback(() => {
    // Spent: the next plain open starts where it always did.
    pendingSettingsTab = undefined;
    if (navHistoryRef.current.canBack) navHistoryRef.current.back();
    else navigate({ to: "/" });
  }, [navigate]);

  // Put the app into a recorded destination. This is the inverse of `push`: it
  // restores the route, the document, the section, the search term and the
  // scroll offset, without recording anything itself (the history suppresses
  // pushes while it is applying, which is what keeps the forward trail alive).
  applyNavEntryRef.current = (entry: NavEntry) => {
    if (pathnameRef.current !== entry.path) navigate({ to: entry.path });
    setHighlightQuery(entry.query);
    // A reader entry always names its document. An entry without one is a
    // non-reader destination (settings), where the open file is left as it is so
    // coming back out of it lands on the document that was already open.
    if (entry.fileId) {
      setActiveFileId(entry.fileId);
      setActiveHeadingId(entry.headingId);
    }
    setDrawerOpen(false);
    // After the document has painted. Restoring the offset before the content
    // exists would scroll a short page and land at the top.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.scrollTo({ top: entry.scrollY }));
    });
  };

  // Seed the trail with wherever the reader landed, so the first back has
  // somewhere to return to and the first open is not also the first entry.
  //
  // Waits for the document, not just for `booting`: hydration sets the open file
  // and clears the boot flag in the same commit, so an effect keyed on `booting`
  // alone reads `activeFileId` as null and seeds an entry that restores nothing.
  // Settings is seeded without one, since it legitimately has no open document.
  const navSeededRef = useRef(false);
  useEffect(() => {
    if (booting || navSeededRef.current) return;
    if (!activeFileId && !showSettings) return;
    navSeededRef.current = true;
    // A trail restored from the session already knows where we are; seeding on
    // top of it would record the landing twice and make the first back a no-op.
    if (navHistoryRef.current.canBack || navHistoryRef.current.canForward) return;
    navHistoryRef.current.push({
      path: location.pathname,
      fileId: activeFileId,
      headingId: activeHeadingId,
      query: highlightQuery,
    });
    // Runs once, on the first render that has somewhere to return to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booting, activeFileId, showSettings]);

  // App-level dismissables. Each is registered while open so back closes it
  // before it walks the trail — the reader's last action was opening the panel,
  // so that is what back should undo. These are registered directly rather than
  // through `useNavEscape`, because this component owns the history rather than
  // consuming it from the context it provides.
  const { registerEscape } = navHistory;
  useEffect(() => {
    if (!drawerOpen) return;
    return registerEscape({
      id: "drawer",
      depth: ESCAPE_DEPTH.panel,
      close: () => setDrawerOpen(false),
    });
  }, [drawerOpen, registerEscape]);
  useEffect(() => {
    if (!aiOpen) return;
    return registerEscape({
      id: "ai-panel",
      depth: ESCAPE_DEPTH.panel,
      close: () => setAiOpen(false),
    });
  }, [aiOpen, registerEscape]);
  useEffect(() => {
    if (!searchOpen) return;
    return registerEscape({
      id: "search-panel",
      depth: ESCAPE_DEPTH.panel,
      close: () => setSearchOpen(false),
    });
  }, [searchOpen, registerEscape]);

  // The browser's own back/gesture is the same intent as the header's back, so
  // it runs the same code — including closing an open mode first. `popstate`
  // fires after the router has already moved, so the route is put back when an
  // escape swallowed the gesture.
  useEffect(() => {
    const onPopState = () => {
      if (navHistoryRef.current.popEscape()) {
        window.history.forward();
        return;
      }
      navHistoryRef.current.back();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Ask AI: opened either from the sidebar (no prefill) or from a text-selection
  // quick action in the reader (seeded with the selection + chosen action).
  const openAskAi = useCallback(() => {
    setAiPrefill(null);
    setAiOpen(true);
  }, []);
  const askAiFromSelection = useCallback((prefill: AskAiPrefill) => {
    setAiPrefill(prefill);
    setAiOpen(true);
  }, []);
  const closeAskAi = useCallback(() => setAiOpen(false), []);

  // Cmd/Ctrl+K. The search panel lives docked inside <Sidebar>, which on
  // mobile is only mounted while the drawer is open — so there, opening
  // search has to open the drawer too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (hasModKey(e) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (mobileNavigation) openDrawer();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavigation, openDrawer]);

  // Append AI output to the open document, or spin it out into a new one.
  const insertAiOutput = useCallback(
    (markdown: string) => {
      const target = snapshotRef.current.activeFileId;
      const file = snapshotRef.current.files.find((f) => f.id === target);
      if (!file) return;
      handleContentChange(file.id, `${file.content}\n\n${markdown}`);
      toast.success("Inserted into document");
    },
    [handleContentChange],
  );
  const createAiDoc = useCallback(
    (name: string, content: string) => {
      const id = `${name}-${crypto.randomUUID().slice(0, 8)}`;
      const doc: MdFile = {
        id,
        name,
        content,
        mimeType: "text/markdown",
        size: content.length,
        addedAt: Date.now(),
        kind: "markdown",
      };
      setFiles((prev) => [...prev, doc]);
      setActiveFileId(id);
      setAiOpen(false);
      if (location.pathname !== "/") navigate({ to: "/" });
      markDirty();
      toast.success("Created new document");
    },
    [location.pathname, navigate, markDirty],
  );

  const openWorkspaceFromHome = useCallback(
    async (id: string) => {
      setSidebarCollapsed(false);
      if (id !== workspaceIdRef.current) await switchWorkspace(id);
      navigate({ to: "/" });
    },
    [switchWorkspace, navigate],
  );

  const createWorkspaceFromDock = useCallback(async () => {
    await newWorkspace();
    navigate({ to: "/" });
  }, [navigate, newWorkspace]);

  const dragOverlay = <DragDropOverlay open={globalDrag} />;

  // Rendered from both the empty state and the reader — a shared link can land
  // on either.
  const shareDialog = (
    <>
      {incomingShare && (
        <LazyBoundary>
          <SharedFilesDialog
            open
            files={incomingShare.files}
            sourceName={incomingShare.sourceName}
            currentWorkspaceName={workspaceId ? workspaceNameRef.current : null}
            busy={importingShare}
            onDismiss={() => setIncomingShare(null)}
            onImport={(target: "new" | "current", ids: string[], name: string) =>
              void acceptSharedFiles(target, ids, name)
            }
          />
        </LazyBoundary>
      )}
      {shareRequest && (
        <LazyBoundary>
          <SharePreviewDialog
            request={shareRequest}
            onDismiss={() => setShareRequest(null)}
            onUpload={uploadShareLink}
            onCopy={copyLink}
            onDownload={downloadJson}
          />
        </LazyBoundary>
      )}
    </>
  );

  const {
    hits: searchHits,
    total: searchTotal,
    pending: searchPending,
    loadingWorkspaces,
    indexing: searchIndexing,
    error: searchError,
    retry: retrySearch,
  } = useSearchIndex({
    active: searchOpen,
    currentWorkspaceId: workspaceId,
    files,
    workspaces,
    query: searchQuery,
    crossWorkspace: searchCrossWorkspace,
  });
  const handleSearchHitSelect = useCallback(
    async (hit: SearchHit) => {
      await switchWorkspace(hit.workspaceId);
      if (showSettings) await openFromHome(hit.fileId, hit.headingId);
      else
        handleSelect(
          hit.fileId,
          hit.headingId,
          searchQuery,
          hit.line,
          hit.occurrence,
          hit.lineIndex,
        );
      // Clicking a result jumps the reader to it; the panel stays open so more
      // results can be tried without reopening it, the way VS Code's does.
    },
    [switchWorkspace, showSettings, openFromHome, handleSelect, searchQuery],
  );
  const searchPanelState: SearchPanelState | null = searchOpen
    ? {
        query: searchQuery,
        onQueryChange: setSearchQuery,
        crossWorkspace: searchCrossWorkspace,
        onCrossWorkspaceChange: setSearchCrossWorkspace,
        hits: searchHits,
        total: searchTotal,
        pending: searchPending,
        loadingWorkspaces,
        indexing: searchIndexing,
        error: searchError,
        onRetry: retrySearch,
        onSelectHit: (hit: SearchHit) => void handleSearchHitSelect(hit),
        workspaceName: (id: string) => workspaces.find((w) => w.id === id)?.name ?? "Workspace",
        onClose: () => setSearchOpen(false),
      }
    : null;

  const savedPage = showSaved ? (
    <LazyBoundary>
      <SavedPage
        saved={savedEntries}
        highlights={highlights}
        fileName={(fileId) => filesRef.current.find((f) => f.id === fileId)?.name ?? null}
        onOpenSaved={openSaved}
        onRemoveSaved={removeSaved}
        onOpenHighlight={(hl) => handleSelect(hl.fileId, hl.subtopicId || undefined)}
        onRemoveHighlight={removeHighlight}
      />
    </LazyBoundary>
  ) : null;

  // Settings is a dialog over the reader rather than a page of its own, so the
  // document stays visible behind it and closing it returns you to exactly what
  // you were reading. `/settings` stays a real route so the deep link still
  /**
   * Destination picker for a cross-workspace move.
   *
   * Rendered alongside the other dialogs rather than inside the sidebar: the
   * sidebar is unmounted on a phone once the drawer closes, and the move must
   * survive that — it is the reader's documents in flight.
   */
  const moveDialog = (
    <MoveToWorkspaceDialog
      open={pendingMove !== null}
      summary={pendingMoveSummary}
      workspaces={workspaces}
      currentWorkspaceId={workspaceId}
      busy={moving}
      onCancel={() => setPendingMove(null)}
      onConfirm={(destinationId) => void moveToWorkspace(destinationId)}
    />
  );

  // works — it just opens the dialog on top. Rendered from both the empty state
  // and the reader, so that link resolves even before any document is open.
  const settingsDialog = showSettings ? (
    <LazyBoundary>
      <SettingsPage
        workspaces={workspaces}
        currentWorkspaceId={workspaceId}
        onRenameWorkspace={renameWorkspace}
        onDeleteWorkspace={deleteWorkspace}
        onNewWorkspace={newWorkspace}
        onClearStorage={clearAllStorage}
        saved={savedEntries}
        onOpenSaved={openSaved}
        onRemoveSaved={removeSaved}
        onClearSaved={() => {
          setSaved([]);
          markDirty();
        }}
        highlights={highlights}
        onRemoveHighlight={removeHighlight}
        onClearHighlights={() => {
          setHighlights([]);
          markDirty();
        }}
        onNavigate={openFromHome}
        files={files}
        onOpenWorkspace={openWorkspaceFromHome}
        theme={theme}
        onSetTheme={setTheme}
        readingMode={readingMode}
        onSetReadingMode={setReadingMode}
        contentWidth={contentWidth}
        onSetContentWidth={setContentWidth}
        mathRenderer={mathRenderer}
        onSetMathRenderer={setMathRenderer}
        mathNumbering={mathNumbering}
        onSetMathNumbering={setMathNumbering}
        mathExplorer={mathExplorer}
        onSetMathExplorer={setMathExplorer}
        readingFont={readingFont}
        onSetReadingFont={setReadingFont}
        googleFont={googleFont}
        onSetGoogleFont={setGoogleFont}
        diagramColors={diagramColors}
        onSetDiagramColors={setDiagramColors}
        diagramCamera={diagramCamera}
        onSetDiagramCamera={setDiagramCamera}
        diagramFollowNumbers={diagramFollowNumbers}
        onSetDiagramFollowNumbers={setDiagramFollowNumbers}
        diagramNumbers={diagramNumbers}
        onSetDiagramNumbers={setDiagramNumbers}
        aiEnabled={aiEnabled}
        onSetAiEnabled={setAiEnabled}
        showEmbedMedia={showEmbedMedia}
        onSetShowEmbedMedia={setShowEmbedMedia}
        onRestoreFromBin={restoreFromBin}
        onDeleteForever={deleteForever}
        onEmptyBin={emptyBin}
        onImportWorkspace={importWorkspace}
        onExportWorkspace={exportWorkspace}
        onShareWorkspace={shareWorkspace}
        initialTab={pendingSettingsTab}
        onClose={closeSettings}
      />
    </LazyBoundary>
  ) : null;

  // ---- durability surface ----

  const retrySave = useCallback(async () => {
    setRetryingSave(true);
    try {
      await persistNow(false, true);
    } finally {
      setRetryingSave(false);
    }
  }, [persistNow]);

  const saveState: SaveState | null = !workspaceId
    ? null
    : saveError || conflict
      ? "error"
      : saveStatus === "saving"
        ? "saving"
        : saveStatus === "pending" || editorDirty
          ? "pending"
          : "saved";

  const journalContext = useMemo(
    () => ({ workspaceId, journal, schedule: scheduleJournalFlush }),
    [workspaceId, journal, scheduleJournalFlush],
  );

  // One bottom banner at a time, most urgent first: a conflict is waiting on a
  // decision, a failed save is losing ground, recovered drafts can wait.
  const statusBanner =
    conflictBanner ??
    (saveError ? (
      <SaveErrorBanner
        message={saveError}
        retrying={retryingSave}
        onRetry={() => void retrySave()}
        onExport={exportWorkspace}
      />
    ) : recovered.length > 0 ? (
      <DraftRecoveryBanner
        drafts={recovered.map((entry): RecoveredDraft => ({
          fileId: entry.fileId,
          fileName: entry.fileName,
          updatedAt: entry.updatedAt,
          asCopy: entry.asCopy,
        }))}
        onRestore={restoreRecovered}
        onDiscard={discardRecovered}
      />
    ) : null);

  if (booting) {
    return <div className="min-h-dvh bg-background">{statusBanner}</div>;
  }

  if (files.length === 0) {
    return (
      <EmptyWorkspace
        onHome={goHome}
        workspaces={workspaces}
        currentWorkspaceId={workspaceId}
        onSwitchWorkspace={switchWorkspace}
        onOpenSettings={openSettings}
        inputRef={inputRef}
        onFileInputChange={handleFileInput}
        onCreateFile={createFile}
        onCreateBoardFile={createBoardFile}
        dragOverlay={dragOverlay}
        shareDialog={shareDialog}
        settingsDialog={settingsDialog}
        moveDialog={moveDialog}
        statusBanner={statusBanner}
      />
    );
  }

  return (
    <NavHistoryContext.Provider value={navHistory}>
      <DraftJournalContext.Provider value={journalContext}>
        <div className="min-h-dvh bg-background">
          <Header
            hideOnDesktop
            onMenu={openDrawer}
            onOpenPalette={() => {
              openDrawer();
              setSearchOpen(true);
            }}
            hasFiles
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={toggleSidebar}
            onHome={goHome}
            workspaces={workspaces}
            currentWorkspaceId={workspaceId}
            onSwitchWorkspace={switchWorkspace}
            onOpenSettings={openSettings}
            saveIndicator={saveState ? <SaveIndicator state={saveState} compact /> : null}
          />

          <div className="flex">
            <div
              ref={sidebarWrapRef}
              className="sticky top-0 hidden h-dvh shrink-0 border-r border-border bg-background lg:block"
              style={{ width: sidebarCollapsed ? 56 : SIDEBAR_WIDTH }}
            >
              <div ref={sidebarInnerRef} className="h-full w-full">
                <Sidebar
                  showEmbedMedia={showEmbedMedia}
                  files={files}
                  activeFileId={activeFileId}
                  activeHeadingId={activeHeadingId}
                  expanded={expanded}
                  onToggleFile={toggleFile}
                  onSelect={handleSelect}
                  onAddFiles={() => inputRef.current?.click()}
                  onRemoveFile={moveToBin}
                  onDownloadFile={downloadFile}
                  onDownloadFiles={downloadFiles}
                  onMoveToWorkspace={workspaces.length > 1 ? setPendingMove : undefined}
                  onShareFile={shareFile}
                  onShareFiles={(ids) => void shareFiles(ids)}
                  onRenameFile={renameFile}
                  onEditFile={editFile}
                  onConvertFile={conversion.start}
                  convertingFileId={conversion.runningId}
                  folders={folders}
                  onCreateFile={createFile}
                  onCreateMermaid={createMermaidFile}
                  onCreateBoard={createBoardFile}
                  onCreateFolder={createFolder}
                  onRenameFolder={renameFolder}
                  onDeleteFolder={deleteFolder}
                  onMoveFileToFolder={moveFileToFolder}
                  onMoveFolderToFolder={moveFolderToFolder}
                  onReorderFile={reorderFile}
                  onSortByName={sortFilesByName}
                  view={sidebarView}
                  onView={setSidebarView}
                  saved={savedEntries}
                  onOpenSaved={openSaved}
                  onRemoveSaved={removeSaved}
                  theme={theme}
                  onCycleTheme={cycleTheme}
                  currentWorkspaceName={workspaceNameRef.current}
                  canDeleteWorkspace={workspaces.length > 1}
                  onRenameCurrentWorkspace={(name) =>
                    workspaceIdRef.current && void renameWorkspace(workspaceIdRef.current, name)
                  }
                  onDeleteCurrentWorkspace={() =>
                    workspaceIdRef.current && void deleteWorkspace(workspaceIdRef.current)
                  }
                  onClearStorage={clearAllStorage}
                  highlights={highlights}
                  onRemoveHighlight={removeHighlight}
                  onOpenSettings={openSettings}
                  onAddToSplit={openBeside}
                  splitFileIds={splitFileIds}
                  onAskAi={aiEnabled ? openAskAi : undefined}
                  onImportWorkspace={importWorkspace}
                  onExportWorkspace={exportWorkspace}
                  onShareWorkspace={shareWorkspace}
                  workspaces={workspaces}
                  currentWorkspaceId={workspaceId}
                  onSwitchWorkspace={switchWorkspace}
                  docked
                  saveIndicator={saveState ? <SaveIndicator state={saveState} /> : null}
                  onOpenSearch={() => setSearchOpen(true)}
                  onToggleSidebar={toggleSidebar}
                  search={searchPanelState}
                />
              </div>

              <div
                className="absolute inset-y-0 left-0 flex w-14 flex-col items-center gap-4 border-r border-border bg-background py-3 z-20 transition-opacity duration-200"
                style={{
                  opacity: sidebarCollapsed ? 1 : 0,
                  pointerEvents: sidebarCollapsed ? "auto" : "none",
                }}
              >
                <button
                  onClick={() => setSidebarCollapsed(false)}
                  className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Expand sidebar"
                  title="Expand sidebar"
                >
                  <Menu className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    setSidebarCollapsed(false);
                    setSearchOpen(true);
                  }}
                  className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Search docs"
                  title="Search docs"
                >
                  <Search className="h-4 w-4" />
                </button>
                {saveState && (
                  <span
                    // The rail stays mounted behind the expanded sidebar;
                    // only the visible copy of the status is read out.
                    aria-hidden={!sidebarCollapsed}
                    className="flex h-8 w-8 items-center justify-center"
                  >
                    <SaveIndicator state={saveState} compact />
                  </span>
                )}
                {/* The same three ways to add as the expanded sidebar offers —
                  the rail used to jump straight to the file picker, which was
                  the one option of the three you could not undo by closing a
                  menu. Opens rightwards, since there is nothing to its left. */}
                <AddMenu
                  align="left"
                  onCreateFile={() => createFile(null)}
                  onCreateMermaid={() => createMermaidFile(null)}
                  onCreateBoard={() => createBoardFile(null)}
                  onCreateFolder={promptNewFolderFromRail}
                  onUpload={() => inputRef.current?.click()}
                  buttonClassName="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                />
                <div className="flex-1" />
                <button
                  onClick={() => openSettings()}
                  className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Settings"
                  title="Settings"
                >
                  <Settings className="h-4 w-4" />
                </button>
                {/* The workspace monogram opens the same avatar-strip switcher
                  the expanded sidebar's footer shows inline. */}
                <WorkspaceMenu
                  variant="icon"
                  workspaces={workspaces}
                  currentId={workspaceId}
                  onSwitch={(id) => void switchWorkspace(id)}
                />
              </div>
            </div>

            <Sheet open={drawerOpen && mobileNavigation} onOpenChange={setDrawerOpen}>
              <SheetContent
                ref={drawerContentRef}
                side="left"
                aria-describedby={undefined}
                showCloseButton={false}
                className="flex w-80 max-w-[85vw] flex-col gap-0 p-0 pl-[env(safe-area-inset-left)] pb-[env(safe-area-inset-bottom)]"
                onCloseAutoFocus={(event) => {
                  // There are multiple openers (menu, search, keyboard shortcut),
                  // so a single SheetTrigger cannot restore the right one.
                  event.preventDefault();
                  const opener = drawerOpenerRef.current;
                  if (opener?.isConnected && opener.getClientRects().length) opener.focus();
                }}
                onEscapeKeyDown={(event) => {
                  // Sidebar menus and search own their Escape handlers. Let
                  // those close first without also dismissing their parent.
                  if (
                    searchOpen ||
                    drawerContentRef.current?.querySelector("[data-sidebar-menu-panel]")
                  ) {
                    event.preventDefault();
                  }
                }}
              >
                <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
                <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
                  <span className="text-sm font-semibold truncate px-1">
                    {workspaceNameRef.current || "Workspace"}
                  </span>
                  <SheetClose
                    aria-label="Close"
                    className="-mr-2 inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground coarse:h-11 coarse:w-11"
                  >
                    <X className="h-4 w-4" />
                  </SheetClose>
                </div>
                <div className="min-h-0 flex-1">
                  <Sidebar
                    showEmbedMedia={showEmbedMedia}
                    files={files}
                    activeFileId={activeFileId}
                    activeHeadingId={activeHeadingId}
                    expanded={expanded}
                    onToggleFile={toggleFile}
                    onSelect={handleSelect}
                    onAddFiles={() => inputRef.current?.click()}
                    onRemoveFile={moveToBin}
                    onDownloadFile={downloadFile}
                    onDownloadFiles={downloadFiles}
                    onMoveToWorkspace={workspaces.length > 1 ? setPendingMove : undefined}
                    onShareFile={shareFile}
                    onShareFiles={(ids) => void shareFiles(ids)}
                    onRenameFile={renameFile}
                    onEditFile={editFile}
                    onConvertFile={conversion.start}
                    convertingFileId={conversion.runningId}
                    folders={folders}
                    onCreateFile={createFile}
                    onCreateMermaid={createMermaidFile}
                    onCreateBoard={createBoardFile}
                    onCreateFolder={createFolder}
                    onRenameFolder={renameFolder}
                    onDeleteFolder={deleteFolder}
                    onMoveFileToFolder={moveFileToFolder}
                    onMoveFolderToFolder={moveFolderToFolder}
                    onReorderFile={reorderFile}
                    onSortByName={sortFilesByName}
                    view={sidebarView}
                    onView={setSidebarView}
                    saved={savedEntries}
                    onOpenSaved={openSaved}
                    onRemoveSaved={removeSaved}
                    theme={theme}
                    onCycleTheme={cycleTheme}
                    currentWorkspaceName={workspaceNameRef.current}
                    canDeleteWorkspace={workspaces.length > 1}
                    onRenameCurrentWorkspace={(name) =>
                      workspaceIdRef.current && void renameWorkspace(workspaceIdRef.current, name)
                    }
                    onDeleteCurrentWorkspace={() =>
                      workspaceIdRef.current && void deleteWorkspace(workspaceIdRef.current)
                    }
                    onClearStorage={clearAllStorage}
                    highlights={highlights}
                    onRemoveHighlight={removeHighlight}
                    onOpenSettings={(tab) => {
                      setDrawerOpen(false);
                      openSettings(tab);
                    }}
                    onAskAi={
                      aiEnabled
                        ? () => {
                            setDrawerOpen(false);
                            openAskAi();
                          }
                        : undefined
                    }
                    workspaces={workspaces}
                    currentWorkspaceId={workspaceId}
                    onSwitchWorkspace={(id) => {
                      setDrawerOpen(false);
                      switchWorkspace(id);
                    }}
                    onImportWorkspace={importWorkspace}
                    onExportWorkspace={exportWorkspace}
                    onShareWorkspace={shareWorkspace}
                    search={searchPanelState}
                  />
                </div>
              </SheetContent>
            </Sheet>

            {/* One boundary for the whole content column. The settings page and the
            binary-document viewers are code-split; the markdown viewer is not,
            so the common case never suspends here. */}
            <ConversionContext.Provider
              value={{
                files,
                runningId: conversion.runningId,
                onConvert: conversion.start,
                onCancel: conversion.cancel,
                onOpen: handleSelect,
              }}
            >
              <LazyBoundary
                loading={<main className="min-w-0 flex-1" aria-busy />}
                failed={<ChunkFailedNotice />}
                resetKey={`${activeFileId}:${showSaved}`}
              >
                {/* In split view the column is pinned to the viewport and each pane
                scrolls itself. Without a real height here the group resolves
                `h-full` against an auto-height parent, every pane grows to its
                content, and the *window* ends up doing the scrolling — which is
                why the panes used to move together. */}
                <main
                  className={
                    paneLayout.panes.length > 1 && !showSaved
                      ? "flex min-h-0 w-0 min-w-0 flex-1 flex-col overflow-hidden h-[calc(100dvh-var(--header-h,3.5rem))]"
                      : "min-w-0 flex-1 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:pb-0"
                  }
                >
                  {!showSaved &&
                    paneLayout.panes.length === 1 &&
                    activeFile &&
                    conversionActions(activeFile)}
                  {/* Saved is a page, not an overlay: it takes the content column
                  instead of stacking on top of whatever document was open. */}
                  {showSaved ? (
                    savedPage
                  ) : paneLayout.panes.length > 1 ? (
                    /* Split view. Each pane carries its own tab strip and its own
                   document; the focused pane is what the rest of the app means
                   by "the active file", so nothing outside here has to know
                   panes exist.

                   Side by side needs width to be worth anything: two panes of a
                   320px phone are 160px each, narrower than the documents' own
                   minimum and unreadable. Splitting is only offered from the
                   docked sidebar, so a phone never opens one — but a desktop
                   window narrowed with a split already open used to land
                   exactly there. Below the width where two columns still read,
                   the panes stack instead. */
                    <ResizablePanelGroup
                      orientation={splitStacks ? "vertical" : "horizontal"}
                      className="h-full"
                    >
                      {paneLayout.panes.map((pane, index) => {
                        const paneFile = files.find((f) => f.id === pane.activeTabId) ?? null;
                        const paneKind = paneFile
                          ? (paneFile.kind ?? getDocumentKind(paneFile.name, paneFile.mimeType))
                          : null;
                        const paneIsBoard = paneKind === "board";
                        return (
                          <Fragment key={pane.id}>
                            {index > 0 && <ResizableHandle withHandle />}
                            <ResizablePanel
                              defaultSize={`${Math.floor(100 / paneLayout.panes.length)}%`}
                              minSize="20%"
                            >
                              <div
                                onMouseDown={() => focusPane(pane.id)}
                                className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
                              >
                                {/* No tab strip. The open documents live in the
                                sidebar; a pane is just a column of reading, and
                                the only chrome it carries is a thin header
                                saying which document it holds and how to close
                                it. */}
                                <div
                                  className={`flex h-9 shrink-0 items-center gap-2 border-b px-3 ${
                                    pane.id === paneLayout.focusedPaneId
                                      ? "border-border bg-background"
                                      : "border-border/60 bg-muted/20"
                                  }`}
                                >
                                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                                    {paneFile ? paneFile.name.replace(/\.[^.]+$/, "") : "Empty"}
                                  </span>
                                  <button
                                    onClick={() => closePane(pane.id)}
                                    aria-label="Close this pane"
                                    title="Close this pane"
                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                                <div
                                  className={
                                    paneIsBoard
                                      ? "min-h-0 min-w-0 flex-1 overflow-hidden"
                                      : "min-h-0 min-w-0 flex-1 overflow-y-auto px-4"
                                  }
                                >
                                  {paneFile && conversionActions(paneFile)}
                                  {paneFile ? (
                                    <PaneDocument
                                      file={paneFile}
                                      files={files}
                                      saved={saved}
                                      highlights={highlights}
                                      workspaceFolders={folders}
                                      onImportAttachments={importAttachments}
                                      workspaceId={workspaceId}
                                      workspaceRevision={workspaceRevision}
                                      workspaceName={workspaceNameRef.current}
                                      onContentChange={handleContentChange}
                                      onDocumentSave={handleDocumentSave}
                                      onEditorDirtyChange={(dirty) => {
                                        if (dirty) officeDirtyPanes.current.add(pane.id);
                                        else officeDirtyPanes.current.delete(pane.id);
                                        syncEditorDirty();
                                      }}
                                      onRenameFile={renameFile}
                                      onAddHighlight={addHighlight}
                                      onUpdateHighlight={updateHighlight}
                                      onRemoveHighlight={removeHighlight}
                                      onRepairHighlights={repairHighlights}
                                      onToggleSaved={toggleSaved}
                                      onRemoveSaved={removeSaved}
                                      onOpenArtifact={openEmbeddedArtifact}
                                      readingMode={readingMode}
                                      contentWidth={contentWidth}
                                      // An edit request belongs to the column the
                                      // reader is working in, not to every column
                                      // showing that document. `revealInPane` has
                                      // already moved focus to the pane holding the
                                      // file, so this is that pane — and the same
                                      // document deliberately opened side by side
                                      // with itself no longer drops both copies
                                      // into the editor at once.
                                      startInEditFileId={
                                        pane.id === paneLayout.focusedPaneId ? autoEditFileId : null
                                      }
                                      mathPreferences={mathPreferences}
                                      onStartInEditConsumed={consumeStartInEdit}
                                      // Only the pane showing the document a jump
                                      // names is told about it.
                                      activeSubtopicId={
                                        paneFile.id === activeFileId ? activeHeadingId : null
                                      }
                                      highlightQuery={
                                        paneFile.id === activeFileId ? highlightQuery : null
                                      }
                                      pendingSearch={
                                        pendingSearch?.fileId === paneFile.id ? pendingSearch : null
                                      }
                                      onSearchShown={clearPendingSearch}
                                    />
                                  ) : (
                                    <p className="px-2 py-16 text-center text-sm text-muted-foreground">
                                      Nothing open in this pane. Drag a tab here, or pick a document
                                      from the sidebar.
                                    </p>
                                  )}
                                </div>
                              </div>
                            </ResizablePanel>
                          </Fragment>
                        );
                      })}
                    </ResizablePanelGroup>
                  ) : activeFile &&
                    (activeFile.kind === "markdown" ||
                      activeFile.kind === "text" ||
                      !activeFile.kind) ? (
                    <MarkdownViewer
                      file={activeFile}
                      prevFile={prevFile}
                      nextFile={nextFile}
                      onNav={navFromViewer}
                      activeSubtopicId={activeHeadingId}
                      highlightQuery={highlightQuery}
                      onContentChange={handleContentChange}
                      onEditorDirtyChange={(dirty) => {
                        editorDirtyRef.current = dirty;
                        syncEditorDirty();
                      }}
                      startInEditFileId={autoEditFileId}
                      onStartInEditConsumed={consumeStartInEdit}
                      nextReadingMin={nextReadingMinutes}
                      isBookmarked={!!activePageSaved}
                      onToggleBookmark={toggleActivePageSaved}
                      highlights={activeFileHighlights}
                      onAddHighlight={addHighlightToActive}
                      onUpdateHighlight={updateHighlight}
                      onRemoveHighlight={removeHighlight}
                      onRepairHighlights={repairHighlights}
                      saved={activeFileSaved}
                      onToggleSaved={toggleSavedOnActive}
                      onRemoveSaved={removeSaved}
                      pendingSaved={pendingSaved?.fileId === activeFile.id ? pendingSaved : null}
                      onSavedShown={clearPendingSaved}
                      pendingSearch={pendingSearch?.fileId === activeFile.id ? pendingSearch : null}
                      onSearchShown={clearPendingSearch}
                      onHome={goHome}
                      onRenameFile={renameActiveFile}
                      onShareFile={shareActiveFile}
                      onAskAi={aiEnabled ? askAiFromSelection : undefined}
                      readingMode={readingMode}
                      contentWidth={contentWidth}
                      mathPreferences={mathPreferences}
                      workspaceId={workspaceId}
                      workspaceRevision={workspaceRevision}
                      workspaceFiles={files}
                      workspaceFolders={folders}
                      onImportAttachments={importAttachments}
                      workspaceName={workspaceNameRef.current}
                      onOpenArtifact={openEmbeddedArtifact}
                    />
                  ) : activeFile ? (
                    <DocumentViewer
                      key={activeFile.id}
                      onDocumentSave={handleDocumentSave}
                      onEditorDirtyChange={(dirty) => {
                        editorDirtyRef.current = dirty;
                        if (dirty) officeDirtyPanes.current.add("main");
                        else officeDirtyPanes.current.delete("main");
                        syncEditorDirty();
                      }}
                      file={activeFile}
                      isBookmarked={!!findSaved(saved, { fileId: activeFile.id, kind: "file" })}
                      onToggleBookmark={toggleActiveDocumentSaved}
                      prevFile={prevFile}
                      nextFile={nextFile}
                      onNavFile={navToFile}
                      onContentChange={handleContentChange}
                      startInEditFileId={autoEditFileId}
                      onStartInEditConsumed={consumeStartInEdit}
                    />
                  ) : null}
                </main>
              </LazyBoundary>
            </ConversionContext.Provider>
          </div>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept={SUPPORTED_ACCEPT}
            className="hidden"
            onChange={(e) => {
              handleFileInput(e.target.files);
              e.target.value = "";
            }}
          />

          {/* Mounted only once opened. The panel is a large component whose props
          are derived from every document in the workspace; keeping it out of
          the tree until it is asked for saves that work on every render. */}
          {aiOpen && aiEnabled && (
            <LazyBoundary>
              <AskAiPanel
                open
                onClose={closeAskAi}
                prefill={aiPrefill}
                initialSelection={null}
                activeFile={aiActiveFile}
                activeSection={aiActiveSection}
                files={aiFiles}
                onInsert={insertAiOutput}
                onCreateDoc={createAiDoc}
              />
            </LazyBoundary>
          )}

          {settingsDialog}
          {moveDialog}

          {dragOverlay}
          {shareDialog}
          {statusBanner}
        </div>
      </DraftJournalContext.Provider>
    </NavHistoryContext.Provider>
  );
}
