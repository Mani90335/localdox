import { embedMediaFolderIds } from "@/lib/workspace/embed-media";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { isEditableTarget, hasModKey } from "@/lib/platform/keyboard";
import {
  ChevronDown,
  ChevronRight,
  Settings,
  GripVertical,
  Check,
  PanelLeft,
  Search,
  ArrowLeft,
  ArrowRight,
  Folder,
  FolderOpen,
  CheckSquare,
  X,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { modKeyLabel } from "@/lib/platform/keyboard";
import type { Highlight } from "@/lib/markdown/dom-highlighter";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { readingMinutes } from "@/lib/markdown/markdown-utils";
import { fileLabel, getDocumentKind, isEditableKind } from "@/lib/markdown/document-utils";
import { availableFormats, type ExportFormat } from "@/services/markdown-export";
import { WorkspaceStrip, initials } from "./WorkspaceStrip";
import { useNavHistory } from "@/hooks/use-nav-history";
import { canConvertToMarkdown, latestMarkdownCopies } from "@/services/doc-conversion";
import { kindIcon, kindMeta } from "./sidebar/file-glyphs";
import { isOutsideMenu, MenuItem, MenuPanel } from "./sidebar/menu-primitives";
import { GroupActionMenu } from "./sidebar/GroupActionMenu";
import { FileMenu } from "./sidebar/FileMenu";
import { AddMenu } from "./sidebar/AddMenu";
import { isRulesFile } from "@/services/exams/rules-tag";
import { FolderMenu } from "./sidebar/FolderMenu";
import type { SidebarFolder } from "./sidebar/types";
import { SearchPanel, type SearchPanelState } from "./sidebar/SearchPanel";

export type { SidebarFolder };
export { AddMenu };

/**
 * How the file list is presented in the sidebar.
 * - `mode` is driven by the chip row: All (flat) or Grouped (by file type).
 * - `sort`/`dir` are set from the three-dots menu. `manual` keeps the real
 *   file order so drag reordering stays meaningful.
 */
export type SidebarView = {
  sort: "manual" | "name" | "date";
  dir: "asc" | "desc";
  mode: "all" | "grouped";
};
export const DEFAULT_VIEW: SidebarView = {
  sort: "manual",
  dir: "asc",
  mode: "all",
};

/**
 * The list's views, in the order the picker offers them.
 *
 * The Bin is not among them. It is not a way of looking at the workspace —
 * it holds documents that have left it — and it lives in Settings ▸ Storage,
 * beside the quota it is actually competing for.
 */
/** Context-menu rows styled like the sidebar's own menus (`MenuItem`). */
const CONTEXT_ITEM = "gap-3 rounded-lg px-2.5 py-2 text-sm";

/**
 * The sidebar's icon buttons: one size and one quiet treatment for every
 * control in its chrome, so they read as a single toolbar. The collapsed rail
 * in `DocsApp` uses the same class, so a control looks the same in either
 * state.
 */
export const CHROME_BUTTON =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35 coarse:h-11 coarse:w-11";

const VIEW_MODES: readonly SidebarView["mode"][] = ["all", "grouped"];
const VIEW_LABEL: Record<SidebarView["mode"], string> = {
  all: "All files",
  grouped: "Grouped",
};

/**
 * Drag payload for filing a document into a folder. Distinct from the reorder
 * drag (which carries no data) so a folder only accepts real file drags, and a
 * file dragged in from the desktop still reaches the uploader.
 */
const FILE_DND = "application/x-localdox-file";
/**
 * Drag payload for re-parenting a folder. Its own type, so a folder row accepts
 * a dragged folder and a dragged document as two different drops — and so the
 * reorder drag, which carries no data at all, still matches neither.
 */
const FOLDER_DND = "application/x-localdox-folder";
/**
 * Drag payload for moving a folder to another place in the list (reorder
 * mode). Its own type so the folder drop targets, which re-parent on
 * `FOLDER_DND`, ignore it — and so the drag carries data at all, which Firefox
 * requires before it will start one.
 */
const FOLDER_REORDER_DND = "application/x-localdox-folder-order";

interface Props {
  showEmbedMedia?: boolean;
  files: MdFile[];
  activeFileId: string | null;
  activeHeadingId: string | null;
  expanded: Record<string, boolean>;
  onToggleFile: (fileId: string) => void;
  onSelect: (fileId: string, headingId?: string) => void;
  onAddFiles: () => void;
  onRemoveFile: (id: string) => void;
  /**
   * Bin a multi-selection in one go: the documents, plus any selected folders
   * together with everything inside them. One call rather than a loop over
   * `onRemoveFile`, so the parent can ask a single question when any of it is
   * open on screen.
   */
  onRemoveSelection?: (selection: { fileIds: string[]; folderIds: string[] }) => void;
  onRenameFile: (id: string, newName: string) => void;
  /** Open a document in the editor. Only offered for editable text documents. */
  onEditFile?: (id: string) => void;
  onConvertFile?: (id: string) => void;
  convertingFileId?: string | null;
  /**
   * Folders the workspace has, flat. Files point at one through `folderId`;
   * anything unfiled stays at the top level under the folder rows.
   */
  folders?: SidebarFolder[];
  /** Create a blank `new.md`, optionally straight inside a folder. */
  onCreateFile?: (folderId?: string | null) => void;
  /** Create an animated standalone Mermaid source file. */
  onCreateMermaid?: (folderId?: string | null) => void;
  onCreateBoard?: (folderId?: string | null) => void;
  /** Open the New exam dialog: an `.xam` paper tagged with a ruleset. */
  onCreateExam?: () => void;
  /** A new `.xp` practice file, named first like any new file. */
  onCreatePractice?: (folderId?: string | null) => void;
  /** Create a folder, optionally nested inside an existing one. */
  onCreateFolder?: (name: string, parentId?: string | null) => void;
  /** Re-parent a folder. `null` puts it back at the top level. */
  onMoveFolderToFolder?: (folderId: string, parentId: string | null) => void;
  onRenameFolder?: (id: string, name: string) => void;
  /** Deleting a folder keeps its documents — they return to the top level. */
  onDeleteFolder?: (id: string) => void;
  onMoveFileToFolder?: (fileId: string, folderId: string | null) => void;
  currentWorkspaceName: string;
  canDeleteWorkspace: boolean;
  onRenameCurrentWorkspace: (name: string) => void;
  onDeleteCurrentWorkspace: () => void;
  onClearStorage: () => void;
  highlights: Highlight[];
  onRemoveHighlight: (id: string) => void;
  /** Open the isolated "highlights only" view for a file (text-based only). */
  onReorderFile?: (oldIndex: number, newIndex: number) => void;
  /** Move a folder to `targetId`'s place in the list, beside it under the same parent. */
  onReorderFolder?: (folderId: string, targetId: string) => void;
  onSortByName?: () => void;
  view?: SidebarView;
  onView?: (view: SidebarView) => void;
  /** Opens settings. An optional tab id lands the dialog on that section. */
  onOpenSettings: (tab?: "workspace") => void;
  /** Ids already showing in a side-by-side column. */
  splitFileIds?: string[];
  /** Put this document in a column of its own, beside what is being read. */
  onAddToSplit?: (fileId: string) => void;
  /** Open the Ask AI panel. When omitted, the Ask AI button is hidden. */
  onAskAi?: () => void;
  onImportWorkspace?: (file: File) => void;
  onExportWorkspace?: () => void;
  onShareWorkspace?: () => void;
  theme?: string;
  onCycleTheme?: () => void;
  workspaces?: { id: string; name: string }[];
  currentWorkspaceId?: string | null;
  onSwitchWorkspace?: (id: string) => void;
  onDownloadFile?: (id: string, format: ExportFormat) => void;
  onDownloadFiles?: (ids: string[], format: ExportFormat) => void;
  onMoveToWorkspace?: (selection: { fileIds: string[]; folderIds: string[] }) => void;
  /** Copy a link to one file. The recipient chooses where it lands. */
  onShareFile?: (id: string) => void;
  /** Copy a link to the multi-select batch. */
  onShareFiles?: (ids: string[]) => void;
  /**
   * Docked = the desktop/landscape full-height rail with no app header. It grows
   * a workspace picker, a search field, and a continue-reading card at the top.
   * Undocked (mobile drawer) keeps the compact Ask AI hero layout.
   */
  docked?: boolean;
  /** The workspace's save state, shown beside the history controls when docked. */
  saveIndicator?: React.ReactNode;
  onOpenSearch?: () => void;
  onToggleSidebar?: () => void;
  /** Non-null swaps the file tree for the VS Code-style search panel. */
  search?: SearchPanelState | null;
}

function SidebarImpl({
  showEmbedMedia = true,
  files,
  activeFileId,
  activeHeadingId,
  expanded,
  onToggleFile,
  onSelect,
  onAddFiles,
  onRemoveFile,
  onRemoveSelection,
  onRenameFile,
  onEditFile,
  onConvertFile,
  convertingFileId,
  folders: allFolders = [],
  onCreateFile,
  onCreateMermaid,
  onCreateBoard,
  onCreateExam,
  onCreatePractice,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFileToFolder,
  onMoveFolderToFolder,
  currentWorkspaceName,
  canDeleteWorkspace,
  onRenameCurrentWorkspace,
  onDeleteCurrentWorkspace,
  onClearStorage,
  highlights,
  onRemoveHighlight,
  onReorderFile,
  onReorderFolder,
  onSortByName,
  view = DEFAULT_VIEW,
  onView,
  onOpenSettings,
  splitFileIds = [],
  onAddToSplit,
  onAskAi,
  onImportWorkspace,
  onExportWorkspace,
  onShareWorkspace,
  workspaces = [],
  currentWorkspaceId,
  onSwitchWorkspace,
  onDownloadFile,
  onDownloadFiles,
  onMoveToWorkspace,
  onShareFile,
  onShareFiles,
  docked = false,
  saveIndicator,
  onOpenSearch,
  onToggleSidebar,
  search = null,
}: Props) {
  const hiddenFolders = useMemo(
    () => (showEmbedMedia ? new Set<string>() : embedMediaFolderIds(allFolders)),
    [showEmbedMedia, allFolders],
  );
  const folders = useMemo(
    () => allFolders.filter((folder) => !hiddenFolders.has(folder.id)),
    [allFolders, hiddenFolders],
  );
  // Rulesets (`.xrule`) are kept and edited in Settings ▸ Exam rules; a paper
  // names the one it uses, so they would only be clutter among documents.
  const hiddenFiles = useMemo(
    () =>
      new Set(
        files
          .filter(
            (file) => (file.folderId && hiddenFolders.has(file.folderId)) || isRulesFile(file),
          )
          .map((file) => file.id),
      ),
    [files, hiddenFolders],
  );

  const currentWorkspace = useMemo(
    () => workspaces.find((w) => w.id === currentWorkspaceId) ?? null,
    [workspaces, currentWorkspaceId],
  );
  const otherWorkspaces = useMemo(
    () => workspaces.filter((w) => w.id !== currentWorkspaceId),
    [workspaces, currentWorkspaceId],
  );

  // Back/forward over the workspace's own navigation trail, rendered next to
  // the sidebar toggle.
  const navHistory = useNavHistory();

  // Progressive disclosure: chapters stay collapsed unless the reader opens
  // them; the current chapter is expanded automatically. This keeps the
  // reader from facing hundreds of headings at once.
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeHeadingId]);

  // Reorder mode: toggled from any file's three-dots menu. While on, rows in the
  // flat list become draggable and dropping calls onReorderFile. dragIndex is the
  // row being dragged; overIndex is the row currently hovered as a drop target.
  const markdownCopies = useMemo(() => latestMarkdownCopies(files), [files]);
  const [reordering, setReordering] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  // The folder equivalents: the folder being dragged, and the folder row under
  // the pointer (which is also where a dragged *document* lands, filed inside).
  const [dragFolderId, setDragFolderId] = useState<string | null>(null);
  const [overFolderId, setOverFolderId] = useState<string | null>(null);

  // Multi-select mode. Documents and folders are selected side by side; a
  // selected folder stands for itself *and* everything inside it.
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelectedIds((selected) => {
      const visible = new Set([...selected].filter((id) => !hiddenFiles.has(id)));
      return visible.size === selected.size ? selected : visible;
    });
  }, [hiddenFiles]);

  const toggleIn = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  const toggleSelection = (id: string) => setSelectedIds((prev) => toggleIn(prev, id));
  const toggleFolderSelection = (id: string) => setSelectedFolderIds((prev) => toggleIn(prev, id));
  const clearSelection = () => {
    setSelecting(false);
    setSelectedIds(new Set());
    setSelectedFolderIds(new Set());
  };
  /** Enter multi-select, optionally with the row it was started from ticked. */
  const startSelecting = (seed?: { fileId?: string; folderId?: string }) => {
    setSelecting(true);
    setSelectedIds(new Set(seed?.fileId ? [seed.fileId] : []));
    setSelectedFolderIds(new Set(seed?.folderId ? [seed.folderId] : []));
  };

  // Folders start open — a folder the reader just made should show what lands
  // in it — and only the ones they collapse are remembered (for this session).
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  // Folder currently hovered by a file drag, so the drop target is obvious.
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);

  const toggleFolder = (id: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const promptNewFolder = (parentId?: string | null) => {
    const name = window.prompt("Folder name:", "New folder");
    if (name && name.trim()) onCreateFolder?.(name.trim(), parentId ?? null);
  };

  // Folder currently being dragged, so a row is never offered as a drop target
  // for itself and the root zone doesn't light up under its own drag.
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  // Document currently being dragged into (or out of) a folder. The top-level
  // drop zone highlights only while one is in flight.
  const [draggingFileId, setDraggingFileId] = useState<string | null>(null);

  // "Create" opens a small File/Folder menu; "view" picks what the list below
  // shows. Both are click-away dropdowns anchored to their own button.
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const createRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!creatingOpen && !viewMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (isOutsideMenu(t, createRef.current)) setCreatingOpen(false);
      if (isOutsideMenu(t, viewMenuRef.current)) setViewMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setCreatingOpen(false);
      setViewMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [creatingOpen, viewMenuOpen]);

  const total = files.length - hiddenFiles.size;

  // Binned documents are out of the list entirely — they wait in Settings ▸
  // Storage ▸ Bin until they are restored or purged.
  const activeFiles = files.filter((f) => !f.isArchived && !f.deletedAt && !hiddenFiles.has(f.id));

  // Multi-select shortcuts. Read through a ref so the listener isn't torn down
  // and rebuilt on every render just because `activeFiles` is a fresh array.
  const selectAll = () => {
    setSelectedIds(new Set(activeFiles.map((f) => f.id)));
    // Folders only exist as rows in the flat "All" list; selecting ones the
    // reader cannot see would bin them without their knowing.
    setSelectedFolderIds(new Set(view.mode === "all" ? folders.map((f) => f.id) : []));
  };
  const selectAllRef = useRef(selectAll);
  selectAllRef.current = selectAll;

  useEffect(() => {
    // Only while multi-select is on: outside it, Cmd/Ctrl+A must keep meaning
    // "select all text on the page".
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (hasModKey(e) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAllRef.current();
        return;
      }
      if (e.key === "Escape") {
        setSelecting(false);
        setSelectedIds(new Set());
        setSelectedFolderIds(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);

  // Apply the sidebar view (sort → group). Manual reorder is only meaningful
  // against the real file order in a flat list, so it is disabled once a sort
  // is chosen or the list is grouped.
  const kindOf = (f: MdFile) => f.kind ?? getDocumentKind(f.name, f.mimeType);
  const viewActive = view.sort !== "manual" || view.mode !== "all";

  // Drag reorder is only meaningful against the real file order in a flat list,
  // so enabling it forces the view back to manual/All. Disabled entirely when
  // there is nothing to reorder or the parent gave us no reorder handler.
  const canReorder = (!!onReorderFile && total > 1) || (!!onReorderFolder && folders.length > 1);
  const toggleReorder = () => {
    setReordering((on) => {
      const next = !on;
      if (next && viewActive) onView?.(DEFAULT_VIEW);
      if (!next) endDrag();
      return next;
    });
  };

  // If the view leaves the flat manual list while reordering, leave reorder mode
  // so we never drag against a sorted/grouped list that ignores the drop index.
  useEffect(() => {
    if (reordering && viewActive) {
      setReordering(false);
      endDrag();
    }
  }, [reordering, viewActive]);

  function endDrag() {
    setDragIndex(null);
    setOverIndex(null);
    setDragFolderId(null);
    setOverFolderId(null);
  }
  const dropOn = (targetIndex: number) => {
    if (dragIndex !== null && dragIndex !== targetIndex) {
      // Dropped beside a document in another folder: it joins that folder as
      // well as taking that place, which is what the reader just saw happen.
      const moved = files[dragIndex];
      const target = files[targetIndex];
      const targetFolder = target?.folderId ?? null;
      if (moved && target && (moved.folderId ?? null) !== targetFolder) {
        onMoveFileToFolder?.(moved.id, targetFolder);
      }
      onReorderFile?.(dragIndex, targetIndex);
    }
    endDrag();
  };
  const sorted =
    view.sort === "manual"
      ? activeFiles
      : [...activeFiles].sort((a, b) => {
          const base =
            view.sort === "name"
              ? a.name.localeCompare(b.name)
              : (a.addedAt ?? 0) - (b.addedAt ?? 0);
          return base * (view.dir === "desc" ? -1 : 1);
        });
  // Folders only shape the flat "All" list; Grouped stays grouped by file type.
  const knownFolderIds = new Set(folders.map((f) => f.id));
  const showFolders = view.mode === "all" && folders.length > 0;
  const rootFiles = sorted.filter((f) => !f.folderId || !knownFolderIds.has(f.folderId));
  const listed = showFolders ? rootFiles : sorted;

  /**
   * Drop handlers for `folderId` (null = top level).
   *
   * Accepts both drags: a document being filed, and a folder being re-parented.
   * `stopPropagation` on the drop matters now that folders nest — without it a
   * drop on a child folder would bubble to every ancestor's handler and the
   * outermost one would win.
   */
  const dropTargetProps = (folderId: string | null) => {
    if (!onMoveFileToFolder && !onMoveFolderToFolder) return {};
    const accepts = (e: React.DragEvent) =>
      (!!onMoveFileToFolder && e.dataTransfer.types.includes(FILE_DND)) ||
      (!!onMoveFolderToFolder && e.dataTransfer.types.includes(FOLDER_DND));
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move" as const;
        setDropFolderId(folderId);
      },
      onDragLeave: () => setDropFolderId((current) => (current === folderId ? null : current)),
      onDrop: (e: React.DragEvent) => {
        if (!accepts(e)) return;
        const fileId = e.dataTransfer.getData(FILE_DND);
        const draggedFolder = e.dataTransfer.getData(FOLDER_DND);
        setDropFolderId(null);
        if (!fileId && !draggedFolder) return;
        e.preventDefault();
        e.stopPropagation();
        if (fileId) onMoveFileToFolder?.(fileId, folderId);
        // A folder dropped on itself is a no-op rather than a cycle; the parent
        // guards the deeper case (dropping onto one's own descendant).
        else if (draggedFolder && draggedFolder !== folderId) {
          onMoveFolderToFolder?.(draggedFolder, folderId);
        }
        setDraggingFileId(null);
        setDraggingFolderId(null);
      },
    };
  };

  /**
   * The folder tree, derived from the flat list.
   *
   * A folder whose parent is missing — deleted, or never written by an older
   * build — is treated as a root rather than dropped, so nothing it holds can
   * become unreachable.
   */
  const childrenOf = (parentId: string | null) =>
    folders.filter((f) => {
      const parent = f.parentId ?? null;
      if (parent === parentId) return true;
      return parentId === null && parent !== null && !knownFolderIds.has(parent);
    });
  const rootFolders = childrenOf(null);

  /** The selected folders and every folder nested under them. */
  const selectedFolderTree = () => {
    const tree = new Set<string>();
    const visit = (id: string, depth: number) => {
      if (tree.has(id) || depth > 12) return;
      tree.add(id);
      for (const child of childrenOf(id)) visit(child.id, depth + 1);
    };
    for (const id of selectedFolderIds) visit(id, 0);
    return tree;
  };
  /**
   * The documents a group action applies to: the ones ticked, plus everything
   * inside a ticked folder. Sharing or downloading a folder means its contents.
   */
  const selectedFileIds = () => {
    const tree = selectedFolderTree();
    const ids = new Set(selectedIds);
    for (const file of activeFiles) if (file.folderId && tree.has(file.folderId)) ids.add(file.id);
    return [...ids];
  };
  const selectionTotal = activeFiles.length + (view.mode === "all" ? folders.length : 0);

  /** The menu every selected row carries. One instance of the rules, whichever row opens it. */
  const groupMenu = () => (
    <GroupActionMenu
      onShare={
        onShareFiles
          ? () => {
              const ids = selectedFileIds();
              if (ids.length) onShareFiles(ids);
              clearSelection();
            }
          : undefined
      }
      onMoveToBin={() => {
        const fileIds = selectedFileIds();
        const folderIds = [...selectedFolderTree()];
        if (onRemoveSelection) onRemoveSelection({ fileIds, folderIds });
        else fileIds.forEach((id) => onRemoveFile(id));
        clearSelection();
      }}
      onMoveToWorkspace={
        onMoveToWorkspace
          ? () => {
              onMoveToWorkspace({ fileIds: [...selectedIds], folderIds: [...selectedFolderIds] });
              clearSelection();
            }
          : undefined
      }
      onDownload={
        onDownloadFile
          ? () => {
              const ids = selectedFileIds();
              // A multi-file download stays the original bytes. The converted
              // formats are per-document by nature — a batch of PDFs would mean
              // one print dialog per file, each waiting on the last, and the
              // reader picking a format once for documents that may not all
              // support it.
              if (onDownloadFiles) onDownloadFiles(ids, "original");
              else ids.forEach((id) => onDownloadFile(id, "original"));
              clearSelection();
            }
          : undefined
      }
      onCancel={clearSelection}
      onSelectAll={selectAll}
      allSelected={selectedIds.size + selectedFolderIds.size >= selectionTotal}
    />
  );

  /** Which row a right-click landed on, so "Select" can start from it. */
  const contextRowRef = useRef<{ fileId?: string; folderId?: string } | null>(null);

  /**
   * One folder and everything under it.
   *
   * Recursive rather than a flattened list with an indent level: the nesting is
   * what makes a drop land in the right folder, and each level owns its own
   * drop target and collapse state. `depth` only guards against a cycle that
   * survived the parent's checks — a corrupt import, say — so the sidebar
   * cannot be made to recurse forever.
   */
  const renderFolder = (folder: SidebarFolder, depth: number): React.ReactNode => {
    if (depth > 12) return null;
    const items = sorted.filter((f) => f.folderId === folder.id);
    const subfolders = childrenOf(folder.id);
    const collapsed = collapsedFolders.has(folder.id);
    const isDropTarget = dropFolderId === folder.id && draggingFolderId !== folder.id;
    const count = items.length + subfolders.length;
    // Reorder mode turns the folder's drag from "file it inside another
    // folder" into "move it in the list", and makes its header a landing spot
    // for a document being reordered.
    const reorderActive = reordering && !viewActive && !selecting && !!onReorderFolder;
    const parentDragActive = !!onMoveFolderToFolder && !selecting && !reordering;
    const isReorderTarget =
      reordering &&
      overFolderId === folder.id &&
      (dragIndex !== null || (dragFolderId !== null && dragFolderId !== folder.id));
    const folderSelected = selectedFolderIds.has(folder.id);
    return (
      <div
        key={folder.id}
        className={`mb-px rounded-lg ${isDropTarget ? "ring-2 ring-primary/60" : ""} ${
          draggingFolderId === folder.id ? "opacity-40" : ""
        }`}
        {...dropTargetProps(folder.id)}
      >
        <div
          data-sidebar-folder={folder.id}
          className={`group flex items-center gap-1 rounded-lg px-1 transition-colors duration-150 hover:bg-sidebar-accent/50 ${
            reorderActive ? "cursor-grab active:cursor-grabbing" : ""
          } ${dragFolderId === folder.id ? "opacity-40" : ""} ${
            isReorderTarget ? "ring-2 ring-primary/60" : ""
          } ${folderSelected ? "bg-sidebar-accent/60" : ""}`}
          draggable={reorderActive || parentDragActive}
          onDragStart={
            reorderActive
              ? (e) => {
                  e.stopPropagation();
                  e.dataTransfer.setData(FOLDER_REORDER_DND, folder.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDragFolderId(folder.id);
                }
              : parentDragActive
                ? (e) => {
                    e.stopPropagation();
                    e.dataTransfer.setData(FOLDER_DND, folder.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDraggingFolderId(folder.id);
                  }
                : undefined
          }
          onDragOver={
            reordering
              ? (e) => {
                  const folderMove = dragFolderId !== null && dragFolderId !== folder.id;
                  const fileMove = dragIndex !== null && !!onMoveFileToFolder;
                  if (!folderMove && !fileMove) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  setOverFolderId(folder.id);
                }
              : undefined
          }
          onDragLeave={
            reordering
              ? () => setOverFolderId((current) => (current === folder.id ? null : current))
              : undefined
          }
          onDrop={
            reordering
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (dragFolderId && dragFolderId !== folder.id) {
                    onReorderFolder?.(dragFolderId, folder.id);
                  } else if (dragIndex !== null && files[dragIndex]) {
                    onMoveFileToFolder?.(files[dragIndex].id, folder.id);
                  }
                  endDrag();
                }
              : undefined
          }
          onDragEnd={
            reorderActive
              ? endDrag
              : parentDragActive
                ? () => {
                    setDraggingFolderId(null);
                    setDropFolderId(null);
                  }
                : undefined
          }
        >
          {reorderActive && (
            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
          )}
          {selecting && (
            <div className="flex h-6 w-6 shrink-0 items-center justify-center pl-1">
              <input
                type="checkbox"
                checked={folderSelected}
                onChange={() => toggleFolderSelection(folder.id)}
                aria-label={`Select folder ${folder.name}`}
                className="h-4 w-4 cursor-pointer rounded border-border text-primary focus:ring-primary"
              />
            </div>
          )}
          <button
            onClick={() => toggleFolder(folder.id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1.5 pl-1 pr-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11"
            aria-expanded={!collapsed}
            title={`${folder.name} · ${count} item${count === 1 ? "" : "s"}`}
          >
            <ChevronRight
              className={`h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${
                collapsed ? "" : "rotate-90"
              }`}
              aria-hidden
            />
            {collapsed ? (
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="ml-1 min-w-0 flex-1 truncate text-sm text-foreground/75">
              {folder.name}
            </span>
            {/* Open, the folder's contents are its count. Closed, the number is
                the only hint of what is inside. */}
            {collapsed && count > 0 && (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
            )}
          </button>
          {selecting ? (
            folderSelected ? (
              groupMenu()
            ) : null
          ) : (
            <FolderMenu
              onNewFile={onCreateFile ? () => onCreateFile(folder.id) : undefined}
              onNewMermaid={onCreateMermaid ? () => onCreateMermaid(folder.id) : undefined}
              onNewBoard={onCreateBoard ? () => onCreateBoard(folder.id) : undefined}
              // Creates *inside* this folder now, rather than another one beside
              // it at the top level.
              onNewFolder={onCreateFolder ? () => promptNewFolder(folder.id) : undefined}
              onRename={
                onRenameFolder
                  ? () => {
                      const next = window.prompt("Rename folder to:", folder.name);
                      if (next && next.trim() && next.trim() !== folder.name) {
                        onRenameFolder(folder.id, next.trim());
                      }
                    }
                  : undefined
              }
              onDelete={
                onDeleteFolder
                  ? () => {
                      if (
                        count === 0 ||
                        window.confirm(
                          `Delete "${folder.name}"? Its ${count} item${
                            count > 1 ? "s" : ""
                          } move back to the top level.`,
                        )
                      ) {
                        onDeleteFolder(folder.id);
                      }
                    }
                  : undefined
              }
            />
          )}
        </div>
        {!collapsed && (
          <div className="ml-[0.9rem] border-l border-border/60 pl-1.5">
            {subfolders.map((child) => renderFolder(child, depth + 1))}
            {items.map(renderFileRow)}
            {count === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">Drag files here</p>
            )}
          </div>
        )}
      </div>
    );
  };

  const groups =
    view.mode === "grouped"
      ? Array.from(
          sorted
            .reduce((map, f) => {
              const label = fileLabel(kindOf(f));
              const bucket = map.get(label) ?? [];
              bucket.push(f);
              map.set(label, bucket);
              return map;
            }, new Map<string, MdFile[]>())
            .entries(),
        ).map(([label, items]) => ({ label, items }))
      : [{ label: "", items: listed }];

  const renderFileRow = (file: MdFile) => {
    const realIndex = files.indexOf(file);
    const current = file.id === activeFileId;
    const open = expanded[file.id] ?? current;
    const kind = kindOf(file);
    const KindIcon = kindIcon(kind);
    const meta = kindMeta(kind);
    const isTextual = kind === "markdown" || kind === "text";
    const mins = readingMinutes(file.content);
    const title = file.name.replace(
      /\.(md|markdown|mdx|mmd|mermaid|board|excalidraw|txt|docx|pdf|xlsx|xls|csv|json|html|htm|ppt|pptx|gdoc|gslides|xam|xrule|xp)$/i,
      "",
    );
    const dragActive = reordering && !viewActive && realIndex >= 0 && !selecting;
    // Outside reorder mode, a row is dragged to file it into a folder instead.
    const folderDragActive =
      !!onMoveFileToFolder && folders.length > 0 && !selecting && !dragActive;
    const isDragging = dragActive && dragIndex === realIndex;
    const isDropTarget = dragActive && overIndex === realIndex && dragIndex !== realIndex;
    return (
      <div key={file.id} className="mb-px">
        <div
          data-sidebar-file={file.id}
          draggable={dragActive || folderDragActive}
          onDragStart={
            dragActive
              ? (e) => {
                  setDragIndex(realIndex);
                  e.dataTransfer.effectAllowed = "move";
                }
              : folderDragActive
                ? (e) => {
                    e.dataTransfer.setData(FILE_DND, file.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDraggingFileId(file.id);
                  }
                : undefined
          }
          onDragOver={
            dragActive
              ? (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setOverIndex(realIndex);
                }
              : undefined
          }
          onDrop={
            dragActive
              ? (e) => {
                  e.preventDefault();
                  dropOn(realIndex);
                }
              : undefined
          }
          onDragEnd={
            dragActive || folderDragActive
              ? () => {
                  endDrag();
                  setDropFolderId(null);
                  setDraggingFileId(null);
                }
              : undefined
          }
          /*
           * The active row carries a marker in the left margin as well as a
           * surface. A tinted fill alone is a low-contrast signal that the eye
           * has to land on to read; the bar is a hard vertical edge that
           * registers peripherally, so the reader can keep their attention on
           * the document and still know where they are in the list.
           */
          className={`group relative flex items-center gap-1 rounded-lg px-1 transition-colors duration-150 ${
            current
              ? "bg-sidebar-accent before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.75 before:-translate-y-1/2 before:rounded-r-full before:bg-primary before:content-['']"
              : "hover:bg-sidebar-accent/50"
          } ${dragActive ? "cursor-grab active:cursor-grabbing" : ""} ${
            isDragging ? "opacity-40" : ""
          } ${isDropTarget ? "ring-2 ring-primary/60" : ""}`}
        >
          {dragActive && (
            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
          )}
          {selecting && (
            <div
              className="flex h-6 w-6 shrink-0 items-center justify-center pl-1"
              onClick={(e) => {
                e.stopPropagation();
                // The checkbox's own change handles clicks on the box; this is
                // the padding around it.
                if (e.target === e.currentTarget) toggleSelection(file.id);
              }}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(file.id)}
                onChange={() => toggleSelection(file.id)}
                aria-label={`Select ${file.name}`}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
              />
            </div>
          )}
          <button
            onClick={() => {
              if (selecting) toggleSelection(file.id);
              else onSelect(file.id);
            }}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-1.5 pl-2 pr-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11"
            aria-current={current ? "page" : undefined}
            /* The type and reading time used to be a column on every row —
               "9m", "CSV", "JSON" — repeating what the coloured glyph already
               says and squeezing every name into an earlier ellipsis. They are
               a hover away now, with the full name the row truncates. */
            title={`${file.name} · ${isTextual ? `${mins} min read` : meta.label}`}
          >
            {!selecting && <KindIcon className={`h-4 w-4 shrink-0 ${meta.tone}`} aria-hidden />}
            <span
              className={`min-w-0 flex-1 truncate text-sm ${
                current ? "font-medium text-foreground" : "text-foreground/75"
              }`}
            >
              {title}
            </span>
          </button>
          {!selecting ? (
            <FileMenu
              // The file types with an editor behind them. A PDF or a
              // spreadsheet has no edit mode to enter, so the item is absent
              // rather than present and inert.
              onEdit={onEditFile && isEditableKind(kind) ? () => onEditFile(file.id) : undefined}
              onConvert={
                onConvertFile && canConvertToMarkdown(file)
                  ? () => onConvertFile(file.id)
                  : undefined
              }
              conversionDisabled={!!convertingFileId}
              hasMarkdownCopy={markdownCopies.has(file.id)}
              onOpenMarkdown={(() => {
                const copy = markdownCopies.get(file.id);
                return copy ? () => onSelect(copy.id) : undefined;
              })()}
              // Markdown and text are renamed from the name field their editor
              // puts above the source; everything else has no editor to hold
              // one, so it keeps the menu item.
              onRename={
                onEditFile && isTextual
                  ? undefined
                  : () => {
                      const newName = window.prompt("Rename file to:", file.name);
                      if (newName && newName !== file.name) {
                        onRenameFile(file.id, newName);
                      }
                    }
              }
              onMoveToBin={() => onRemoveFile(file.id)}
              folders={folders}
              currentFolderId={file.folderId ?? null}
              onMoveToFolder={
                onMoveFileToFolder ? (folderId) => onMoveFileToFolder(file.id, folderId) : undefined
              }
              onAddToSplit={onAddToSplit ? () => onAddToSplit(file.id) : undefined}
              alreadyInSplit={splitFileIds.includes(file.id)}
              onDownload={onDownloadFile ? (format) => onDownloadFile(file.id, format) : undefined}
              formats={availableFormats(file)}
              onShare={onShareFile ? () => onShareFile(file.id) : undefined}
            />
          ) : selectedIds.has(file.id) ? (
            groupMenu()
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <aside className="flex h-full flex-col">
      {docked ? (
        /* One row of chrome, not two. The collapse toggle comes first so it
           sits exactly where the collapsed rail's expand button does: toggling
           twice never moves the pointer. Back and forward act on the whole
           workspace, so they ride beside it; search sits opposite. There is no
           wordmark — the reader already knows which app they are in, and it
           was the loudest thing in the column while doing nothing. The save
           state moved to the footer, beside the workspace it describes. */
        <div className="flex items-center gap-0.5 px-2.5 pt-2.5">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className={CHROME_BUTTON}
              aria-label="Toggle sidebar"
              title="Collapse sidebar"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={navHistory.back}
            disabled={!navHistory.canBack}
            aria-label={navHistory.backLabel}
            title={navHistory.backLabel}
            className={CHROME_BUTTON}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            onClick={navHistory.forward}
            disabled={!navHistory.canForward}
            aria-label={navHistory.forwardLabel}
            title={navHistory.forwardLabel}
            className={CHROME_BUTTON}
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          {onOpenSearch && (
            <button
              onClick={onOpenSearch}
              className={`ml-auto ${CHROME_BUTTON}`}
              aria-label="Search docs"
              title={`Search docs (${modKeyLabel}K)`}
            >
              <Search className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : null}

      {/* The list's own header: which view is showing, and the one control for
          adding to it. Create and Upload used to be a pair of full-width
          buttons above; as a `+` beside the label they take no vertical space
          and sit next to the list they add to. */}
      {onView && !search && (
        <div className="flex items-center gap-1 pb-1 pl-3 pr-2.5 pt-4">
          <div ref={viewMenuRef} className="relative min-w-0 flex-1">
            {/* Sized to its label rather than the full row, so the hover and
                the click target describe the same thing: the picker. */}
            <button
              onClick={() => setViewMenuOpen((o) => !o)}
              aria-expanded={viewMenuOpen}
              aria-haspopup="menu"
              className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11"
            >
              <span className="truncate">{VIEW_LABEL[view.mode]}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform ${
                  viewMenuOpen ? "rotate-180" : ""
                }`}
                aria-hidden
              />
            </button>

            {viewMenuOpen && (
              <MenuPanel align="left">
                {VIEW_MODES.map((mode) => (
                  <MenuItem
                    key={mode}
                    icon={Check}
                    iconClassName={view.mode === mode ? "" : "opacity-0"}
                    label={VIEW_LABEL[mode]}
                    onClick={() => {
                      onView({ ...view, mode });
                      setViewMenuOpen(false);
                    }}
                  />
                ))}
              </MenuPanel>
            )}
          </div>

          <AddMenu
            onCreateFile={onCreateFile ? () => onCreateFile(null) : undefined}
            onCreateMermaid={onCreateMermaid ? () => onCreateMermaid(null) : undefined}
            onCreateBoard={onCreateBoard ? () => onCreateBoard(null) : undefined}
            onCreateFolder={onCreateFolder ? promptNewFolder : undefined}
            onCreateExam={onCreateExam}
            onCreatePractice={onCreatePractice ? () => onCreatePractice(null) : undefined}
            onUpload={onAddFiles}
          />
        </div>
      )}

      {search ? (
        <SearchPanel {...search} />
      ) : (
        /* Right-click anywhere in the list for the list's own modes. They used
           to be reachable only from a document's ⋮ menu, which made "select"
           and "reorder" look like things you do to one file. Radix also opens
           this on a long press, so touch gets it too. */
        <ContextMenu>
          <ContextMenuTrigger
            asChild
            onContextMenu={(e) => {
              const row = (e.target as Element).closest?.(
                "[data-sidebar-file],[data-sidebar-folder]",
              );
              contextRowRef.current = row
                ? {
                    fileId: row.getAttribute("data-sidebar-file") ?? undefined,
                    folderId: row.getAttribute("data-sidebar-folder") ?? undefined,
                  }
                : null;
            }}
          >
            <nav className="flex-1 overflow-y-auto px-3 pb-3">
              {reordering && !viewActive && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-2 text-xs text-primary">
                  <GripVertical className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1">Drag files and folders to reorder</span>
                  <button
                    onClick={toggleReorder}
                    className="shrink-0 rounded px-2 py-0.5 text-xs font-semibold hover:bg-primary/15"
                  >
                    Done
                  </button>
                </div>
              )}
              {selecting && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-2 text-xs text-primary">
                  <CheckSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 tabular-nums" aria-live="polite">
                    {selectedIds.size + selectedFolderIds.size} selected
                  </span>
                  <button
                    onClick={clearSelection}
                    className="shrink-0 rounded px-2 py-0.5 text-xs font-semibold hover:bg-primary/15"
                  >
                    Done
                  </button>
                </div>
              )}
              {total === 0 && folders.length === 0 ? null : (
                <>
                  {showFolders && rootFolders.map((folder) => renderFolder(folder, 0))}
                  {/* The top level's own drop target, and the reason a file can be
                dragged back out of a folder: it wraps the unfiled list *and*
                the empty space below it, so the gap under the last row is a
                real place to drop rather than dead pixels. */}
                  <div
                    className={`min-h-16 rounded-lg ${
                      // Only while something is actually being dragged. This used to
                      // test `dropFolderId === null`, which is the *resting* state —
                      // so the ring was drawn permanently, reading as a stray border
                      // around the unfiled files.
                      showFolders && draggingFileId !== null && dropFolderId === null
                        ? "ring-2 ring-primary/60"
                        : ""
                    }`}
                    {...(showFolders ? dropTargetProps(null) : {})}
                  >
                    {groups.map((groupItem) => (
                      <div
                        key={groupItem.label || "__all"}
                        className={groupItem.label ? "mb-3" : ""}
                      >
                        {groupItem.label && (
                          <div className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {groupItem.label}
                          </div>
                        )}
                        {groupItem.items.map(renderFileRow)}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </nav>
          </ContextMenuTrigger>
          <ContextMenuContent className="z-(--z-menu) w-56 rounded-xl p-1.5 shadow-xl">
            {selecting ? (
              <>
                <ContextMenuItem
                  className={CONTEXT_ITEM}
                  disabled={selectedIds.size + selectedFolderIds.size >= selectionTotal}
                  onSelect={selectAll}
                >
                  <CheckSquare className="h-4 w-4" strokeWidth={1.5} />
                  Select all
                  <ContextMenuShortcut>{modKeyLabel}A</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem className={CONTEXT_ITEM} onSelect={clearSelection}>
                  <X className="h-4 w-4" strokeWidth={1.5} />
                  Done selecting
                </ContextMenuItem>
              </>
            ) : (
              <ContextMenuItem
                className={CONTEXT_ITEM}
                disabled={total === 0 && folders.length === 0}
                onSelect={() => {
                  if (reordering) toggleReorder();
                  startSelecting(contextRowRef.current ?? undefined);
                }}
              >
                <CheckSquare className="h-4 w-4" strokeWidth={1.5} />
                Select
              </ContextMenuItem>
            )}
            {canReorder && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className={CONTEXT_ITEM}
                  onSelect={() => {
                    if (selecting) clearSelection();
                    toggleReorder();
                  }}
                >
                  {reordering ? (
                    <Check className="h-4 w-4" strokeWidth={1.5} />
                  ) : (
                    <GripVertical className="h-4 w-4" strokeWidth={1.5} />
                  )}
                  {reordering ? "Done reordering" : "Reorder"}
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
      )}

      {/* One row: where you are, whether it is safe, where else you could be,
          and settings. It used to be a pill-shaped avatar with a fused gear
          and the name in 10px type underneath — three stacked layers of chrome
          to say "My workspace". The save state lives here because it is a
          fact about this workspace, not about the open document. */}
      <div className="flex items-center gap-1 border-t border-sidebar-border py-2 pl-2.5 pr-2.5">
        {currentWorkspace ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-0.5">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-2xs font-semibold uppercase text-sidebar-foreground ring-1 ring-inset ring-primary/40"
              aria-hidden
            >
              {initials(currentWorkspace.name)}
            </span>
            <span
              className="min-w-0 truncate text-sm font-medium text-foreground/90"
              title={currentWorkspace.name}
            >
              {currentWorkspace.name}
            </span>
            {saveIndicator && <span className="flex shrink-0 items-center">{saveIndicator}</span>}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center">{saveIndicator}</div>
        )}
        {/* The other workspaces stay one tap away — Arc-style instant
          switching — but as small avatars in the same row rather than a
          second band of labelled circles. Each keeps its name as its
          accessible label and tooltip. */}
        {onSwitchWorkspace && otherWorkspaces.length > 0 && (
          <WorkspaceStrip
            size="sm"
            workspaces={otherWorkspaces}
            currentId={null}
            onSelect={onSwitchWorkspace}
            className="min-w-0 max-w-[45%] shrink"
          />
        )}
        <button
          onClick={() => onOpenSettings()}
          className={CHROME_BUTTON}
          aria-label={currentWorkspace ? `Settings for ${currentWorkspace.name}` : "Settings"}
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}

/**
 * The sidebar renders a row per document (and a sub-list per open document), so
 * it is the most expensive thing in the shell after the viewer itself. Memoized
 * so that reading, scrolling, saving and every other app-level state change
 * leaves it alone; `DocsApp` holds its callbacks and derived lists to stable
 * identities to make that hold.
 */
export const Sidebar = memo(SidebarImpl);
