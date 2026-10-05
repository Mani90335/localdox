import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, Download, LockKeyhole, MoreHorizontal, Upload } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { AttemptRecord, ExamRecord } from "./storage";
import {
  studyProgress,
  progressionPolicy,
  scorePercentage,
  meetsPassingScore,
  type StudyPlanRecord,
  type DayProgress,
  type DayStep,
} from "./study-plan";
import { ExamMarkdown } from "./ExamMarkdown";
import { Button, EmptyState, LinkButton, OverflowMenu, ProgressBar } from "./ui/kit";
import { formatDuration, formatPercent } from "./ui/display";

interface Props {
  plans: StudyPlanRecord[];
  attempts: AttemptRecord[];
  library: ExamRecord[];
  onImportFiles: (files: File[]) => void;
  onImportExample: () => void;
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
/** "planId/topicId": topics from every uploaded plan share one picker. */
const topicKey = (planId: string, topicId: string) => `${planId}/${topicId}`;

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

export function StudyPlans(props: Props) {
  const { plans, attempts, library } = props,
    [selected, setSelected] = useState(""),
    [chosenStep, setChosenStep] = useState<StepId | null>(null),
    [replacement, setReplacement] = useState(""),
    [noteSaved, setNoteSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    practiceInput = useRef<HTMLInputElement>(null),
    rewriteInput = useRef<HTMLInputElement>(null);

  // Every topic of every plan, in upload order.
  const topics = plans.flatMap((record) =>
    studyProgress(record, attempts).map((progress, i) => ({
      record,
      progress,
      topic: record.plan.days[i],
      key: topicKey(record.id, progress.id),
    })),
  );
  const current =
    topics.find((t) => t.key === selected) ??
    topics.find((t) => t.progress.step !== "done") ??
    topics.at(-1);
  const p = current?.progress,
    record = current?.record,
    topic = current?.topic,
    saved = record && topic ? record.days[topic.id] : undefined;
  const policy = saved ? progressionPolicy(saved.cycles[0].exam.exam.rules) : null;

  // A finished step moves the view to the next one; a chosen step stays.
  useEffect(() => setChosenStep(null), [current?.key, p?.step]);
  useEffect(() => {
    setNoteSaved(false);
    setReplacement("");
  }, [current?.key]);

  const fileInput = (
    <input
      ref={input}
      className="sr-only"
      type="file"
      multiple
      accept=".zip,.json,.md,.png,.jpg,.jpeg,.gif,.webp,.svg"
      aria-label="Import study plan"
      onChange={(event) => {
        props.onImportFiles(Array.from(event.target.files ?? []));
        event.target.value = "";
      }}
    />
  );

  if (!current || !p || !record || !topic || !saved || !policy)
    return (
      <div className="ex-page">
        {fileInput}
        <EmptyState
          icon={<Upload size={20} />}
          title="Upload a topic to start"
          actions={
            <>
              <Button variant="primary" onClick={() => input.current?.click()}>
                <Upload size={16} aria-hidden="true" /> Upload files
              </Button>
              <Button onClick={props.onImportExample}>Try the example</Button>
            </>
          }
        >
          Each topic has four steps, one after another: learn, practise, take the exam, review your
          answers. Upload a .zip, or the plan with its exam and practice files.
        </EmptyState>
        <p className="ex-small" style={{ textAlign: "center", marginTop: 12 }}>
          <LinkButton onClick={props.onDownloadExample}>Download example files</LinkButton>
        </p>
      </div>
    );

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
  const nextOpen = topics.find((t) => t.key !== current.key && t.progress.step !== "done");
  const planId = record.id,
    topicId = topic.id;

  return (
    <div className="ex-page">
      {fileInput}
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

      <header className="ex-page-header" style={{ alignItems: "center" }}>
        <div>
          {topics.length > 1 ? (
            <label className="xp-topic-picker">
              <span className="sr-only">Topic</span>
              <select
                className="ex-select xp-plan-select"
                value={current.key}
                onChange={(e) => setSelected(e.target.value)}
              >
                {plans.map((plan) => (
                  <optgroup key={plan.id} label={plan.plan.name}>
                    {topics
                      .filter((t) => t.record.id === plan.id)
                      .map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.progress.step === "done" ? "✓ " : ""}
                          {t.topic.title}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
          ) : null}
          <h1 className={topics.length > 1 ? "sr-only" : undefined}>{topic.title}</h1>
        </div>
        <div className="ex-row">
          <Button onClick={() => input.current?.click()}>
            <Upload size={16} aria-hidden="true" /> Upload
          </Button>
          <OverflowMenu
            trigger={
              <Button aria-label="More" className="ex-btn--icon">
                <MoreHorizontal size={16} aria-hidden="true" />
              </Button>
            }
            items={[
              {
                label: "Download example files",
                icon: <Download size={16} />,
                onSelect: props.onDownloadExample,
              },
            ]}
          />
        </div>
      </header>

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
              <Button variant="primary" onClick={() => setSelected(nextOpen.key)}>
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
                  {policy.rewriteDifficultyPercentage}% {policy.difficultyLabel} questions.
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
                        <input
                          ref={rewriteInput}
                          className="sr-only"
                          type="file"
                          multiple
                          accept=".zip,.json,.md,.png,.jpg,.jpeg,.gif,.webp,.svg"
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
    </div>
  );
}
