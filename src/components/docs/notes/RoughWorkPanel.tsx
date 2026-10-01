import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Check,
  ChevronDown,
  Copy,
  Eraser,
  FileInput,
  FileText,
  Link2,
  Link2Off,
  MoreHorizontal,
  NotebookPen,
  PencilLine,
  PencilRuler,
  Plus,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/ui/modal";
import { splitMarkdownSegments } from "@/lib/markdown/markdown-segments";
import {
  MAX_SCRATCHPAD_TITLE,
  selectedWork,
  type InsertionPoint,
  type Scratchpad,
} from "@/lib/workspace/rough-work";
import type { MathRendererType } from "@/services/math/types";
import { NOTE_COMPONENTS, NOTE_PLUGINS } from "./note-components";
import { NoteRenderContext, type NoteRenderSettings } from "./note-render-context";
import { ScratchpadEditor, type ScratchpadEditorHandle } from "./ScratchpadEditor";
import type { NoteSourceState } from "./NotesPanel";

/** The document rough work can be inserted into, measured when asked. */
export interface InsertTarget {
  fileId: string;
  name: string;
  points: InsertionPoint[];
  /** Why it can't take an insertion right now; Insert stays disabled. */
  blocked?: string;
  /** Hash of the text `points` were measured in; a change since cancels. */
  base: string;
}

export interface InsertRequest {
  /** The scratchpad it came from; none for a computed result. */
  padId?: string;
  markdown: string;
  fileId: string;
  point: InsertionPoint;
  base: string;
}

