import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
// `xlsx` (~563 kB) and `jszip` (~273 kB) are imported where they are used, not
// here: a static import put both in the app's main chunk, so every reader
// downloaded a spreadsheet parser and a zip reader before they could open a
// markdown file. Word documents already followed this pattern with `mammoth`.
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Filter,
  Maximize,
  Minimize,
  Presentation,
  Search,
  Star,
  Trash2,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RefreshCw,
  Pencil,
  Network,
  ListTree,
  Code2,
  Eye,
} from "lucide-react";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import {
  dataUrlToArrayBuffer,
  dataUrlToBlob,
  fileLabel,
  getDocumentKind,
  googleUrl,
  DISCARD_PROMPT,
} from "@/lib/markdown/document-utils";
import { buildMindMap } from "@/services/mindmap";
import { JsonTree } from "./JsonTree";
import { ViewerHeader, type ViewerNav } from "../navigation/ViewerHeader";
import { ESCAPE_DEPTH, useNavEscape } from "@/hooks/use-nav-history";
import { MermaidBlock } from "@/services/diagrams";
import { BoardCanvas } from "@/services/board";
import { MarkdownEditor } from "../editor/MarkdownEditor";

// Only readers who actually open a mind map pay for the layout engine and its
// renderer, in keeping with how the spreadsheet and Word viewers load.
const MindMapView = lazy(() =>
  import("@/services/mindmap/MindMapView").then((module) => ({ default: module.MindMapView })),
);

interface Props {
  file: MdFile;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  onRemoveFile?: () => void;
  /** Sibling files, so the shared header's prev/next can move between files. */
  prevFile?: MdFile | null;
  nextFile?: MdFile | null;
  onNavFile?: (fileId: string) => void;
  /** Rendered inside markdown content: strip all chrome, show only the content. */
  embedded?: boolean;
  /** Fill a bounded parent (such as a split pane) instead of the viewport. */
  fillAvailableHeight?: boolean;
  /** Persist an edited document. Omitted where the viewer is read-only. */
  onContentChange?: (fileId: string, content: string) => void;
  /** Opens the workspace command palette from the header's search field. */
  onOpenPalette?: () => void;
  /**
   * Document the sidebar asked to edit. Editing is entered from the file's
   * three-dots menu rather than a header button, so the request arrives here
   * the same way it does for markdown. Cleared through `onStartInEditConsumed`.
   */
  startInEditFileId?: string | null;
  onStartInEditConsumed?: () => void;
}
interface GoogleProps extends Props {
  isSlides: boolean;
}

/**
 * Document name without its extension, for labels. Unlike the markdown
 * viewer's version this drops any trailing extension, since this file serves
 * every document type.
 */
const stripExt = (name: string) => name.replace(/\.[^./\\]+$/, "");

/** File-level prev/next for the shared header — used by every non-deck viewer. */
function useFileNav({
  prevFile,
  nextFile,
  onNavFile,
}: Pick<Props, "prevFile" | "nextFile" | "onNavFile">): ViewerNav {
  return {
    onPrev: () => prevFile && onNavFile?.(prevFile.id),
    onNext: () => nextFile && onNavFile?.(nextFile.id),
    prevDisabled: !prevFile || !onNavFile,
    nextDisabled: !nextFile || !onNavFile,
    // The pager names the destination rather than the direction — the arrow
    // already says which way it goes.
    prevLabel: prevFile ? `Previous: ${stripExt(prevFile.name)}` : "Previous file",
    nextLabel: nextFile ? stripExt(nextFile.name) : "Next file",
  };
}

function DocumentViewerImpl(props: Props) {
  const { file } = props;
  const kind = file.kind ?? getDocumentKind(file.name, file.mimeType);
  if (kind === "pdf") return <PdfViewer {...props} />;
  if (kind === "docx") return <DocxViewer {...props} />;
  if (kind === "spreadsheet" || kind === "csv") return <SpreadsheetViewer {...props} />;
  if (kind === "json") return <JsonViewer {...props} />;
  if (kind === "mermaid") return <MermaidFileViewer {...props} />;
  if (kind === "board") return <BoardFileViewer {...props} />;
  if (kind === "html") return <HtmlFileViewer {...props} />;
  if (kind === "presentation") return <PresentationViewer {...props} />;
  if (kind === "image") return <ImageViewer {...props} />;
  if (kind === "google-doc" || kind === "google-slide")
    return <GoogleViewer {...props} isSlides={kind === "google-slide"} />;
  return <UnknownViewer {...props} />;
}

/**
 * Memoized for the same reason as the markdown viewer: parsing a spreadsheet or
 * a deck is expensive, and an app-shell re-render must not trigger it again.
 */
export const DocumentViewer = memo(DocumentViewerImpl);

/** A standalone .mmd/.mermaid document. Its source remains portable: optional
 * `flow:` frontmatter is understood by mermaid-animator here and ignored by
 * ordinary Mermaid renderers elsewhere. */
