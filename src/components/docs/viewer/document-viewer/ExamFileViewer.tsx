import { lazy, Suspense, useCallback, useContext, useMemo } from "react";
import { CircleAlert, LockKeyhole } from "lucide-react";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { dataBlob } from "@/lib/workspace/binary";
import { ExamMarkdown } from "@/services/exams/ExamMarkdown";
import { optionLabel, parseExamFile, type Question } from "@/services/exams/parser";
import { rulesFileFor, starterRules } from "@/services/exams/paper-plan";
import { isRulesFile, rulesetTitle, withRulesTag } from "@/services/exams/rules-tag";
import { TYPE_LABEL, trimNumber } from "@/services/exams/ui/display";
// The renderer's tokens and figure styles; `.ex-portal` below carries them
// outside the exam app, as it does for exam dialogs.
import "@/services/exams/exams.css";
import { ExamWorkspaceContext, type ExamWorkspace } from "../ExamWorkspaceContext";
import { Loading, ViewerFrame, ViewerMasthead } from "./shared";
import type { Props } from "./shared";
import {
  Problems,
  SourceEditor,
  Unreadable,
  plural,
  readQuestions,
  useSourceEditor,
} from "./question-source";

// The exam engine (sessions, storage, grading) loads only when a paper is
// sat, not when one is previewed.
const ExamStudy = lazy(() => import("@/services/exams/ExamApp"));

const marksText = (n: number) => `${trimNumber(n)} mark${n === 1 ? "" : "s"}`;

/**
 * An `.xam` file: an exam's questions, keys and solutions in Markdown.
 *
 * In an Exam Workspace the paper is sat: its rules, a Start button and its
 * attempts replace the preview. Elsewhere it previews as the questions it
 * asks. Either way the keys and solutions stay hidden: they are shown only in
 * the review of a submitted attempt. The source, through Edit, is the one
 * place they can be read, because it is the author's file.
 */
export function ExamFileViewer(props: Props) {
  const { file, prevFile, nextFile, onNavFile, onContentChange, onOpenPalette } = props;
  const context = useContext(ExamWorkspaceContext);
  const workspace = context?.examEnabled ? context : null;
  const read = useCallback(
    (source: string) => readQuestions(() => parseExamFile(source, file.name)),
    [file.name],
  );
  const saved = useMemo(() => read(file.content), [read, file.content]);
  const { editing, draft, setDraft, drafted, actions } = useSourceEditor(file, read, props);

  const counts =
    saved.ok && !workspace && saved.value.questions.length
      ? `${plural(saved.value.questions.length, "question")} · ${marksText(
          saved.value.questions.reduce((sum, q) => sum + q.marks, 0),
        )}`
      : undefined;

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
          kindLabel={workspace ? "Exam" : "Exam questions"}
          meta={editing ? undefined : counts}
        />
        {editing ? (
          <SourceEditor
            label="Edit exam questions"
            draft={draft}
            onChange={setDraft}
            status={
              drafted?.ok ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Reads as {plural(drafted.value.questions.length, "exam question")} — Done saves,
                  Cancel discards.
                </p>
              ) : (
                <Problems problems={drafted?.problems ?? []} compact />
              )
            }
          />
        ) : workspace ? (
          <ExamPane
            file={file}
            workspace={workspace}
            onTagRules={(rulesName) =>
              onContentChange?.(file.id, withRulesTag(file.content, rulesName))
            }
          />
        ) : saved.ok ? (
          <div className="ex-portal xf-preview flex flex-col gap-4">
            <p className="flex items-start gap-2 rounded-xl border border-hairline bg-surface-sunken px-4 py-3 text-sm text-muted-foreground">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Keys and solutions stay hidden until an attempt is submitted. Sit this paper in an
              Exam Workspace.
            </p>
            {!saved.value.questions.length && (
              <p className="text-sm text-muted-foreground">
                No questions yet. Edit to add :::question blocks and their :::solution.
              </p>
            )}
            <ol className="flex flex-col gap-4">
              {saved.value.questions.map((q, i) => (
                <QuestionCard
                  key={q.id}
                  number={i + 1}
                  question={q}
                  solved={saved.value.solutions.some((s) => s.id === q.id)}
                />
              ))}
            </ol>
          </div>
        ) : (
          <Unreadable problems={saved.problems} source={file.content} />
        )}
      </div>
    </ViewerFrame>
  );
}

