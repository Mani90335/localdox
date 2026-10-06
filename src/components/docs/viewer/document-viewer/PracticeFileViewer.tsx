import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { dataBlob } from "@/lib/workspace/binary";
import { ExamAssets, ExamMarkdown } from "@/services/exams/ExamMarkdown";
import { numeric, optionLabel, type Question, type Solution } from "@/services/exams/parser";
import { checkPractice, readPracticeFile, type PracticeSheet } from "@/services/exams/practice";
import { isAnswered, type Outcome, type Response } from "@/services/exams/scoring";
import { TYPE_LABEL, TYPE_NAME } from "@/services/exams/ui/display";
import "@/services/exams/exams.css";
import { ExamWorkspaceContext } from "../ExamWorkspaceContext";
import { ViewerFrame, ViewerMasthead } from "./shared";
import type { Props } from "./shared";
import {
  Problems,
  SourceEditor,
  Unreadable,
  plural,
  readQuestions,
  useSourceEditor,
} from "./question-source";

/**
 * An `.xp` file: practice questions, answered in place. Choosing an option
 * (or checking a number) marks it right or wrong at once and opens the
 * solution. No rules, timer or attempts: that is what `.xam` papers are for.
 */
export function PracticeFileViewer(props: Props) {
  const { file, prevFile, nextFile, onNavFile, onOpenPalette } = props;
  const workspace = useContext(ExamWorkspaceContext);
  const read = useCallback(
    (source: string) => readQuestions(() => readPracticeFile(source, file.name)),
    [file.name],
  );
  const saved = useMemo(() => read(file.content), [read, file.content]);
  const { editing, draft, setDraft, drafted, actions } = useSourceEditor(file, read, props);
  // Images resolve by file name from the workspace where its files are at
  // hand (Exam Workspaces); elsewhere they show as a labelled gap.
  const files = workspace?.files;
  const assets = useMemo(() => {
    const found: Record<string, Blob> = {};
    for (const f of files ?? []) {
      const blob = !f.deletedAt && f.kind === "image" ? dataBlob(f.data, f.mimeType) : null;
      if (blob) found[f.name] = blob;
    }
    return { assets: found };
  }, [files]);

  return (
    <ViewerFrame
      file={file}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
      editing={editing}
      action={actions}
    >
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        <ViewerMasthead
          file={file}
          kindLabel="Practice"
          meta={editing || !saved.ok ? undefined : plural(saved.value.questions.length, "question")}
        />
        {editing ? (
          <SourceEditor
            label="Edit practice questions"
            draft={draft}
            onChange={setDraft}
            status={
              drafted?.ok ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Reads as {plural(drafted.value.questions.length, "question")} — Done saves, Cancel
                  discards.
                </p>
              ) : (
                <Problems problems={drafted?.problems ?? []} compact />
              )
            }
          />
        ) : saved.ok ? (
          <ExamAssets source={assets}>
            <Sheet key={file.id} fileId={file.id} sheet={saved.value} />
          </ExamAssets>
        ) : (
          <Unreadable problems={saved.problems} source={file.content} />
        )}
      </div>
    </ViewerFrame>
  );
}

interface Answer {
  response: Response;
  outcome: Outcome;
  /** The question and key it was checked against; an edit to either retires it. */
  sig: string;
}
type Answers = Record<string, Answer>;

/**
 * Answers live in this browser, per file: practice progress is a reader's
 * own, not part of the file, and is cheap to lose. Storage can be full or
 * blocked, so every access is guarded and the sheet works without it.
 */