export interface RoughWorkProps {
  /** Pads for the open document first, then the rest (see `sortScratchpads`). */
  scratchpads: Scratchpad[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** The document in the reader, if any — what "link" and "insert" act on. */
  currentFile: { id: string; name: string } | null;
  fileName: (fileId: string) => string | undefined;
  sourceState: (fileId: string) => NoteSourceState;
  onCreate: () => void;
  onChange: (id: string, content: string) => void;
  onRename: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onClear: (id: string) => void;
  onDelete: (id: string) => void;
  /** Link to `currentFile`, or unlink (null). */
  onLink: (id: string, fileId: string | null) => void;
  onOpenDocument: (fileId: string) => void;
  onSaveAsNote: (id: string, markdown: string) => void;
  insertTarget: () => InsertTarget | null;
  onInsert: (request: InsertRequest) => void;
  onDirtyChange: (dirty: boolean) => void;
}

/**
 * Rough work: scratchpads for trying equations and working things out
 * without touching the document. One pad is open at a time; the picker
 * switches between them, with the open document's pads listed first.
 */
export function RoughWorkPanel({
  scratchpads,
  activeId,
  onSelect,
  currentFile,
  fileName,
  sourceState,
  onCreate,
  onChange,
  onRename,
  onDuplicate,
  onClear,
  onDelete,
  onLink,
  onOpenDocument,
  onSaveAsNote,
  insertTarget,
  onInsert,
  onDirtyChange,
  mathRenderer,
  variant,
}: RoughWorkProps & { mathRenderer: MathRendererType; variant: "docked" | "sheet" }) {
  const pad = scratchpads.find((p) => p.id === activeId) ?? scratchpads[0] ?? null;
  const editorRef = useRef<ScratchpadEditorHandle>(null);
  const [liveText, setLiveText] = useState(pad?.content ?? "");
  const [hasSelection, setHasSelection] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [insert, setInsert] = useState<{
    padId: string;
    markdown: string;
    target: InsertTarget | null;
  } | null>(null);

  // A different pad (or none) starts with its own text and no rename open.
  useEffect(() => {
    setLiveText(pad?.content ?? "");
    setHasSelection(false);
    setRenaming(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pad?.id]);

  const padding = variant === "docked" ? "px-3" : "";

  if (!pad) {
    return (
      <div className="flex flex-col items-center px-6 py-14 text-center">
        <PencilRuler className="mb-3 h-5 w-5 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">No rough work yet</p>
        <p className="mt-1.5 max-w-64 text-xs leading-relaxed text-muted-foreground">
          A private place to try equations and work through steps. Nothing here changes your
          documents unless you insert it.
        </p>
        <button
          onClick={onCreate}
          className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90 coarse:h-11 coarse:px-4"
        >
          <Plus className="h-3.5 w-3.5" /> New scratchpad
        </button>
      </div>
    );
  }

  /** What an action applies to: the selection, or the whole pad. */
  const work = () => {
    const live = editorRef.current?.read();
    if (!live) return selectedWork(pad.content, 0, 0);
    return selectedWork(live.text, live.start, live.end);
  };
  const flush = () => editorRef.current?.flush();

  const linked = pad.fileId;
  const linkedState = linked ? sourceState(linked) : null;
  const linkedName = linked ? (fileName(linked) ?? pad.fileName ?? "Deleted document") : null;
  const empty = !liveText.trim();

  return (
    <div className={`space-y-2.5 pb-6 ${padding}`}>
      {/* Which pad, and what to do with it. */}
      <div className="flex items-center gap-1">
        {renaming ? (
          <RenameField
            title={pad.title}
            onDone={(title) => {
              setRenaming(false);
              if (title !== null) onRename(pad.id, title);
            }}
          />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11"
              aria-label={`Scratchpad: ${pad.title}. Switch scratchpad`}
            >
              <span className="truncate">{pad.title}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="z-(--z-menu) max-h-80 w-64 overflow-y-auto"
            >
              <PadList
                pads={scratchpads}
                activeId={pad.id}
                currentFileId={currentFile?.id ?? null}
                fileName={fileName}
                onSelect={(id) => {
                  flush();
                  onSelect(id);
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <IconButton
          label="New scratchpad"
          onClick={() => {
            flush();
            onCreate();
          }}
        >
          <Plus className="h-4 w-4" />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Scratchpad actions"
            title="Scratchpad actions"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11 coarse:w-11"
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-(--z-menu) w-60">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <PencilLine className="h-4 w-4" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                flush();
                onDuplicate(pad.id);
              }}
            >
              <Copy className="h-4 w-4" /> Duplicate
            </DropdownMenuItem>
            {currentFile && currentFile.id !== linked && (
              <DropdownMenuItem onSelect={() => onLink(pad.id, currentFile.id)}>
                <Link2 className="h-4 w-4" />
                <span className="truncate">Link to “{currentFile.name}”</span>
              </DropdownMenuItem>
            )}
            {linked && (
              <DropdownMenuItem onSelect={() => onLink(pad.id, null)}>
                <Link2Off className="h-4 w-4" /> Unlink from document
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={empty} onSelect={() => setConfirmClear(true)}>
              <Eraser className="h-4 w-4" /> Clear contents…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                flush();
                onDelete(pad.id);
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" /> Delete scratchpad
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* What it is for. */}
      <div className="flex min-w-0 items-center gap-1.5 px-2 text-xs text-muted-foreground">
        {linked ? (
          <button
            onClick={() => onOpenDocument(linked)}
            disabled={linkedState !== "live"}
            title={
              linkedState === "live"
                ? `Open ${linkedName}`
                : linkedState === "binned"
                  ? "The document is in the Bin"
                  : "The document is no longer in this workspace"
            }
            className="flex min-w-0 items-center gap-1.5 rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:text-muted-foreground"
          >
            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className={`truncate ${linkedState === "live" ? "" : "line-through"}`}>
              For {linkedName}
            </span>
            {linkedState !== "live" && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-2xs font-medium">
                {linkedState === "binned" ? "In Bin" : "Deleted"}
              </span>
            )}
          </button>
        ) : (
          <span>Not linked to a document</span>
        )}
      </div>

      <ScratchpadEditor
        key={pad.id}
        ref={editorRef}
        pad={pad}
        onChange={onChange}
        onDirtyChange={onDirtyChange}
        onTextChange={setLiveText}
        onSelectionChange={setHasSelection}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <ActionButton
          disabled={empty}
          onClick={() => {
            const chosen = work();
            if (!chosen) return;
            flush();
            onSaveAsNote(pad.id, chosen.markdown);
          }}
        >
          <NotebookPen className="h-3.5 w-3.5" />
          {hasSelection ? "Save selection as note" : "Save as note"}
        </ActionButton>
        <ActionButton
          disabled={empty}
          onClick={() => {
            const chosen = work();
            if (!chosen) return;
            flush();
            setInsert({ padId: pad.id, markdown: chosen.markdown, target: insertTarget() });
          }}
        >
          <FileInput className="h-3.5 w-3.5" />
          {hasSelection ? "Insert selection…" : "Insert into document…"}
        </ActionButton>
      </div>

      <RoughWorkPreview text={liveText} mathRenderer={mathRenderer} />

      <Modal
        open={confirmClear}
        onOpenChange={setConfirmClear}
        size="sm"
        icon={<Eraser className="h-4 w-4" />}
        title={`Clear “${pad.title}”?`}
        description="Its text is removed. The scratchpad, its name and its link stay."
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => {
                setConfirmClear(false);
                flush();
                onClear(pad.id);
              }}
              className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Clear contents
            </button>
          </>
        }
      />

      <InsertDialog
        request={insert}
        mathRenderer={mathRenderer}
        onCancel={() => setInsert(null)}
        onConfirm={(point) => {
          if (!insert?.target) return;
          onInsert({
            padId: insert.padId,
            markdown: insert.markdown,
            fileId: insert.target.fileId,
            point,
            base: insert.target.base,
          });
          setInsert(null);
        }}
      />
    </div>
  );
}

function PadList({
  pads,
  activeId,
  currentFileId,
  fileName,
  onSelect,
}: {
  pads: Scratchpad[];
  activeId: string;
  currentFileId: string | null;
  fileName: (fileId: string) => string | undefined;
  onSelect: (id: string) => void;
}) {
  const forThis = currentFileId ? pads.filter((p) => p.fileId === currentFileId) : [];
  const rest = pads.filter((p) => !forThis.includes(p));
  const item = (pad: Scratchpad) => (
    <DropdownMenuItem key={pad.id} onSelect={() => onSelect(pad.id)} className="items-start">
      <Check
        className={`mt-0.5 h-4 w-4 shrink-0 ${pad.id === activeId ? "" : "invisible"}`}
        aria-hidden
      />
      <span className="min-w-0">
        <span className="block truncate">{pad.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {pad.fileId
            ? (fileName(pad.fileId) ?? pad.fileName ?? "Deleted document")
            : "No document"}
        </span>
      </span>
    </DropdownMenuItem>
  );
  return (
    <>
      {forThis.length > 0 && (
        <>
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
            This document
          </DropdownMenuLabel>
          {forThis.map(item)}
          {rest.length > 0 && <DropdownMenuSeparator />}
        </>
      )}
      {rest.length > 0 && forThis.length > 0 && (
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Other rough work
        </DropdownMenuLabel>
      )}
      {rest.map(item)}
    </>
  );
}

function RenameField({
  title,
  onDone,
}: {
  title: string;
  /** The new title, or null when the rename was abandoned. */
  onDone: (title: string | null) => void;
}) {
  const [value, setValue] = useState(title);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  return (
    <input
      autoFocus
      value={value}
      maxLength={MAX_SCRATCHPAD_TITLE}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(value);
        } else if (e.key === "Escape") {
          // Abandons the rename only; the sheet or panel stays open.
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      }}
      aria-label="Scratchpad name"
      className="h-8 min-w-0 flex-1 rounded-md border border-primary/50 bg-background px-2 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11"
    />
  );
}

/** Pause after typing before the preview catches up. */
const PREVIEW_MS = 250;

/**
 * The pad, drawn. Debounced, deferred, and split into segments that are
 * parsed only when their own text changes, so typing in a long pad re-parses
 * the part being typed in. Equations go through the notes' drawing path:
 * the reader's cache first, then idle-time KaTeX, only when on screen.
 */
function RoughWorkPreview({
  text,
  mathRenderer,
}: {
  text: string;
  mathRenderer: MathRendererType;
}) {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    if (text === settled) return;
    const timer = setTimeout(() => setSettled(text), PREVIEW_MS);
    return () => clearTimeout(timer);
  }, [text, settled]);
  // Starts empty, so even the first render of a long pad happens in a
  // background render that React splits between segments, never as one task.
  const deferred = useDeferredValue(settled, "");
  const segments = useMemo(() => splitMarkdownSegments(deferred).sources, [deferred]);
  const render = useMemo<NoteRenderSettings>(
    () => ({ renderer: mathRenderer, visible: true }),
    [mathRenderer],
  );
  if (!deferred.trim()) return null;
  return (
    <section aria-label="Preview" className="rounded-lg border border-border/70 bg-card p-3">
      <h3 className="mb-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        Preview
      </h3>
      <div className="docs-note">
        <NoteRenderContext.Provider value={render}>
          {segments.map((source, index) => (
            <PreviewSegment key={index} source={source} />
          ))}
        </NoteRenderContext.Provider>
      </div>
    </section>
  );
}

