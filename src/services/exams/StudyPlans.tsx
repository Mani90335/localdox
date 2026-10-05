import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, FileUp, LockKeyhole, Upload } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { AttemptRecord, ExamRecord } from "./storage";
import {
  progressionPolicy,
  scorePercentage,
  meetsPassingScore,
  type DayProgress,
  type DayStep,
} from "./study-plan";
import type { TopicItem } from "./topics";
import { ExamMarkdown } from "./ExamMarkdown";
import { Button, LinkButton, ProgressBar } from "./ui/kit";
import { formatDuration, formatPercent } from "./ui/display";

type StepId = Exclude<DayStep, "done">;
const STEPS: { id: StepId; name: string }[] = [
  { id: "learn", name: "Learn" },
  { id: "practice", name: "Practice" },
  { id: "exam", name: "Exam" },
  { id: "review", name: "Review" },
];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const graded = (a: AttemptRecord) =>
  !!a.analysis && ["submitted", "review"].includes(a.session.phase);

/** One line under each step in the stepper. */
function stepNote(p: DayProgress, step: StepId, state: "done" | "current" | "locked"): string {
  if (state === "locked") return "Locked";
  if (step === "practice")
    return p.practiceTotal === 0
      ? "No questions"
      : `${Math.min(p.practiceAttempted, p.practiceTotal)} of ${p.practiceTotal}`;
  if (step === "exam" && p.status === "passed")
    return `Passed · ${formatPercent(p.bestPercentage ?? 0)}`;
  if (step === "exam" && p.status === "failed") return "Not passed";
  if (step === "exam" && p.status === "revision_required") return "No attempts left";
  return state === "done" ? "Done" : "Now";
}

interface Props {
  item: TopicItem;
  topics: TopicItem[];
  library: ExamRecord[];
  onSelect: (key: string) => void;
  onUploadExamFile: (planId: string, files: File[]) => void;
  onDownloadExample: () => void;
  onTask: (planId: string, topicId: string, taskId: string, checked: boolean) => void;
  onNote: (planId: string, topicId: string, note: string) => void;
  onLearned: (planId: string, topicId: string) => void;
  onPractice: (planId: string, topicId: string) => void;
  onAddPractice: (planId: string, topicId: string, files: File[]) => void;
  onStart: (planId: string, topicId: string) => void;
  onRevision: (planId: string, topicId: string) => void;
  onRewrite: (planId: string, topicId: string, exam: ExamRecord) => void;
  onRewriteFiles: (planId: string, topicId: string, files: File[]) => void;
  onOpenAttempt: (attempt: AttemptRecord) => void;
  onReview: (attempt: AttemptRecord) => void;
}

