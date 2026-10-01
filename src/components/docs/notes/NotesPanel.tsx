import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Check,
  Copy,
  FileText,
  NotebookPen,
  Pencil,
  PencilRuler,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { searchNotes, type Note } from "@/lib/workspace/notes";
import { copyText } from "@/lib/workspace/share";
import {
  cancelIdleCallbackSafe,
  hasModKey,
  requestIdleCallbackSafe,
} from "@/lib/platform/keyboard";
import type { MathRendererType } from "@/services/math/types";
import { NOTE_COMPONENTS, NOTE_PLUGINS } from "./note-components";
import { NoteRenderContext, type NoteRenderSettings } from "./note-render-context";
import { RoughWorkPanel, type RoughWorkProps } from "./RoughWorkPanel";
import { ComputePanel, type ComputeProps } from "./ComputePanel";

/** Whether a note's source document can still be opened. */
export type NoteSourceState = "live" | "binned" | "missing";

export type NotesTab = "notes" | "rough" | "compute";

export interface NotesPanelProps {
  /** Newest first. */
  notes: Note[];
  /** The source document's current name, or undefined once it is gone. */
  fileName: (fileId: string) => string | undefined;
  sourceState: (fileId: string) => NoteSourceState;
  onOpenSource: (note: Note) => void;
  onUpdate: (id: string, content: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  /** A note just added: scrolled to and marked briefly. */
  freshId?: string | null;
  /** The reader's math preference, so notes hit the same render cache. */
  mathRenderer?: MathRendererType;
  /**
   * `docked` is the desktop column, with its own title bar and scroller;
   * `sheet` sits inside a BottomSheet, which supplies both.
   */
  variant: "docked" | "sheet";
  tab: NotesTab;
  onTabChange: (tab: NotesTab) => void;
  /** The Rough work tab (see RoughWorkPanel). */
  roughWork: RoughWorkProps;
  /** The Compute tab (see ComputePanel). */
  compute: ComputeProps;
}

/**
 * The Notes panel: passages the reader copied out of documents, kept as
 * Markdown, searchable, editable, and each with a link back to where it came
 * from (see lib/workspace/notes.ts for the model).
 *
 * It is a reading companion rather than a page, so it stays open beside the
 * document as the reader moves between documents.
 */
export function NotesPanel({
  notes,
  fileName,
  sourceState,
  onOpenSource,
  onUpdate,
  onRemove,
  onClose,
  freshId,
  variant,
  mathRenderer = "auto",
  tab,
  onTabChange,
  roughWork,
  compute,
}: NotesPanelProps) {
  const [query, setQuery] = useState("");
  // The notes themselves are first rendered in an idle period of their own.
  // When the panel is open across a reload it mounts alongside the document,
  // and parsing its notes in the same task added a ~45 ms frame to the
  // document's first render (measured: none with the panel closed).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const handle = requestIdleCallbackSafe(() => setReady(true), 500);
    return () => cancelIdleCallbackSafe(handle);
  }, []);
  const visible = useMemo(() => searchNotes(notes, query, fileName), [notes, query, fileName]);
  // A note saved from rough work links back to its pad, by the pad's current title.
  const padTitles = useMemo(
    () => new Map(roughWork.scratchpads.map((pad) => [pad.id, pad.title])),
    [roughWork.scratchpads],
  );

  const search = notes.length > 0 && (
    <div className={`relative ${variant === "sheet" ? "mt-3" : "px-3 pb-3"}`}>
      <Search
        className={`pointer-events-none absolute top-2.5 h-3.5 w-3.5 text-muted-foreground ${variant === "sheet" ? "left-2.5" : "left-5.5"}`}
        aria-hidden
      />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            setQuery("");
          }
        }}
        placeholder="Search notes"
        aria-label="Search notes"
        className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring coarse:h-11"
      />
    </div>
  );

  const list = !ready ? null : notes.length === 0 ? (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <NotebookPen className="mb-3 h-5 w-5 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium text-foreground">No notes yet</p>
      <p className="mt-1.5 max-w-64 text-xs leading-relaxed text-muted-foreground">
        Select text in a document and choose{" "}
        <span className="font-medium text-foreground">Copy selection to notes</span>. A note is a
        copy — editing the document never changes it.
      </p>
    </div>
  ) : visible.length === 0 ? (
    <p className="px-6 py-10 text-center text-sm text-muted-foreground">
      No notes match “{query.trim()}”.
    </p>
  ) : (
    <ul className={`space-y-2 ${variant === "docked" ? "px-3 pb-6" : "pb-2"}`} aria-label="Notes">
      {visible.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          name={
            note.origin
              ? (padTitles.get(note.origin.scratchpadId) ?? note.origin.title)
              : (fileName(note.fileId) ?? note.fileName)
          }
          state={
            note.origin
              ? padTitles.has(note.origin.scratchpadId)
                ? "live"
                : "missing"
              : sourceState(note.fileId)
          }
          fresh={note.id === freshId}
          mathRenderer={mathRenderer}
          onOpenSource={onOpenSource}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );

  const tabs = <PanelTabs tab={tab} onTabChange={onTabChange} noteCount={notes.length} />;
  const rough = ready && (
    <RoughWorkPanel {...roughWork} mathRenderer={mathRenderer} variant={variant} />
  );
  const computeTab = ready && (
    <ComputePanel {...compute} mathRenderer={mathRenderer} variant={variant} />
  );
  const other = tab === "rough" ? rough : computeTab;
  const panel = (children: React.ReactNode) => (
    <div id={`notes-tabpanel-${tab}`} role="tabpanel" aria-labelledby={`notes-tab-${tab}`}>
      {children}
    </div>
  );

  if (variant === "sheet") {
    // The sheet scrolls as a whole, so the tabs (and the search) stay pinned.
    return (
      <div>
        <div className="sticky top-0 z-20 bg-background pb-3">
          {tabs}
          {tab === "notes" && search}
        </div>
        {panel(tab === "notes" ? list : other)}
      </div>
    );
  }

  const body = panel(
    tab === "notes" ? (
      <>
        {search}
        {list}
      </>
    ) : (
      other
    ),
  );

  return (
    <section aria-label="Notes panel" className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-3">
        {tabs}
        <div className="flex-1" />
        <button
          onClick={onClose}
          aria-label="Close notes"
          title="Close notes"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </section>
  );
}

