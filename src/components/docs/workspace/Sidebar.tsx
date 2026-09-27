import { embedMediaFolderIds } from "@/lib/workspace/embed-media";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isEditableTarget, hasModKey, modKeyLabel } from "@/lib/platform/keyboard";
import {
  ChevronRight,
  Settings,
  MoreVertical,
  Trash2,
  Pencil,
  SquarePen,
  GripVertical,
  Check,
  Plus,
  Sparkles,
  PanelLeft,
  Search,
  ArrowLeft,
  ArrowRight,
  FileText,
  FileType,
  FileSpreadsheet,
  FileJson,
  FileImage,
  FileVideo,
  FileAudio,
  Workflow,
  Presentation,
  Globe,
  File as FileIcon,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderInput,
  FilePlus,
  Download,
  Printer,
  Upload,
  CheckSquare,
  Share2,
  Columns2,
  Hash,
  Table,
  Code,
  Quote,
  List,
  PenTool,
  Star,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { splitIntoSubtopics } from "@/lib/markdown/markdown-utils";
import type { Highlight } from "@/lib/markdown/dom-highlighter";
import { savedTypeLabel, type SavedEntry, type SavedItem } from "@/lib/workspace/saved-items";
import type { MdFile, DocumentKind } from "@/lib/markdown/markdown-utils";
import { readingMinutes } from "@/lib/markdown/markdown-utils";
import { fileLabel, getDocumentKind, isEditableKind } from "@/lib/markdown/document-utils";
import { availableFormats, FORMAT_LABEL, type ExportFormat } from "@/services/markdown-export";
import { WorkspaceStrip, initials } from "./WorkspaceStrip";
import { useNavHistory } from "@/hooks/use-nav-history";
import { canConvertToMarkdown, latestMarkdownCopies } from "@/services/doc-conversion";

/** A glyph per export format, so the flyout scans by shape like the file list. */
const FORMAT_ICON: Record<ExportFormat, LucideIcon> = {
  docx: FileType,
  pdf: Printer,
  markdown: FileText,
  html: Globe,
  original: Download,
};

// Arc-style "favicon" per file type — a small colored glyph that anchors each
// row so the list scans by shape, not just text.
const KIND_ICON: Partial<Record<DocumentKind, LucideIcon>> = {
  markdown: FileText,
  mermaid: Workflow,
  board: PenTool,
  text: FileText,
  docx: FileType,
  pdf: FileType,
  spreadsheet: FileSpreadsheet,
  csv: FileSpreadsheet,
  json: FileJson,
  presentation: Presentation,
  "google-doc": Globe,
  "google-slide": Globe,
  html: Globe,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
};

function kindIcon(kind: DocumentKind): LucideIcon {
  return KIND_ICON[kind] ?? FileIcon;
}

/*
 * Colour per file type, and the short label the row shows on its right.
 *
 * The glyphs above were already distinct in shape, but every one of them was
 * drawn in the same muted grey at 14px, where the difference between a sheet
 * and a document is a couple of pixels of stroke — the list could only be read
 * by name. Hue is the fastest channel the eye has for this, so each family gets
 * one and the list becomes scannable before a single word is read.
 *
 * The label matters for a second reason: rows drop the file extension, so
 * "metrics" and "config" gave no clue what they were. The label puts the type
 * back, in the column that was otherwise empty for every non-text file.
 */
const KIND_META: Partial<Record<DocumentKind, { tone: string; label: string }>> = {
  markdown: { tone: "text-sky-500 dark:text-sky-400", label: "MD" },
  text: { tone: "text-slate-500 dark:text-slate-400", label: "TXT" },
  mermaid: { tone: "text-cyan-600 dark:text-cyan-400", label: "DIAGRAM" },
  board: { tone: "text-fuchsia-500 dark:text-fuchsia-400", label: "BOARD" },
  docx: { tone: "text-blue-600 dark:text-blue-400", label: "DOCX" },
  pdf: { tone: "text-rose-500 dark:text-rose-400", label: "PDF" },
  spreadsheet: { tone: "text-emerald-600 dark:text-emerald-400", label: "SHEET" },
  csv: { tone: "text-emerald-600 dark:text-emerald-400", label: "CSV" },
  json: { tone: "text-amber-600 dark:text-amber-400", label: "JSON" },
  presentation: { tone: "text-orange-500 dark:text-orange-400", label: "DECK" },
  "google-doc": { tone: "text-blue-600 dark:text-blue-400", label: "DOC" },
  "google-slide": { tone: "text-orange-500 dark:text-orange-400", label: "SLIDES" },
  html: { tone: "text-indigo-500 dark:text-indigo-400", label: "HTML" },
  image: { tone: "text-violet-500 dark:text-violet-400", label: "IMAGE" },
  video: { tone: "text-pink-500 dark:text-pink-400", label: "VIDEO" },
  audio: { tone: "text-teal-500 dark:text-teal-400", label: "AUDIO" },
};

function kindMeta(kind: DocumentKind) {
  return KIND_META[kind] ?? { tone: "text-muted-foreground", label: "FILE" };
}

/** Glyph for a saved item, so the Saved list scans by what was starred. */
function savedIcon(item: SavedItem): LucideIcon {
  if (item.kind === "file") return FileText;
  if (item.kind === "section") return Hash;
  switch (item.blockType) {
    case "table":
      return Table;
    case "code":
      return Code;
    case "quote":
      return Quote;
    case "image":
      return FileImage;
    case "list":
      return List;
    default:
      return Star;
  }
}

/** Saved items grouped under the file they came from, newest group first. */
function savedByFile(items: SavedEntry[]): Array<[string, SavedEntry[]]> {
  const groups = new Map<string, SavedEntry[]>();
  for (const item of items) {
    const bucket = groups.get(item.fileName);
    if (bucket) bucket.push(item);
    else groups.set(item.fileName, [item]);
  }
  return [...groups.entries()];
}

/**
 * How the file list is presented in the sidebar.
 * - `mode` is driven by the chip row: All (flat), Grouped (by file type),
 *   or Saved (bookmarks only).
 * - `sort`/`dir` are set from the three-dots menu. `manual` keeps the real
 *   file order so drag reordering stays meaningful.
 */
export type SidebarView = {
  sort: "manual" | "name" | "date";
  dir: "asc" | "desc";
  mode: "all" | "grouped" | "saved";
};
export const DEFAULT_VIEW: SidebarView = {
  sort: "manual",
  dir: "asc",
  mode: "all",
};

/**
 * The list's three views, in the order the picker offers them.
 *
 * The Bin is not among them. It is not a way of looking at the workspace —
 * it holds documents that have left it — and it lives in Settings ▸ Storage,
 * beside the quota it is actually competing for.
 */
const VIEW_MODES: readonly SidebarView["mode"][] = ["all", "grouped", "saved"];
const VIEW_LABEL: Record<SidebarView["mode"], string> = {
  all: "All files",
  grouped: "Grouped",
  saved: "Saved",
};

/** A sidebar folder, as far as the sidebar is concerned. */
export interface SidebarFolder {
  id: string;
  name: string;
  /** Folder this one sits inside; null/undefined = top level. */
  parentId?: string | null;
  /** Managed attachment folder, independent of its display name. */
  purpose?: "embed-media";
}

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
  onRenameFile: (id: string, newName: string) => void;
  /** Open a document in the editor. Only offered for editable text documents. */
  onEditFile?: (id: string) => void;
  onConvertFile?: (id: string) => void;
  convertingFileId?: string | null;
  /** Star / unstar a whole document from its row menu. */
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
  /** Create a folder, optionally nested inside an existing one. */
  onCreateFolder?: (name: string, parentId?: string | null) => void;
  /** Re-parent a folder. `null` puts it back at the top level. */
  onMoveFolderToFolder?: (folderId: string, parentId: string | null) => void;
  onRenameFolder?: (id: string, name: string) => void;
  /** Deleting a folder keeps its documents — they return to the top level. */
  onDeleteFolder?: (id: string) => void;
  onMoveFileToFolder?: (fileId: string, folderId: string | null) => void;
  /** Stars on documents, sections and blocks — the Saved chip. */
  saved: SavedEntry[];
  currentWorkspaceName: string;
  canDeleteWorkspace: boolean;
  onRenameCurrentWorkspace: (name: string) => void;
  onDeleteCurrentWorkspace: () => void;
  onClearStorage: () => void;
  highlights: Highlight[];
  /** Go to a saved item: its file, its page, then the passage itself. */
  onOpenSaved: (item: SavedItem) => void;
  onRemoveSaved: (id: string) => void;
  onRemoveHighlight: (id: string) => void;
  /** Open the isolated "highlights only" view for a file (text-based only). */
  onReorderFile?: (oldIndex: number, newIndex: number) => void;
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
  onOpenPalette?: () => void;
  onToggleSidebar?: () => void;
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
  onRenameFile,
  onEditFile,
  onConvertFile,
  convertingFileId,
  folders: allFolders = [],
  onCreateFile,
  onCreateMermaid,
  onCreateBoard,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFileToFolder,
  onMoveFolderToFolder,
  saved: allSaved,
  currentWorkspaceName,
  canDeleteWorkspace,
  onRenameCurrentWorkspace,
  onDeleteCurrentWorkspace,
  onClearStorage,
  highlights,
  onOpenSaved,
  onRemoveSaved,
  onRemoveHighlight,
  onReorderFile,
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
  onShareFile,
  onShareFiles,
  docked = false,
  onOpenPalette,
  onToggleSidebar,
}: Props) {
  const hiddenFolders = useMemo(() => showEmbedMedia ? new Set<string>() : embedMediaFolderIds(allFolders), [showEmbedMedia, allFolders]);
  const folders = useMemo(() => allFolders.filter((folder) => !hiddenFolders.has(folder.id)), [allFolders, hiddenFolders]);
  const hiddenFiles = useMemo(() => new Set(files.filter((file) => file.folderId && hiddenFolders.has(file.folderId)).map((file) => file.id)), [files, hiddenFolders]);
  const saved = useMemo(() => allSaved.filter((entry) => !hiddenFiles.has(entry.fileId)), [allSaved, hiddenFiles]);

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

  // Which documents are starred as a whole — the star in each row's menu
  // reflects this. Section and block stars are excluded: they say nothing about
  // whether the document itself is starred.

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

  // Multi-select mode
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelectedIds((selected) => {
      const visible = new Set([...selected].filter((id) => !hiddenFiles.has(id)));
      return visible.size === selected.size ? selected : visible;
    });
  }, [hiddenFiles]);

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
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
  const activeFilesRef = useRef(activeFiles);
  activeFilesRef.current = activeFiles;

  useEffect(() => {
    // Only while multi-select is on: outside it, Cmd/Ctrl+A must keep meaning
    // "select all text on the page".
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (hasModKey(e) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedIds(new Set(activeFilesRef.current.map((f) => f.id)));
        return;
      }
      if (e.key === "Escape") {
        setSelecting(false);
        setSelectedIds(new Set());
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
  const canReorder = !!onReorderFile && total > 1;
  const toggleReorder = () => {
    setReordering((on) => {
      const next = !on;
      if (next && viewActive) onView?.(DEFAULT_VIEW);
      if (!next) {
        setDragIndex(null);
        setOverIndex(null);
      }
      return next;
    });
  };

  // If the view leaves the flat manual list while reordering, leave reorder mode
  // so we never drag against a sorted/grouped list that ignores the drop index.
  useEffect(() => {
    if (reordering && viewActive) {
      setReordering(false);
      setDragIndex(null);
      setOverIndex(null);
    }
  }, [reordering, viewActive]);

  const endDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };
  const dropOn = (targetIndex: number) => {
    if (dragIndex !== null && dragIndex !== targetIndex) {
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
  // Folders only shape the flat "All" list; Grouped stays grouped by file type,
  // and Recent/Saved are their own orderings.
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
    return (
      <div
        key={folder.id}
        className={`mb-1.5 rounded-lg ${isDropTarget ? "ring-2 ring-primary/60" : ""} ${
          draggingFolderId === folder.id ? "opacity-40" : ""
        }`}
        {...dropTargetProps(folder.id)}
      >
        <div
          className="group flex items-center gap-1 rounded-lg px-1"
          draggable={!!onMoveFolderToFolder && !selecting}
          onDragStart={
            onMoveFolderToFolder && !selecting
              ? (e) => {
                  e.stopPropagation();
                  e.dataTransfer.setData(FOLDER_DND, folder.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDraggingFolderId(folder.id);
                }
              : undefined
          }
          onDragEnd={
            onMoveFolderToFolder && !selecting
              ? () => {
                  setDraggingFolderId(null);
                  setDropFolderId(null);
                }
              : undefined
          }
        >
          <button
            onClick={() => toggleFolder(folder.id)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pl-2 pr-1.5 text-left coarse:min-h-11"
            aria-expanded={!collapsed}
          >
            <ChevronRight
              className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
                collapsed ? "" : "rotate-90"
              }`}
              aria-hidden
            />
            {collapsed ? (
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
            ) : (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground/80">
              {folder.name}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
          </button>
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
        </div>
        {!collapsed && (
          <div className="ml-4 border-l border-border pl-1">
            {subfolders.map((child) => renderFolder(child, depth + 1))}
            {items.map(renderFileRow)}
            {count === 0 && (
              <p className="px-2 py-2 text-xs text-muted-foreground">Empty — drag a file here.</p>
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
      /\.(md|markdown|mdx|mmd|mermaid|excalidraw|txt|docx|pdf|xlsx|xls|csv|json|html|htm|ppt|pptx|gdoc|gslides)$/i,
      "",
    );
    const dragActive = reordering && !viewActive && realIndex >= 0 && !selecting;
    // Outside reorder mode, a row is dragged to file it into a folder instead.
    const folderDragActive =
      !!onMoveFileToFolder && folders.length > 0 && !selecting && !dragActive;
    const isDragging = dragActive && dragIndex === realIndex;
    const isDropTarget = dragActive && overIndex === realIndex && dragIndex !== realIndex;
    return (
      <div key={file.id} className="mb-1.5">
        <div
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
                toggleSelection(file.id);
              }}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(file.id)}
                onChange={() => toggleSelection(file.id)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
              />
            </div>
          )}
          <button
            onClick={() => {
              if (selecting) toggleSelection(file.id);
              else onSelect(file.id);
            }}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pl-2 pr-1.5 text-left coarse:min-h-11"
            aria-current={current ? "page" : undefined}
          >
            {!selecting && <KindIcon className={`h-4 w-4 shrink-0 ${meta.tone}`} aria-hidden />}
            <span
              className={`min-w-0 flex-1 truncate text-sm ${
                current ? "font-semibold text-foreground" : "font-medium text-foreground/80"
              }`}
            >
              {title}
            </span>
            {/* Reading time where there is text to read, the file type where
                there is not — this column used to render an empty span for
                every binary file, leaving half the list with a ragged, unused
                right edge and no indication of what those rows held. */}
            <span
              className={`shrink-0 text-[0.6875rem] tabular-nums ${
                current ? "text-muted-foreground" : "text-muted-foreground/60"
              } ${isTextual ? "" : "font-semibold tracking-wider"}`}
            >
              {isTextual ? `${mins}m` : meta.label}
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
              onRename={() => {
                const newName = window.prompt("Rename file to:", file.name);
                if (newName && newName !== file.name) {
                  onRenameFile(file.id, newName);
                }
              }}
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
              reordering={reordering}
              onToggleReorder={canReorder ? toggleReorder : undefined}
              onSelectMode={() => {
                setSelecting(true);
                setSelectedIds(new Set([file.id]));
              }}
            />
          ) : selectedIds.has(file.id) ? (
            <GroupActionMenu
              onShare={
                onShareFiles
                  ? () => {
                      onShareFiles([...selectedIds]);
                      setSelecting(false);
                      setSelectedIds(new Set());
                    }
                  : undefined
              }
              onMoveToBin={() => {
                selectedIds.forEach((id) => onRemoveFile(id));
                setSelecting(false);
                setSelectedIds(new Set());
              }}
              onDownload={
                onDownloadFile
                  ? () => {
                      // A multi-file download stays the original bytes. The
                      // converted formats are per-document by nature — a batch
                      // of PDFs would mean one print dialog per file, each
                      // waiting on the last, and the reader picking a format
                      // once for documents that may not all support it.
                      if (onDownloadFiles) onDownloadFiles([...selectedIds], "original");
                      else selectedIds.forEach((id) => onDownloadFile(id, "original"));
                      setSelecting(false);
                      setSelectedIds(new Set());
                    }
                  : undefined
              }
              onCancel={() => {
                setSelecting(false);
                setSelectedIds(new Set());
              }}
              onSelectAll={() => setSelectedIds(new Set(activeFiles.map((f) => f.id)))}
              allSelected={selectedIds.size >= activeFiles.length}
            />
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <aside className="flex h-full flex-col">
      {docked ? (
        <>
          {/* Brand row: the product's name owns the top of the rail, with the
              controls that act on the whole app — search and the collapse
              toggle — sitting opposite it. */}
          <div className="flex items-center gap-1 px-4 pt-4">
            <span className="min-w-0 flex-1 truncate text-xl font-bold tracking-tight text-foreground">
              Localdox
            </span>
            {onOpenPalette && (
              <button
                onClick={onOpenPalette}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground coarse:h-11 coarse:w-11"
                aria-label="Search docs"
                title="Search docs"
              >
                <Search className="h-4.5 w-4.5" />
              </button>
            )}
            {onToggleSidebar && (
              <button
                onClick={onToggleSidebar}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground coarse:h-11 coarse:w-11"
                aria-label="Toggle sidebar"
                title="Toggle sidebar"
              >
                <PanelLeft className="h-4.5 w-4.5" />
              </button>
            )}
          </div>

          {/* History controls. Back and forward act on the workspace as a whole
              rather than on the open document, so they belong with the chrome
              here rather than in the viewer's own header. */}
          <div className="flex items-center gap-1 px-3 pt-2">
            <button
              onClick={navHistory.back}
              disabled={!navHistory.canBack}
              aria-label={navHistory.backLabel}
              title={navHistory.backLabel}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground coarse:h-11 coarse:w-11 disabled:pointer-events-none disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button
              onClick={navHistory.forward}
              disabled={!navHistory.canForward}
              aria-label={navHistory.forwardLabel}
              title={navHistory.forwardLabel}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground coarse:h-11 coarse:w-11 disabled:pointer-events-none disabled:opacity-40"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </>
      ) : null}

      {/* The list's own header: which view is showing, and the one control for
          adding to it. Create and Upload used to be a pair of full-width
          buttons above; as a `+` beside the label they take no vertical space
          and sit next to the list they add to. */}
      {onView && (
        <div className="flex items-center gap-1 px-3 pb-1 pt-3">
          <div ref={viewMenuRef} className="relative min-w-0 flex-1">
            <button
              onClick={() => setViewMenuOpen((o) => !o)}
              aria-expanded={viewMenuOpen}
              className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground coarse:min-h-11"
            >
              <span className="truncate">{VIEW_LABEL[view.mode]}</span>
              <ChevronRight
                className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform ${
                  viewMenuOpen ? "rotate-90" : ""
                }`}
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
            onUpload={onAddFiles}
          />
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {reordering && !viewActive && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-2 text-xs text-primary">
            <GripVertical className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">Drag files to reorder</span>
            <button
              onClick={toggleReorder}
              className="shrink-0 rounded px-2 py-0.5 text-xs font-semibold hover:bg-primary/15"
            >
              Done
            </button>
          </div>
        )}
        {view.mode === "saved" ? (
          saved.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              No saved items yet. Star a document, a section, a table or a code block.
            </p>
          ) : (
            savedByFile(saved).map(([fileName, items]) => (
              <div key={fileName} className="mb-3">
                <div className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {fileName}
                </div>
                <ul className="space-y-1">
                  {items.map((item) => {
                    const Icon = savedIcon(item);
                    return (
                      <li
                        key={item.id}
                        className="group flex items-start gap-1 rounded-lg px-1 hover:bg-accent/60"
                      >
                        <button
                          onClick={() => onOpenSaved(item)}
                          className="flex min-w-0 flex-1 items-start gap-2 rounded-md py-2 pl-2 pr-1.5 text-left"
                          title={item.text || item.title}
                        >
                          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground/80">
                              {item.title}
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                              {savedTypeLabel(item)}
                              {item.orphaned && (
                                <span className="text-amber-600 dark:text-amber-400">
                                  · edited away
                                </span>
                              )}
                            </span>
                          </span>
                        </button>
                        <button
                          onClick={() => onRemoveSaved(item.id)}
                          className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-100 transition-opacity hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
                          aria-label="Remove saved item"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )
        ) : total === 0 && folders.length === 0 ? null : (
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
                <div key={groupItem.label || "__all"} className={groupItem.label ? "mb-3" : ""}>
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

      <div className="flex items-center gap-2 border-t border-sidebar-border p-2">
        {/* Settings apply to whichever workspace is open, so its trigger sits
            fused to that workspace's own avatar rather than floating on its
            own — the pairing reads as "settings for here". Everywhere else to
            switch to lives in the strip beside it. */}
        {currentWorkspace && (
          // Same origin-bottom hover magnify as the strip's own avatars, so the
          // current workspace doesn't sit dead while everything beside it
          // responds to the pointer.
          <div className="flex shrink-0 origin-bottom flex-col items-center gap-1.5 transition-transform duration-150 ease-out hover:scale-105">
            <div className="flex items-center gap-0.5 rounded-full border border-primary/35 bg-sidebar-accent p-1">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full bg-background text-xs font-semibold uppercase text-sidebar-foreground"
                title={currentWorkspace.name}
              >
                {initials(currentWorkspace.name)}
              </span>
              <button
                onClick={() => onOpenSettings()}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-sidebar-foreground"
                aria-label={`Settings for ${currentWorkspace.name}`}
                title="Settings"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            </div>
            <span className="max-w-[76px] truncate text-[11px] font-medium text-sidebar-foreground">
              {currentWorkspace.name}
            </span>
          </div>
        )}
        {onSwitchWorkspace && otherWorkspaces.length > 0 && (
          <>
            <div className="h-8 w-[2px] shrink-0 rounded-full bg-border" />
            <WorkspaceStrip
              workspaces={otherWorkspaces}
              currentId={null}
              onSelect={onSwitchWorkspace}
              className="min-w-0 flex-1"
            />
          </>
        )}
        {!currentWorkspace && (
          <button
            onClick={() => onOpenSettings()}
            className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            aria-label="Settings"
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        )}
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

function GroupActionMenu({
  onShare,
  onMoveToBin,
  onDownload,
  onCancel,
  onSelectAll,
  allSelected,
}: {
  onShare?: () => void;
  onMoveToBin: () => void;
  onDownload?: () => void;
  onCancel: () => void;
  onSelectAll: () => void;
  allSelected: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (isOutsideMenu(e.target as Node, rootRef.current)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative ml-0.5 flex shrink-0 items-center">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`flex h-6 w-6 items-center justify-center rounded text-primary transition-opacity hover:bg-accent hover:text-primary ${open ? "opacity-100" : "opacity-100"}`}
        aria-label="Group options"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <MenuPanel>
          {/* Also bound to Cmd/Ctrl+A while multi-select is on; shown here so
              the shortcut is discoverable rather than folklore. */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onSelectAll();
            }}
            disabled={allSelected}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <CheckSquare className="h-3 w-3" />
            Select All
            <kbd className="ml-auto text-[10px] font-medium text-muted-foreground">
              {modKeyLabel}A
            </kbd>
          </button>
          <div className="my-1 h-px bg-border" />
          {onShare && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onShare();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent"
            >
              <Share2 className="h-3 w-3" />
              Share Selected
            </button>
          )}
          {onDownload && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onDownload();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent"
            >
              <Download className="h-3 w-3" />
              Download Selected
            </button>
          )}
          {/* One removal, not two. Binning is reversible for thirty days, so
              there is no separate "delete" to offer beside it. */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onMoveToBin();
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive hover:bg-accent/50"
          >
            <Trash2 className="h-3 w-3" />
            Move Selected to Bin
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onCancel();
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent"
          >
            Cancel Selection
          </button>
        </MenuPanel>
      )}
    </div>
  );
}

function FileMenu({
  onEdit,
  onConvert,
  conversionDisabled,
  hasMarkdownCopy,
  onOpenMarkdown,
  onRename,
  onMoveToBin,
  folders = [],
  currentFolderId = null,
  onMoveToFolder,
  onAddToSplit,
  alreadyInSplit,
  onDownload,
  formats = ["original"],
  onShare,
  reordering,
  onToggleReorder,
  onSelectMode,
}: {
  /** Show this document in a column of its own, beside what is being read. */
  onAddToSplit?: () => void;
  /** Already has a column — the item says so rather than offering it twice. */
  alreadyInSplit?: boolean;
  /** Open this document in the editor. Absent for non-editable file types. */
  onEdit?: () => void;
  onConvert?: () => void;
  conversionDisabled?: boolean;
  hasMarkdownCopy?: boolean;
  onOpenMarkdown?: () => void;
  onRename: () => void;
  /**
   * Send the document to the Bin. Recoverable for 30 days, which is why this
   * replaced both "Archive" and "Delete" — two ways to make a file go away,
   * neither of which was reversible in an obvious place.
   */
  onMoveToBin: () => void;
  folders?: SidebarFolder[];
  currentFolderId?: string | null;
  onMoveToFolder?: (folderId: string | null) => void;
  /**
   * Write the document out in one of the offered formats.
   *
   * A format rather than a bare "download", because Word and PDF are the two
   * ways a document actually leaves this app and get the same reach as handing
   * back the original bytes did. `formats` says which ones this document can
   * produce — a spreadsheet the app only reads has no markdown to convert, so
   * it offers the original alone rather than three items that would fail.
   */
  onDownload?: (format: ExportFormat) => void;
  formats?: ExportFormat[];
  onShare?: () => void;
  reordering?: boolean;
  onToggleReorder?: () => void;
  onSelectMode?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Which flyout is open beside the menu, and the row it hangs off.
  const [submenu, setSubmenu] = useState<"move" | "export" | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Opening one flyout closes the other, and both close with the menu.
  const openFlyout = (which: "move" | "export") => (e: React.MouseEvent) => {
    e.stopPropagation();
    setAnchor(e.currentTarget as HTMLElement);
    setSubmenu((sub) => (sub === which ? null : which));
  };

  useEffect(() => {
    if (!open) {
      setSubmenu(null);
      setAnchor(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (isOutsideMenu(e.target as Node, rootRef.current)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative ml-0.5 flex shrink-0 items-center">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        /* From `md` up this reveals on hover, which on a touch tablet means it
           never reveals at all — every per-file action (edit, rename, share,
           remove) was unreachable there. `coarse:opacity-100` restores it, and
           the ::before pads the 24px glyph to a 44px target; growing the button
           itself would have re-flowed every row in the tree. */
        className={`relative flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground coarse:before:absolute coarse:before:-inset-2.5 coarse:before:content-[''] ${open ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100 coarse:opacity-100"}`}
        aria-label="Options"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <MenuPanel>
          {/* Working on the document itself. */}
          {onOpenMarkdown && (
            <MenuItem
              icon={FileText}
              label="Open Markdown copy"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onOpenMarkdown();
              }}
            />
          )}
          {onConvert && (
            <MenuItem
              icon={FileText}
              label={hasMarkdownCopy ? "Convert again" : "Convert to Markdown"}
              disabled={conversionDisabled}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onConvert();
              }}
            />
          )}
          {onEdit && (
            <MenuItem
              icon={SquarePen}
              label="Edit"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onEdit();
              }}
            />
          )}
          <MenuItem
            icon={Pencil}
            label="Rename"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onRename();
            }}
          />
          {onAddToSplit && (
            <MenuItem
              icon={Columns2}
              label={alreadyInSplit ? "Already in split view" : "Add to split view"}
              disabled={alreadyInSplit}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onAddToSplit();
              }}
            />
          )}
          {onMoveToFolder && folders.length > 0 && (
            <MenuItem
              icon={FolderInput}
              label="Move to folder"
              onClick={openFlyout("move")}
              trailing={<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
            />
          )}

          {/* Getting the document out of the app. Share and Download were two
              rows saying the same thing — "a copy, elsewhere" — so they share
              one flyout instead of two slots in the top-level list. */}
          {(onShare || onDownload) && (
            <>
              <MenuSeparator />
              <MenuItem
                icon={Upload}
                label="Export"
                onClick={openFlyout("export")}
                trailing={<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
              />
            </>
          )}

          {/* How the list behaves — not about this document at all, so it sits
              apart from the rows that are. */}
          {(onToggleReorder || onSelectMode) && <MenuSeparator />}
          {onToggleReorder && (
            <MenuItem
              icon={reordering ? Check : GripVertical}
              label={reordering ? "Done reordering" : "Reorder"}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onToggleReorder();
              }}
            />
          )}
          {onSelectMode && (
            <MenuItem
              icon={CheckSquare}
              label="Select"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onSelectMode();
              }}
            />
          )}

          <MenuSeparator />
          <MenuItem
            icon={Trash2}
            label="Move to Bin"
            destructive
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onMoveToBin();
            }}
          />
        </MenuPanel>
      )}

      {open && submenu === "move" && onMoveToFolder && (
        <MenuFlyout anchor={anchor}>
          <MenuItem
            icon={FileText}
            label="Top level"
            disabled={currentFolderId === null}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onMoveToFolder(null);
            }}
          />
          {folders.map((folder) => (
            <MenuItem
              key={folder.id}
              icon={Folder}
              label={folder.name}
              disabled={currentFolderId === folder.id}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onMoveToFolder(folder.id);
              }}
            />
          ))}
        </MenuFlyout>
      )}

      {open && submenu === "export" && (
        <MenuFlyout anchor={anchor}>
          {onShare && (
            <MenuItem
              icon={Share2}
              label="Share link"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onShare();
              }}
            />
          )}
          {/* One row per format rather than a single "Download" that always
              produced the source file. Word and PDF are what a document is
              usually wanted as; the original stays last for the cases where the
              bytes themselves are the point. */}
          {onDownload &&
            formats.map((format) => (
              <MenuItem
                key={format}
                icon={FORMAT_ICON[format]}
                label={FORMAT_LABEL[format]}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onDownload(format);
                }}
              />
            ))}
        </MenuFlyout>
      )}
    </div>
  );
}