function MermaidFileViewer({
  file,
  prevFile,
  nextFile,
  onNavFile,
  onContentChange,
  onOpenPalette,
  startInEditFileId,
  onStartInEditConsumed,
}: Props) {
  const [editing, setEditing] = useState(false);
  const originalContentRef = useRef(file.content);

  useEffect(() => {
    originalContentRef.current = file.content;
    setEditing(false);
    // Content echoes from the parent must not replace the snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  useEffect(() => {
    if (startInEditFileId !== file.id || editing) return;
    setEditing(true);
    onStartInEditConsumed?.();
  }, [editing, file.id, onStartInEditConsumed, startInEditFileId]);

  // Leaving discards — nothing is written until Done — so a draft that differs
  // from the file asks first. The editor owns the draft text, so the snapshot
  // taken on entry is what this can compare against.
  useNavEscape(
    editing,
    () => {
      if (file.content !== originalContentRef.current && !window.confirm(DISCARD_PROMPT)) return;
      setEditing(false);
    },
    ESCAPE_DEPTH.mode,
  );

  return (
    <ViewerFrame
      file={file}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
      action={
        !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit animation
          </button>
        ) : undefined
      }
    >
      {editing ? (
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
          <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            Add a YAML <code>flow:</code> block before the Mermaid source to choreograph routes,
            waits, parallel packets, and node states. Done saves, Cancel discards.
          </div>
          <MarkdownEditor
            initialContent={file.content}
            fileId={file.id}
            // The editor reports the document the text was typed into, so a
            // commit that lands after a file switch still goes to the right
            // file. `undefined` content means the draft never changed.
            onDone={(fileId, content) => {
              if (content !== undefined) onContentChange?.(fileId, content);
              setEditing(false);
            }}
            // Nothing was written, so cancelling only leaves.
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <div className="mx-auto max-w-6xl px-4 py-4 md:px-8">
          <MermaidBlock code={file.content} name={file.name} />
        </div>
      )}
    </ViewerFrame>
  );
}

/**
 * A standalone `.excalidraw` board. The canvas is the editor — there is no
 * separate edit mode to enter, and no markdown editor is offered for it: a
 * board's source is an Excalidraw scene, and letting someone type into it by
 * hand would only corrupt the document.
 */
function BoardFileViewer({ file, onContentChange, fillAvailableHeight }: Props) {
  return (
    <div
      className={`min-h-0 min-w-0 overflow-hidden ${
        fillAvailableHeight ? "h-full w-full" : "h-[calc(100dvh-3.5rem)] w-full lg:h-dvh"
      }`}
    >
      {/* No padding, no card, no border: a board is a surface, not a figure on
          a page. Framing it the way a diagram is framed is exactly what made it
          read as an embedded iframe rather than part of the app. */}
      <BoardCanvas
        fileId={file.id}
        content={file.content}
        onContentChange={
          onContentChange ? (content) => onContentChange(file.id, content) : undefined
        }
      />
    </div>
  );
}

/** How long typing has to pause before an HTML draft is handed to the parent. */
const HTML_AUTOSAVE_MS = 600;

/**
 * A standalone `.html` / `.htm` document, rendered rather than described.
 *
 * The page runs in a fully sandboxed frame — `sandbox=""`, matching
 * `InlineArtifact` — which is the whole security story here. An uploaded HTML
 * file is untrusted input: granting `allow-same-origin` would put it in the
 * app's own origin, where its scripts could read the entire IndexedDB
 * workspace. An empty sandbox blocks scripts, forms, popups and same-origin
 * access, so the preview shows layout and styling while the document stays
 * inert. `srcDoc` keeps it local — nothing is uploaded to render it.
 *
 * The source toggle is offered because a blocked-script page can look
 * misleadingly empty; seeing the markup explains why.
 *
 * The markup is also editable. An `.html` file is text the reader owns, the
 * same as a `.md` one, and it was the odd case out: the sidebar's "Edit" item
 * was simply absent for it, so a document you could read and whose source you
 * could stare at was the one document you could not change. Editing writes
 * through the same autosave path every other text document uses, and the
 * preview re-renders from the draft as soon as it lands.
 */
