import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Check, Copy, FileText, NotebookPen, Pencil, Search, Trash2, X } from "lucide-react";
import { searchNotes, type Note } from "@/lib/workspace/notes";
import { copyText } from "@/lib/workspace/share";
import { hasModKey } from "@/lib/platform/keyboard";

/** Whether a note's source document can still be opened. */
export type NoteSourceState = "live" | "binned" | "missing";

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
  /**
   * `docked` is the desktop column, with its own title bar and scroller;
   * `sheet` sits inside a BottomSheet, which supplies both.
   */
  variant: "docked" | "sheet";
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
}: NotesPanelProps) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => searchNotes(notes, query, fileName), [notes, query, fileName]);

  const search = notes.length > 0 && (
    <div
      className={`relative ${variant === "sheet" ? "sticky top-0 z-10 bg-background pb-3" : "px-3 pb-3"}`}
    >
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

  const list =
    notes.length === 0 ? (
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
            name={fileName(note.fileId) ?? note.fileName}
            state={sourceState(note.fileId)}
            fresh={note.id === freshId}
            onOpenSource={onOpenSource}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
      </ul>
    );

  if (variant === "sheet") {
    return (
      <div>
        {search}
        {list}
      </div>
    );
  }

  return (
    <section aria-label="Notes panel" className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-4">
        <h2 className="text-sm font-semibold text-foreground">Notes</h2>
        {notes.length > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">{notes.length}</span>
        )}
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
      {search}
      <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
    </section>
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

/**
 * GFM for tables and task lists; remark-math so `$…$` is parsed as math and
 * shown as its LaTeX source in a code span. Rendered as plain Markdown, `\,`
 * and `_` inside an equation would be eaten as escapes and emphasis.
 */
const NOTE_PLUGINS = [remarkGfm, remarkMath];

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
  onOpenSource,
  onUpdate,
  onRemove,
}: {
  note: Note;
  name: string;
  state: NoteSourceState;
  fresh: boolean;
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

  // Measured rather than guessed from the text: a short note with a table or
  // an image can be taller than a long paragraph.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body) setOverflows(body.scrollHeight > FOLDED_HEIGHT + 24);
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

  const source = note.source.sectionTitle ? `${name} › ${note.source.sectionTitle}` : name;
  const sourceHint =
    state === "missing"
      ? "The source document is no longer in this workspace"
      : state === "binned"
        ? "The source document is in the Bin"
        : `Go to this passage in ${name}`;

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
        <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
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
            <ReactMarkdown remarkPlugins={NOTE_PLUGINS}>{note.content}</ReactMarkdown>
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