const PreviewSegment = memo(function PreviewSegment({ source }: { source: string }) {
  return (
    <ReactMarkdown remarkPlugins={NOTE_PLUGINS} components={NOTE_COMPONENTS}>
      {source}
    </ReactMarkdown>
  );
});

/**
 * The one place rough work (and a computed result) reaches a document: shown
 * exactly what goes in and where, and inserted only on an explicit Insert.
 */
export function InsertDialog({
  request,
  mathRenderer,
  onCancel,
  onConfirm,
}: {
  request: { markdown: string; target: InsertTarget | null } | null;
  mathRenderer: MathRendererType;
  onCancel: () => void;
  onConfirm: (point: InsertionPoint) => void;
}) {
  const target = request?.target ?? null;
  const [choice, setChoice] = useState(0);
  useEffect(() => setChoice(0), [request]);
  const point = target?.points[choice] ?? target?.points[0];
  const blocked = !target ? "Open a Markdown or text document to insert into it." : target.blocked;
  const render = useMemo<NoteRenderSettings>(
    () => ({ renderer: mathRenderer, visible: true }),
    [mathRenderer],
  );

  return (
    <Modal
      open={request !== null}
      onOpenChange={(open) => !open && onCancel()}
      size="md"
      icon={<FileInput className="h-4 w-4" />}
      title={target ? `Insert into “${target.name}”?` : "Insert into a document"}
      description="The document gets a copy. Your rough work stays as it is."
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!!blocked || !point}
            onClick={() => point && onConfirm(point)}
            className="rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-40"
          >
            Insert
          </button>
        </>
      }
    >
      <div className="space-y-4 px-5 py-4 text-sm">
        {blocked ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-foreground">
            {blocked}
          </p>
        ) : (
          target &&
          target.points.length > 1 && (
            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Where</legend>
              {target.points.map((option, index) => (
                <label key={option.kind} className="flex items-center gap-2 text-foreground">
                  <input
                    type="radio"
                    name="insert-point"
                    checked={choice === index}
                    onChange={() => setChoice(index)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  {option.kind === "page" ? (
                    <span className="min-w-0 truncate">
                      End of this page{option.title ? ` — ${option.title}` : ""}
                    </span>
                  ) : (
                    "End of the document"
                  )}
                </label>
              ))}
            </fieldset>
          )
        )}
        {target && !blocked && target.points.length === 1 && (
          <p className="text-xs text-muted-foreground">Goes at the end of the document.</p>
        )}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">What goes in</p>
          <div className="docs-note max-h-64 overflow-y-auto rounded-md border border-border/70 bg-card p-3">
            <NoteRenderContext.Provider value={render}>
              <ReactMarkdown remarkPlugins={NOTE_PLUGINS} components={NOTE_COMPONENTS}>
                {request?.markdown ?? ""}
              </ReactMarkdown>
            </NoteRenderContext.Provider>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11 coarse:w-11"
    >
      {children}
    </button>
  );
}

function ActionButton({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      disabled={disabled}
      // Keeps the field's selection: the action reads it on click.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-background coarse:h-11 coarse:px-3"
    >
      {children}
    </button>
  );
}