function HtmlFileViewer({
  file,
  isBookmarked,
  onToggleBookmark,
  prevFile,
  nextFile,
  onNavFile,
  onContentChange,
  onOpenPalette,
  startInEditFileId,
  onStartInEditConsumed,
}: Props) {
  // Preview first: rendering the page is the point of opening it. Source is a
  // deliberate step away from that, the way it is in a browser.
  const [showSource, setShowSource] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(file.content);

  // The source Cancel puts back. Captured when the editor opens, not when the
  // document does: autosave has been writing the draft into `file.content`, so
  // a snapshot taken at open time would revert past an earlier session's work.
  const originalRef = useRef(file.content);

  // A new document starts in preview rather than inheriting the previous file's
  // mode — the toggle describes how you are reading *this* page. The draft is
  // re-seeded per document, not per content change, so the parent echoing an
  // autosave back doesn't clobber what has been typed since.
  useEffect(() => {
    setShowSource(false);
    setEditing(false);
    setDraft(file.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  // Autosave, matching the markdown and JSON editors.
  useEffect(() => {
    if (!editing || draft === file.content) return;
    const timer = setTimeout(() => onContentChangeRef.current?.(file.id, draft), HTML_AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, editing, file.content, file.id]);

  const beginEdit = () => {
    originalRef.current = file.content;
    setDraft(file.content);
    setEditing(true);
  };

  const doneEdit = () => setEditing(false);

  const cancelEdit = () => {
    setDraft(originalRef.current);
    onContentChange?.(file.id, originalRef.current);
    setEditing(false);
  };

  // "Edit" from the file's sidebar menu, the same channel the other editors
  // are opened through.
  useEffect(() => {
    if (startInEditFileId !== file.id || editing) return;
    beginEdit();
    onStartInEditConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startInEditFileId, file.id]);

  useNavEscape(editing, cancelEdit, ESCAPE_DEPTH.mode);
  useNavEscape(!editing && showSource, () => setShowSource(false), ESCAPE_DEPTH.mode);

  // While editing, the preview follows the draft rather than the last saved
  // content, so the frame is a live answer to what has just been typed.
  const previewSource = editing ? draft : file.content;

  return (
    <ViewerFrame
      file={file}
      isBookmarked={isBookmarked}
      onToggleBookmark={onToggleBookmark}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
      action={
        editing ? (
          // The editing session's own controls, the way the JSON editor does
          // it. Entering the editor stays a file action in the sidebar menu.
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={cancelEdit}
              className="flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doneEdit}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-xs font-medium text-background hover:opacity-90"
            >
              <Eye className="h-3.5 w-3.5" /> Done · Preview
            </button>
          </div>
        ) : (
          editing ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={cancelEdit}
              className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commitEdit}
              className="inline-flex h-8 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
              title="Save and stop editing"
            >
              Done
            </button>
          </div>
        ) : (
          <button
              type="button"
              onClick={() => setShowSource((on) => !on)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-pressed={showSource}
            >
              {showSource ? (
                <>
                  <Eye className="h-3.5 w-3.5" /> Preview
                </>
              ) : (
                <>
                  <Code2 className="h-3.5 w-3.5" /> Source
                </>
              )}
            </button>
        )
        )
      }
    >
      {editing ? (
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            aria-label="Edit HTML source"
            className="h-[calc(100dvh-16rem)] w-full resize-none rounded-xl border border-hairline bg-surface-sunken p-4 font-mono text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-primary/20"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Editing the page source — changes save automatically.
          </p>
          {/* The live result, kept alongside the markup rather than behind a
              toggle: an HTML edit is only meaningful next to what it renders. */}
          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
              Preview
            </div>
            <iframe
              title={`${file.name} preview`}
              srcDoc={previewSource}
              sandbox=""
              className="h-[45dvh] w-full border-0 bg-white"
            />
          </div>
        </div>
      ) : showSource ? (
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
          <pre className="overflow-x-auto rounded-xl border border-border bg-muted/30 p-4 text-xs leading-relaxed">
            <code>{file.content}</code>
          </pre>
        </div>
      ) : (
        <iframe
          title={file.name}
          srcDoc={previewSource}
          sandbox=""
          className="h-[calc(100dvh-7.5rem)] w-full border-0 bg-white"
        />
      )}
    </ViewerFrame>
  );
}

/**
 * The masthead a non-text file opens with.
 *
 * Markdown documents get their title, file name and reading time from the
 * reader's own header. Everything else — a sheet, a JSON file, a deck — opened
 * straight into its content with no name anywhere on screen, on the reasoning
 * that the sidebar already marks the active file. It does, until the sidebar is
 * collapsed, or the window is narrow enough that it becomes a drawer, or the
 * reader simply came back to the tab: then the open document is anonymous.
 *
 * Costs one line, and gives every file type the same opening as a document.
 */
function ViewerMasthead({
  file,
  kindLabel,
  meta,
  actions,
}: {
  file: MdFile;
  kindLabel: string;
  /** One short fact about the file, e.g. "9 rows · 5 columns". */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-4 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>{kindLabel}</span>
          {meta && (
            <>
              <span aria-hidden className="font-normal text-border">
                ·
              </span>
              <span className="font-medium normal-case tracking-normal">{meta}</span>
            </>
          )}
        </p>
        <h1 className="mt-1 truncate text-lg font-semibold tracking-[-0.015em] text-foreground">
          {file.name}
        </h1>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  );
}

function ViewerFrame({
  children,
  action,
  navAction,
  isBookmarked,
  onToggleBookmark,
  prevFile,
  nextFile,
  onNavFile,
  onOpenPalette,
}: {
  /**
   * Accepted so call sites can keep passing the open document, and to leave the
   * per-type `icon` prop in place, but the header no longer renders either: the
   * sidebar marks the active file, so this space belongs to search.
   */
  file?: MdFile;
  children: React.ReactNode;
  action?: React.ReactNode;
  navAction?: React.ReactNode;
  icon?: React.ReactNode;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
} & Pick<Props, "prevFile" | "nextFile" | "onNavFile" | "onOpenPalette">) {
  const nav = useFileNav({ prevFile, nextFile, onNavFile });
  return (
    <section className="min-h-[calc(100dvh-4rem)] bg-background">
      <ViewerHeader
        navAction={navAction}
        // Starring and editing live in the file's three-dots menu in the
        // sidebar, next to the other things you do *to* a document. What stays
        // here is per-view state — zoom, fullscreen, the mind map — which has
        // no meaning anywhere else.
        actions={action}
      />
      {children}
    </section>
  );
}

function PdfViewer({
  file,
  isBookmarked,
  onToggleBookmark,
  prevFile,
  nextFile,
  onNavFile,
  onOpenPalette,
}: Props) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const blob = dataUrlToBlob(file.data, "application/pdf");
    if (!blob) return;
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file.data]);
  return (
    <ViewerFrame
      file={file}
      isBookmarked={isBookmarked}
      onToggleBookmark={onToggleBookmark}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
    >
      {url ? (
        <iframe
          title={`Preview ${file.name}`}
          src={url}
          className="h-[calc(100dvh-7.5rem)] w-full bg-muted"
        />
      ) : (
        <Loading label="Preparing PDF preview" />
      )}
    </ViewerFrame>
  );
}

