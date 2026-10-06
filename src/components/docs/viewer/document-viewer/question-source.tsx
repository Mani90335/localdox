import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { DISCARD_PROMPT } from "@/lib/markdown/document-utils";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { ESCAPE_DEPTH, useNavEscape } from "@/hooks/use-nav-history";
import { ExamImportError } from "@/services/exams/schema";
import { describeIssue } from "@/services/exams/ui/display";
import type { Props } from "./shared";

/**
 * What `.xam` papers and `.xp` practice files share: Markdown source that is
 * read by a strict parser, edited as text, and saved only on Done.
 */

export type Reading<T> = { ok: true; value: T } | { ok: false; problems: string[] };
/** Parse a question file, turning the parser's issues into readable lines. */
export function readQuestions<T>(read: () => T): Reading<T> {
  try {
    return { ok: true, value: read() };
  } catch (error) {
    return {
      ok: false,
      problems:
        error instanceof ExamImportError
          ? error.issues.map(describeIssue)
          : [error instanceof Error ? error.message : String(error)],
    };
  }
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The draft and its Done / Cancel / Escape handling. Done is the only write.
 * A draft with problems still saves: it is the author's text, and the file
 * says what to fix until it is fixed.
 */
export function useSourceEditor<T>(
  file: MdFile,
  read: (source: string) => Reading<T>,
  { onContentChange, startInEditFileId, onStartInEditConsumed }: Props,
) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(file.content);
  const drafted = useMemo(() => (editing ? read(draft) : null), [draft, editing, read]);

  useEffect(() => {
    setDraft(file.content);
    setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const beginEdit = () => {
    setDraft(file.content);
    setEditing(true);
  };
  const cancelEdit = () => {
    setDraft(file.content);
    setEditing(false);
  };
  const commitEdit = () => {
    if (draft !== file.content) onContentChange?.(file.id, draft);
    setEditing(false);
  };
  useEffect(() => {
    if (startInEditFileId !== file.id || editing) return;
    beginEdit();
    onStartInEditConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startInEditFileId, file.id]);
  useNavEscape(
    editing,
    () => {
      if (draft !== file.content && !window.confirm(DISCARD_PROMPT)) return;
      cancelEdit();
    },
    ESCAPE_DEPTH.mode,
  );

  const actions: ReactNode = editing ? (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={cancelEdit}
        className="flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={commitEdit}
        title="Save and stop editing"
        className="flex h-8 items-center rounded-md bg-foreground px-2.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
      >
        Done · Save
      </button>
    </div>
  ) : null;

  return { editing, draft, setDraft, drafted, actions };
}

/** The source textarea, with what the draft reads as beneath it. */
export function SourceEditor({
  label,
  draft,
  onChange,
  status,
}: {
  label: string;
  draft: string;
  onChange: (value: string) => void;
  /** A line saying what the draft reads as, or its problems. */
  status: ReactNode;
}) {
  return (
    <div>
      <textarea
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        aria-label={label}
        className="h-[calc(100dvh-15rem)] w-full resize-none rounded-xl border border-border bg-surface-sunken p-4 font-mono text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-primary/20"
      />
      {status}
    </div>
  );
}

export function Problems({ problems, compact = false }: { problems: string[]; compact?: boolean }) {
  return (
    <div
      role="alert"
      className={`rounded-xl border border-destructive/30 bg-destructive/5 text-sm ${compact ? "mt-2 px-3 py-2" : "px-4 py-3"}`}
    >
      <p className="flex items-center gap-2 font-medium text-destructive">
        <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
        {problems.length === 1
          ? "One thing to fix in this file"
          : `${problems.length} things to fix in this file`}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-foreground">
        {problems.slice(0, 8).map((problem, i) => (
          <li key={i}>{problem}</li>
        ))}
        {problems.length > 8 && <li>…and {problems.length - 8} more.</li>}
      </ul>
    </div>
  );
}

/** A file that doesn't read: what to fix, then its source as it stands. */
export function Unreadable({ problems, source }: { problems: string[]; source: string }) {
  return (
    <>
      <Problems problems={problems} />
      <pre className="mt-4 max-h-[calc(100dvh-20rem)] overflow-auto whitespace-pre-wrap rounded-xl border border-hairline bg-surface-sunken p-4 font-mono text-sm leading-6 text-foreground">
        {source}
      </pre>
    </>
  );
}