const TAB_ORDER: NotesTab[] = ["notes", "rough", "compute"];

/**
 * Notes, Rough work and Compute: one panel for the reader's own working.
 * Arrow keys move between the tabs (wrapping), as in any tablist.
 */
function PanelTabs({
  tab,
  onTabChange,
  noteCount,
}: {
  tab: NotesTab;
  onTabChange: (tab: NotesTab) => void;
  noteCount: number;
}) {
  const refs = useRef<Partial<Record<NotesTab, HTMLButtonElement | null>>>({});
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : TAB_ORDER.length - 1;
    const next = TAB_ORDER[(TAB_ORDER.indexOf(tab) + step) % TAB_ORDER.length];
    onTabChange(next);
    refs.current[next]?.focus();
  };
  const item = (id: NotesTab, label: string, count?: number) => (
    <button
      ref={(el) => {
        refs.current[id] = el;
      }}
      id={`notes-tab-${id}`}
      role="tab"
      aria-selected={tab === id}
      aria-controls={`notes-tabpanel-${id}`}
      tabIndex={tab === id ? 0 : -1}
      onClick={() => onTabChange(id)}
      className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-10 coarse:px-3.5 coarse:text-sm ${
        tab === id
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      {!!count && <span className="tabular-nums text-muted-foreground">{count}</span>}
    </button>
  );
  return (
    <div
      role="tablist"
      aria-label="Notes panel"
      onKeyDown={onKeyDown}
      className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {item("notes", "Notes", noteCount)}
      {item("rough", "Rough work")}
      {item("compute", "Compute")}
    </div>
  );
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const dateFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

/** "just now", "5 minutes ago", "yesterday" — then a date. */
function when(at: number, now = Date.now()): string {
  const seconds = Math.round((at - now) / 1000);
  if (Math.abs(seconds) < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return relative.format(days, "day");
  return dateFormat.format(at);
}

/** Taller than this and a note folds, so one long passage can't bury the rest. */
const FOLDED_HEIGHT = 288;

/**
 * One note. Memoized, with the panel's callbacks passed straight through:
 * the app re-renders on every autosave, and re-parsing every note's Markdown
 * each time would make a long notes list cost something while typing.
 */
const NoteCard = memo(function NoteCard({
  note,
  name,
  state,
  fresh,
  mathRenderer,
  onOpenSource,
  onUpdate,
  onRemove,
}: {
  note: Note;
  name: string;
  state: NoteSourceState;
  fresh: boolean;
  mathRenderer: MathRendererType;
  onOpenSource: (note: Note) => void;
  onUpdate: (id: string, content: string) => void;
  onRemove: (id: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const cardRef = useRef<HTMLLIElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (fresh) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [fresh]);

  // Equations and diagrams are drawn only for notes on (or near) screen, so a
  // long list costs what is visible. Once drawn, a note stays drawn.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "300px 0px" },
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, []);
  const render = useMemo<NoteRenderSettings>(
    () => ({ renderer: mathRenderer, visible }),
    [mathRenderer, visible],
  );

  // Measured rather than guessed from the text: a short note with a table or
  // an image can be taller than a long paragraph — and an equation or diagram
  // changes its height when it is drawn, so it is watched, not measured once.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => setOverflows(body.scrollHeight > FOLDED_HEIGHT + 24);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const child of body.children) observer.observe(child);
    return () => observer.disconnect();
  }, [note.content, draft]);

  useEffect(() => {
    if (draft === null) return;
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight + 2, 480)}px`;
  }, [draft]);

  const editing = draft !== null;
  const startEditing = () => {
    setDraft(note.content);
    requestAnimationFrame(() => fieldRef.current?.focus());
  };
  const save = () => {
    if (draft === null || !draft.trim()) return;
    onUpdate(note.id, draft);
    setDraft(null);
  };

  const source = note.origin
    ? `Rough work › ${name}`
    : note.source.sectionTitle
      ? `${name} › ${note.source.sectionTitle}`
      : name;
  const sourceHint = note.origin
    ? state === "live"
      ? `Open the scratchpad “${name}”`
      : "The scratchpad was deleted; this note keeps its own copy"
    : state === "missing"
      ? "The source document is no longer in this workspace"
      : state === "binned"
        ? "The source document is in the Bin"
        : `Go to this passage in ${name}`;
  const SourceIcon = note.origin ? PencilRuler : FileText;

  return (
    <li
      ref={cardRef}
      className={`group rounded-lg border bg-card p-3 transition-shadow ${
        fresh ? "border-primary/50 ring-2 ring-primary/25" : "border-border/70"
      }`}
    >
      <button
        onClick={() => onOpenSource(note)}
        title={sourceHint}
        className="mb-2 flex w-full min-w-0 items-center gap-1.5 rounded text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SourceIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className={`truncate ${state === "live" ? "" : "line-through decoration-1"}`}>
          {source}
        </span>
        {state !== "live" && (
          <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-2xs font-medium">
            {state === "binned" ? "In Bin" : "Deleted"}
          </span>
        )}
      </button>

      {editing ? (
        <div>
          <textarea
            ref={fieldRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hasModKey(e.nativeEvent)) {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(null);
              }
            }}
            aria-label="Note text (Markdown)"
            spellCheck
            className="block min-h-28 w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <button
              onClick={() => setDraft(null)}
              className="h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground coarse:h-10"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!draft.trim()}
              title="Save (⌘/Ctrl+Enter)"
              className="h-7 rounded-md bg-foreground px-2.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40 coarse:h-10"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            ref={bodyRef}
            className="docs-note relative overflow-hidden"
            style={!expanded && overflows ? { maxHeight: FOLDED_HEIGHT } : undefined}
          >
            <NoteRenderContext.Provider value={render}>
              <ReactMarkdown remarkPlugins={NOTE_PLUGINS} components={NOTE_COMPONENTS}>
                {note.content}
              </ReactMarkdown>
            </NoteRenderContext.Provider>
            {!expanded && overflows && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-card to-transparent"
              />
            )}
          </div>
          {overflows && (
            <button
              onClick={() => setExpanded((open) => !open)}
              className="mt-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </>
      )}

      {!editing && (
        <div className="mt-2 flex items-center gap-0.5">
          <span
            className="mr-auto text-2xs text-muted-foreground"
            title={new Date(note.updatedAt).toLocaleString()}
          >
            {note.updatedAt > note.createdAt
              ? `Edited ${when(note.updatedAt)}`
              : when(note.createdAt)}
          </span>
          <NoteAction
            label={copied ? "Copied" : "Copy note"}
            onClick={() => {
              void copyText(note.content).then((ok) => {
                if (!ok) return;
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </NoteAction>
          <NoteAction label="Edit note" onClick={startEditing}>
            <Pencil className="h-3.5 w-3.5" />
          </NoteAction>
          <NoteAction label="Delete note" onClick={() => onRemove(note.id)} destructive>
            <Trash2 className="h-3.5 w-3.5" />
          </NoteAction>
        </div>
      )}
    </li>
  );
});

function NoteAction({
  label,
  onClick,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors coarse:h-10 coarse:w-10 ${
        destructive
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-accent hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