function DocxViewer({
  file,
  isBookmarked,
  onToggleBookmark,
  prevFile,
  nextFile,
  onNavFile,
  onOpenPalette,
}: Props) {
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const buffer = dataUrlToArrayBuffer(file.data);
    if (!buffer) {
      setError("This Word file is missing its document data.");
      return;
    }
    void (async () => {
      try {
        const module = (await import("mammoth/mammoth.browser")) as unknown as {
          default?: MammothBrowser;
        } & MammothBrowser;
        const mammoth = module.default ?? module;
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
        // mammoth's output is HTML derived from an untrusted file, and it goes
        // straight into `dangerouslySetInnerHTML` below. mammoth does not
        // promise a safe subset — a crafted .docx can carry through markup that
        // executes — so the string is sanitized before it is ever mounted.
        // Dropped in its own chunk alongside mammoth, so readers who never open
        // a Word file pay nothing for it.
        const { default: DOMPurify } = await import("dompurify");
        const safe = DOMPurify.sanitize(result.value);
        if (alive) setHtml(safe);
      } catch {
        if (alive) setError("This Word document could not be read in the browser.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [file.data]);
  return (
    <ViewerFrame
      file={file}
      isBookmarked={isBookmarked}
      onToggleBookmark={onToggleBookmark}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
    >
      {error ? (
        <ErrorState message={error} />
      ) : !html ? (
        <Loading label="Formatting Word document" />
      ) : (
        <article
          className="docx-prose mx-auto max-w-4xl px-5 py-10 md:px-10"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </ViewerFrame>
  );
}

interface MammothBrowser {
  convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
}

type SheetData = { name: string; rows: string[][] };

const ROW_HEIGHT = 33;
const OVERSCAN = 12;

/**
 * Numeric-aware cell compare. `localeCompare` with `numeric: true` builds a
 * fresh Intl collator per call, which dominates the profile when sorting tens
 * of thousands of rows; comparing numbers directly and falling back to a single
 * shared collator is around two orders of magnitude cheaper.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
function compareCells(a: string, b: string): number {
  if (a === b) return 0;
  const na = Number(a);
  const nb = Number(b);
  const aNumeric = a !== "" && !Number.isNaN(na);
  const bNumeric = b !== "" && !Number.isNaN(nb);
  if (aNumeric && bNumeric) return na - nb;
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return collator.compare(a, b);
}

function SpreadsheetViewer({
  file,
  isBookmarked,
  onToggleBookmark,
  prevFile,
  nextFile,
  onNavFile,
  onOpenPalette,
}: Props) {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const [deferredQuery, setDeferredQuery] = useState("");
  const [sort, setSort] = useState<{ column: number; direction: 1 | -1 } | null>(null);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 600 });
  // Typing is decoupled from filtering: the input stays responsive while the
  // scan over every cell runs once the user pauses, instead of on each keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDeferredQuery(query), 140);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const XLSX = await import("xlsx");
        if (!alive) return;
        const kind = file.kind ?? getDocumentKind(file.name, file.mimeType);
        const workbook =
          kind === "csv"
            ? XLSX.read(file.content, { type: "string", dense: true })
            : XLSX.read(dataUrlToArrayBuffer(file.data), {
                type: "array",
                dense: true,
                // Styles, formula text and volatile metadata are never rendered
                // here, and parsing them is a large share of the cost on a big
                // workbook.
                cellStyles: false,
                cellFormula: false,
                cellHTML: false,
              });
        const next = workbook.SheetNames.map((name) => {
          const raw = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
            header: 1,
            defval: "",
            blankrows: false,
          }) as unknown[][];
          // Stringified in place. Mapping into a second matrix doubles peak
          // memory for a sheet that can already be hundreds of megabytes.
          for (let r = 0; r < raw.length; r++) {
            const row = raw[r];
            for (let c = 0; c < row.length; c++) {
              const value = row[c];
              if (typeof value !== "string") row[c] = value == null ? "" : String(value);
            }
          }
          return { name, rows: raw as string[][] };
        });
        if (!alive) return;
        setSheets(next);
        setActive(0);
        setError("");
      } catch {
        if (alive) setError("This spreadsheet could not be read.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [file.content, file.data, file.kind, file.mimeType, file.name]);
  const sheet = sheets[active];
  const headers = sheet?.rows[0] ?? [];
  const rows = useMemo(() => {
    const body = sheet?.rows;
    if (!body || body.length < 2) return [] as string[][];
    const needle = deferredQuery.trim().toLowerCase();
    let source: string[][];
    if (needle) {
      source = [];
      // Hand-rolled loops: the needle is lowercased once rather than per cell,
      // and no intermediate array is allocated for the rows that are filtered out.
      for (let r = 1; r < body.length; r++) {
        const row = body[r];
        for (let c = 0; c < row.length; c++) {
          if (row[c].toLowerCase().includes(needle)) {
            source.push(row);
            break;
          }
        }
      }
    } else {
      source = body.slice(1);
    }
    if (!sort) return source;
    const { column, direction } = sort;
    // slice() only when the array is still the parsed one, so a filtered result
    // is sorted in place instead of copied again.
    const sorted = source === body ? source.slice() : source;
    sorted.sort((a, b) => compareCells(a[column] ?? "", b[column] ?? "") * direction);
    return sorted;
  }, [sheet, deferredQuery, sort]);

  /*
   * Which columns hold figures.
   *
   * Decided per column from the body rather than per cell, so one stray "n/a"
   * in a revenue column does not left-align that one number and break the
   * column's right edge. A column counts as numeric when it has at least one
   * number in it and nothing that is clearly not one — empties are ignored,
   * since a blank tells you nothing about the column's type.
   *
   * Sampled from the head of the sheet: a hundred rows settle the question, and
   * the alternative is walking a 50,000-row export on every render.
   */
  const numericColumns = useMemo(() => {
    const body = sheet?.rows;
    if (!body || body.length < 2) return [] as boolean[];
    const width = body[0]?.length ?? 0;
    const limit = Math.min(body.length, 101);
    const result: boolean[] = [];
    for (let c = 0; c < width; c++) {
      let seen = 0;
      let numeric = true;
      for (let r = 1; r < limit; r++) {
        const cell = body[r]?.[c]?.trim();
        if (!cell) continue;
        seen++;
        // Currency, thousands separators and a trailing percent still describe
        // a quantity, so they are stripped before the test rather than
        // disqualifying the column.
        if (!/^[-+]?[$£€]?\d[\d,\s]*(\.\d+)?%?$/.test(cell)) {
          numeric = false;
          break;
        }
      }
      result.push(numeric && seen > 0);
    }
    return result;
  }, [sheet]);

  // Only the rows overlapping the scroll window are turned into DOM. Rendering
  // every row of a large export is what made these files unusable: the cost is
  // now bounded by viewport height, not by row count.
  const total = rows.length;
  const first = Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    total,
    Math.ceil((viewport.scrollTop + viewport.height) / ROW_HEIGHT) + OVERSCAN,
  );
  const visible = rows.slice(first, last);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = () => setViewport({ scrollTop: node.scrollTop, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [sheet]);

  // Scrolling back to the top on a new sheet or filter keeps the window aligned
  // with what is actually being shown.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = 0;
    setViewport((prev) => ({ ...prev, scrollTop: 0 }));
  }, [active, deferredQuery, sort]);
  return (
    <ViewerFrame
      file={file}
      isBookmarked={isBookmarked}
      onToggleBookmark={onToggleBookmark}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
    >
      {error ? (
        <ErrorState message={error} />
      ) : !sheet ? (
        <Loading label="Loading spreadsheet" />
      ) : (
        <div className="mx-auto max-w-7xl p-4 md:p-7">
          <ViewerMasthead
            file={file}
            kindLabel={/\.csv$/i.test(file.name) ? "CSV" : "Spreadsheet"}
            meta={
              <>
                {rows.length.toLocaleString()} {rows.length === 1 ? "row" : "rows"} ·{" "}
                {headers.length} {headers.length === 1 ? "column" : "columns"}
              </>
            }
            actions={
              /* The search field used to be the first thing in the panel and
                 ran the full width of it — a control sized for a thousand rows
                 sitting above nine. It is a filter, so it is sized like one and
                 placed with the other controls. */
              <div className="relative w-52">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter rows"
                  aria-label="Filter rows"
                  className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                />
              </div>
            }
          />
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-(--shadow-1)">
            {sheets.length > 1 && (
              <div className="flex gap-1 overflow-x-auto border-b border-border px-2 pt-2">
                {sheets.map((item, index) => (
                  <button
                    key={item.name}
                    onClick={() => {
                      setActive(index);
                      setSort(null);
                    }}
                    className={`shrink-0 rounded-t-md px-3 py-2 text-xs font-semibold ${active === index ? "bg-background text-primary shadow-[0_-1px_0_var(--color-border)]" : "text-muted-foreground hover:bg-accent"}`}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}
            <div
              ref={scrollRef}
              onScroll={(e) =>
                setViewport({
                  scrollTop: e.currentTarget.scrollTop,
                  height: e.currentTarget.clientHeight,
                })
              }
              className="max-h-[calc(100dvh-15rem)] overflow-auto"
            >
              <table className="spreadsheet-table w-full border-collapse text-left text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-20 w-12 bg-muted px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                      #
                    </th>
                    {headers.map((header, column) => (
                      <th
                        key={`${header}-${column}`}
                        onClick={() =>
                          setSort((previous) =>
                            previous?.column === column
                              ? { column, direction: previous.direction === 1 ? -1 : 1 }
                              : { column, direction: 1 },
                          )
                        }
                        aria-sort={
                          sort?.column === column
                            ? sort.direction === 1
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                        /* A numeric column's heading follows its figures to the
                           right edge. A heading that sits left of the column it
                           labels reads as belonging to the column beside it. */
                        className={`sticky top-0 z-10 cursor-pointer select-none whitespace-nowrap bg-muted px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-accent ${
                          numericColumns[column] ? "text-right" : "text-left"
                        }`}
                      >
                        {header || `Column ${column + 1}`}
                        {/* The caret holds its space whether or not the column
                            is the sorted one, so clicking through the headings
                            does not shunt every other column sideways. */}
                        <span
                          aria-hidden
                          className={`ml-1 inline-block w-2 ${sort?.column === column ? "text-primary" : "text-transparent"}`}
                        >
                          {sort?.column === column && sort.direction === -1 ? "↓" : "↑"}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Spacers stand in for the rows outside the window so the
                      scrollbar still reflects the full sheet. */}
                  {first > 0 ? (
                    <tr style={{ height: first * ROW_HEIGHT }} aria-hidden>
                      <td colSpan={headers.length + 1} className="p-0" />
                    </tr>
                  ) : null}
                  {visible.map((row, offset) => {
                    const rowIndex = first + offset;
                    return (
                      <tr key={rowIndex} style={{ height: ROW_HEIGHT }}>
                        <td className="sticky left-0 z-10 bg-card px-3 py-2 text-right text-xs text-muted-foreground">
                          {rowIndex + 1}
                        </td>
                        {headers.map((_, column) => (
                          <td
                            key={column}
                            /* Figures are set right-aligned and tabular, so
                               digits line up in columns and the eye can compare
                               magnitudes down the column without reading a
                               single number. Left-aligned proportional figures
                               — what this was — make 2840000 and 412 look the
                               same length. Text stays left. */
                            className={`whitespace-nowrap border-t border-hairline px-3 py-2 text-foreground/85 ${
                              numericColumns[column]
                                ? "text-right font-medium tabular-nums"
                                : "text-left"
                            }`}
                          >
                            {row[column]}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {last < total ? (
                    <tr style={{ height: (total - last) * ROW_HEIGHT }} aria-hidden>
                      <td colSpan={headers.length + 1} className="p-0" />
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </ViewerFrame>
  );
}

function JsonViewer({
  file,
  isBookmarked,
  onToggleBookmark,
  prevFile,
  nextFile,
  onNavFile,
  onContentChange,
  onOpenPalette,
  startInEditFileId,
  onStartInEditConsumed,
}: Props) {
  const [mode, setMode] = useState<"tree" | "mindmap">("tree");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(file.content);

  const formatted = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(file.content), null, 2);
    } catch {
      return file.content;
    }
  }, [file.content]);

  // Parsed once per document, and shared by the tree and the mind map. `null`
  // means the file isn't valid JSON, in which case only the raw views apply.
  const parsed = useMemo<{ value: unknown } | null>(() => {
    try {
      return { value: JSON.parse(file.content) };
    } catch {
      return null;
    }
  }, [file.content]);

  // The draft is re-seeded per document rather than per content change, so a
  // content echo from the parent doesn't clobber what's been typed since.
  useEffect(() => {
    setDraft(file.content);
    setEditing(false);
    setMode("tree");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const draftError = useMemo(() => {
    if (!editing) return null;
    try {
      JSON.parse(draft);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid JSON";
    }
  }, [draft, editing]);

  // Commit and leave, matching the markdown editor: nothing is written until
  // the reader presses Done. Invalid JSON can't be committed at all, so a
  // document is never persisted in a half-typed state.
  const commitEdit = () => {
    if (draftError) return;
    if (draft !== file.content) onContentChange?.(file.id, draft);
    setEditing(false);
  };

  const beginEdit = () => {
    setDraft(formatted);
    setEditing(true);
    // The editor is itself the raw view, so there is no separate raw mode to
    // switch to — only the mind map has to be left behind.
    setMode("tree");
  };

  // Discard: the draft was never written, so dropping it is the whole job.
  const cancelEdit = () => {
    setDraft(file.content);
    setEditing(false);
  };

  // "Edit" from the file's sidebar menu. Entering the editor is no longer a
  // header button, so this is how the request arrives.
  useEffect(() => {
    if (startInEditFileId !== file.id || editing) return;
    beginEdit();
    onStartInEditConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startInEditFileId, file.id]);

  // Back leaves the editor and the mind map, the same as their own exit
  // controls do — a mode you entered is the last thing you did, so it is the
  // first thing back should undo.
  //
  // Leaving discards, so a draft with real changes in it asks first. Nothing is
  // written on the way out: Done is the only path that saves.
  const escapeEdit = () => {
    if (draft !== file.content && !window.confirm(DISCARD_PROMPT)) return;
    cancelEdit();
  };
  useNavEscape(editing, escapeEdit, ESCAPE_DEPTH.mode);
  useNavEscape(!editing && mode === "mindmap", () => setMode("tree"), ESCAPE_DEPTH.mode);

  const applyFormat = () => {
    try {
      setDraft(JSON.stringify(JSON.parse(draft), null, 2));
    } catch {
      // Unparseable drafts are left exactly as typed; the inline error already
      // says why, and reformatting would have nothing to work from.
    }
  };

  // Built once per document. Invalid JSON, a flat shape, or a file too large to
  // draw all return null, and the action is simply not offered — the viewer
  // below is unchanged in every one of those cases.
  const mindMap = useMemo(
    () => buildMindMap(file.content, file.name.replace(/\.json$/i, "")),
    [file.content, file.name],
  );

  const lines = formatted.split("\n");
  const showMap = mode === "mindmap" && Boolean(mindMap);

  // A two-position toggle showing both destinations at once, so the mind map is
  // visibly available rather than hidden behind a button that renames itself.
  // Tree is the default and stays on the left.
  const modeSwitch =
    !editing && parsed && mindMap ? (
      <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5">
        {(
          [
            { value: "tree", label: "Tree", icon: ListTree },
            { value: "mindmap", label: "Mind map", icon: Network },
          ] as const
        ).map(({ value, label, icon: Icon }) => {
          const active = (value === "mindmap") === showMap;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={active}
              title={value === "mindmap" ? "Show as mind map" : "Show as tree"}
              className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <ViewerFrame
      file={file}
      isBookmarked={isBookmarked}
      onToggleBookmark={onToggleBookmark}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
      navAction={modeSwitch}
      action={
        // Entering the editor is the file's own action and lives in its
        // sidebar menu. What stays here belongs to the editing session itself:
        // reformatting the draft, and leaving.
        editing ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={applyFormat}
              className="flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Format
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            {/* The only write path. Disabled on a draft that isn't valid JSON —
                the inline error below says why. */}
            <button
              type="button"
              onClick={commitEdit}
              disabled={Boolean(draftError)}
              title={draftError ? "Fix the JSON before saving" : "Save and stop editing"}
              className="flex h-8 items-center rounded-md bg-foreground px-2.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Done · Save
            </button>
          </div>
        ) : null
      }
    >
      {showMap ? (
        <Suspense fallback={<Loading label="Building mind map" />}>
          <MindMapView tree={mindMap!} />
        </Suspense>
      ) : (
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
          <ViewerMasthead
            file={file}
            kindLabel="JSON"
            meta={
              parsed && !editing
                ? `${lines.length.toLocaleString()} ${lines.length === 1 ? "line" : "lines"}`
                : undefined
            }
          />
          {editing ? (
            <div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                aria-label="Edit JSON"
                className={`h-[calc(100dvh-13rem)] w-full resize-none rounded-xl border bg-surface-sunken p-4 font-mono text-sm leading-6 text-foreground outline-none focus:ring-2 ${
                  draftError
                    ? "border-destructive focus:ring-destructive/20"
                    : "border-border focus:ring-primary/20"
                }`}
              />
              <p
                className={`mt-2 text-xs ${draftError ? "text-destructive" : "text-muted-foreground"}`}
                role={draftError ? "alert" : undefined}
              >
                {draftError ?? "Valid JSON — Done saves, Cancel discards."}
              </p>
            </div>
          ) : parsed ? (
            <JsonTree value={parsed.value} />
          ) : (
            <pre className="max-h-[calc(100dvh-13rem)] overflow-auto rounded-xl border border-hairline bg-surface-sunken p-4 text-sm leading-6 text-foreground">
              <code>
                {lines.map((line, index) => (
                  <div key={index}>
                    <span className="mr-5 inline-block w-7 select-none text-right text-muted-foreground/70">
                      {index + 1}
                    </span>
                    {line}
                  </div>
                ))}
              </code>
            </pre>
          )}
        </div>
      )}
    </ViewerFrame>
  );
}

type Slide = { number: number; title: string; text: string };
function PresentationViewer({
  file,
  isBookmarked,
  onToggleBookmark,
  embedded,
  onOpenPalette,
}: Props) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  // Back takes the deck out of fullscreen before it leaves the document, so a
  // presenting reader is not dropped straight out of what they were showing.
  useNavEscape(isFullscreen, () => void document.exitFullscreen?.(), ESCAPE_DEPTH.mode);

  useEffect(() => {
    setSlides([]);
    setCurrent(0);
    setError("");
    const buffer = dataUrlToArrayBuffer(file.data);
    if (!buffer) {
      setError(
        "This presentation was saved before binary previews were available. Remove it and upload the original .ppt or .pptx file again.",
      );
      return;
    }
    void (async () => {
      try {
        const { default: JSZip } = await import("jszip");
        const zip = await JSZip.loadAsync(buffer);
        const paths = Object.keys(zip.files)
          .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
          .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
        if (!paths.length) throw new Error("legacy");
        const next = await Promise.all(
          paths.map(async (path, index) => {
            const xml = await zip.file(path)!.async("string");
            const values = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
              .map((match) => decodeXml(match[1]).trim())
              .filter(Boolean);
            return {
              number: index + 1,
              title: values[0] || `Slide ${index + 1}`,
              text: values.slice(1).join("\n"),
            };
          }),
        );
        setSlides(next);
        setCurrent(0);
      } catch {
        // Binary .ppt files do not share the OOXML slide tree used by PPTX.
        // Preserve their readable text as a deck so the same slide controls
        // remain useful instead of dropping the reader into a download-only flow.
        const legacySlides = extractLegacyPptSlides(buffer);
        if (legacySlides.length) {
          setSlides(legacySlides);
          setCurrent(0);
        } else {
          setError("This PowerPoint file does not contain readable slide text.");
        }
      }
    })();
  }, [file.id, file.data]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") setCurrent((value) => Math.min(value + 1, slides.length - 1));
      if (event.key === "ArrowLeft") setCurrent((value) => Math.max(value - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length]);
  const slide = slides[current];
  const goPrev = () => setCurrent((value) => Math.max(value - 1, 0));
  const goNext = () => setCurrent((value) => Math.min(value + 1, slides.length - 1));
  const slideEl = slide && (
    <article className="presentation-slide">
      <div className="absolute inset-0 opacity-90 [background:radial-gradient(circle_at_85%_12%,#45b7e8_0,transparent_32%),radial-gradient(circle_at_12%_90%,#6c5ce7_0,transparent_42%),linear-gradient(135deg,#ffffff_0%,#edf3fb_100%)]" />
      <div className="relative flex h-full flex-col justify-center p-[8%] text-slate-900">
        <div className="mb-5 h-1.5 w-14 rounded-full bg-sky-500" />
        <h1 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight md:text-6xl">
          {slide.title}
        </h1>
        {slide.text && (
          <p className="mt-7 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-slate-600 md:text-xl">
            {slide.text}
          </p>
        )}
      </div>
    </article>
  );

  // Embedded in markdown: reading-only. No header, no rail, no fullscreen —
  // just the slide and two swipe buttons.
  if (embedded) {
    return (
      <section
        ref={containerRef}
        className="presentation-shell relative bg-background text-foreground"
      >
        {error ? (
          <ErrorState message={error} />
        ) : !slide ? (
          <Loading label="Building presentation" />
        ) : (
          <div className="relative flex items-center justify-center overflow-hidden p-4 md:p-8">
            {slideEl}
            {slides.length > 1 && (
              <>
                <button
                  onClick={goPrev}
                  disabled={current === 0}
                  aria-label="Previous slide"
                  className="deck-nav left-3"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  onClick={goNext}
                  disabled={current === slides.length - 1}
                  aria-label="Next slide"
                  className="deck-nav right-3"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      ref={containerRef}
      className="presentation-shell min-h-[calc(100dvh-4rem)] bg-background text-foreground"
    >
      <ViewerHeader
        actions={
          <>
            {slides.length > 0 && (
              <span className="min-w-12 text-center text-xs text-muted-foreground tabular-nums">
                {current + 1} / {slides.length}
              </span>
            )}
            <button
              onClick={toggleFullscreen}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </>
        }
      />
      {error ? (
        <ErrorState message={error} />
      ) : !slide ? (
        <Loading label="Building presentation" />
      ) : (
        <div className="flex min-h-[calc(100dvh-7.5rem)] flex-col">
          <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4 md:p-8">
            {slideEl}
          </div>
          <div className="presentation-rail">
            {slides.map((item, index) => (
              <button
                key={item.number}
                onClick={() => setCurrent(index)}
                className={`presentation-thumb ${current === index ? "is-active" : ""}`}
                aria-label={`Show slide ${item.number}`}
              >
                <span className="text-xs text-muted-foreground">{item.number}</span>
                <span className="presentation-thumb-card">
                  <strong>{item.title}</strong>
                  <small>{item.text}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function GoogleViewer({
  file,
  isSlides,
  isBookmarked,
  onToggleBookmark,
  prevFile,
  nextFile,
  onNavFile,
  onOpenPalette,
}: GoogleProps) {
  const url = googleUrl(file.content);
  const preview = url?.replace(/\/edit(?:\?.*)?$/, "/preview");
  return (
    <ViewerFrame
      file={file}
      isBookmarked={isBookmarked}
      onToggleBookmark={onToggleBookmark}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
    >
      {preview ? (
        <iframe
          title={`Google ${isSlides ? "Slides" : "Doc"} ${file.name}`}
          src={preview}
          className="h-[calc(100dvh-7.5rem)] w-full bg-white"
          allowFullScreen
        />
      ) : (
        <ErrorState
          message={`Add a shared Google ${isSlides ? "Slides" : "Docs"} link to this .${isSlides ? "gslides" : "gdoc"} file to preview it here.`}
        />
      )}
    </ViewerFrame>
  );
}
function ImageViewer({
  file,
  isBookmarked,
  onToggleBookmark,
  prevFile,
  nextFile,
  onNavFile,
  onOpenPalette,
}: Props) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  // Back steps out of fullscreen first, leaving the reader on the image rather
  // than on whatever they were looking at before it.
  useNavEscape(isFullscreen, () => void document.exitFullscreen?.(), ESCAPE_DEPTH.mode);

  // Prefer the stored data URL; fall back to inline text (data:/http) so legacy
  // saves and linked images still render. SVG, GIF, WebP, AVIF, etc. all ride
  // the browser's native <img> decoder — no format-specific handling needed.
  const src =
    file.data || (/^(data:|https?:)/.test(file.content.trim()) ? file.content.trim() : "");

  const reset = () => {
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  };
  useEffect(reset, [file.id]);

  const clampZoom = (value: number) => Math.min(8, Math.max(0.1, value));
  const zoomBy = (factor: number) =>
    setZoom((z) => {
      const next = clampZoom(z * factor);
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });

  // Zooming is the +/− buttons' job only. Pinch (ctrl/meta+wheel on trackpads,
  // gesture* in Safari) is swallowed rather than acted on: left alone it becomes
  // a browser page zoom that persists after leaving the viewer. Native
  // non-passive listeners — React's onWheel is passive, so preventDefault there
  // is a no-op.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    const swallow = (event: Event) => event.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", swallow);
    el.addEventListener("gesturechange", swallow);
    el.addEventListener("gestureend", swallow);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", swallow);
      el.removeEventListener("gesturechange", swallow);
      el.removeEventListener("gestureend", swallow);
    };
  }, [src, broken]);
  const onPointerDown = (event: React.PointerEvent) => {
    if (zoom <= 1) return;
    (event.target as Element).setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({ x: drag.ox + (event.clientX - drag.x), y: drag.oy + (event.clientY - drag.y) });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div ref={containerRef} className="bg-background">
      <ViewerFrame
        file={file}
        isBookmarked={isBookmarked}
        onToggleBookmark={onToggleBookmark}
        prevFile={prevFile}
        nextFile={nextFile}
        onNavFile={onNavFile}
        onOpenPalette={onOpenPalette}
        action={
          <div className="flex items-center gap-1">
            <IconBtn label="Zoom out" onClick={() => zoomBy(1 / 1.25)} disabled={!src || broken}>
              <ZoomOut className="h-4 w-4" />
            </IconBtn>
            <button
              onClick={reset}
              disabled={!src || broken}
              title="Reset zoom"
              className="min-w-12 rounded-md px-1 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              {Math.round(zoom * 100)}%
            </button>
            <IconBtn label="Zoom in" onClick={() => zoomBy(1.25)} disabled={!src || broken}>
              <ZoomIn className="h-4 w-4" />
            </IconBtn>
            <IconBtn
              label="Rotate"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              disabled={!src || broken}
            >
              <RotateCw className="h-4 w-4" />
            </IconBtn>
            <IconBtn
              label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              onClick={toggleFullscreen}
              disabled={!src || broken}
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </IconBtn>
          </div>
        }
      >
        {!src ? (
          <ErrorState message="This image is missing its data. Remove it and upload the file again." />
        ) : broken ? (
          <ErrorState message="This image could not be decoded by the browser." />
        ) : (
          <div
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="image-canvas flex min-h-[calc(100dvh-7.5rem)] items-center justify-center overflow-hidden p-4 md:p-8"
            style={{
              cursor: zoom > 1 ? (dragRef.current ? "grabbing" : "grab") : "default",
              // Blocks touch pinch-zoom, which would zoom the page not the image.
              touchAction: "none",
            }}
          >
            <img
              src={src}
              alt={file.name}
              draggable={false}
              onLoad={(e) =>
                setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
              }
              onError={() => setBroken(true)}
              className="max-h-full max-w-full select-none rounded-md shadow-lg"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                transition: dragRef.current ? "none" : "transform 0.12s ease-out",
              }}
            />
          </div>
        )}
        {natural && src && !broken && (
          <div className="pointer-events-none fixed bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-background/90 px-3 py-1 text-xs font-medium tabular-nums text-muted-foreground backdrop-blur">
            {natural.w} × {natural.h}
          </div>
        )}
      </ViewerFrame>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function UnknownViewer({
  file,
  isBookmarked,
  onToggleBookmark,
  prevFile,
  nextFile,
  onNavFile,
  onOpenPalette,
}: Props) {
  return (
    <ViewerFrame
      file={file}
      isBookmarked={isBookmarked}
      onToggleBookmark={onToggleBookmark}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
    >
      <ErrorState message="This file was uploaded successfully, but this browser does not have a previewer for its format yet." />
    </ViewerFrame>
  );
}
function Loading({ label, dark = false }: { label: string; dark?: boolean }) {
  return (
    <div
      className={`flex min-h-[55vh] items-center justify-center text-sm ${dark ? "text-white/60" : "text-muted-foreground"}`}
    >
      <span className="mr-3 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label}
    </div>
  );
}
function ErrorState({ message, dark = false }: { message: string; dark?: boolean }) {
  return (
    <div
      className={`flex min-h-[55vh] items-center justify-center px-6 text-center text-sm ${dark ? "text-white/65" : "text-muted-foreground"}`}
    >
      {message}
    </div>
  );
}
function decodeXml(value: string) {
  const el = new DOMParser().parseFromString(`<span>${value}</span>`, "text/html").body;
  return el.textContent ?? value;
}

function extractLegacyPptSlides(buffer: ArrayBuffer): Slide[] {
  const bytes = new Uint8Array(buffer);
  const strings: string[] = [];
  let current = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const code = bytes[index] | (bytes[index + 1] << 8);
    if (code >= 32 && code < 0xfffd) {
      current += String.fromCharCode(code);
    } else {
      if (current.trim().length > 3) strings.push(current.trim());
      current = "";
    }
  }
  if (current.trim().length > 3) strings.push(current.trim());
  return strings
    .filter((text, index, all) => all.indexOf(text) === index)
    .slice(0, 80)
    .map((text, index) => ({
      number: index + 1,
      title: text.split(/\r?\n/)[0].slice(0, 120) || `Slide ${index + 1}`,
      text: text.split(/\r?\n/).slice(1).join("\n").slice(0, 1800),
    }));
}
