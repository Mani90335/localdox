import { toast } from "sonner";
import { remarkMedia, mediaUrlTransform } from "@/lib/markdown/markdown-media";
import type { FolderRecord } from "@/lib/workspace/persistence";
import {
  remarkConvertedHtml,
  convertedAnchorMap,
  convertedFootnotes,
} from "@/services/doc-conversion";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { ProgressiveMarkdown } from "./markdown-viewer/ProgressiveMarkdown";
import { markdownComponents } from "./markdown-viewer/markdown-components";
import { useSectionFolds } from "./markdown-viewer/section-folds";
import { MathProvider } from "@/services/math/MathContext";
import { DEFAULT_MATH_PREFERENCES } from "@/services/math/types";
import { slugLabel } from "@/services/math/equation-registry";
import { useMarkdownPlugins } from "@/lib/markdown/markdown-plugins";
import {
  Copy,
  Link2,
  ArrowLeft,
  ArrowRight,
  Clock,
  Pencil,
  Eye,
  Tag,
  Trash2,
  X,
  ScrollText,
  Files,
  Sparkles,
  BookOpen,
  Share,
  MoreHorizontal,
  Search,
  Crosshair,
  Code2,
  FileText,
  NotebookPen,
} from "lucide-react";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import type { ReadingMode } from "@/lib/workspace/persistence";
import { ReadingProgress } from "../navigation/ReadingProgress";
import { MarkdownEditor, type MarkdownEditorHandle } from "../editor/MarkdownEditorLazy";
import { isVideoUrl, VideoPlayer } from "@/lib/markdown/media-embeds";
import { Lightbox } from "./Lightbox";
import { cn } from "@/lib/utils";
import { HL_COLORS, hlGroup, type Highlight } from "@/lib/markdown/dom-highlighter";
import {
  getSelectionOffsets,
  buildRange,
  offsetFromPoint,
  firstTextRange,
  releaseTextIndex,
  contextAround,
  findAnchor,
  sameQuote,
  textBetween,
  queryRanges,
  nthQueryRange,
  firstQueryRangeInLine,
  rangeOffsets,
} from "@/lib/markdown/text-offsets";
import { occurrenceOrdinal, parseRows } from "@/lib/search/rows";
import type { PendingSearch } from "@/lib/search/schema";
import { createHighlightPainter } from "@/lib/markdown/highlight-registry";
import type { PassageTarget } from "@/lib/workspace/saved-items";
import type { NoteDraft } from "@/lib/workspace/notes";
import { locateInSource, sourceLinesForSelection } from "@/lib/markdown/source-locate";
import { selectionToMarkdown } from "@/lib/markdown/selection-markdown";
import {
  anchorSpan,
  lineSpan,
  searchHitSpan,
  type SourceSpan,
} from "@/lib/markdown/source-address";
import { addressOfRange, queryRangeWithin, rangeOfAddress } from "@/lib/markdown/dom-address";
import type { SourceAddressing } from "./markdown-viewer/ProgressiveMarkdown";
import { diagramSourceOf } from "@/lib/markdown/diagram-sources";
import { copyText } from "@/lib/workspace/share";
import {
  fileSubtopics,
  headingChunkMap,
  readingMinutes,
  wordCount,
} from "@/lib/markdown/markdown-utils";
import { InlineArtifact } from "./InlineArtifact";
import { artifactReference, prepareWorkspaceEmbeds } from "@/lib/workspace/workspace-artifacts";
import {
  CollapseContext,
  MarkdownRenderContext,
  type CollapseContextValue,
  type MarkdownRenderContextValue,
} from "./markdown-viewer/contexts";
import { elementOf, flashPassage, scrollToPassage } from "./markdown-viewer/flash-passage";
import { remarkInteractiveBlockMeta } from "./markdown-viewer/remark-interactive-block-meta";
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
import { EditButton } from "./EditButton";
import { ESCAPE_DEPTH, useNavEscape } from "@/hooks/use-nav-history";
import { usePortalContainer } from "@/hooks/use-portal-container";

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
  highlights: Highlight[];
  onAddHighlight: (hl: Omit<Highlight, "id" | "fileId">) => void;
  onUpdateHighlight: (id: string, patch: Partial<Pick<Highlight, "color" | "label">>) => void;
  onRemoveHighlight: (id: string) => void;
  /**
   * Corrected anchors, found while painting: the document was edited and these
   * highlights had to be re-located. Persisted, but not as an undoable step.
   */
  onRepairHighlights?: (patches: Array<{ id: string; patch: Partial<Highlight> }>) => void;
  /**
   * A passage the reader just opened from a note's source link: scroll to it
   * and flash it once, then call `onSavedShown` so it isn't replayed on
   * re-render.
   */
  pendingSaved?: PassageTarget | null;
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
  pendingSearch?: PendingSearch | null;
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
  /** Keep the selection as a note. Hidden from the selection menu when omitted. */
  onCopyToNotes?: (draft: NoteDraft) => void;
  /** Show or hide the Notes panel; the header button is hidden when omitted. */
  onToggleNotes?: () => void;
  notesOpen?: boolean;
}