const storageKey = (fileId: string) => `localdox:practice-answers:${fileId}`;
function loadAnswers(fileId: string): Answers {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(fileId)) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, Partial<Answer>>).filter(
        ([, a]) =>
          typeof a?.sig === "string" &&
          typeof a.outcome === "string" &&
          (typeof a.response === "string" || Array.isArray(a.response)),
      ),
    ) as Answers;
  } catch {
    return {};
  }
}
function saveAnswers(fileId: string, answers: Answers) {
  try {
    if (Object.keys(answers).length)
      localStorage.setItem(storageKey(fileId), JSON.stringify(answers));
    else localStorage.removeItem(storageKey(fileId));
  } catch {
    // Not saved: the answers still show until the file is closed.
  }
}
/** FNV-1a of what decides an answer's verdict; change detection only. */
function signature(q: Question, s: Solution): string {
  let hash = 0x811c9dc5;
  for (const char of [q.type, q.body, ...q.options, s.answer, String(s.tolerance)].join("\u0000")) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

function Sheet({ fileId, sheet }: { fileId: string; sheet: PracticeSheet }) {
  const signatures = useMemo(
    () =>
      Object.fromEntries(sheet.questions.map((q) => [q.id, signature(q, sheet.solutionFor[q.id])])),
    [sheet],
  );
  const [stored, setStored] = useState(() => loadAnswers(fileId));
  // Only answers to questions as they read now count.
  const answers = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(stored).filter(([id, a]) => signatures[id] === a.sig),
      ) as Answers,
    [stored, signatures],
  );
  const commit = (next: Answers) => {
    setStored(next);
    saveAnswers(fileId, next);
  };
  const answer = (q: Question, response: Response) => {
    if (answers[q.id] || !isAnswered(response)) return;
    const outcome = checkPractice(q, sheet.solutionFor[q.id], response);
    commit({ ...answers, [q.id]: { response, outcome, sig: signatures[q.id] } });
  };

  const total = sheet.questions.length,
    answered = Object.keys(answers).length,
    correct = Object.values(answers).filter((a) => a.outcome === "correct").length;
  let number = 0;
  return (
    <div className="ex-portal xf-preview flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div
          className="h-1.5 min-w-32 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Practice answered"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={answered}
        >
          <div
            className="h-full rounded-full bg-lime-600 transition-[width] duration-300 dark:bg-lime-500"
            style={{ width: `${(answered / total) * 100}%` }}
          />
        </div>
        <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
          {answered} of {total} answered{answered > 0 && ` · ${correct} correct`}
        </p>
        {answered > 0 && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Clear your ${plural(answered, "answer")} and start over?`))
                commit({});
            }}
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Start over
          </button>
        )}
      </div>
      {sheet.groups.map((group, g) => (
        <section key={g} aria-label={group.title ?? undefined} className="flex flex-col gap-4">
          {group.title && <h2 className="text-base font-semibold">{group.title}</h2>}
          <ol className="flex flex-col gap-4">
            {group.questions.map((q) => (
              <PracticeQuestion
                key={q.id}
                number={++number}
                question={q}
                solution={sheet.solutionFor[q.id]}
                answer={answers[q.id]}
                onAnswer={(response) => answer(q, response)}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

const VERDICT: Record<Outcome, string> = {
  correct: "Correct",
  partial: "Partly correct",
  wrong: "Not quite",
  unanswered: "Not quite",
};

function PracticeQuestion({
  number,
  question: q,
  solution,
  answer,
  onAnswer,
}: {
  number: number;
  question: Question;
  solution: Solution;
  answer?: Answer;
  onAnswer: (response: Response) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<Response>(null);
  const verdictRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  // Checking with a button that then disappears would drop focus to the page;
  // it moves to the verdict instead, which also reads it out.
  useEffect(() => {
    if (answer && moveFocus.current) verdictRef.current?.focus();
    moveFocus.current = false;
  }, [answer]);
  const check = (response: Response) => {
    moveFocus.current = q.type !== "mcq";
    onAnswer(response);
  };

  const response = answer?.response ?? draft;
  const picked = Array.isArray(response) ? response : response ? [response] : [];
  const key = solution.answer.split(",").map((a) => a.trim());
  const ready = q.type === "nat" ? typeof draft === "string" && numeric(draft) : isAnswered(draft);

  return (
    <li
      aria-labelledby={`${id}-title`}
      className="rounded-xl border border-hairline bg-card px-4 py-4 md:px-5"
    >
      <p className="mb-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span id={`${id}-title`} className="font-semibold text-foreground">
          <span className="sr-only">Question </span>Q{number}
        </span>
        <span title={TYPE_NAME[q.type]}>· {TYPE_LABEL[q.type]}</span>
        {q.difficulty && <span>· {q.difficulty}</span>}
        {q.topic && <span>· {q.topic}</span>}
      </p>
      <ExamMarkdown source={q.body} />

      {q.type === "nat" ? (
        answer ? null : (
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) check(draft);
            }}
          >
            <input
              className="h-9 w-48 rounded-md border border-input bg-background px-3 text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring"
              aria-label={`Answer to question ${number}`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="Enter a number"
              value={typeof draft === "string" ? draft : ""}
              onChange={(e) => setDraft(e.target.value)}
            />
            <CheckButton disabled={!ready} />
          </form>
        )
      ) : (
        <>
          <ol className="mt-3 flex flex-col gap-1.5" aria-label="Options">
            {q.options.map((option, i) => {
              const label = optionLabel(i),
                on = picked.includes(label),
                state = !answer
                  ? on
                    ? "picked"
                    : "open"
                  : key.includes(label)
                    ? "correct"
                    : on
                      ? "wrong"
                      : "rest";
              return (
                <li
                  key={label}
                  className={`relative flex items-start gap-3 rounded-lg border px-3 py-2 transition-colors ${OPTION_TONE[state]}`}
                >
                  {/* The button stretches over the whole row, so the option is
                      the target; its markdown can't sit inside a button. */}
                  <button
                    type="button"
                    aria-labelledby={`${id}-${label}`}
                    aria-pressed={q.type === "msq" && !answer ? on : undefined}
                    aria-disabled={answer ? true : undefined}
                    onClick={() => {
                      if (answer) return;
                      if (q.type === "mcq") check(label);
                      else setDraft(on ? picked.filter((v) => v !== label) : [...picked, label]);
                    }}
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full xf-choice text-xs font-semibold after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring ${answer ? "cursor-default" : "cursor-pointer"} ${BADGE_TONE[state]}`}
                  >
                    {state === "correct" ? (
                      <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                    ) : state === "wrong" ? (
                      <X className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                    ) : (
                      label
                    )}
                  </button>
                  <div id={`${id}-${label}`} className="xf-option min-w-0 flex-1">
                    <span className="sr-only">
                      {label}
                      {state === "correct" ? ", correct" : state === "wrong" ? ", your answer" : ""}
                      :{" "}
                    </span>
                    <ExamMarkdown source={option} />
                  </div>
                </li>
              );
            })}
          </ol>
          {q.type === "msq" && !answer && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <CheckButton disabled={!ready} onClick={() => check(draft)} />
              <span className="text-xs text-muted-foreground">Select all that apply.</span>
            </div>
          )}
        </>
      )}

      {answer && (
        <div
          ref={verdictRef}
          tabIndex={-1}
          className="mt-4 flex flex-col gap-3 border-t border-hairline pt-3"
        >
          <p className={`xp-verdict is-${answer.outcome}`} role="status">
            {answer.outcome === "correct" ? (
              <Check size={18} aria-hidden="true" />
            ) : (
              <X size={18} aria-hidden="true" />
            )}
            {VERDICT[answer.outcome]}
          </p>
          {q.type === "nat" && (
            <p className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
              <span>
                Your answer: <strong>{String(answer.response)}</strong>
              </span>
              <span>
                Correct: <strong>{solution.answer.replace(":", " to ")}</strong>
                {solution.tolerance !== undefined ? ` ± ${solution.tolerance}` : ""}
              </span>
            </p>
          )}
          {solution.body.trim() && (
            <section aria-label="Solution">
              <ExamMarkdown source={solution.body} />
            </section>
          )}
        </div>
      )}
    </li>
  );
}

const OPTION_TONE = {
  open: "border-hairline hover:border-border hover:bg-accent/50",
  picked: "border-primary/50 bg-primary/5",
  correct: "border-lime-600/40 bg-lime-600/5 dark:border-lime-400/40",
  wrong: "border-destructive/40 bg-destructive/5",
  rest: "border-hairline opacity-70",
} as const;
const BADGE_TONE = {
  open: "bg-muted text-muted-foreground",
  picked: "bg-primary text-primary-foreground",
  correct: "bg-lime-600 text-white dark:bg-lime-500",
  wrong: "bg-destructive text-destructive-foreground",
  rest: "bg-muted text-muted-foreground",
} as const;

function CheckButton({ disabled, onClick }: { disabled: boolean; onClick?: () => void }) {
  return (
    <button
      type={onClick ? "button" : "submit"}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 items-center rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      Check answer
    </button>
  );
}