/**
 * The shared look for every popover menu in the sidebar — a file row's
 * three-dots menu, a folder row's, and the `+` menu.
 *
 * Rows are a comfortable tap size with a full-size icon rather than the cramped
 * 12px glyphs these menus used to use, and related actions sit in groups
 * between separators instead of running together as one undifferentiated list.
 */
function MenuItem({
  icon: Icon,
  label,
  onClick,
  destructive,
  disabled,
  trailing,
  iconClassName,
}: {
  icon: LucideIcon;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Rendered at the end of the row — a chevron for a submenu, say. */
  trailing?: React.ReactNode;
  iconClassName?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent ${
        destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-accent"
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${iconClassName ?? ""}`} strokeWidth={1.5} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

/** Divider between groups of menu items. */
function MenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}

/**
 * A nested list that opens *beside* its parent menu rather than inside it.
 *
 * The folder list and the export actions used to unfold in place, pushing the
 * rest of the menu down and making a long list of folders scroll inside a panel
 * that was already a popover. A second panel alongside the first is how a menu
 * of menus behaves everywhere else, and it leaves the parent's own rows where
 * the reader left them.
 *
 * Positioned against the parent row: opening to the right, flipping to the left
 * when that would run off-screen, and pulled up when it would overhang the
 * bottom.
 */
function MenuFlyout({
  anchor,
  children,
}: {
  anchor: HTMLElement | null;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      if (!anchor) return;
      const box = anchor.getBoundingClientRect();
      let left = box.right + MENU_GAP;
      if (left + MENU_WIDTH > window.innerWidth - VIEWPORT_MARGIN) {
        left = box.left - MENU_WIDTH - MENU_GAP;
      }
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

      const height = panelRef.current?.offsetHeight ?? 0;
      let top = box.top;
      if (height && top + height > window.innerHeight - VIEWPORT_MARGIN) {
        top = Math.max(VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN - height);
      }
      setPos({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, children]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      // Same tag as MenuPanel: the click-away handler treats a click in here as
      // inside the menu, not outside it.
      data-sidebar-menu-panel
      className="fixed z-(--z-menu) max-h-[min(60vh,22rem)] w-56 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl"
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Shared shell for the sidebar's popover menus. */
const MENU_WIDTH = 224; // w-56
const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;

/**
 * True when a click landed outside both the menu root and its panel. `MenuPanel`
 * portals the panel to <body>, so it is no longer a DOM descendant of the root —
 * a plain `root.contains(target)` test would read every click on a menu item as
 * a click outside and close the menu before the item could fire.
 */
function isOutsideMenu(target: Node | null, root: HTMLElement | null) {
  if (!root || !target) return false;
  if (root.contains(target)) return false;
  return !(target instanceof Element && target.closest("[data-sidebar-menu-panel]"));
}

/**
 * Menus fly out to the *side* of their trigger rather than dropping below it:
 * dropped inside the sidebar column a panel covers the rows underneath, hiding
 * the very list the reader is working in. Opening beside the trigger puts the
 * panel over the content area and leaves the file list readable.
 *
 * It has to be portaled with fixed coordinates to do that. The file list is a
 * `overflow-y-auto` scroller, and a scroll container clips on *both* axes — an
 * absolutely positioned panel would be cut off at the sidebar's edge, which is
 * the very problem this is solving. Measuring the trigger and rendering to
 * <body> escapes the clip; the trade-off is that the panel must be repositioned
 * on scroll and resize rather than riding along with its anchor.
 */
function MenuPanel({
  align = "right",
  children,
}: {
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      // The anchor sits inside the menu root, so its parent chain reaches the
      // trigger's positioned wrapper — the box the panel aligns against.
      const anchor = anchorRef.current?.parentElement;
      if (!anchor) return;
      const box = anchor.getBoundingClientRect();

      // Open toward `align`, flipping to the other side only when that would
      // run past the viewport edge.
      let left = align === "right" ? box.right + MENU_GAP : box.left - MENU_WIDTH - MENU_GAP;
      if (left + MENU_WIDTH > window.innerWidth - VIEWPORT_MARGIN)
        left = box.left - MENU_WIDTH - MENU_GAP;
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

      // Top-aligned with the trigger, pulled up if the panel would overhang the
      // bottom of the screen.
      const height = panelRef.current?.offsetHeight ?? 0;
      let top = box.top;
      if (height && top + height > window.innerHeight - VIEWPORT_MARGIN)
        top = Math.max(VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN - height);

      setPos({ top, left });
    };
    place();
    // `true` catches scrolling in the sidebar's own scroller, not just the page.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [align, children]);

  return (
    <>
      {/* Zero-size marker left in the menu root so the portaled panel can measure it. */}
      <span ref={anchorRef} className="hidden" aria-hidden />
      {typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            // Tagged so each menu's click-away handler can tell a click on its
            // own portaled panel from a genuine click outside the menu.
            data-sidebar-menu-panel
            className="fixed z-(--z-menu) w-56 rounded-xl border border-border bg-popover p-1.5 shadow-xl"
            style={{
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              // Measured before it is placed; hidden for that first frame so it
              // never flashes in the corner.
              visibility: pos ? "visible" : "hidden",
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * The `+` menu: the three ways to add to a workspace. Shared by the expanded
 * sidebar's list header and the collapsed rail, so both offer the same options.
 */
export function AddMenu({
  onCreateFile,
  onCreateMermaid,
  onCreateBoard,
  onCreateFolder,
  onUpload,
  align = "right",
  className,
  buttonClassName,
}: {
  onCreateFile?: () => void;
  onCreateMermaid?: () => void;
  onCreateBoard?: () => void;
  onCreateFolder?: () => void;
  onUpload: () => void;
  align?: "left" | "right";
  className?: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (isOutsideMenu(e.target as Node, rootRef.current)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className ?? ""}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Add to workspace"
        title="Add to workspace"
        className={
          buttonClassName ??
          "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground coarse:h-11 coarse:w-11"
        }
      >
        <Plus className="h-4 w-4" />
      </button>

      {open && (
        <MenuPanel align={align}>
          {onCreateFile && (
            <MenuItem
              icon={FilePlus}
              label="New file"
              onClick={() => {
                setOpen(false);
                onCreateFile();
              }}
            />
          )}
          {onCreateBoard && (
            <MenuItem
              icon={PenTool}
              label="New board"
              onClick={() => {
                setOpen(false);
                onCreateBoard();
              }}
            />
          )}
          {onCreateFolder && (
            <MenuItem
              icon={FolderPlus}
              label="New folder"
              onClick={() => {
                setOpen(false);
                onCreateFolder();
              }}
            />
          )}
          <MenuItem
            icon={Upload}
            label="Upload files"
            onClick={() => {
              setOpen(false);
              onUpload();
            }}
          />
        </MenuPanel>
      )}
    </div>
  );
}

/** Three-dots menu on a folder row: create inside it, rename it, delete it. */
function FolderMenu({
  onNewFile,
  onNewMermaid,
  onNewBoard,
  onNewFolder,
  onRename,
  onDelete,
}: {
  onNewFile?: () => void;
  onNewMermaid?: () => void;
  onNewBoard?: () => void;
  onNewFolder?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (isOutsideMenu(e.target as Node, rootRef.current)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = (label: string, Icon: LucideIcon, run: () => void, destructive = false) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setOpen(false);
        run();
      }}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent ${
        destructive ? "text-destructive hover:bg-accent/50" : "text-foreground"
      }`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );

  return (
    <div ref={rootRef} className="relative ml-0.5 flex shrink-0 items-center">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground md:opacity-0 md:group-hover:opacity-100"
        aria-label="Folder options"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <MenuPanel>
          {onNewFile && item("New File here", FilePlus, onNewFile)}
          {onNewBoard && item("New Board here", PenTool, onNewBoard)}
          {onNewFolder && item("New Folder", FolderPlus, onNewFolder)}
          {(onNewFile || onNewBoard || onNewFolder) && (onRename || onDelete) && (
            <div className="my-1 h-px bg-border" />
          )}
          {onRename && item("Rename folder", Pencil, onRename)}
          {onDelete && item("Delete folder", Trash2, onDelete, true)}
        </MenuPanel>
      )}
    </div>
  );
}