const asText = (f: MdFile) => ({ id: f.id, name: f.name, content: f.content });
/** The paper sat in place, with the rules it names and the workspace's images. */
function ExamPane({
  file,
  workspace,
  onTagRules,
}: {
  file: MdFile;
  workspace: ExamWorkspace;
  /** Name a ruleset in the paper's header. */
  onTagRules: (rulesName: string) => void;
}) {
  const { files, folders, openRules, addTextFile, workspaceId } = workspace;
  const lookup = useMemo(() => rulesFileFor(file, files, folders), [file, files, folders]);
  const rules = useMemo(
    () =>
      lookup.kind === "found"
        ? { kind: "found" as const, file: asText(lookup.file) }
        : lookup.kind === "ambiguous"
          ? { kind: "ambiguous" as const, files: lookup.files.map(asText) }
          : { kind: "missing" as const, tagged: lookup.tagged },
    [lookup],
  );
  const rulesets = useMemo(
    () =>
      files
        .filter((f) => !f.deletedAt && isRulesFile(f))
        .map((f) => ({ name: f.name, title: rulesetTitle(f) })),
    [files],
  );
  const images = useMemo(() => {
    const found: Record<string, Blob> = {};
    for (const f of files) {
      const blob = !f.deletedAt && f.kind === "image" ? dataBlob(f.data, f.mimeType) : null;
      if (blob) found[f.name] = blob;
    }
    return found;
  }, [files]);
  if (workspace.paused) return null;
  return (
    <Suspense fallback={<Loading label="Opening exam" />}>
      <ExamStudy
        key={file.id}
        workspaceId={workspaceId}
        paper={asText(file)}
        rules={rules}
        rulesets={rulesets}
        images={images}
        onOpenRules={openRules}
        onUseRules={onTagRules}
        onCreateRules={() => {
          // Rulesets live at the top level: Settings lists them, not folders.
          const made = addTextFile(
            `${file.name.replace(/\.[^.]+$/, "")}.xrule`,
            starterRules(file.name),
            null,
          );
          onTagRules(made.name);
        }}
      />
    </Suspense>
  );
}

/** One question as the candidate will see it: no key, no solution. */
function QuestionCard({
  number,
  question: q,
  solved,
}: {
  number: number;
  question: Question;
  /** Whether the file has its `:::solution` block. Its content isn't shown. */
  solved: boolean;
}) {
  const meta = [TYPE_LABEL[q.type], marksText(q.marks), q.difficulty, q.topic].filter(Boolean);
  return (
    <li className="rounded-xl border border-hairline bg-card px-4 py-4 md:px-5">
      <p className="mb-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Q{number}</span>
        {meta.map((m) => (
          <span key={m}>· {m}</span>
        ))}
        <span className="ml-auto font-mono text-2xs opacity-70">#{q.id}</span>
      </p>
      <ExamMarkdown source={q.body} />
      {q.options.length > 0 && (
        <ol className="mt-3 flex flex-col gap-1.5" aria-label="Options">
          {q.options.map((option, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-lg border border-hairline px-3 py-2"
            >
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                aria-hidden
              >
                {optionLabel(i)}
              </span>
              <span className="sr-only">{optionLabel(i)}:</span>
              <div className="xf-option min-w-0 flex-1">
                <ExamMarkdown source={option} />
              </div>
            </li>
          ))}
        </ol>
      )}
      {!solved && (
        <p className="mt-4 flex items-center gap-2 border-t border-hairline pt-3 text-sm text-destructive">
          <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
          No :::solution{"{"}#{q.id}
          {"}"} block — add its key and explanation.
        </p>
      )}
    </li>
  );
}