const stripExt = (name: string) => name.replace(/\.(md|markdown|mdx|txt)$/i, "");

/**
 * The first element at or under `element` that has a box. Addressed
 * equations and diagrams are wrapped in `display: contents` elements, which
 * can't be scrolled to or outlined themselves.
 */
function boxOf(element: Element): HTMLElement {
  let current = element as HTMLElement;
  while (getComputedStyle(current).display === "contents" && current.firstElementChild)
    current = current.firstElementChild as HTMLElement;
  return current;
}
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Viewer-specific remark passes, held at module scope so the array identity is
 * stable. Rebuilding it per render would make react-markdown re-parse the whole
 * document every time this component re-renders for any other reason.
 */
const EXTRA_REMARK_PLUGINS = [remarkInteractiveBlockMeta, remarkMedia];

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
  highlights,
  onAddHighlight,
  onUpdateHighlight,
  onRemoveHighlight,
  onRepairHighlights,
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
  mathPreferences = DEFAULT_MATH_PREFERENCES,
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
  onCopyToNotes,
  onToggleNotes,
  notesOpen = false,
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
  // A heading to bring into view once the document on screen has finished
  // rendering. A long document mounts in steps (see ProgressiveMarkdown), so
  // the heading may not exist yet when it is asked for.
  const [pendingHeading, setPendingHeading] = useState<string | null>(null);
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
          if (singleMode) setPendingHeading(targetChunk.id);
          else onNav(file.id, targetChunk.id);
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
          if (singleMode) setPendingHeading(targetChunk.id);
          else onNav(file.id, targetChunk.id);
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

  const renderPage = useMemo(() => {
    let content = activeChunk.content.replace(/^\s*(#{1,6})\s+[^\n]+(\n|$)/, "");

    // Strip leading horizontal rules (often left over when users separate sections with ---)
    while (true) {
      const next = content.replace(/^\s*(?:[-*_][ \t]*){3,}(?:\r?\n|$)/, "");
      if (next === content) break;
      content = next;
    }
    // Characters stripped from the front: where the rendered page starts
    // within the page's source, for source addressing.
    const lead = activeChunk.content.length - content.length;

    // Strip trailing horizontal rules
    while (true) {
      const next = content.replace(/(?:\r?\n|^)\s*(?:[-*_][ \t]*){3,}\s*$/, "");
      if (next === content) break;
      content = next;
    }

    return { markdown: prepareWorkspaceEmbeds(content), lead };
  }, [activeChunk.content]);
  const renderContent = renderPage.markdown;

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

  // Where what is rendered sits in the file, so every rendered block carries
  // its file span (lib/markdown/source-address.ts). A page's offset is found
  // by walking the pages in order: an identical page earlier in the file must
  // not be mistaken for this one.
  const addressing = useMemo<SourceAddressing | undefined>(() => {
    if (singleMode) return { file: file.content, rendered: markdownSource, base: 0 };
    let cursor = 0;
    for (const chunk of allChunks) {
      const at = file.content.indexOf(chunk.content, cursor);
      if (at === -1) return undefined;
      if (chunk.id === activeChunk.id)
        return { file: file.content, rendered: markdownSource, base: at + renderPage.lead };
      cursor = at + chunk.content.length;
    }
    return undefined;
  }, [singleMode, file.content, markdownSource, allChunks, activeChunk.id, renderPage.lead]);

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
  // The element `contentRef` holds: one per document and page (or whole-document
  // render), so nothing rendered for one document is reconciled into another's.
  const contentKey = `${file.id}:${singleMode ? "full" : activeChunk.id}`;
  // The source whose render is complete in `contentRef`. A long document
  // mounts in steps; everything that reads the rendered document as a whole —
  // painting highlights, finding a saved passage or search hit, scrolling to a
  // heading — waits until the whole of it is there.
  const [renderedSource, setRenderedSource] = useState<string | null>(null);
  const settled = !editMode && renderedSource === markdownSource;
  const settledRef = useRef(settled);
  settledRef.current = settled;
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
        /** The selection itself, kept for copying it as Markdown. */
        range?: Range;
      }
    | { mode: "edit"; hl: Highlight; x: number; y: number; label: string };
  const [menu, setMenu] = useState<HlMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // A selection inside a figure in full screen (a JSON tree) opens the menu
  // there, since <body> is not painted while it is up.
  const menuContainer = usePortalContainer();

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
      // A copy, so typing a label (which clears the live selection) or
      // clicking a button in the menu doesn't take it away.
      range: range?.cloneRange(),
    });
  };

  const openEditMenu = (hl: Highlight, x: number, y: number) => {
    setMenu({ mode: "edit", hl, x, y, label: hl.label ?? "" });
  };

  // Sections the reader has wrapped up, by heading id. Cleared on a document
  // switch: the ids belong to the document that was open.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  // Reset during render, on an actual switch only. An effect keyed on `file.id`
  // also ran on mount, after the first commit: a fold made while a long
  // document was still mounting could land before that effect flushed, and the
  // "reset" then wiped it.
  const [foldsFileId, setFoldsFileId] = useState(file.id);
  if (foldsFileId !== file.id) {
    setFoldsFileId(file.id);
    setCollapsedSections(new Set());
  }

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
  useSectionFolds(contentRef, collapsedSections, `${contentKey}:${editMode}`);

  // Opening a passage from a note's source link: once the target page is rendered,
  // scroll to the passage and flash it. Anchored by quote first (the document
  // may have been edited since it was saved), by stored offsets only as a hint.
  useEffect(() => {
    if (!pendingSaved || !settled) return;
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
      let atomic: Element | null = null;
      // An addressed passage (a note's link) lands on exactly its span.
      if (pendingSaved.span) {
        const addressed = rangeOfAddress(container, pendingSaved.span, file.content);
        if (addressed) {
          atomic = addressed.atomic;
          range = atomic ? null : addressed.range;
        }
      }
      if (!range && !atomic && !heading && !image && pendingSaved.text) {
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
        (atomic && boxOf(atomic)) ??
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
  }, [pendingSaved, settled, renderContent, fullRender, onSavedShown, file.content]);

  // "Inspect" — the reader's answer to DevTools' inspect element. Take the
  // rendered text under the pointer, find where it lives in the markdown
  // source, and drop the editor's caret on it, selected and scrolled into view.
  // State rather than a ref: the editor downloads on first use, so the jump
  // below has to wait for it to exist rather than find it missing and drop.
  const [editor, setEditor] = useState<MarkdownEditorHandle | null>(null);
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

  /**
   * The page range the open menu acts on: the selection kept when it opened,
   * rebuilt from its offsets if a re-render replaced its nodes — or, for a
   * highlight being edited, the range it is painted over.
   */
  const menuRange = (): Range | null => {
    const container = contentRef.current;
    if (!container || !menu) return null;
    if (
      menu.mode === "create" &&
      menu.range &&
      !menu.range.collapsed &&
      container.contains(menu.range.commonAncestorContainer)
    )
      return menu.range;
    if (menu.mode === "create") return buildRange(container, menu.start, menu.end);
    return paintedHighlights.current.find((painted) => painted.hl.id === menu.hl.id)?.range ?? null;
  };

  /** The file span of the menu's range (lib/markdown/source-address.ts). */
  const menuAddress = (): SourceSpan | null => {
    const container = contentRef.current;
    const range = menuRange();
    return container && range ? addressOfRange(container, range, file.content) : null;
  };

  const inspect = (text: string) => {
    // The selection's own address, read off the rendered blocks: exact, even
    // for a phrase the document repeats. The text search below is only for
    // content the renderer couldn't address (converted HTML).
    const addressed = menuAddress();
    // Paged mode renders one section, so prefer a match inside that section —
    // a phrase repeated elsewhere shouldn't hijack the jump.
    const chunkStart = singleMode ? -1 : file.content.indexOf(activeChunk.content);
    const prefer =
      chunkStart >= 0 && !singleMode
        ? { from: chunkStart, to: chunkStart + activeChunk.content.length }
        : undefined;
    const span = addressed ?? locateInSource(file.content, text, prefer);

    setMenu(null);
    window.getSelection()?.removeAllRanges();
    setInspectMissed(!span);
    setEditMode(true);
    setPendingSelect(span ?? { start: Math.max(0, chunkStart), end: Math.max(0, chunkStart) });
  };

  /**
   * Keep the selection as a note: its content as clean Markdown (see
   * selection-markdown.ts), plus a quote anchor to find it again by.
   *
   * The saved range is preferred; if a re-render has since replaced the nodes
   * it pointed into, it is rebuilt from the offsets taken when the menu opened.
   */
  const copyToNotes = () => {
    const container = contentRef.current;
    if (!onCopyToNotes || !container || menu?.mode !== "create") return;
    const range = menuRange();
    const address = range ? addressOfRange(container, range, file.content) : null;
    const content =
      (range && selectionToMarkdown(range, container, diagramSourceOf)) || menu.text.trim();

    // The heading the passage sits under. Paged mode strips each page's own
    // title from the render (it is the masthead), so the page stands in for it.
    let heading: HTMLElement | null = null;
    if (range) {
      for (const candidate of container.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")) {
        const before =
          candidate.contains(range.startContainer) ||
          !!(
            candidate.compareDocumentPosition(range.startContainer) &
            Node.DOCUMENT_POSITION_FOLLOWING
          );
        if (!before) break;
        if (candidate.id) heading = candidate;
      }
    }
    const page = singleMode ? undefined : activeChunk;
    onCopyToNotes({
      content,
      source: {
        // From the same text index `findAnchor` searches when the note is
        // followed back. `Selection.toString()` is layout-aware (it adds line
        // breaks around KaTeX's spans), so it never matches that index exactly
        // across an equation, and the jump would flash only a prefix.
        quote: textBetween(container, menu.start, menu.end) || menu.text,
        prefix: menu.prefix,
        suffix: menu.suffix,
        start: menu.start,
        end: menu.end,
        subtopicId: page?.id,
        headingId: heading?.id ?? page?.id,
        sectionTitle: heading?.textContent?.trim() || page?.title,
        // Where in the file, which is what the link back follows first.
        anchor: address ? anchorSpan(file.content, address) : undefined,
      },
    });
    window.getSelection()?.removeAllRanges();
    setMenu(null);
  };

  const copySource = (text: string) => {
    // The selection's source lines, by address; failing that, like Inspect,
    // by text, preferring the section on screen.
    const addressed = menuAddress();
    const chunkStart = singleMode ? -1 : file.content.indexOf(activeChunk.content);
    const prefer =
      chunkStart >= 0 && !singleMode
        ? { from: chunkStart, to: chunkStart + activeChunk.content.length }
        : undefined;
    const lines = addressed && lineSpan(file.content, addressed);
    const source =
      (lines && file.content.slice(lines.start, lines.end)) ??
      sourceLinesForSelection(file.content, text, prefer) ??
      text;
    void copyText(source);
    window.getSelection()?.removeAllRanges();
    setMenu(null);
  };

  // Applied once the editor has mounted with the document's source.
  useEffect(() => {
    if (!pendingSelect) return;
    // Left the editor before it arrived: the jump belongs to that visit only.
    if (!editMode) return setPendingSelect(null);
    if (!editor) return;
    const { start, end } = pendingSelect;
    setPendingSelect(null);
    editor.select(start, end);
  }, [pendingSelect, editMode, editor]);

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

  const paintedHighlights = useRef<Array<{ hl: Highlight; range: Range }>>([]);

  // Paint persistent highlights with the CSS Custom Highlight API — no DOM
  // mutation, so React re-renders never wipe them and cross-node selections
  // highlight correctly. Groups map to ::highlight(dc-hl-N) rules in the CSS.
  useEffect(() => {
    const container = contentRef.current;
    const painter = createHighlightPainter();
    if (!container || !painter.supported || !highlights.length) return;
    // Mid-edit the rendered document is a moving target (the draft autosaves
    // every 400ms). Re-anchoring waits for the reader to leave the editor.
    // It also waits for a long document to finish mounting: anchoring against
    // part of it could settle on an earlier repeat of the quote, and write that
    // wrong position back as a repair.
    if (!settled) return;

    // Deferred to the next frame so adding a highlight doesn't repaint every
    // other one synchronously inside the same commit the reader is watching.
    const paint = () => {
      paintedHighlights.current = [];
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
          if (hl.subtopicId && sectionExists && hl.subtopicId !== activeChunk.id) continue;
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
            if (
              range &&
              !range.collapsed &&
              (owned || !sectionExists) &&
              (hl.start !== anchor.start || hl.end !== anchor.end || hl.orphaned || !sectionExists)
            ) {
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
        paintedHighlights.current.push({ hl, range });
        const g = hlGroup(hl.color);
        (groups[g] ||= []).push(range);
      }

      painter.paint(groups);

      // Re-runs this effect, which then takes the fast path for every repaired
      // highlight and produces no further repairs.
      if (repairs.length) onRepairHighlights?.(repairs);
    };
    let frame = requestAnimationFrame(paint);
    // Syntax plugins, diagrams, folds and embeds can replace text nodes
    // without changing the markdown prop. Rebuild ranges after those commits.
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      paintedHighlights.current = [];
      painter.clear();
    };
  }, [
    highlights,
    activeChunk.id,
    renderContent,
    fullRender,
    settled,
    singleMode,
    knownChunkIds,
    file.content,
    onRepairHighlights,
  ]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container || !settled || !highlightQuery?.trim()) return;
    const painter = createHighlightPainter();
    if (!painter.supported) return;
    const paint = () => painter.paint({ "dc-query": queryRanges(container, highlightQuery ?? "") });
    let frame = requestAnimationFrame(paint);
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      painter.clear();
    };
  }, [highlightQuery, activeChunk.id, singleMode, settled, file.id]);

  useEffect(() => {
    const container = contentRef.current;
    return () => {
      if (container) releaseTextIndex(container);
    };
  }, [activeChunk.id, singleMode, editMode, file.id]);

  // Click inside the content: if the click lands on an existing highlight, open
  // its edit popover (CSS highlights aren't DOM nodes, so we hit-test offsets).
  const onContentClick = (e: React.MouseEvent) => {
    if (editMode || !contentRef.current) return;
    if (!highlights.length) return; // nothing to hit-test against
    if (!window.getSelection()?.isCollapsed) return; // a drag-select, not a click
    const off = offsetFromPoint(contentRef.current, e.clientX, e.clientY);
    if (off == null) return;
    // Use the ranges actually painted in this pane, including re-anchored
    // section highlights shown in whole-document mode and legacy highlights.
    const point = buildRange(contentRef.current, off, off + 1);
    if (!point) return;
    const hit = paintedHighlights.current.find(({ range }) => {
      if (range.comparePoint(point.startContainer, point.startOffset) !== 0) return false;
      const rects = range.getClientRects();
      return Array.from(rects).some(
        (rect) =>
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom,
      );
    });
    if (hit) openEditMenu(hit.hl, e.clientX, e.clientY);
  };

  // Keep the whole menu on screen. It opens at the selection and grows down,
  // so a selection near the bottom of the window (the last lines of a
  // document, which can't scroll any higher) pushed its lower row — the label
  // field — past the edge, out of reach. Measured
  // before paint, so it never appears in the wrong place first.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!menu || !element) return;
    const margin = 8;
    const { height } = element.getBoundingClientRect();
    const top = parseFloat(element.style.top) || 0;
    const fits = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
    if (fits !== top) element.style.top = `${fits}px`;
  }, [menu]);

  // Close the menu on outside click / Escape (but keep it open while the reader
  // interacts with the popover itself).
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    // An Escape one of its dropdowns already handled (Radix marks it
    // defaultPrevented) closes only that dropdown.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && setMenu(null);
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

  /** The header's pencil: into the editor, caret at the top. */
  const enterEditMode = useCallback(() => {
    setEditMode(true);
    setPendingSelect({ start: 0, end: 0 });
  }, []);

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
  // Single-page: switching document scrolls to top; selecting a section from
  // the sidebar scrolls to that heading's anchor within the full document.
  //
  // A heading that isn't in the DOM yet — a long document still mounting — is
  // scrolled to once the render is complete, by the effect below.
  useEffect(() => {
    const target = singleMode
      ? activeSubtopicId
      : activeSubtopicId && activeSubtopicId !== activeChunk.id
        ? activeSubtopicId
        : null;
    if (!target) {
      setPendingHeading(null);
      scrollToTop();
      return;
    }
    const el = settledRef.current ? document.getElementById(target) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else setPendingHeading(target);
    // `settled` is read through a ref: finishing a render must not repeat the
    // scroll for a heading the reader has already been taken to.
  }, [activeChunk.id, activeSubtopicId, file.id, singleMode]);

  useEffect(() => {
    if (!pendingHeading || !settled) return;
    setPendingHeading(null);
    const el = document.getElementById(pendingHeading);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else scrollToTop();
  }, [pendingHeading, settled]);

  // A clicked `\eqref`. The equation may be on another page (paginated mode)
  // or not mounted yet (a long document), so the jump waits for the render to
  // settle. Kept apart from `pendingHeading`, which a page change clears.
  const [pendingEquation, setPendingEquation] = useState<string | null>(null);
  const navigateToEquation = useCallback(
    (label: string) => {
      const domId = `eq-${slugLabel(label)}`;
      const labelled = new RegExp(`\\\\label\\s*\\{\\s*${escapeRegExp(label)}\\s*\\}`);
      const owner = singleMode ? null : allChunks.find((chunk) => labelled.test(chunk.content));
      if (owner && owner.id !== activeChunk.id) onNav(file.id, owner.id);
      setPendingEquation(domId);
    },
    [singleMode, allChunks, activeChunk.id, onNav, file.id],
  );
  useEffect(() => {
    if (!pendingEquation || !settled) return;
    setPendingEquation(null);
    // Instant, like a fragment link. A smooth scroll picks its destination
    // once, and the display equations it passes (content-visibility) take
    // their real size as they render, so it stopped short in long documents.
    document.getElementById(pendingEquation)?.scrollIntoView({ block: "center" });
  }, [pendingEquation, settled]);

  /** Search rows for the source lines this view renders: the whole file in
   *  single-page mode, else the active page without the heading that
   *  `renderContent` strips from its top. */
  const searchRowsOnScreen = useCallback(() => {
    const rows = parseRows(file.content);
    if (singleMode) return rows;
    const chunkStart = file.content.indexOf(activeChunk.content);
    if (chunkStart < 0) return [];
    const first = file.content.slice(0, chunkStart).split("\n").length - 1;
    const end = first + activeChunk.content.split("\n").length;
    const page = rows.filter((row) => row.lineIndex >= first && row.lineIndex < end);
    return /^\s*#{1,6}\s+\S/.test(activeChunk.content) && page[0]?.isHeading ? page.slice(1) : page;
  }, [file.content, singleMode, activeChunk.content]);

  /**
   * Land on the search hit itself.
   *
   * Declared after the two heading scrolls and deferred a frame, so it is the
   * last word on where the reader ends up: those effects have already moved to
   * the heading (or given up and gone to the top) by the time this runs, and a
   * second smooth scroll simply retargets the first.
   *
   * The hit is one particular occurrence of the query, and the word itself
   * usually recurs all over the page, so the hit is located by counting: it
   * is the Nth occurrence among the source lines on screen, and — when the page
   * holds exactly as many occurrences as those lines do — the Nth on the page.
   * When the counts disagree (a diagram or embed renders differently from its
   * source), it falls back to the hit's line, then to the query anywhere.
   */
  useEffect(() => {
    if (!pendingSearch || !settled) return;
    if (!contentRef.current) return;
    const frame = requestAnimationFrame(() => {
      const container = contentRef.current;
      if (!container) return;
      const { query, text, occurrence, lineIndex } = pendingSearch;
      let range: Range | null = null;
      let atomic: Element | null = null;
      // The hit's own address: its line and occurrence, mapped to the file
      // and then onto the page. Exact for a table cell or a repeated word; a
      // hit in a diagram's source lands on the diagram, at the label that
      // shows the word when there is one.
      const span = searchHitSpan(file.content, lineIndex, text, query, occurrence);
      const addressed = span && rangeOfAddress(container, span, file.content);
      if (addressed) {
        atomic = addressed.atomic;
        range = atomic ? queryRangeWithin(atomic, query) : addressed.range;
      }
      // Unaddressed content (converted HTML): count occurrences as before.
      if (!addressed && query && lineIndex >= 0) {
        const at = occurrenceOrdinal(searchRowsOnScreen(), query, lineIndex, occurrence);
        if (at) {
          const nth = nthQueryRange(container, query, at.ordinal);
          if (nth.count === at.total) range = nth.range;
        }
      }
      if (!addressed)
        range ??= text
          ? firstQueryRangeInLine(container, text, query, occurrence)
          : query
            ? firstTextRange(container, query)
            : null;
      const target = range ? elementOf(range) : atomic && boxOf(atomic);
      const landed = range && rangeOffsets(container, range);
      const landedText = range?.toString();
      // The passage in the container's current DOM, should a re-render have
      // replaced the nodes `range` points into.
      const reanchor = () =>
        landed && textBetween(container, landed.start, landed.end) === landedText
          ? buildRange(container, landed.start, landed.end)
          : null;
      if (range) scrollToPassage(range, () => (range.collapsed ? reanchor() : range));
      else target?.scrollIntoView({ behavior: "smooth", block: "center" });
      // The same one-shot flash a note source link gets, for the same reason: on a
      // dense page, arriving is not the same as seeing where you arrived.
      flashPassage(range, target, landed ? { container, reanchor } : undefined);

      onSearchShown?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [
    pendingSearch,
    settled,
    renderContent,
    fullRender,
    onSearchShown,
    searchRowsOnScreen,
    file.content,
  ]);

  // Reading progress now lives in <ReadingProgress>, which writes the
  // percentage straight to its own DOM node. It used to be state up here, and
  // because the number changes on nearly every frame of a scroll it re-rendered
  // this whole component — markdown tree included — once per frame.

  // The Cmd/Ctrl+S shortcut belongs to the editor, which is where the draft is.

  const stats = useMemo(() => {
    const src = singleMode ? file.content : activeChunk.content;
    return { words: wordCount(src), readingMin: readingMinutes(src) };
  }, [singleMode, file.content, activeChunk.content]);

  // What the markdown renderers read about this document (see
  // `markdown-components.tsx`). The renderers themselves never change, so a
  // change here re-renders only the few elements that read it.
  const renderCtx = useMemo<MarkdownRenderContextValue>(
    () => ({
      file,
      media: {
        workspaceId,
        workspaceRevision,
        workspaceFiles,
        workspaceFolders,
        workspaceName,
        sourceFile: file,
      },
      anchorTargets: convertedAnchors.targets,
      onNav,
      contentRef,
      openLightbox: setLightbox,
    }),
    [
      file,
      workspaceId,
      workspaceRevision,
      workspaceFiles,
      workspaceFolders,
      workspaceName,
      convertedAnchors,
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
        /* Exporting lives in the document's own row in the sidebar, under
           ⋮ ▸ Export, where every format is listed. What is left
           here acts on the document on screen: edit it, or change how it
           reads. In the editor this must be `undefined`, not an empty wrapper,
           or the header has no way to tell it is empty and reserves its height
           for nothing. */
        actions={
          !editMode ? (
            <div className="flex items-center gap-1">
              {onToggleNotes && (
                <button
                  onClick={onToggleNotes}
                  aria-label="Notes"
                  aria-pressed={notesOpen}
                  title={notesOpen ? "Hide notes" : "Show notes"}
                  className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground coarse:h-11 coarse:w-11 ${
                    notesOpen ? "bg-accent text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <NotebookPen className="h-4 w-4" />
                </button>
              )}
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
              <EditButton onEdit={enterEditMode} />
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
              className="fixed z-(--z-dropdown) -translate-x-1/2 flex flex-col gap-1 rounded-xl border border-border bg-popover p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-100"
              style={{
                top: Math.min(Math.max(56, menu.y - 12), window.innerHeight - 50),
                left: Math.min(Math.max(160, menu.x), window.innerWidth - 160),
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-1">
                {/* Colors */}
                {HL_COLORS.map((color) => {
                  const active = menu.mode === "edit" ? menu.hl.color === color : false;
                  return (
                    <button
                      key={color}
                      aria-label={`Highlight ${color}`}
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
                      className={cn(
                        "h-5 w-5 rounded-full border-2 border-transparent transition-transform hover:scale-110",
                        active && "border-foreground",
                      )}
                      style={{ backgroundColor: color }}
                    />
                  );
                })}

                <div className="mx-1 h-4 w-px bg-border" />

                {/* Actions */}
                {menu.mode === "create" && onAskAi && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        aria-label="AI actions"
                        className="flex h-7 items-center gap-1 rounded px-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Sparkles className="h-3.5 w-3.5" /> AI
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="z-(--z-menu)">
                      {[
                        { label: "Ask AI", action: undefined },
                        { label: "Summarize", action: "summary" },
                        { label: "Explain", action: "explain" },
                        { label: "Rewrite", action: "rewrite" },
                        { label: "Notes", action: "notes" },
                        { label: "Mermaid", action: "mermaid" },
                      ].map((item) => (
                        <DropdownMenuItem
                          key={item.label}
                          onClick={() => {
                            onAskAi({ selection: menu.text, actionId: item.action });
                            window.getSelection()?.removeAllRanges();
                            setMenu(null);
                          }}
                        >
                          {item.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      menu.mode === "create" ? menu.text : menu.hl.text,
                    );
                    setMenu(null);
                  }}
                  className="flex h-7 items-center justify-center rounded px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Copy"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>

                {menu.mode === "create" && onCopyToNotes && (
                  <button
                    onClick={copyToNotes}
                    className="flex h-7 items-center justify-center rounded px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Copy selection to notes"
                  >
                    <NotebookPen className="h-3.5 w-3.5" />
                  </button>
                )}

                {menu.mode === "edit" && (
                  <button
                    onClick={() => {
                      onRemoveHighlight(menu.hl.id);
                      setMenu(null);
                    }}
                    className="flex h-7 items-center justify-center rounded px-1.5 text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                    title="Remove highlight"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label="More highlight actions"
                      className="flex h-7 items-center justify-center rounded px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  {/* Portalled to <body>, so it needs --z-menu to sit above this
                      --z-dropdown popover; opening to the side keeps it from
                      covering the highlight controls. */}
                  <DropdownMenuContent
                    side="right"
                    align="start"
                    sideOffset={8}
                    className="z-(--z-menu)"
                  >
                    <DropdownMenuItem
                      onClick={() => {
                        inspect(menu.mode === "create" ? menu.text : menu.hl.text);
                        setMenu(null);
                      }}
                    >
                      <Crosshair className="mr-2 h-4 w-4" /> Inspect source
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        copySource(menu.mode === "create" ? menu.text : menu.hl.text);
                        setMenu(null);
                      }}
                    >
                      <Code2 className="mr-2 h-4 w-4" /> Copy code
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {menu.mode === "edit" && (
                  <button
                    onClick={() => setMenu(null)}
                    className="flex h-7 items-center justify-center rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground ml-auto"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Optional Label Input if they want to add one quickly */}
              <div className="flex items-center gap-1.5 rounded bg-muted/30 px-2 py-0.5 border border-transparent focus-within:border-border transition-colors">
                <Tag className="h-3 w-3 text-muted-foreground" />
                <input
                  value={menu.label || ""}
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
                  placeholder="Add a label..."
                  className="w-full bg-transparent py-1 text-xs outline-none placeholder:text-muted-foreground/60"
                />
              </div>
            </div>,
            menuContainer ?? document.body,
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
                ref={setEditor}
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
                key={contentKey}
                ref={contentRef}
                onClick={onContentClick}
                aria-busy={settled ? undefined : true}
              >
                <MarkdownRenderContext.Provider value={renderCtx}>
                  <CollapseContext.Provider value={collapseCtx}>
                    {/* Numbered from the whole document, not the page on
                          screen, so equation numbers and references stay put
                          as the reader pages through. */}
                    <MathProvider
                      source={file.content}
                      preferences={mathPreferences}
                      navigateToEquation={navigateToEquation}
                    >
                      <ProgressiveMarkdown
                        addressing={addressing}
                        source={markdownSource}
                        urlTransform={mediaUrlTransform}
                        remarkPlugins={remarkPlugins}
                        rehypePlugins={rehypePlugins}
                        components={markdownComponents}
                        onRendered={setRenderedSource}
                      />
                    </MathProvider>
                  </CollapseContext.Provider>
                </MarkdownRenderContext.Provider>
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