/** The detail pane for one selected topic: its four steps, or its file upload. */
export function TopicPanel(props: Props) {
  const { item, topics, library } = props;
  const { record, topic } = item;
  const p = item.progress;
  const saved = record.days[topic.id];
  const policy = saved?.cycles.length ? progressionPolicy(saved.cycles[0].exam.exam.rules) : null;

  const [chosenStep, setChosenStep] = useState<StepId | null>(null),
    [replacement, setReplacement] = useState(""),
    [noteSaved, setNoteSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    practiceInput = useRef<HTMLInputElement>(null),
    rewriteInput = useRef<HTMLInputElement>(null);

  // A finished step moves the view to the next one; a chosen step stays.
  useEffect(() => setChosenStep(null), [item.key, p?.step]);
  useEffect(() => {
    setNoteSaved(false);
    setReplacement("");
  }, [item.key]);

  const heading = <h1>{topic.title}</h1>;

  // The rules are set; the exam waits for its one file.
  if (!p || !saved || !policy) {
    const setup = record.setup;
    return (
      <>
        <header className="ex-page-header">
          <div>{heading}</div>
        </header>
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          multiple
          accept=".md,.markdown,.png,.jpg,.jpeg,.gif,.webp,.svg"
          aria-label="Upload exam file"
          onChange={(e) => {
            props.onUploadExamFile(record.id, Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <section className="ex-surface xp-step-panel" aria-label="Exam file">
          {setup && (
            <p className="ex-meta tabular">
              <span>{formatDuration(setup.durationMinutes * 60)}</span>
              {setup.questionCount && <span>{setup.questionCount} questions</span>}
              <span>{setup.passPercentage}% to pass</span>
              <span>{plural(setup.maxAttempts, "attempt")}</span>
              <span>
                {setup.rootRules
                  ? "Marking from exam structure"
                  : setup.mcqPenalty === "none"
                    ? "No negative marking"
                    : `−${setup.mcqPenalty === "third" ? "1/3" : "1/4"} for a wrong MCQ`}
              </span>
            </p>
          )}
          <div className="xp-upload">
            <h2>Upload the exam file</h2>
            <p className="ex-small">
              One <code>.md</code> file: questions under <code># Practice</code> and{" "}
              <code># Exam</code>, and a <code>:::solution</code> with the key and explanation for
              each. Exam keys stay hidden until you submit. Add any images it uses.
            </p>
            <div className="xp-cta">
              <Button variant="primary" onClick={() => fileInput.current?.click()}>
                <FileUp size={16} aria-hidden="true" /> Choose file
              </Button>
              <LinkButton onClick={props.onDownloadExample}>Download example file</LinkButton>
            </div>
          </div>
        </section>
      </>
    );
  }

  const exam = p.cycle.exam.exam;
  const passedAttempt = [...p.attempts]
    .filter(
      (a) =>
        graded(a) &&
        meetsPassingScore(a.analysis!.score, a.analysis!.totalMarks, policy.passPercentage),
    )
    .at(-1);
  const lastGraded = [...p.attempts].filter(graded).at(-1);
  const revisionDone = p.cycle.revisionCompletedAt !== undefined;
  const stateOf = (step: StepId): "done" | "current" | "locked" =>
    p.steps[step] ? "done" : p.step === step ? "current" : "locked";
  const shown: StepId = chosenStep ?? (p.step === "done" ? "review" : p.step);
  const candidates = library.filter((e) => e.exam.taxonomy.id === exam.taxonomy.id),
    chosen = candidates.find((e) => e.id === replacement);
  const nextOpen = topics.find((t) => t.key !== item.key && t.progress?.step !== "done");
  const planId = record.id,
    topicId = topic.id;

  return (
    <>
      <header className="ex-page-header">
        <div>{heading}</div>
      </header>

      <input
        ref={practiceInput}
        className="sr-only"
        type="file"
        multiple
        accept=".zip,.md,.png,.jpg,.jpeg,.gif,.webp,.svg"
        aria-label="Add practice questions"
        onChange={(e) => {
          props.onAddPractice(planId, topicId, Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      <nav aria-label="Steps">
        <ol className="xp-hsteps">
          {STEPS.map((s, i) => {
            const state = stateOf(s.id);
            return (
              <li key={s.id} className={`xp-hstep is-${state}`}>
                <button
                  type="button"
                  disabled={state === "locked"}
                  aria-current={shown === s.id ? "step" : undefined}
                  onClick={() => setChosenStep(s.id)}
                >
                  <span className="xp-dot" aria-hidden="true">
                    {state === "done" ? (
                      <Check size={14} strokeWidth={3} />
                    ) : state === "locked" ? (
                      <LockKeyhole size={12} />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="xp-hstep-copy">
                    <strong>
                      <span className="sr-only">Step {i + 1}: </span>
                      {s.name}
                    </strong>
                    <span>{stepNote(p, s.id, state)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section
        className="ex-surface xp-step-panel"
        aria-label={STEPS.find((s) => s.id === shown)!.name}
      >
        {p.step === "done" && (
          <div className="xp-complete">
            <Check size={18} aria-hidden="true" />
            <span>All four steps done.</span>
            {nextOpen && (
              <Button variant="primary" onClick={() => props.onSelect(nextOpen.key)}>
                Next topic: {nextOpen.topic.title}
              </Button>
            )}
          </div>
        )}

        {shown === "learn" && (
          <>
            {topic.summaryMd && <ExamMarkdown source={topic.summaryMd} />}
            {topic.tasks.length > 0 && (
              <ul className="ex-surface ex-surface--flush ex-hairline-list xp-tasks">
                {topic.tasks.map((task) => (
                  <li key={task.id}>
                    <label className={saved.tasks[task.id] ? "xp-task is-done" : "xp-task"}>
                      <input
                        className="ex-check"
                        type="checkbox"
                        checked={!!saved.tasks[task.id]}
                        onChange={(e) => props.onTask(planId, topicId, task.id, e.target.checked)}
                      />
                      <span>{task.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="ex-field">
              <span className="ex-section-head">
                <span>Progress notes (optional)</span>
                <span className="xp-saved" aria-live="polite">
                  {noteSaved && (
                    <>
                      <Check size={12} aria-hidden="true" /> Saved
                    </>
                  )}
                </span>
              </span>
              <textarea
                className="ex-textarea xp-notes"
                aria-label="Study notes"
                placeholder="What you covered, what needs another look"
                value={saved.note}
                maxLength={5000}
                onChange={(e) => {
                  props.onNote(planId, topicId, e.target.value);
                  setNoteSaved(true);
                }}
              />
            </div>
            <div className="xp-cta">
              {!p.steps.learn && (
                <Button variant="primary" onClick={() => props.onLearned(planId, topicId)}>
                  I've finished studying
                </Button>
              )}
              <Link to="/" className="ex-link">
                <BookOpen size={16} aria-hidden="true" /> Open Localdox
              </Link>
            </div>
          </>
        )}

        {shown === "practice" && (
          <>
            {p.practiceTotal > 0 ? (
              <>
                <p className="ex-small">
                  Answer each question, then check it against the key and solution. No timer.
                </p>
                <ProgressBar
                  value={(p.practiceAttempted / p.practiceTotal) * 100}
                  label="Practice answered"
                />
              </>
            ) : (
              <p className="ex-small">
                No practice questions for this topic. Add your own if you like.
              </p>
            )}
            <div className="xp-cta">
              {p.practiceTotal > 0 && (
                <Button
                  variant={stateOf("practice") === "current" ? "primary" : "secondary"}
                  onClick={() => props.onPractice(planId, topicId)}
                >
                  {p.practiceAttempted === 0
                    ? "Start practice"
                    : p.practiceAttempted < p.practiceTotal
                      ? "Continue practice"
                      : "Open practice"}
                </Button>
              )}
              <LinkButton onClick={() => practiceInput.current?.click()}>
                <Upload size={14} aria-hidden="true" /> Add questions
              </LinkButton>
            </div>
          </>
        )}

        {shown === "exam" && (
          <>
            <p className="ex-meta tabular">
              <span>{exam.rules.meta.name}</span>
              <span>{plural(exam.paper.length, "question")}</span>
              <span>{formatDuration(exam.rules.timing.durationMinutes * 60)}</span>
              <span>{policy.passPercentage}% to pass</span>
              {p.status !== "passed" && <span>{plural(p.attemptsRemaining, "attempt")} left</span>}
              {p.cycle.index > 0 && <span>Paper {p.cycle.index + 1}</span>}
            </p>
            {p.status === "passed" ? (
              passedAttempt && (
                <div>
                  <LinkButton onClick={() => props.onOpenAttempt(passedAttempt)}>
                    See result
                  </LinkButton>
                </div>
              )
            ) : p.status === "revision_required" ? (
              <div className="ex-surface xp-panel is-warning">
                <p style={{ fontSize: 14 }}>
                  No attempts left on this paper. Revise, then take a new paper with at least{" "}
                  {policy.rewriteDifficultyPercentage}% {policy.difficultyLabel} questions
                  {record.setup && (
                    <>
                      {" "}
                      (tag them <code>difficulty={policy.difficultyLabel}</code>)
                    </>
                  )}
                  .
                </p>
                <ol className="xp-steps">
                  <li>
                    <span className="xp-dot" aria-hidden="true">
                      {revisionDone ? <Check size={12} strokeWidth={3} /> : 1}
                    </span>
                    <div>
                      <Button
                        disabled={revisionDone}
                        onClick={() => props.onRevision(planId, topicId)}
                      >
                        {revisionDone ? "Revision done" : "I've revised this topic"}
                      </Button>
                    </div>
                  </li>
                  <li>
                    <span className="xp-dot" aria-hidden="true">
                      2
                    </span>
                    <div>
                      <fieldset
                        disabled={!revisionDone}
                        className="xr-fieldset ex-stack"
                        style={{ gap: 8 }}
                      >
                        {record.setup ? (
                          // A configured exam keeps its rules; the new paper is one file.
                          <div className="ex-row">
                            <Button variant="primary" onClick={() => rewriteInput.current?.click()}>
                              <FileUp size={16} aria-hidden="true" /> Upload new paper
                            </Button>
                          </div>
                        ) : (
                          <>
                            <label className="ex-field" style={{ fontWeight: 500 }}>
                              Replacement paper
                              <select
                                className="ex-select"
                                aria-label="Replacement paper"
                                value={replacement}
                                onChange={(e) => setReplacement(e.target.value)}
                              >
                                <option value="">Choose an imported exam</option>
                                {candidates.map((e) => (
                                  <option key={e.id} value={e.id}>
                                    {e.exam.rules.meta.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="ex-row">
                              <Button
                                variant="primary"
                                disabled={!chosen}
                                onClick={() => chosen && props.onRewrite(planId, topicId, chosen)}
                              >
                                Use new paper
                              </Button>
                              <LinkButton onClick={() => rewriteInput.current?.click()}>
                                Import new paper
                              </LinkButton>
                            </div>
                          </>
                        )}
                        <input
                          ref={rewriteInput}
                          className="sr-only"
                          type="file"
                          multiple
                          accept={
                            record.setup
                              ? ".md,.markdown,.png,.jpg,.jpeg,.gif,.webp,.svg"
                              : ".zip,.json,.md,.png,.jpg,.jpeg,.gif,.webp,.svg"
                          }
                          aria-label="Import replacement exam files"
                          onChange={(e) => {
                            props.onRewriteFiles(planId, topicId, Array.from(e.target.files ?? []));
                            e.target.value = "";
                          }}
                        />
                      </fieldset>
                    </div>
                  </li>
                </ol>
              </div>
            ) : (
              <div className="xp-cta">
                <Button variant="primary" onClick={() => props.onStart(planId, topicId)}>
                  {p.activeAttempt
                    ? "Resume exam"
                    : p.status === "failed"
                      ? "Retake exam"
                      : "Start exam"}
                </Button>
                {p.status === "failed" && lastGraded && (
                  <LinkButton onClick={() => props.onReview(lastGraded)}>
                    Review last attempt (
                    {formatPercent(
                      scorePercentage(lastGraded.analysis!.score, lastGraded.analysis!.totalMarks),
                    )}
                    )
                  </LinkButton>
                )}
              </div>
            )}
          </>
        )}

        {shown === "review" && passedAttempt && (
          <>
            <p className="ex-small">
              Go through every answer with its key and solution. Mistakes are shown first.
            </p>
            <div className="xp-cta">
              <Button
                variant={p.steps.review ? "secondary" : "primary"}
                onClick={() => props.onReview(passedAttempt)}
              >
                Review answers
              </Button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
