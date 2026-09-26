import { lazy, useCallback, useMemo } from "react";
import { MarkdownViewer } from "./MarkdownViewer";
import { getDocumentKind } from "@/lib/markdown/document-utils";
import type { Highlight } from "@/lib/markdown/dom-highlighter";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import type { ReadingMode } from "@/lib/workspace/persistence";
import type { MathPreferences } from "@/services/math";
import type { SavedDraft, SavedItem } from "@/lib/workspace/saved-items";

const EMPTY_HIGHLIGHTS: Highlight[] = [];
const EMPTY_SAVED: SavedItem[] = [];

// Keep non-markdown readers out of the initial reading bundle, just as the
// single-document path does in DocsApp. The Suspense boundary around the main
// content column also covers panes that load this viewer.
const DocumentViewer = lazy(() =>
  import("./DocumentViewer").then((module) => ({ default: module.DocumentViewer })),
);

/**
 * One pane's document.
 *
 * The single-pane reader gets its props from `DocsApp`, which can afford to
 * derive them for "the active file" because there is only one. In a split there
 * are several documents on screen at once, so each pane narrows the
 * workspace-level collections to its own file here rather than the parent
 * building one set of props per pane.
 *
 * Deliberately thin: the viewer is unchanged, and everything panes add is
 * either a filter over a list or a partial application of a callback that
 * already takes a file id.
 */
export function PaneDocument({
  file,
  files,
  saved,
  highlights,
  workspaceId,
  workspaceRevision,
  workspaceName,
  onContentChange,
  onRenameFile,
  onAddHighlight,
  onUpdateHighlight,
  onRemoveHighlight,
  onRepairHighlights,
  onToggleSaved,
  onRemoveSaved,
  onOpenArtifact,
  readingMode,
  mathPreferences,
  startInEditFileId,
  onStartInEditConsumed,
  activeSubtopicId = null,
  highlightQuery = null,
  pendingSearch = null,
  onSearchShown,
}: {
  file: MdFile;
  files: MdFile[];
  saved: SavedItem[];
  highlights: Highlight[];
  workspaceId: string | null;
  workspaceRevision: string;
  workspaceName: string;
  onContentChange: (fileId: string, content: string) => void;
  onRenameFile: (fileId: string, name: string) => void;
  onAddHighlight: (hl: Omit<Highlight, "id" | "fileId">, fileId: string) => void;
  onUpdateHighlight: (id: string, patch: Partial<Pick<Highlight, "color" | "label">>) => void;
  onRemoveHighlight: (id: string) => void;
  onRepairHighlights?: (patches: Array<{ id: string; patch: Partial<Highlight> }>) => void;
  onToggleSaved: (fileId: string, draft: SavedDraft) => void;
  onRemoveSaved: (id: string) => void;
  onOpenArtifact?: (fileId: string, workspaceId: string) => void;
  readingMode: ReadingMode;
  mathPreferences?: MathPreferences;
  startInEditFileId?: string | null;
  onStartInEditConsumed?: () => void;
  /**
   * Where a jump from search or the sidebar is pointing, passed down only for
   * the pane holding the document it names — the parent gates these, because a
   * heading id or a matched line means nothing to the other columns.
   *
   * These used to be hard-coded to `null` here, on the reasoning that paging
   * belongs to the single-document reader. But a search hit is not paging: it
   * is a request to be taken to one passage, and in a split it was silently
   * dropped, so opening a hit put the document on screen and left the reader to
   * find the line themselves.
   */
  activeSubtopicId?: string | null;
  highlightQuery?: string | null;
  pendingSearch?: { text: string; query: string } | null;
  onSearchShown?: () => void;
}) {
  const fileHighlights = useMemo(() => {
    const mine = highlights.filter((hl) => hl.fileId === file.id);
    return mine.length > 0 ? mine : EMPTY_HIGHLIGHTS;
  }, [highlights, file.id]);

  const fileSaved = useMemo(() => {
    const mine = saved.filter((item) => item.fileId === file.id);
    return mine.length > 0 ? mine : EMPTY_SAVED;
  }, [saved, file.id]);

  const addHighlight = useCallback(
    (hl: Omit<Highlight, "id" | "fileId">) => onAddHighlight(hl, file.id),
    [onAddHighlight, file.id],
  );
  const toggleSaved = useCallback(
    (draft: SavedDraft) => onToggleSaved(file.id, draft),
    [onToggleSaved, file.id],
  );
  const renameFile = useCallback(
    (name: string) => onRenameFile(file.id, name),
    [onRenameFile, file.id],
  );

  // A split is a layout concern, not a document-type mode. Resolve the viewer
  // for this pane alone so markdown, boards, PDFs, spreadsheets, and every
  // other supported kind can sit beside one another.
  const kind = file.kind ?? getDocumentKind(file.name, file.mimeType);

  if (kind !== "markdown" && kind !== "text") {
    return (
      <DocumentViewer
        key={file.id}
        file={file}
        isBookmarked={fileSaved.some((item) => item.kind === "file")}
        onToggleBookmark={() => onToggleSaved(file.id, { kind: "file", title: file.name })}
        prevFile={null}
        nextFile={null}
        onNavFile={() => {}}
        onContentChange={onContentChange}
        fillAvailableHeight
        startInEditFileId={startInEditFileId}
        onStartInEditConsumed={onStartInEditConsumed}
      />
    );
  }

  return (
    <MarkdownViewer
      // Keyed by document for the same reason the editor is: a pane switching
      // tabs must not hand one document's editor state to the next.
      key={file.id}
      file={file}
      prevFile={null}
      nextFile={null}
      // Paging between documents belongs to the single-document reader. In a
      // split, the tab strip is how you move between them.
      onNav={() => {}}
      activeSubtopicId={activeSubtopicId}
      highlightQuery={highlightQuery}
      pendingSearch={pendingSearch}
      onSearchShown={onSearchShown}
      onContentChange={onContentChange}
      onRenameFile={renameFile}
      startInEditFileId={startInEditFileId}
      onStartInEditConsumed={onStartInEditConsumed}
      nextReadingMin={null}
      isBookmarked={fileSaved.some((item) => item.kind === "file")}
      onToggleBookmark={() => onToggleSaved(file.id, { kind: "file", title: file.name })}
      highlights={fileHighlights}
      onAddHighlight={addHighlight}
      onUpdateHighlight={onUpdateHighlight}
      onRemoveHighlight={onRemoveHighlight}
      onRepairHighlights={onRepairHighlights}
      saved={fileSaved}
      onToggleSaved={toggleSaved}
      onRemoveSaved={onRemoveSaved}
      readingMode={readingMode}
      mathPreferences={mathPreferences}
      workspaceId={workspaceId}
      workspaceRevision={workspaceRevision}
      workspaceFiles={files}
      workspaceName={workspaceName}
      onOpenArtifact={onOpenArtifact}
    />
  );
}
