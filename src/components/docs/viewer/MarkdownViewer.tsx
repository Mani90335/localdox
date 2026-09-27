import { toast } from "sonner";
import { MarkdownMedia } from "./MarkdownMedia";
import {
  remarkMedia,
  mediaKind,
  mediaUrlTransform,
  parseMediaSpec,
} from "@/lib/markdown/markdown-media";
import { isLocalReference } from "@/lib/markdown/media-references";
import type { FolderRecord } from "@/lib/workspace/persistence";
import { ResizableMarkdownTable } from "./ResizableMarkdownTable";
import {
  remarkConvertedHtml,
  convertedAnchorMap,
  convertedFootnotes,
  ConvertedRemoteImage,
} from "@/services/doc-conversion";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";

// Keep parsing outside updates to menus, selection labels and reader chrome.
// Context consumers (saved blocks and heading controls) still update normally.
const MarkdownContent = memo(ReactMarkdown);
import { useMarkdownPlugins } from "@/lib/markdown/markdown-plugins";
import {
  Check,
  Copy,
  Link2,
  ArrowLeft,
  ArrowRight,
  Clock,
  Pencil,
  Eye,
  Info,
  AlertTriangle,
  Lightbulb,
  AlertOctagon,
  StickyNote,
  Tag,
  Trash2,
  X,
  ScrollText,
  Files,
  Sparkles,
  BookOpen,
  Star,
  Share,
  MoreHorizontal,
  Search,
  Crosshair,
  Code2,
  Download,
  Expand,
  Minimize2,
  ChevronDown,
  FileText,
} from "lucide-react";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import type { ReadingMode } from "@/lib/workspace/persistence";
import { slugify } from "@/lib/markdown/markdown-utils";
import { MermaidBlock } from "@/services/diagrams";
import { SaveActionContext } from "../editor/save-action";
import { MindMapBlock } from "@/services/mindmap";
import { JsonTree } from "./JsonTree";
import { ReadingProgress } from "../navigation/ReadingProgress";
import { MarkdownEditor, type MarkdownEditorHandle } from "../editor/MarkdownEditor";
import { detectEmbed, EmbedFrame, isVideoUrl, VideoPlayer } from "@/lib/markdown/media-embeds";
import { Lightbox } from "./Lightbox";
import { HL_COLORS, hlGroup, type Highlight } from "@/lib/markdown/dom-highlighter";
import {
  getSelectionOffsets,
  buildRange,
  offsetFromPoint,
  firstTextRange,
  releaseTextIndex,
  contextAround,
  findAnchor,
  nodeOffsets,
  sameQuote,
  textBetween,
} from "@/lib/markdown/text-offsets";
import {
  findSaved,
  savedExcerpt,
  type SavedBlockType,
  type SavedDraft,
  type SavedItem,
} from "@/lib/workspace/saved-items";
import { locateInSource, sourceLinesForSelection } from "@/lib/markdown/source-locate";
import { copyText } from "@/lib/workspace/share";
import {
  fileSubtopics,
  headingChunkMap,
  readingMinutes,
  wordCount,
} from "@/lib/markdown/markdown-utils";
import { InlineArtifact } from "./InlineArtifact";
import { InteractiveBlock } from "./InteractiveBlock";
import {
  artifactReference,
  isArtifactUrl,
  prepareWorkspaceEmbeds,
} from "@/lib/workspace/workspace-artifacts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ViewerHeader, ViewerPager } from "../navigation/ViewerHeader";
import { ExportMenu } from "@/services/markdown-export/ExportMenu";
import { ESCAPE_DEPTH, useNavEscape } from "@/hooks/use-nav-history";

interface Props {
  file: MdFile;
  prevFile: MdFile | null;
  nextFile: MdFile | null;
  onNav: (fileId: string, subtopicId: string | null) => void;
  activeSubtopicId: string | null;
  highlightQuery: string | null;
  onContentChange: (fileId: string, content: string) => void;
  /**
   * Reports whether the open editor holds changes that leaving would discard.
   *
   * The viewer cannot veto a switch on its own — by the time a new `file` prop
   * arrives the parent has already moved — so the parent keeps this flag and
   * asks before it navigates.
   */
  onEditorDirtyChange?: (dirty: boolean) => void;
  /**
   * Id of a file that should open straight in the editor — a document the
   * reader just created from the sidebar, so pasting markdown is the first
   * thing they can do. Cleared through `onStartInEditConsumed` once honoured.
   */
  startInEditFileId?: string | null;
  onStartInEditConsumed?: () => void;
  nextReadingMin: number | null;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  highlights: Highlight[];
  onAddHighlight: (hl: Omit<Highlight, "id" | "fileId">) => void;
  onUpdateHighlight: (id: string, patch: Partial<Pick<Highlight, "color" | "label">>) => void;
  onRemoveHighlight: (id: string) => void;
  /**
   * Corrected anchors, found while painting: the document was edited and these
   * highlights had to be re-located. Persisted, but not as an undoable step.
   */
  onRepairHighlights?: (patches: Array<{ id: string; patch: Partial<Highlight> }>) => void;
  /** Saved items (stars) for this file. */
  saved?: SavedItem[];
  /** Star or unstar a section or a block (table, code fence, quote, image). */
  onToggleSaved?: (draft: SavedDraft) => void;
  onRemoveSaved?: (id: string) => void;
  /**
   * A saved item the reader just opened from the Saved list: scroll to it and
   * flash it once, then call `onSavedShown` so it isn't replayed on re-render.
   */
  pendingSaved?: SavedItem | null;
  onSavedShown?: () => void;
  /**
   * A search hit the reader just opened from the palette: the line it matched,
   * and the query that found it. Scroll to that passage and flash it, then call
   * `onSearchShown` so it isn't replayed on re-render.
   *
   * Selecting a hit used to move only as far as the heading above it — and when
   * the hit's heading id didn't survive per-page rendering (repeated heading
   * text is slugged against the whole document, but each page is slugged on its
   * own) not even that far, leaving the reader at the top of the page with the
   * match somewhere below the fold.
   */
  pendingSearch?: { text: string; query: string } | null;
  onSearchShown?: () => void;
  onHome?: () => void;
  workspaceId?: string | null;
  workspaceRevision?: string;
  workspaceFiles?: MdFile[];
  workspaceName?: string;
  workspaceFolders?: FolderRecord[];
  mathPreferences?: import("@/services/math").MathPreferences;
  onImportAttachments?: (files: File[]) => Promise<MdFile[]>;
  onOpenArtifact?: (fileId: string, workspaceId: string) => void;
  /** Opens the workspace command palette from the header's search field. */
  onOpenPalette?: () => void;
  onRemoveFile?: () => void;
  /**
   * Rename the open document, offered as a field above the source while the
   * editor is open. Omitted where the viewer is read-only.
   */
  onRenameFile?: (name: string) => void;
  /** Copy a share link to this one file. Hidden when omitted. */
  onShareFile?: () => void;
  readingMode?: ReadingMode;
  onToggleReadingMode?: () => void;
  /** Percentage of the available width the reading/editing column takes up. */
  contentWidth?: number;
  /** Open the Ask AI panel prefilled from the current selection. */
  onAskAi?: (prefill: { selection: string; actionId?: string }) => void;
}

const stripExt = (name: string) => name.replace(/\.(md|markdown|mdx|txt)$/i, "");

/** The element a range starts in, which is what actually scrolls. */
const elementOf = (range: Range | null) =>
  range
    ? ((range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as HTMLElement)
        : range.startContainer.parentElement) ?? null)
    : null;

/** How long a jumped-to passage stays lit. */
const FLASH_MS = 1800;

/**
 * The CSS Custom Highlight API, as much of it as is needed here and only where
 * the browser has it. Typed locally because it is still absent from the DOM
 * lib this project builds against.
 */
type HighlightRegistry = Map<string, object> | undefined;
const highlightRegistry = (): HighlightRegistry =>
  typeof CSS !== "undefined"
    ? (CSS as unknown as { highlights?: Map<string, object> }).highlights
    : undefined;

/**
 * Flash a passage once, so that arriving somewhere is visible and not merely
 * true. Shared by the saved-item jump and the search jump.
 *
 * A text range gets a one-shot custom highlight, which can span elements; a
 * heading or an image, which arrive without a range, get the equivalent
 * class-based pulse.
 */
function flashPassage(range: Range | null, target: HTMLElement | null) {
  const registry = highlightRegistry();
  const HighlightCtor = (globalThis as { Highlight?: new (...ranges: Range[]) => object })
    .Highlight;
  let clear: (() => void) | undefined;
  if (range && registry && HighlightCtor) {
    registry.set("dc-saved-flash", new HighlightCtor(range));
    clear = () => void registry.delete("dc-saved-flash");
  } else if (target) {
    target.classList.add("docs-saved-flash");
    clear = () => target.classList.remove("docs-saved-flash");
  }
  if (clear) setTimeout(clear, FLASH_MS);
}

/**
 * Viewer-specific remark passes, held at module scope so the array identity is
 * stable. Rebuilding it per render would make react-markdown re-parse the whole
 * document every time this component re-renders for any other reason.
 */
const EXTRA_REMARK_PLUGINS = [remarkInteractiveBlockMeta, remarkMedia];

/**
 * Star affordances live deep inside the rendered markdown (a heading, a table,
 * a code block), far from the state that knows what is starred. They read it
 * through this context rather than through props so that saving something
 * re-renders the stars alone — passing `saved` into the `components` memo would
 * rebuild every renderer and re-render the whole document on each star.
 */
interface SavedContextValue {
  /** The element offsets are measured against (the rendered page). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Page the reader is on; undefined in single-page mode (whole-doc offsets). */
  subtopicId?: string;
  isSaved: (probe: {
    kind: SavedItem["kind"];
    headingId?: string;
    text?: string;
  }) => SavedItem | undefined;
  toggle: (draft: SavedDraft) => void;
  remove: (id: string) => void;
  enabled: boolean;
  /**
   * Changes when the rendered markdown does. `SavableBlock` reads its own
   * `textContent` to know what it would save, and that read walks the block's
   * whole subtree — it must happen when the document changes, not on every
   * render of every block.
   */
  revision: string;
}

const SavedContext = createContext<SavedContextValue | null>(null);

/**
 * Which sections the reader has wrapped up, shared between a heading and the
 * content beneath it.
 *
 * Collapsing is a property of the rendered document rather than of any one
 * element: the heading owns the control, but what it hides is its *siblings*,
 * up to the next heading of the same or higher rank. Both sides read this.
 */
interface CollapseContextValue {
  isCollapsed: (headingId: string) => boolean;
  toggle: (headingId: string) => void;
}
const CollapseContext = createContext<CollapseContextValue | null>(null);

function MarkdownViewerImpl({
  file,
  prevFile,
  nextFile,
  onNav,
  activeSubtopicId,
  highlightQuery,
  onContentChange,
  onEditorDirtyChange,
  startInEditFileId,
  onStartInEditConsumed,
  nextReadingMin,
  isBookmarked,
  onToggleBookmark,
  highlights,
  onAddHighlight,
  onUpdateHighlight,
  onRemoveHighlight,
  onRepairHighlights,
  saved = [],
  onToggleSaved,
  onRemoveSaved,
  pendingSaved,
  onSavedShown,
  pendingSearch,
  onSearchShown,
  onHome,
  workspaceId,
  workspaceRevision,
  workspaceFiles,
  workspaceName,
  workspaceFolders,
  onImportAttachments,
  onOpenArtifact,
  onOpenPalette,
  onRemoveFile,
  onRenameFile,
  onShareFile,
  readingMode = "paginated",
  onToggleReadingMode,
  contentWidth = 50,
  onAskAi,
}: Props) {
  const singleMode = readingMode === "single";
  const containerRef = useRef<HTMLDivElement>(null);
  const [editMode, setEditMode] = useState(false);
  // The draft text itself lives inside <MarkdownEditor>. Only the source the
  // editor opened with is kept here, so Cancel can put it back.
  const originalContentRef = useRef(file.content);

  // The editor hands back the id of the document the text was typed into. It is
  // not necessarily `file.id`: a save can arrive while the reader is switching
  // files, and routing it by the now-current file would overwrite the document
  // they just opened with the draft from the one they left.
  const saveDraft = useCallback(
    (fileId: string, content: string) => onContentChange(fileId, content),
    [onContentChange],
  );
  const leaveEditMode = useCallback(
    (cursorIndex?: number, content?: string) => {
      setEditMode(false);
      if (cursorIndex !== undefined) {
        const chunks = fileSubtopics(
          content === undefined ? file : { ...file, content, subtopics: undefined },
        );
        if (chunks.length > 0) {
          let currentLength = 0;
          let targetChunk = chunks[chunks.length - 1];
          for (const chunk of chunks) {
            if (
              cursorIndex >= currentLength &&
              cursorIndex <= currentLength + chunk.content.length
            ) {
              targetChunk = chunk;
              break;
            }
            currentLength += chunk.content.length + 1;
          }
          if (singleMode) {
            setTimeout(() => {
              const el = document.getElementById(targetChunk.id);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 100);
          } else {
            onNav(file.id, targetChunk.id);
          }
        }
      }
    },
    [file, singleMode, onNav],
  );
  const cancelEdit = useCallback(
    (cursorIndex?: number) => {
      onContentChange(file.id, originalContentRef.current);
      setEditMode(false);
      if (cursorIndex !== undefined) {
        const chunks = fileSubtopics(file);
        if (chunks.length > 0) {
          let currentLength = 0;
          let targetChunk = chunks[0];
          for (const chunk of chunks) {
            if (
              cursorIndex >= currentLength &&
              cursorIndex <= currentLength + chunk.content.length
            ) {
              targetChunk = chunk;
              break;
            }
            currentLength += chunk.content.length + 1;
          }
          if (singleMode) {
            setTimeout(() => {
              const el = document.getElementById(targetChunk.id);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 100);
          } else {
            onNav(file.id, targetChunk.id);
          }
        }
      }
    },
    [onContentChange, file.id, file, singleMode, onNav],
  );
  /**
   * Snapshot the source Cancel restores, every time the editor opens.
   *
   * This used to be captured only on a document switch (and by a header button
   * that no longer exists), which quietly made Cancel destructive: autosave
   * writes the draft into `file.content` as you type, so a *second* editing
   * session on the same document still held the text from when the document
   * was first opened. Cancelling that session reverted the document past the
   * work the first session had already saved.
   *
   * Read through a ref rather than a dependency so the snapshot is taken on the
   * transition into the editor and never refreshed by autosave afterwards.
   */
  const liveContentRef = useRef(file.content);
  liveContentRef.current = file.content;
  useEffect(() => {
    if (editMode) originalContentRef.current = liveContentRef.current;
  }, [editMode]);

  const [exporting, setExporting] = useState(false);
  const exportHTML = useCallback(async () => {
    setExporting(true);
    try {
      const { downloadMarkdownHTML } = await import("@/services/markdown-export/media-bundle");
      await downloadMarkdownHTML(file, {
        workspaceId,
        workspaceRevision,
        workspaceFiles,
        workspaceFolders,
        workspaceName,
        sourceFile: file,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export this document.");
    } finally {
      setExporting(false);
    }
  }, [file, workspaceId, workspaceRevision, workspaceFiles, workspaceFolders, workspaceName]);

  // Back leaves the editor. Autosave has already written the draft, so this
  // drops nothing the reader typed.
  useNavEscape(editMode, () => setEditMode(false), ESCAPE_DEPTH.mode);

  const allChunks = useMemo(() => fileSubtopics(file), [file.subtopics, file.content, file.name]);

  // A selected heading may be a nested ##/### that lives inside a # page rather
  // than being a page itself; resolve it to its parent # chunk id.
  const anchorPrefix = `localdox-converted-${encodeURIComponent(file.id)}-`;
  const convertedAnchors = useMemo(
    () =>
      file.derivedFrom
        ? convertedAnchorMap(allChunks, anchorPrefix)
        : ({ owners: {}, targets: {} } as ReturnType<typeof convertedAnchorMap>),
    [allChunks, anchorPrefix, file.derivedFrom],
  );
  const chunkForHeading = useMemo(
    () => ({ ...headingChunkMap(file.content), ...convertedAnchors.owners }),
    [file.content, convertedAnchors],
  );

  const activeChunk = useMemo(() => {
    const targetId = (activeSubtopicId && chunkForHeading[activeSubtopicId]) || activeSubtopicId;
    return (
      allChunks.find((s) => s.id === targetId) ||
      allChunks[0] || { id: "preamble", title: stripExt(file.name), content: file.content }
    );
  }, [allChunks, activeSubtopicId, chunkForHeading, file.content, file.name]);

  // Section ids are slugged from headings, so editing a heading renames them.
  // Highlights pointing at an id that no longer exists aren't lost — they're
  // re-anchored by text and re-homed to whichever page now holds that text.
  const knownChunkIds = useMemo(() => new Set(allChunks.map((c) => c.id)), [allChunks]);

  const chunkIndex = allChunks.findIndex((s) => s.id === activeChunk.id);
  const isLastChunk = chunkIndex === allChunks.length - 1;
  const prevChunk = chunkIndex > 0 ? allChunks[chunkIndex - 1] : null;
  const nextChunk =
    chunkIndex >= 0 && chunkIndex < allChunks.length - 1 ? allChunks[chunkIndex + 1] : null;

  const renderContent = useMemo(() => {
    let content = activeChunk.content.replace(/^\s*(#{1,6})\s+[^\n]+(\n|$)/, "");

    // Strip leading horizontal rules (often left over when users separate sections with ---)
    while (true) {
      const next = content.replace(/^\s*(?:[-*_][ \t]*){3,}(?:\r?\n|$)/, "");
      if (next === content) break;
      content = next;
    }

    // Strip trailing horizontal rules
    while (true) {
      const next = content.replace(/(?:\r?\n|^)\s*(?:[-*_][ \t]*){3,}\s*$/, "");
      if (next === content) break;
      content = next;
    }

    return prepareWorkspaceEmbeds(content);
  }, [activeChunk.content]);

  // Single-page mode renders the whole document at once. Content is left intact
  // so every heading keeps its anchor id for in-page section navigation.
  const fullRender = useMemo(() => {
    return prepareWorkspaceEmbeds(file.content);
  }, [file.content]);

  // The markdown actually handed to the renderer. Resolved once here so the
  // plugin hook and the renderer never disagree about which text is on screen.
  const footnoteDefinitions = useMemo(
    () => (file.derivedFrom ? convertedFootnotes(file.content) : ""),
    [file.derivedFrom, file.content],
  );
  const markdownSource = singleMode
    ? fullRender
    : renderContent + (footnoteDefinitions ? "\n\n" + footnoteDefinitions : "");

  // Syntax highlighting and math typesetting are fetched only for documents
  // that contain code or math — see `useMarkdownPlugins`. Both plugin arrays
  // are memoized, because a fresh array identity makes react-markdown re-parse.
  const extraPlugins = useMemo(
    () =>
      file.derivedFrom
        ? [...EXTRA_REMARK_PLUGINS, [remarkConvertedHtml, { prefix: anchorPrefix }]]
        : EXTRA_REMARK_PLUGINS,
    [file.derivedFrom, anchorPrefix],
  );
  const { remarkPlugins, rehypePlugins } = useMarkdownPlugins(markdownSource, extraPlugins);

  const [lightbox, setLightbox] = useState<{ src: string; alt?: string } | null>(null);

  // Highlight menu: "create" from a fresh selection, or "edit" from clicking an
  // existing highlight. A single popover serves both. Detached from the live
  // Selection so typing a label doesn't dismiss it.
  const contentRef = useRef<HTMLDivElement>(null);
  type HlMenu =
    | {
        mode: "create";
        text: string;
        start: number;
        end: number;
        prefix: string;
        suffix: string;
        x: number;
        y: number;
        label: string;
      }
    | { mode: "edit"; hl: Highlight; x: number; y: number; label: string };
  const [menu, setMenu] = useState<HlMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openCreateMenu = (at?: { x: number; y: number }) => {
    // Offsets are relative to whatever is rendered in contentRef: the active
    // section in paged mode, the whole document in single mode. Both work.
    if (editMode || !contentRef.current) return;
    const sel = getSelectionOffsets(contentRef.current);
    if (!sel) return;
    const range = window.getSelection()?.getRangeAt(0);
    const r = range?.getBoundingClientRect();
    // Captured now, while the offsets are still true: the surrounding text is
    // what lets the highlight find itself again after the document is edited.
    const ctx = contextAround(contentRef.current, sel.start, sel.end);
    setMenu({
      mode: "create",
      text: sel.text,
      start: sel.start,
      end: sel.end,
      prefix: ctx.prefix,
      suffix: ctx.suffix,
      x: at ? at.x : r ? r.left + r.width / 2 : window.innerWidth / 2,
      y: at ? at.y : r ? r.top : 120,
      label: "",
    });
  };

  const openEditMenu = (hl: Highlight, x: number, y: number) => {
    setMenu({ mode: "edit", hl, x, y, label: hl.label ?? "" });
  };

  // ---- saved items (stars) ----
  //
  // Offsets are measured against whatever `contentRef` renders: the active
  // section in paged mode, the whole document in single mode. A section-scoped
  // item records which page it came from so the two spaces never mix — the same
  // rule persistent highlights follow.
  const savedSubtopicId = singleMode ? undefined : activeChunk.id;
  // Sections the reader has wrapped up, by heading id. Cleared on a document
  // switch: the ids belong to the document that was open.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  useEffect(() => setCollapsedSections(new Set()), [file.id]);

  const collapseCtx = useMemo<CollapseContextValue>(
    () => ({
      isCollapsed: (headingId) => collapsedSections.has(headingId),
      toggle: (headingId) =>
        setCollapsedSections((previous) => {
          const next = new Set(previous);
          if (next.has(headingId)) next.delete(headingId);
          else next.add(headingId);
          return next;
        }),
    }),
    [collapsedSections],
  );

  const savedCtx = useMemo<SavedContextValue>(
    () => ({
      containerRef: contentRef,
      subtopicId: savedSubtopicId,
      enabled: !!onToggleSaved && !editMode,
      isSaved: (probe) => findSaved(saved, { fileId: file.id, ...probe }),
      toggle: (draft) => onToggleSaved?.(draft),
      remove: (id) => onRemoveSaved?.(id),
      revision: markdownSource,
    }),
    [saved, savedSubtopicId, onToggleSaved, onRemoveSaved, editMode, file.id, markdownSource],
  );

  // Opening a saved item from the Saved list: once the target page is rendered,
  // scroll to the passage and flash it. Anchored by quote first (the document
  // may have been edited since it was saved), by stored offsets only as a hint.
  useEffect(() => {
    if (!pendingSaved || editMode) return;
    const container = contentRef.current;
    if (!container) return;

    const frame = requestAnimationFrame(() => {
      const heading = pendingSaved.headingId
        ? (document.getElementById(pendingSaved.headingId) as HTMLElement | null)
        : null;
      const image = pendingSaved.blockSrc
        ? container.querySelector<HTMLElement>(`img[src="${CSS.escape(pendingSaved.blockSrc)}"]`)
        : null;

      let range: Range | null = null;
      if (!heading && !image && pendingSaved.text) {
        const anchor = findAnchor(
          container,
          pendingSaved.text,
          pendingSaved.prefix,
          pendingSaved.suffix,
          pendingSaved.start,
        );
        range = anchor ? buildRange(container, anchor.start, anchor.end) : null;
        if (!range) range = firstTextRange(container, pendingSaved.text);
      }

      const target =
        heading ??
        image ??
        (range
          ? ((range.startContainer.nodeType === Node.ELEMENT_NODE
              ? (range.startContainer as HTMLElement)
              : range.startContainer.parentElement) ?? null)
          : null);
      target?.scrollIntoView({ behavior: "smooth", block: heading ? "start" : "center" });
      flashPassage(range, target);

      onSavedShown?.();
    });

    return () => cancelAnimationFrame(frame);
  }, [pendingSaved, editMode, renderContent, fullRender, onSavedShown]);

  // "Inspect" — the reader's answer to DevTools' inspect element. Take the
  // rendered text under the pointer, find where it lives in the markdown
  // source, and drop the editor's caret on it, selected and scrolled into view.
  const editorRef = useRef<MarkdownEditorHandle>(null);
  // Whether the open editor holds changes that leaving would throw away.
  const [editorDirty, setEditorDirty] = useState(false);

  /**
   * Stop a document switch from silently throwing away an open draft.
   *
   * The editor autosaves, so most navigation is safe — but a draft typed inside
   * the debounce window, or one the reader is midway through and does not want,
   * has no other moment to be asked about. Only a genuinely changed draft
   * prompts: leaving an untouched editor stays silent, which is what makes the
   * prompt mean something when it does appear.
   */
  const editorDirtyRef = useRef(false);
  editorDirtyRef.current = editorDirty;

  // Published upwards, where navigation can act on it. Held in a ref so an
  // inline callback from the parent doesn't re-fire this on every render.
  const onEditorDirtyChangeRef = useRef(onEditorDirtyChange);
  onEditorDirtyChangeRef.current = onEditorDirtyChange;
  useEffect(() => {
    onEditorDirtyChangeRef.current?.(editorDirty);
  }, [editorDirty]);
  // Unmounting the viewer ends any unsaved state it was reporting.
  useEffect(() => {
    return () => onEditorDirtyChangeRef.current?.(false);
  }, []);
  const confirmLeaveEditor = useCallback(() => {
    if (!editorDirtyRef.current) return true;
    return window.confirm("This document has unsaved changes. Leave and discard them?");
  }, []);
  const [pendingSelect, setPendingSelect] = useState<{ start: number; end: number } | null>(null);
  const [inspectMissed, setInspectMissed] = useState(false);

  const inspect = (text: string) => {
    // Paged mode renders one section, so prefer a match inside that section —
    // a phrase repeated elsewhere shouldn't hijack the jump.
    const chunkStart = singleMode ? -1 : file.content.indexOf(activeChunk.content);
    const prefer =
      chunkStart >= 0 && !singleMode
        ? { from: chunkStart, to: chunkStart + activeChunk.content.length }
        : undefined;
    const span = locateInSource(file.content, text, prefer);

    setMenu(null);
    window.getSelection()?.removeAllRanges();
    setInspectMissed(!span);
    setEditMode(true);
    setPendingSelect(span ?? { start: Math.max(0, chunkStart), end: Math.max(0, chunkStart) });
  };

  const copySource = (text: string) => {
    // Like Inspect, prefer the section currently on screen so repeated prose
    // resolves to the source the reader actually highlighted.
    const chunkStart = singleMode ? -1 : file.content.indexOf(activeChunk.content);
    const prefer =
      chunkStart >= 0 && !singleMode
        ? { from: chunkStart, to: chunkStart + activeChunk.content.length }
        : undefined;
    const source = sourceLinesForSelection(file.content, text, prefer) ?? text;
    void copyText(source);
    window.getSelection()?.removeAllRanges();
    setMenu(null);
  };

  // Applied once the editor has mounted with the document's source.
  useEffect(() => {
    if (!pendingSelect || !editMode) return;
    const { start, end } = pendingSelect;
    setPendingSelect(null);
    editorRef.current?.select(start, end);
  }, [pendingSelect, editMode]);

  // The "couldn't find it" notice is per-jump, not sticky.
  useEffect(() => {
    if (!inspectMissed) return;
    const t = setTimeout(() => setInspectMissed(false), 6000);
    return () => clearTimeout(t);
  }, [inspectMissed]);

  // Right-click behaves like DevTools: it acts on what's under the pointer.
  // With nothing selected, select the block being pointed at first, so the
  // popover (and Inspect) has something concrete to work with.
  const onContextMenu = (e: React.MouseEvent) => {
    if (editMode || !contentRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      const el = (e.target as HTMLElement)?.closest(
        "p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre, figcaption",
      );
      if (!el || !contentRef.current.contains(el)) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    e.preventDefault();
    openCreateMenu({ x: e.clientX, y: e.clientY });
  };

  // Paint persistent highlights with the CSS Custom Highlight API — no DOM
  // mutation, so React re-renders never wipe them and cross-node selections
  // highlight correctly. Groups map to ::highlight(dc-hl-N) rules in the CSS.
  useEffect(() => {
    const container = contentRef.current;
    const CSSH = (typeof CSS !== "undefined" && (CSS as any).highlights) as
      Map<string, any> | undefined;
    if (!container || !CSSH || typeof (window as any).Highlight === "undefined") return;
    // Mid-edit the rendered document is a moving target (the draft autosaves
    // every 400ms). Re-anchoring waits for the reader to leave the editor.
    if (editMode) return;

    // Deferred to the next frame so adding a highlight doesn't repaint every
    // other one synchronously inside the same commit the reader is watching.
    const frame = requestAnimationFrame(() => {
      const groups: Record<string, Range[]> = {};
      // Corrections found along the way, written back once at the end.
      const repairs: Array<{ id: string; patch: Partial<Highlight> }> = [];

      for (const hl of highlights) {
        // Which highlights this container can show, and whether its offsets are
        // measured in the same space as the stored ones. Section highlights
        // carry offsets relative to their section, meaningless in the whole-doc
        // render; whole-doc highlights are the reverse.
        const sectionExists = !hl.subtopicId || knownChunkIds.has(hl.subtopicId);
        let owned: boolean;
        if (singleMode) {
          owned = !hl.subtopicId;
        } else {
          // A stale subtopicId means the heading it was slugged from was edited.
          // Rather than dropping the highlight, let the current page try to
          // re-anchor it by text and adopt it if the text is here.
          if (sectionExists && hl.subtopicId !== activeChunk.id) continue;
          owned = hl.subtopicId === activeChunk.id;
        }

        // Fast path: the stored offsets still cover the stored text.
        let range: Range | null = null;
        if (owned && typeof hl.start === "number" && typeof hl.end === "number") {
          const at = buildRange(container, hl.start, hl.end);
          if (at && !at.collapsed && sameQuote(textBetween(container, hl.start, hl.end), hl.text)) {
            range = at;
          }
        }

        // The document moved under the highlight (an edit above it, a rewritten
        // passage, a renamed section). Find the passage again by its text.
        if (!range) {
          const anchor = findAnchor(container, hl.text, hl.prefix, hl.suffix, hl.start);
          if (anchor) {
            range = buildRange(container, anchor.start, anchor.end);
            // Only persist offsets measured in this highlight's own space —
            // writing whole-doc offsets onto a section highlight (or the
            // reverse) would corrupt it for the other reading mode.
            if (range && !range.collapsed && (owned || !sectionExists)) {
              repairs.push({
                id: hl.id,
                patch: {
                  start: anchor.start,
                  end: anchor.end,
                  ...contextAround(container, anchor.start, anchor.end),
                  ...(sectionExists
                    ? null
                    : { subtopicId: singleMode ? undefined : activeChunk.id }),
                  ...(hl.orphaned ? { orphaned: false } : null),
                },
              });
            }
          }
          // Legacy highlights stored before offsets existed: first match wins,
          // as before.
          if (!range) range = firstTextRange(container, hl.text);
        }

        if (!range || range.collapsed) {
          // Not on this page. Only call it gone once the markdown source itself
          // no longer contains the text — in paginated mode the page on screen
          // says nothing about the rest of the document. Flagged, never
          // deleted: an edit must not destroy a reader's note.
          if (!hl.orphaned && !locateInSource(file.content, hl.text)) {
            repairs.push({ id: hl.id, patch: { orphaned: true } });
          }
          continue;
        }
        if (hl.orphaned && !repairs.some((r) => r.id === hl.id)) {
          repairs.push({ id: hl.id, patch: { orphaned: false } });
        }
        const g = hlGroup(hl.color);
        (groups[g] ||= []).push(range);
      }

      HL_COLORS.forEach((c) => CSSH.delete(hlGroup(c)));
      for (const [g, ranges] of Object.entries(groups)) {
        CSSH.set(g, new (window as any).Highlight(...ranges));
      }

      // Re-runs this effect, which then takes the fast path for every repaired
      // highlight and produces no further repairs.
      if (repairs.length) onRepairHighlights?.(repairs);
    });

    return () => {
      cancelAnimationFrame(frame);
      HL_COLORS.forEach((c) => CSSH.delete(hlGroup(c)));
    };
  }, [
    highlights,
    activeChunk.id,
    renderContent,
    fullRender,
    editMode,
    singleMode,
    knownChunkIds,
    file.content,
    onRepairHighlights,
  ]);

  // The offset index outlives this component's containers; drop it on unmount
  // so a stale document can't keep its text nodes (or its observer) alive.
  useEffect(() => releaseTextIndex, []);

  // Click inside the content: if the click lands on an existing highlight, open
  // its edit popover (CSS highlights aren't DOM nodes, so we hit-test offsets).
  const onContentClick = (e: React.MouseEvent) => {
    if (editMode || !contentRef.current) return;
    if (!highlights.length) return; // nothing to hit-test against
    if (!window.getSelection()?.isCollapsed) return; // a drag-select, not a click
    const off = offsetFromPoint(contentRef.current, e.clientX, e.clientY);
    if (off == null) return;
    // In single mode only whole-doc highlights carry offsets valid for this
    // container; section highlights are painted by text and aren't hit-testable.
    const hit = highlights.find(
      (h) =>
        (singleMode ? !h.subtopicId : !h.subtopicId || h.subtopicId === activeChunk.id) &&
        typeof h.start === "number" &&
        typeof h.end === "number" &&
        off >= h.start &&
        off < h.end,
    );
    if (hit) openEditMenu(hit, e.clientX, e.clientY);
  };

  // Close the menu on outside click / Escape (but keep it open while the reader
  // interacts with the popover itself).
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => setMenu(null), [activeChunk.id, file.id, editMode]);

  useEffect(() => {
    originalContentRef.current = file.content;
    // A document the reader just created opens in the editor with the caret
    // already in it; every other document opens as reading.
    const startInEdit = startInEditFileId === file.id;
    setEditMode(startInEdit);
    if (startInEdit) {
      setPendingSelect({ start: 0, end: 0 });
      onStartInEditConsumed?.();
    }
    // Only on a document switch — `startInEditFileId` is consumed here, and
    // re-running when it clears would drop the reader out of the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  // Edit requested for the document already on screen — the sidebar's "Edit"
  // item, which now owns that action instead of a header button. The effect
  // above only fires on a document switch, so this is the case it cannot see.
  useEffect(() => {
    if (startInEditFileId !== file.id || editMode) return;
    setEditMode(true);
    setPendingSelect({ start: 0, end: 0 });
    onStartInEditConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startInEditFileId, file.id]);

  // Gentle fade/rise when switching documents — reads as a settle, not a flash.
  //
  // Driven by the Web Animations API rather than GSAP: this and one sidebar
  // tween were the app's only two uses of a 153 kB library, and both are a
  // single keyframe pair the platform runs on the compositor for free.
  //
  // `fill` is deliberately left at its default so no residual transform stays
  // behind — any transform, even an identity one, turns this element into the
  // containing block for `position: fixed` descendants, which would re-anchor
  // the selection popover to the scroller instead of the viewport.
  useEffect(() => {
    const el = containerRef.current;
    if (!el?.animate) return;
    const anim = el.animate(
      [
        { opacity: 0, transform: "translateY(10px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 400, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    return () => anim.cancel();
  }, [activeChunk.id, file.id]);

  // Autosaving the draft is the editor's own concern now — see MarkdownEditor.

  /**
   * Back to the top of *this* document.
   *
   * In split view each pane is its own scroll container, so scrolling the
   * window would move every column at once — and in the single-document reader
   * the window is the scroller, so it still has to work there. Walk up from the
   * viewer to whichever ancestor actually scrolls and move that one.
   */
  const scrollToTop = () => {
    let el: HTMLElement | null = containerRef.current;
    while (el) {
      const overflowY = getComputedStyle(el).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
        el.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      el = el.parentElement;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Paginated: when a nested ##/### heading inside the page is selected, scroll
  // to its anchor; otherwise (page's own # or a page change) reset to top.
  // (Skipped in single mode, which scrolls within the whole-doc render below.)
  useEffect(() => {
    if (singleMode) return;
    const el =
      activeSubtopicId && activeSubtopicId !== activeChunk.id
        ? document.getElementById(activeSubtopicId)
        : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else scrollToTop();
  }, [activeChunk.id, activeSubtopicId, file.id, singleMode]);

  // Single-page: switching document scrolls to top; selecting a section from the
  // sidebar scrolls to that heading's anchor within the full document.
  useEffect(() => {
    if (!singleMode) return;
    const el = activeSubtopicId ? document.getElementById(activeSubtopicId) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else scrollToTop();
  }, [singleMode, activeSubtopicId, file.id]);

  /**
   * Land on the search hit itself.
   *
   * Declared after the two heading scrolls and deferred a frame, so it is the
   * last word on where the reader ends up: those effects have already moved to
   * the heading (or given up and gone to the top) by the time this runs, and a
   * second smooth scroll simply retargets the first.
   *
   * Anchored by the matched line, falling back to the query itself — a line may
   * render differently from its source (markdown syntax is stripped, a match
   * inside a link or emphasis is split across elements), and the query is the
   * shortest thing guaranteed to be somewhere in the text.
   */
  useEffect(() => {
    if (!pendingSearch || editMode) return;
    if (!contentRef.current) return;
    const frame = requestAnimationFrame(() => {
      const container = contentRef.current;
      if (!container) return;
      const range =
        firstTextRange(container, pendingSearch.text) ??
        (pendingSearch.query ? firstTextRange(container, pendingSearch.query) : null);
      const target = elementOf(range);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      // The same one-shot flash a saved item gets, for the same reason: on a
      // dense page, arriving is not the same as seeing where you arrived.
      flashPassage(range, target);

      onSearchShown?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingSearch, editMode, renderContent, fullRender, onSearchShown]);

  // Reading progress now lives in <ReadingProgress>, which writes the
  // percentage straight to its own DOM node. It used to be state up here, and
  // because the number changes on nearly every frame of a scroll it re-rendered
  // this whole component — markdown tree included — once per frame.

  // The Cmd/Ctrl+S shortcut belongs to the editor, which is where the draft is.

  const stats = useMemo(() => {
    const src = singleMode ? file.content : activeChunk.content;
    return { words: wordCount(src), readingMin: readingMinutes(src) };
  }, [singleMode, file.content, activeChunk.content]);

  // Search-query highlighting stays a lightweight React wrap. Persistent
  // highlights are painted via the CSS Custom Highlight API instead (see the
  // effect below) so they survive re-renders and span multiple elements.
  const highlightText = (text: string): any => {
    const q = highlightQuery?.trim();
    if (!q || !text) return text;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = text.split(new RegExp(`(${escaped})`, "gi"));
    return parts.map((p, i) =>
      p.toLowerCase() === q.toLowerCase() ? (
        <mark key={i} className="rounded bg-primary/25 px-0.5 text-foreground">
          {p}
        </mark>
      ) : (
        <span key={i}>{p}</span>
      ),
    );
  };

  const walkChildren = (children: any): any => {
    // With no active search there is nothing to wrap. Returning children
    // untouched avoids blanketing the document in <span>s — which bloated the
    // DOM and, worse, split it into thousands of extra text nodes that every
    // offset lookup then had to walk.
    if (!highlightQuery?.trim()) return children;
    if (typeof children === "string") return highlightText(children);
    if (Array.isArray(children))
      return children.map((c, i) => <span key={i}>{walkChildren(c)}</span>);
    return children;
  };

  /**
   * Whether the element currently being rendered sits under a collapsed
   * heading.
   *
   * react-markdown hands each block to its own component with no notion of
   * where it sits relative to the headings around it — the document arrives as
   * a flat list of siblings. So the walk is tracked here: every heading records
   * its own rank and id, and every block in between asks whether any heading
   * still "open" above it is collapsed. A heading of equal or higher rank ends
   * the previous section, which is what makes an H3 fold without swallowing the
   * H2 that follows it.
   *
   * Reset per render pass, because that is exactly the order the blocks are
   * rendered in.
   */
  const sectionWalk = useRef<{ rank: number; id: string }[]>([]);
  sectionWalk.current = [];

  const enterHeading = (rank: number, id: string) => {
    const stack = sectionWalk.current;
    while (stack.length && stack[stack.length - 1].rank >= rank) stack.pop();
    stack.push({ rank, id });
  };
  /**
   * True when any heading above this block is folded.
   *
   * `maxRank` excludes the caller's own level and everything below it, which is
   * what keeps a folded heading on screen: a heading asks only about its
   * *ancestors*, so it never hides itself and the chevron that unfolds it
   * survives. Ordinary blocks pass no rank and are hidden by any folded heading
   * above them.
   */
  const underCollapsed = (maxRank = Infinity) =>
    sectionWalk.current.some((entry) => entry.rank < maxRank && collapsedSections.has(entry.id));

  /** Wrap a block component so it disappears while its section is folded. */
  const foldable = (render: (p: any) => React.ReactNode) => (p: any) =>
    underCollapsed() ? null : render(p);

  const heading = (rank: number, as: string) => (p: any) => {
    const text = Array.isArray(p.children)
      ? p.children.map((c: any) => (typeof c === "string" ? c : "")).join("")
      : String(p.children ?? "");
    const id = p.id || slugify(text);
    // Asked before this heading joins the walk, and only about levels above it:
    // a heading folded by the reader must keep rendering, or the control that
    // unfolds it disappears along with its section.
    const hidden = underCollapsed(rank);
    enterHeading(rank, id);
    if (hidden) return null;
    return <HeadingLink as={as} {...p} highlight={highlightText} />;
  };

  const components = useMemo(
    () => ({
      h1: heading(1, "h1"),
      h2: heading(2, "h2"),
      h3: heading(3, "h3"),
      h4: heading(4, "h4"),
      h5: heading(5, "h5"),
      h6: heading(6, "h6"),
      p: foldable((p: any) => {
        // Rich embed detection: a paragraph that is a single bare autolink.
        // Match on props.href rather than element type — the custom `a`
        // override makes the child's type the component, not the string "a".
        const kids = Array.isArray(p.children) ? p.children : [p.children];
        const solo = kids.filter((c: any) => !(typeof c === "string" && !c.trim()));
        const only = solo.length === 1 ? solo[0] : null;
        const href = only?.props?.href;
        const src = only?.props?.src;
        if (href) {
          const inner = only.props?.children;
          const text =
            typeof inner === "string" ? inner : Array.isArray(inner) ? inner.join("") : "";
          if (text === href || text === "") {
            const embed = detectEmbed(href);
            if (embed) return <EmbedFrame embed={embed} />;
            if (mediaKind(href))
              return (
                <MarkdownMedia
                  src={href}
                  context={{
                    workspaceId,
                    workspaceRevision,
                    workspaceFiles,
                    workspaceFolders,
                    workspaceName,
                    sourceFile: file,
                  }}
                />
              );
          }
        }
        return <p {...p}>{walkChildren(p.children)}</p>;
      }),
      blockquote: foldable((p: any) => (
        <SavableBlock blockType="quote">
          <Callout {...p} />
        </SavableBlock>
      )),
      pre: foldable((p: any) => {
        const codeEl = Array.isArray(p.children) ? p.children[0] : p.children;
        const cls = codeEl?.props?.className ?? "";
        const isMermaid = typeof cls === "string" && /language-mermaid/.test(cls);
        return (
          <SavableBlock
            blockType="code"
            className={isMermaid ? "docs-savable-mermaid" : "docs-savable-code"}
            // A diagram puts the save action in its own control tray, so the
            // star is not drawn floating beside it. Its rendered text is the
            // stylesheet Mermaid injects rather than anything the reader sees,
            // so the source is what identifies it.
            renderOwnSaveAction={isMermaid}
            identity={isMermaid ? extractText(codeEl?.props?.children).trim() : undefined}
          >
            <CodeBlock {...p} />
          </SavableBlock>
        );
      }),
      div: foldable((p: any) => <div {...p}>{walkChildren(p.children)}</div>),
      img: foldable((p: any) => {
        if (file.derivedFrom) return <ConvertedRemoteImage src={p.src ?? ""} alt={p.alt} />;
        if (
          isArtifactUrl(p.src) ||
          isLocalReference(p.src ?? "") ||
          mediaKind(p.src ?? "") !== "image"
        ) {
          return (
            <MarkdownMedia
              src={p.src ?? ""}
              alt={p.alt}
              spec={parseMediaSpec(p["data-media"])}
              context={{
                workspaceId,
                workspaceRevision,
                workspaceFiles,
                workspaceFolders,
                workspaceName,
                sourceFile: file,
              }}
            />
          );
        }
        return (
          <SavableBlock blockType="image" as="span" identity={p.src} className="inline-block">
            <img
              {...p}
              loading="lazy"
              onClick={() => setLightbox({ src: p.src, alt: p.alt })}
              className="cursor-zoom-in"
            />
          </SavableBlock>
        );
      }),
      a: (p: any) => {
        const href = typeof p.href === "string" ? p.href : "";
        if (isArtifactUrl(href) || isLocalReference(href))
          return (
            <MarkdownMedia
              src={href}
              linkOnly
              context={{
                workspaceId,
                workspaceRevision,
                workspaceFiles,
                workspaceFolders,
                workspaceName,
                sourceFile: file,
              }}
            >
              {p.children}
            </MarkdownMedia>
          );
        // An in-page reference (`[see](#recommended-controls)`) used to be left
        // to the browser, which looks for the element and finds nothing: in
        // paginated mode the target heading usually lives in a *different*
        // chunk that isn't mounted, so the click did nothing at all. Resolve it
        // through the app's own navigation instead — switch to the chunk that
        // owns the heading, then scroll to it.
        if (href.startsWith("#")) {
          let rawTarget = href.slice(1);
          try {
            rawTarget = decodeURIComponent(rawTarget);
          } catch {
            /* malformed fragment stays literal */
          }
          const targetId = convertedAnchors.targets[rawTarget] ?? rawTarget;
          return (
            <a
              {...p}
              onClick={(event: React.MouseEvent) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                event.preventDefault();
                // Footnotes are appended to each converted page. Follow their
                // local targets without changing the currently selected page.
                if (file.derivedFrom && rawTarget.startsWith("user-content-fn")) {
                  const note = contentRef.current?.querySelector(`#${CSS.escape(rawTarget)}`);
                  if (note) {
                    note.scrollIntoView({ behavior: "smooth", block: "start" });
                    return;
                  }
                }
                // Selecting the chunk mounts it; the effect that watches
                // `activeSubtopicId` scrolls to the heading once it exists.
                onNav(file.id, targetId);
                requestAnimationFrame(() => {
                  document
                    .getElementById(targetId)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              }}
            >
              {walkChildren(p.children)}
            </a>
          );
        }
        return (
          <a {...p} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
            {walkChildren(p.children)}
          </a>
        );
      },
      li: (p: any) => <li {...p}>{walkChildren(p.children)}</li>,
      table: foldable((p: any) => (
        <SavableBlock blockType="table" className="docs-savable-table">
          <ResizableMarkdownTable {...p} />
        </SavableBlock>
      )),
      td: (p: any) => <td {...p}>{walkChildren(p.children)}</td>,
      th: (p: any) => <th {...p}>{walkChildren(p.children)}</th>,
    }),
    // `highlights` is deliberately absent: nothing here reads it, and including
    // it rebuilt every renderer on each highlight change, re-rendering the whole
    // markdown tree (the entire document, in single-page mode).

    // `collapsedSections` is read by every foldable block through the walk, so
    // folding a heading has to rebuild this map — otherwise the chevron turns
    // and nothing moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      highlightQuery,
      workspaceId,
      workspaceRevision,
      workspaceFiles,
      workspaceName,
      workspaceFolders,
      file,
      onOpenArtifact,
      collapsedSections,
      file.id,
      chunkForHeading,
      convertedAnchors,
      file.derivedFrom,
      onNav,
    ],
  );

  return (
    <div className="flex h-full flex-col bg-background">
      <ViewerHeader
        navAction={
          // The section picker heads the toolbar in both reading modes. Paged
          // mode switches the page it renders; single-page mode scrolls to the
          // heading in the whole-document render — the document has the same
          // sections either way, so the same control moves between them.
          allChunks.length <= 1 ? null : (
            <Select
              value={singleMode ? (activeSubtopicId ?? allChunks[0].id) : activeChunk.id}
              onValueChange={(val) => onNav(file.id, val)}
            >
              {/* Borderless and fixed-width: it sits at the head of the toolbar
                  where a bordered control read as an input, and a width that
                  tracked the section title made the whole header shift on every
                  section change. */}
              <SelectTrigger className="h-9 w-56 shrink-0 flex items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-1.5 text-sm font-medium text-foreground shadow-none hover:bg-accent/50 focus:ring-0">
                <span className="truncate min-w-0 text-left">
                  {singleMode
                    ? (allChunks.find((c) => c.id === activeSubtopicId)?.title ??
                      allChunks[0].title)
                    : activeChunk.title}
                </span>
              </SelectTrigger>
              <SelectContent className="max-w-[90vw] sm:max-w-md w-full">
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider sticky top-0 bg-popover z-10 border-b border-border/50 mb-1">
                  Sections
                </div>
                <div className="max-h-[40vh] overflow-y-auto pr-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] scrollbar-none">
                  {allChunks.map((chunk) => {
                    // Cached word count — this list is rebuilt on every render
                    // of the viewer, and scanning every section's text each
                    // time was O(document) for a dropdown that is usually shut.
                    const readingMin = readingMinutes(chunk.content);
                    return (
                      <SelectItem
                        key={chunk.id}
                        value={chunk.id}
                        className="cursor-pointer pl-2 pr-2 [&>span.absolute]:hidden"
                      >
                        <div className="flex w-full items-center justify-between gap-4">
                          <span className="truncate">
                            {chunk.title.length > 20
                              ? chunk.title.substring(0, 20) + "..."
                              : chunk.title}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {readingMin} min
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </div>
              </SelectContent>
            </Select>
          )
        }
        /* Starring lives on the document's own row in the sidebar, and editing
           lives in that row's menu. What is left here is the one control that
           changes how this view reads — and when even that does not apply this
           must be `undefined`, not an empty wrapper, or the header has no way
           to tell it is empty and reserves its height for nothing. */
        actions={
          !editMode ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void exportHTML()}
                disabled={exporting}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
                title="Download a styled HTML page; uploaded attachments are bundled in a ZIP and web media stays online"
              >
                <Download className="h-4 w-4" />
                {exporting ? "Exporting…" : "Download HTML + Media"}
              </button>
              {onToggleReadingMode && (
                <button
                  onClick={onToggleReadingMode}
                  title={
                    singleMode
                      ? "Paged: read one section at a time"
                      : "Single page: read the whole document"
                  }
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground coarse:h-11 coarse:w-11"
                >
                  <Files className="h-4 w-4" />
                </button>
              )}
              {/* Export sits with the document rather than only in the sidebar
                  row menu: while reading is when you want it, and on a phone
                  that panel is closed. */}
              <ExportMenu
                file={file}
                mediaContext={{
                  workspaceId,
                  workspaceRevision,
                  workspaceFiles,
                  workspaceFolders,
                  workspaceName,
                  sourceFile: file,
                }}
              />
            </div>
          ) : undefined
        }
      />
      <div
        ref={containerRef}
        className="relative flex-1 overflow-y-auto transition-colors duration-500"
      >
        {menu &&
          !editMode &&
          // Portalled to <body> on purpose. The popover is positioned in viewport
          // coordinates, and any transformed ancestor (the GSAP entrance tween,
          // a backdrop-filter, a `will-change`) would silently become its
          // containing block and throw those coordinates off by the scroller's
          // height — which is what hid it entirely in single-page mode.
          createPortal(
            <div
              ref={menuRef}
              className="fixed z-(--z-dropdown) w-64 -translate-x-1/2 rounded-lg border border-border bg-popover p-2 shadow-xl"
              style={{
                top: Math.min(Math.max(56, menu.y - 12), window.innerHeight - 24),
                left: Math.min(Math.max(132, menu.x), window.innerWidth - 132),
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {menu.mode === "create" ? "Highlight" : "Edit highlight"}
                </span>
                <button
                  onClick={() => setMenu(null)}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {menu.mode === "create" && onAskAi && (
                <div className="mb-2 border-b border-border pb-2">
                  <div className="mb-1.5 flex items-center gap-1 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Sparkles className="h-3 w-3" /> Ask AI
                  </div>
                  <div className="flex flex-wrap gap-1 px-1">
                    {[
                      { label: "Ask AI", action: undefined },
                      { label: "Summarize", action: "summary" },
                      { label: "Explain", action: "explain" },
                      { label: "Notes", action: "notes" },
                      { label: "Mermaid", action: "mermaid" },
                      { label: "Rewrite", action: "rewrite" },
                    ].map((item) => (
                      <button
                        key={item.label}
                        onClick={() => {
                          onAskAi({ selection: menu.text, actionId: item.action });
                          window.getSelection()?.removeAllRanges();
                          setMenu(null);
                        }}
                        className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-2 flex items-center gap-1.5 px-1">
                {HL_COLORS.map((color) => {
                  const active = menu.mode === "edit" && menu.hl.color === color;
                  return (
                    <button
                      key={color}
                      aria-label={`Highlight ${color}`}
                      className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
                        active
                          ? "ring-2 ring-foreground ring-offset-1 ring-offset-popover"
                          : "border border-border/60"
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => {
                        if (menu.mode === "create") {
                          onAddHighlight({
                            text: menu.text,
                            color,
                            label: menu.label.trim() || undefined,
                            subtopicId: singleMode ? undefined : activeChunk.id,
                            start: menu.start,
                            end: menu.end,
                            prefix: menu.prefix,
                            suffix: menu.suffix,
                          });
                          window.getSelection()?.removeAllRanges();
                        } else {
                          onUpdateHighlight(menu.hl.id, { color });
                        }
                        setMenu(null);
                      }}
                    />
                  );
                })}
              </div>

              <div className="mb-2 flex items-center gap-1.5 rounded-md border border-border bg-background px-2">
                <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={menu.label}
                  onChange={(e) => setMenu((m) => (m ? { ...m, label: e.target.value } : m))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (menu.mode === "create") {
                        onAddHighlight({
                          text: menu.text,
                          color: HL_COLORS[0],
                          label: menu.label.trim() || undefined,
                          subtopicId: singleMode ? undefined : activeChunk.id,
                          start: menu.start,
                          end: menu.end,
                          prefix: menu.prefix,
                          suffix: menu.suffix,
                        });
                        window.getSelection()?.removeAllRanges();
                      } else {
                        onUpdateHighlight(menu.hl.id, { label: menu.label.trim() || undefined });
                      }
                      setMenu(null);
                    }
                  }}
                  placeholder="Add a label (optional)"
                  className="w-full bg-transparent py-1.5 text-xs outline-none placeholder:text-muted-foreground"
                />
              </div>

              <div className="mb-2 grid grid-cols-2 gap-1">
                <button
                  onClick={() => inspect(menu.mode === "create" ? menu.text : menu.hl.text)}
                  title="Open the editor with this text selected"
                  className="flex items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  <Crosshair className="h-3.5 w-3.5" /> Inspect source
                </button>
                <button
                  onClick={() => copySource(menu.mode === "create" ? menu.text : menu.hl.text)}
                  title="Copy the source code behind this text"
                  className="flex items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  <Code2 className="h-3.5 w-3.5" /> Copy code
                </button>
              </div>

              <div className="flex items-center gap-1">
                {/* Saving lives here rather than on a star pinned to every
                    block: the reader has already told us what they care about
                    by selecting it, and a selection can be any range — a
                    paragraph, part of a table, a whole section — where a block
                    star could only ever offer the block it sat on. */}
                {savedCtx.enabled && menu.mode === "create" && (
                  <button
                    onClick={() => {
                      savedCtx.toggle({
                        kind: "block",
                        blockType: "text",
                        title: savedExcerpt(menu.text, 90),
                        text: menu.text,
                        subtopicId: savedCtx.subtopicId,
                        start: menu.start,
                        end: menu.end,
                        prefix: menu.prefix,
                        suffix: menu.suffix,
                      });
                      window.getSelection()?.removeAllRanges();
                      setMenu(null);
                    }}
                    title="Save this selection"
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Star className="h-3.5 w-3.5" /> Save
                  </button>
                )}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      menu.mode === "create" ? menu.text : menu.hl.text,
                    );
                    setMenu(null);
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {menu.mode === "edit" && (
                  <button
                    onClick={() => {
                      onRemoveHighlight(menu.hl.id);
                      setMenu(null);
                    }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                )}
                {menu.mode === "create" && (
                  <button
                    onClick={() => {
                      onAddHighlight({
                        text: menu.text,
                        color: HL_COLORS[0],
                        label: menu.label.trim() || undefined,
                        subtopicId: singleMode ? undefined : activeChunk.id,
                        start: menu.start,
                        end: menu.end,
                        prefix: menu.prefix,
                        suffix: menu.suffix,
                      });
                      window.getSelection()?.removeAllRanges();
                      setMenu(null);
                    }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-foreground px-2 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
                  >
                    Highlight
                  </button>
                )}
              </div>
            </div>,
            document.body,
          )}

        {lightbox && <Lightbox {...lightbox} onClose={() => setLightbox(null)} />}

        <div
          className="docs-reading-pane mx-auto flex w-full gap-8 px-6 py-10 md:px-10 md:py-16"
          // A share of the pane's own inline size (`cqi`, from the
          // `container-type: inline-size` below), not of the viewport — so the
          // column already tracks the sidebar being collapsed or expanded, and
          // only the slider in Settings needs to move it. styles.css only reads
          // this at `md:` and up: a phone-width column cut down to 40-50% of an
          // already-narrow screen would be unreadable.
          style={{ "--docs-content-width": `${contentWidth}cqi` } as CSSProperties}
        >
          <article
            onMouseUp={() => openCreateMenu()}
            onContextMenu={onContextMenu}
            className="docs-prose mx-auto min-w-0 flex-1"
          >
            {/*
             * The masthead.
             *
             * A section used to open with its title and a reading time and
             * nothing else, which left two questions unanswered on every
             * screen: which document is this, and how far through it am I. The
             * file name was only ever visible in the sidebar, so with the
             * sidebar collapsed — or on a phone, where it is a drawer — the
             * open document had no name at all.
             *
             * Three lines, in the order they are wanted: what this is, what
             * it is called, and what it will cost to read.
             */}
            {!singleMode && (
              <header className="mb-10">
                <p className="mb-3 flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{file.name}</span>
                  {allChunks.length > 1 && (
                    <>
                      <span aria-hidden className="text-border">
                        /
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {chunkIndex + 1} of {allChunks.length}
                      </span>
                    </>
                  )}
                </p>
                <h1 className="wrap-break-word text-pretty text-[2rem] font-[680] leading-[1.12] tracking-[-0.028em] text-foreground sm:text-[2.6rem]">
                  {activeChunk.title}
                </h1>
                <p className="mt-3.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />≈ {stats.readingMin} min read
                  </span>
                  <span aria-hidden className="text-border">
                    ·
                  </span>
                  <span className="tabular-nums">{stats.words.toLocaleString()} words</span>
                </p>
              </header>
            )}

            {editMode ? (
              <MarkdownEditor
                // Keyed by document: switching files tears the editor down and
                // builds a new one, rather than handing the previous document's
                // draft to the next document's instance.
                key={file.id}
                ref={editorRef}
                fileId={file.id}
                initialContent={file.content}
                onSave={saveDraft}
                onDone={leaveEditMode}
                onCancel={cancelEdit}
                onDirtyChange={setEditorDirty}
                inspectMissed={inspectMissed}
                fileName={file.name}
                onRename={onRenameFile}
                mediaContext={{
                  workspaceId,
                  workspaceRevision,
                  workspaceFiles,
                  workspaceFolders,
                  workspaceName,
                  sourceFile: file,
                }}
                onImportAttachments={onImportAttachments}
              />
            ) : (
              <div
                key={singleMode ? "full" : activeChunk.id}
                ref={contentRef}
                onClick={onContentClick}
              >
                <SavedContext.Provider value={savedCtx}>
                  <CollapseContext.Provider value={collapseCtx}>
                    <MarkdownContent
                      urlTransform={mediaUrlTransform}
                      remarkPlugins={remarkPlugins}
                      rehypePlugins={rehypePlugins}
                      components={components}
                    >
                      {markdownSource}
                    </MarkdownContent>
                  </CollapseContext.Provider>
                </SavedContext.Provider>
              </div>
            )}

            {/* One pager for both reading modes. Paged mode steps section by
                section and falls through to the next file at the end of a
                document; single page shows everything, so it steps files. */}
            {!editMode && (
              <ViewerPager
                className="mt-16 border-t border-border"
                nextEyebrow={
                  nextChunk ? `Next ${chunkIndex + 2}/${allChunks.length}` : "Next chapter"
                }
                nav={{
                  onPrev: () => {
                    if (!singleMode && prevChunk) onNav(file.id, prevChunk.id);
                  },
                  onNext: () => {
                    if (!singleMode && nextChunk) onNav(file.id, nextChunk.id);
                  },
                  prevDisabled: singleMode || !prevChunk,
                  nextDisabled: singleMode || !nextChunk,
                  prevLabel: !singleMode && prevChunk ? `Previous: ${prevChunk.title}` : "Previous",
                  nextLabel: !singleMode && nextChunk ? nextChunk.title || "Next" : "Next",
                }}
              />
            )}
          </article>
        </div>

        <ReadingProgress
          containerRef={containerRef}
          contentRef={contentRef}
          revision={markdownSource}
          hidden={editMode}
        />
      </div>
    </div>
  );
}

/**
 * Rendering a document means parsing markdown, painting highlights and walking
 * the resulting tree, so this component must not re-render just because the app
 * shell around it did. Every prop it takes is either a primitive or held to a
 * stable identity in `DocsApp`, which is what makes the memo effective.
 */
export const MarkdownViewer = memo(MarkdownViewerImpl);

/**
 * Wraps a block (table, code fence, quote, image) with a hover star that saves
 * it. The block's own rendered text is the quote the saved item re-anchors by,
 * so a saved table is still findable after the document around it is edited.
 *
 * A block that already owns a row of overlay controls — a diagram — can render
 * the save action itself instead, as one more segment in that row. It reads the
 * action from {@link SaveActionContext}; see `renderOwnSaveAction`.
 */
function SavableBlock({
  blockType,
  as: Wrapper = "div",
  className = "",
  identity,
  renderOwnSaveAction,
  children,
}: {
  blockType: SavedBlockType;
  as?: "div" | "span";
  className?: string;
  /** Stands in for the text of blocks that have none — an image's src. */
  identity?: string;
  /**
   * Suppress the floating star and publish the save action on context instead,
   * for a block that places it among its own controls.
   */
  renderOwnSaveAction?: boolean;
  children: React.ReactNode;
}) {
  const ctx = useContext(SavedContext);
  const ref = useRef<HTMLDivElement & HTMLSpanElement>(null);
  const [text, setText] = useState("");

  // Re-read the block's own text when the document changes. This used to run
  // with no dependency array at all, so every render of the page walked the
  // subtree of every table, code fence, quote and image on it — O(document) of
  // DOM traversal per render, plus a second render pass to settle. Keying it to
  // the rendered source keeps the star pointing at the right text (the whole
  // point of the original comment) at a fraction of the cost.
  useEffect(() => {
    const next = ref.current?.textContent?.trim() ?? "";
    setText((prev) => (prev === next ? prev : next));
  }, [ctx?.revision]);

  if (!ctx?.enabled) return <>{children}</>;

  // `identity` wins over the rendered text where it is given. A block whose DOM
  // text is not its content — a diagram, whose textContent is the stylesheet
  // Mermaid injects, complete with a per-render generated id — would otherwise
  // be saved under a key that changes on every render and never matches itself
  // again, so the star could never show as saved and never toggle back off.
  const probe = identity || text || "";
  const existing = ctx.isSaved({ kind: "block", text: probe });

  const toggle = (e?: React.MouseEvent) => {
    // Invoked from a menu item as well as a button, and a menu item has no
    // event to give — the guards are what let one handler serve both.
    e?.preventDefault();
    e?.stopPropagation();
    if (existing) {
      ctx.remove(existing.id);
      return;
    }
    const container = ctx.containerRef.current;
    const el = ref.current;
    const offsets = container && el ? nodeOffsets(container, el) : null;
    const quote = identity || offsets?.text.trim() || probe;
    ctx.toggle({
      kind: "block",
      blockType,
      title: savedExcerpt(quote || identity || blockType, 90),
      text: quote || undefined,
      blockSrc: blockType === "image" ? identity : undefined,
      subtopicId: ctx.subtopicId,
      ...(offsets && container
        ? {
            start: offsets.start,
            end: offsets.end,
            ...contextAround(container, offsets.start, offsets.end),
          }
        : null),
    });
  };

  if (renderOwnSaveAction) {
    return (
      <Wrapper ref={ref} className={`docs-savable ${className}`.trim()}>
        <SaveActionContext.Provider
          value={{
            saved: Boolean(existing),
            toggle,
            label: existing ? `Remove saved ${blockType}` : `Save ${blockType}`,
            title: existing ? "Saved — click to remove" : `Save this ${blockType}`,
          }}
        >
          {children}
        </SaveActionContext.Provider>
      </Wrapper>
    );
  }

  // No floating star. A star pinned to the corner of every table, quote, image
  // and code fence turned the document into a field of controls competing with
  // the prose — and it only ever offered to save whole blocks, never the
  // paragraph or the half-table the reader actually cared about. Saving now
  // lives on the selection popover, which can save any range at all, so the
  // block wrapper keeps its identity and offsets and draws nothing.
  return (
    <Wrapper ref={ref} className={`docs-savable ${className}`.trim()}>
      {children}
    </Wrapper>
  );
}

function HeadingLink({ as: Tag, children, id, highlight, ...rest }: any) {
  const ctx = useContext(SavedContext);
  const collapse = useContext(CollapseContext);
  const text = Array.isArray(children)
    ? children.map((c) => (typeof c === "string" ? c : "")).join("")
    : String(children ?? "");
  const finalId = id || slugify(text);
  const savedSection = ctx?.enabled
    ? ctx.isSaved({ kind: "section", headingId: finalId })
    : undefined;
  const collapsed = collapse?.isCollapsed(finalId) ?? false;
  return (
    <Tag id={finalId} {...rest} className="group relative scroll-mt-24">
      {/* Out in the margin, not in the text.
          This used to sit inline before the heading, which put a control in the
          middle of the prose on every single heading — permanent chrome the
          reader had to read past. It lives to the left of the reading column
          now and only appears when the heading is hovered or focused, so an
          untouched page is just the document. A collapsed section keeps its
          chevron visible regardless: that is the only way back. */}
      {collapse && (
        <button
          onClick={() => collapse.toggle(finalId)}
          /* The hover-reveal above assumes a pointer that can hover. On a touch
             tablet — where this is shown, being >=md — there is none, so an
             expanded section's chevron never appeared and a reader could not
             collapse anything; only re-expanding worked, because a collapsed
             one is pinned visible. `coarse:opacity-100` gives touch the same
             affordance a mouse gets. The ::before pads the 24px target out to
             44px without moving it: the margin it sits in is narrower than 44px
             at this breakpoint, so growing the box itself would push it off the
             side of the screen. */
          className={`absolute -left-7 top-1/2 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 coarse:before:absolute coarse:before:-inset-2.5 coarse:before:content-[''] md:flex ${
            collapsed
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 coarse:opacity-100"
          }`}
          aria-expanded={!collapsed}
          aria-controls={`${finalId}-section`}
          title={collapsed ? "Expand section" : "Collapse section"}
          aria-label={collapsed ? "Expand section" : "Collapse section"}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${collapsed ? "-rotate-90" : ""}`}
          />
        </button>
      )}
      {typeof children === "string" ? (highlight?.(children) ?? children) : children}
      {/* A saved section still marks its heading, but only once it *is* saved:
          an always-present star on every heading was chrome the reader had to
          look past on the way down the page. Saving a section is done from the
          selection popover now; this is the receipt, not the button. */}
      {ctx?.enabled && savedSection && (
        <button
          onClick={() => ctx.remove(savedSection.id)}
          className="ml-1 inline-flex h-9 w-9 items-center justify-center align-middle"
          title="Saved — click to remove"
          aria-label="Remove saved section"
        >
          <Star className="h-4 w-4 fill-gold text-gold" />
        </button>
      )}
    </Tag>
  );
}

function CodeBlock({ children, ...rest }: any) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  // Detect Mermaid
  const codeEl: any = Array.isArray(children) ? children[0] : children;
  const cls = codeEl?.props?.className ?? "";
  if (typeof cls === "string" && /language-mermaid/.test(cls)) {
    const raw = extractText(codeEl?.props?.children);
    return <MermaidBlock code={raw} />;
  }

  const encodedLang = /language-([\w+-]+)/.exec(cls)?.[1];
  const [lang, encodedMeta] = encodedLang?.split("--") ?? [];
  const meta =
    codeEl?.props?.node?.data?.meta ??
    codeEl?.props?.node?.meta ??
    encodedMeta?.replaceAll("-", " ") ??
    "";

  // ```mindmap fences hold JSON and draw as an interactive map, the same way
  // ```mermaid fences hold diagram source. Any fence meta becomes the root's
  // name when the JSON does not carry one.
  if (lang === "mindmap") {
    return <MindMapBlock code={extractText(codeEl?.props?.children)} title={meta} />;
  }

  if (lang === "interactive-html" || lang === "interactive-react") {
    return (
      <InteractiveBlock
        kind={lang === "interactive-html" ? "html" : "react"}
        code={extractText(codeEl?.props?.children)}
        meta={meta}
      />
    );
  }

  // A ```json fence renders as a browsable tree rather than a wall of text.
  // Malformed JSON falls through to the plain code block below, so a typo
  // still shows the author what they wrote instead of an error.
  if (lang === "json") {
    const raw = extractText(codeEl?.props?.children);
    try {
      const parsed = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object") {
        return <JsonFigure value={parsed} />;
      }
    } catch {
      // Not valid JSON — fall through.
    }
  }

  return (
    <div className="group relative my-6">
      {/* {lang && (
        <div className="absolute left-3 top-2 z-10 rounded bg-background/60 px-1.5 py-0.5 text-xs font-mono uppercase tracking-wider text-muted-foreground backdrop-blur">
          {lang}
        </div>
      )} */}
      <button
        onClick={() => {
          const code = ref.current?.innerText ?? "";
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label={copied ? "Copied" : "Copy code"}
        /* A hover-only reveal leaves this button unreachable on touch, so
           `hover-none:opacity-100` pins it there. Being permanently visible is
           also why it loses its label on a touch device: the word doubled the
           button's width, and parked over the first line of a code block on a
           phone that was the difference between covering the end of a line and
           covering half of it. The tick that replaces the icon still reports
           the copy, and `aria-label` carries the name either way. */
        className="absolute right-2 top-2 z-10 inline-flex min-h-9 items-center gap-1 rounded-md border border-border/50 bg-background/80 px-2.5 py-1.5 text-xs text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:text-foreground group-hover:opacity-100 coarse:min-h-11 coarse:min-w-11 coarse:justify-center coarse:px-0 [@media(hover:none)]:opacity-100"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        <span className="coarse:hidden">{copied ? "Copied" : "Copy"}</span>
      </button>
      <pre ref={ref} {...rest}>
        {children}
      </pre>
    </div>
  );
}

/**
 * A ```json fence, rendered as a browsable tree with a full-screen control.
 *
 * Structured data in a document has the same problem a diagram does: it gets
 * the width of a text column, which is the one place a deep tree is least
 * readable. Full screen is the element's own rather than an overlay, so the
 * branches the reader has opened survive going in and coming back out, and
 * Escape or the browser's own exit are followed like any other fullscreen.
 */
function JsonFigure({ value }: { value: unknown }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === hostRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggle = () => {
    const el = hostRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => setFull(false));
  };

  return (
    <div
      ref={hostRef}
      className={`overflow-hidden border-border bg-background ${
        full ? "flex h-screen w-screen flex-col rounded-none border-0" : "my-6 rounded-xl border"
      }`}
    >
      <div className="flex items-center justify-end border-b border-border/70 bg-background/40 px-2 py-1.5">
        <button
          onClick={toggle}
          title={full ? "Exit full screen" : "Full screen"}
          aria-label={full ? "Exit full screen" : "Full screen"}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className={full ? "min-h-0 flex-1 overflow-auto" : "max-h-128 overflow-auto"}>
        <JsonTree value={value} />
      </div>
    </div>
  );
}

function extractText(node: any): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node?.props?.children) return extractText(node.props.children);
  return "";
}

// react-markdown exposes the code language to component overrides but not the
// fenced-code info string. Keep the interactive flags in the language token so
// `interactive-react preview`, `split`, and `playground` all survive parsing.
function remarkInteractiveBlockMeta() {
  return (tree: any) => {
    const walk = (node: any) => {
      if (node?.type === "code" && /^(interactive-html|interactive-react)$/.test(node.lang ?? "")) {
        const flags = String(node.meta ?? "")
          .toLowerCase()
          .split(/\s+/)
          .map((flag) => flag.replace(/[^a-z0-9]/g, ""))
          .filter(Boolean)
          .join("-");
        if (flags) node.lang = `${node.lang}--${flags}`;
      }
      node?.children?.forEach(walk);
    };
    walk(tree);
  };
}

/**
 * The seven GitHub admonition types, collapsed onto four visual tones. Seven
 * distinct colours would be seven things to learn; the reader only ever needs
 * to know how loudly a box is speaking, so the tones are graded by urgency —
 * `info` for context, `success` for advice, `warn` for care, `danger` for
 * consequences — and the label carries the exact word. Tone is applied by
 * `data-tone` in `styles.css` rather than by utility classes, so the callout
 * is themed from the same tokens as the rest of the reader.
 */
const CALLOUT_MAP: Record<string, { icon: any; label: string; tone: string }> = {
  NOTE: { icon: StickyNote, label: "Note", tone: "info" },
  INFO: { icon: Info, label: "Info", tone: "info" },
  TIP: { icon: Lightbulb, label: "Tip", tone: "success" },
  WARNING: { icon: AlertTriangle, label: "Warning", tone: "warn" },
  CAUTION: { icon: AlertTriangle, label: "Caution", tone: "warn" },
  DANGER: { icon: AlertOctagon, label: "Danger", tone: "danger" },
  IMPORTANT: { icon: AlertOctagon, label: "Important", tone: "danger" },
};

const CALLOUT_RE = /^\s*\[!(NOTE|INFO|TIP|WARNING|CAUTION|DANGER|IMPORTANT)\]\s*(.*)/is;

function Callout({ children, ...rest }: any) {
  const kids = Array.isArray(children) ? [...children] : [children];
  let type: string | null = null;

  // The marker is on the blockquote's first *element* child. react-markdown
  // keeps the newlines between block children as plain strings, so the first
  // entry in this array is almost always "\n" rather than the paragraph — the
  // scan used to look at that string, find no `props` on it, and give up
  // immediately, which is why no callout in any document ever rendered and
  // every one of them showed its raw `[!NOTE]` marker to the reader.
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (typeof c === "string" && !c.trim()) continue;
    if (!c?.props) break;
    const m = CALLOUT_RE.exec(extractText(c.props.children));
    if (!m) break;
    type = m[1].toUpperCase();
    // Drop the marker, keeping whatever followed it on the same line.
    const remainder = m[2];
    kids[i] = remainder ? { ...c, props: { ...c.props, children: remainder } } : null;
    break;
  }

  if (!type) {
    return <blockquote {...rest}>{children}</blockquote>;
  }

  const cfg = CALLOUT_MAP[type];
  const Icon = cfg.icon;
  return (
    <aside className="docs-callout" data-tone={cfg.tone} role="note">
      <span className="docs-callout-mark" aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      <div className="docs-callout-body">
        <p className="docs-callout-label">{cfg.label}</p>
        {kids.filter(Boolean)}
      </div>
    </aside>
  );
}
