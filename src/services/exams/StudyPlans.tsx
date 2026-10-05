import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  FilePlus2,
  Flag,
  LockKeyhole,
  RotateCcw,
  Upload,
} from "lucide-react";
import type { AttemptRecord, ExamRecord } from "./storage";
import {
  studyProgress,
  progressionPolicy,
  scorePercentage,
  meetsPassingScore,
  type StudyPlanRecord,
  type DayStatus,
} from "./study-plan";
import { ExamMarkdown } from "./ExamMarkdown";
import samplePlan from "../../../plans/foundations.plan.json?raw";
interface Props {
  plans: StudyPlanRecord[];
  attempts: AttemptRecord[];
  library: ExamRecord[];
  onImport: (source: string) => void;
  onTask: (planId: string, dayId: string, taskId: string, checked: boolean) => void;
  onNote: (planId: string, dayId: string, note: string) => void;
  onStart: (planId: string, dayId: string) => void;
  onRevision: (planId: string, dayId: string) => void;
  onRewrite: (planId: string, dayId: string, exam: ExamRecord) => void;
  onRewriteFiles: (planId: string, dayId: string, files: File[]) => void;
  onOpenAttempt: (attempt: AttemptRecord) => void;
}
const statusLabel: Record<DayStatus, string> = {
  locked: "Locked",
  ready: "Ready to begin",
  in_progress: "Exam in progress",
  failed: "Failed · try again",
  revision_required: "Revision required",
  passed: "Passed",
};
const formatPercent = (value: number) => `${Number(value.toFixed(1))}%`;
function StatusIcon({ status }: { status: DayStatus }) {
  return status === "passed" ? (
    <Check size={16} />
  ) : status === "locked" ? (
    <LockKeyhole size={14} />
  ) : status === "revision_required" ? (
    <BookOpen size={16} />
  ) : status === "failed" ? (
    <RotateCcw size={15} />
  ) : (
    <span className="study-step-dot" />
  );
}
function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([samplePlan], { type: "application/json" })),
    link = document.createElement("a");
  link.href = url;
  link.download = "foundations.plan.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function StudyPlans(props: Props) {
  const { plans, attempts, library } = props,
    [selectedPlan, setSelectedPlan] = useState(""),
    [selectedDay, setSelectedDay] = useState(""),
    [replacement, setReplacement] = useState("");
  const dayList = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLInputElement>(null),
    rewriteInput = useRef<HTMLInputElement>(null);
  const record = plans.find((p) => p.id === selectedPlan) ?? plans[0],
    progress = record ? studyProgress(record, attempts) : [],
    completed = progress.filter((p) => p.status === "passed").length;
  const current =
      progress.find((p) => p.id === selectedDay) ??
      progress.find((p) => p.status !== "passed") ??
      progress.at(-1),
    day = record?.plan.days.find((d) => d.id === current?.id),
    saved = day && record.days[day.id],
    index = record?.plan.days.findIndex((d) => d.id === day?.id) ?? 0;
  const policy = saved ? progressionPolicy(saved.cycles[0].exam.exam.rules) : null;
  const candidates = library.filter(
      (e) => e.exam.taxonomy.id === current?.cycle.exam.exam.taxonomy.id,
    ),
    chosen = candidates.find((e) => e.id === replacement);
  const isLocked = current?.status === "locked",
    isPassed = current?.status === "passed",
    revision = current?.status === "revision_required";
  useEffect(() => {
    const list = dayList.current,
      selected = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (list && selected && list.scrollWidth > list.clientWidth) {
      list.scrollTo({
        left:
          list.scrollLeft +
          selected.getBoundingClientRect().left -
          list.getBoundingClientRect().left -
          12,
      });
    }
  }, [current?.id, record?.id]);
  return (
    <div className="study-workspace">
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept=".json"
        aria-label="Import study plan"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void file.text().then(props.onImport);
          event.target.value = "";
        }}
      />
      <header className="study-page-header">
        <div>
          <p className="exam-eyebrow">ONE DAY AT A TIME</p>
          <h1>Study plans</h1>
          <p className="exam-muted">A clear next step. Progress earned through understanding.</p>
        </div>
        <div className="exam-actions">
          <button className="study-icon-button" onClick={downloadTemplate}>
            <Download size={16} /> Plan template
          </button>
          <button className="exam-primary study-icon-button" onClick={() => input.current?.click()}>
            <Upload size={16} /> Import plan
          </button>
        </div>
      </header>
      {!record ? (
        <section className="study-empty">
          <div className="study-empty-symbol">
            <CalendarDays size={30} />
          </div>
          <p className="exam-eyebrow">YOUR ROUTINE, WITH A LITTLE STRUCTURE</p>
          <h2>
            Turn a study plan into
            <br />
            daily progress.
          </h2>
          <p>
            Bring your lessons and exams together. Check off your work, test what you know, and
            unlock the next day when you pass.
          </p>
          <div className="exam-actions">
            <button
              className="exam-primary study-icon-button"
              onClick={() => props.onImport(samplePlan)}
            >
              Try the example plan <ArrowRight size={16} />
            </button>
            <button onClick={() => input.current?.click()}>Import your plan</button>
          </div>
          <div className="study-how">
            <span>
              <b>01</b> Follow your plan
            </span>
            <ChevronRight size={15} />
            <span>
              <b>02</b> Pass your exam
            </span>
            <ChevronRight size={15} />
            <span>
              <b>03</b> Move forward
            </span>
          </div>
          <p className="study-small">
            Use the downloadable JSON template. Import any referenced exams before your plan.
          </p>
        </section>
      ) : (
        <>
          <section className="study-plan-overview">
            <div>
              {plans.length > 1 ? (
                <label className="study-plan-picker">
                  Current plan
                  <select
                    value={record.id}
                    onChange={(e) => {
                      setSelectedPlan(e.target.value);
                      setSelectedDay("");
                      setReplacement("");
                    }}
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.plan.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <h2>{record.plan.name}</h2>
              )}
              <p className="exam-muted">{record.plan.description}</p>
              {record.plan.startDate && (
                <p className="study-small">
                  Started{" "}
                  {new Date(record.plan.startDate + "T00:00:00").toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>
            <div className="study-completion">
              <strong>
                {completed}
                <span> / {progress.length} days</span>
              </strong>
              <div
                className="study-progress-track"
                role="progressbar"
                aria-label="Days passed"
                aria-valuemin={0}
                aria-valuemax={progress.length}
                aria-valuenow={completed}
              >
                <span style={{ width: `${(completed / progress.length) * 100}%` }} />
              </div>
              <small>
                {completed === progress.length
                  ? "Plan complete. Well done."
                  : "Each passed exam unlocks the next day."}
              </small>
            </div>
          </section>
          <div className="study-layout">
            <aside className="study-days">
              <p className="exam-eyebrow">YOUR PATH</p>
              <ol ref={dayList}>
                {progress.map((p, i) => {
                  const d = record.plan.days[i];
                  return (
                    <li key={p.id}>
                      <button
                        className={`study-day-link study-status-${p.status}`}
                        aria-current={p.id === current?.id ? "step" : undefined}
                        onClick={() => {
                          setSelectedDay(p.id);
                          setReplacement("");
                        }}
                      >
                        <span className="study-step-icon">
                          <StatusIcon status={p.status} />
                        </span>
                        <span className="study-day-copy">
                          <small>DAY {String(i + 1).padStart(2, "0")}</small>
                          <strong>{d.title}</strong>
                          <span>{statusLabel[p.status]}</span>
                        </span>
                        {p.status === "passed" ? (
                          <span className="study-day-score">
                            {formatPercent(p.bestPercentage!)}
                          </span>
                        ) : p.id === current?.id ? (
                          <ChevronRight size={16} />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className="study-path-note">
                <LockKeyhole size={14} /> Days unlock in order. Your checklist and notes are always
                saved.
              </p>
            </aside>
            {day && current && saved && policy && (
              <main className="study-day-detail">
                <header className="study-day-heading">
                  <div className="exam-actions">
                    <span className="study-day-number">
                      DAY {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className={`study-status-pill study-status-${current.status}`}>
                      {statusLabel[current.status]}
                    </span>
                    {day.estimatedMinutes && (
                      <span className="study-time">
                        <Clock3 size={14} /> {day.estimatedMinutes} min planned
                      </span>
                    )}
                  </div>
                  <h2>{day.title}</h2>
                  <ExamMarkdown source={day.summaryMd} />
                </header>
                {isLocked ? (
                  <section className="study-gate">
                    <div className="study-gate-symbol">
                      <LockKeyhole size={24} />
                    </div>
                    <h3>One step at a time</h3>
                    <p>
                      Pass Day {index} before starting this day. Completing a checklist alone does
                      not unlock an exam.
                    </p>
                    <button
                      onClick={() =>
                        setSelectedDay(progress.find((p) => p.status !== "passed")!.id)
                      }
                    >
                      Go to your current day <ArrowRight size={16} />
                    </button>
                  </section>
                ) : (
                  <>
                    {isPassed && (
                      <div className="study-success">
                        <CheckCircle2 size={22} />
                        <div>
                          <strong>Day {index + 1} passed. Keep your momentum.</strong>
                          <p>
                            Your best score is {formatPercent(current.bestPercentage!)}.{" "}
                            {index + 1 < progress.length
                              ? "The next day is now unlocked."
                              : "You have completed this plan."}
                          </p>
                        </div>
                        {index + 1 < progress.length && (
                          <button onClick={() => setSelectedDay(progress[index + 1].id)}>
                            Next day <ArrowRight size={15} />
                          </button>
                        )}
                      </div>
                    )}
                    <section className="study-section">
                      <div className="study-section-title">
                        <h3>Your learning checklist</h3>
                        <span>
                          {current.completedTasks} of {current.totalTasks} done
                        </span>
                      </div>
                      <div className="study-task-list">
                        {day.tasks.length ? (
                          day.tasks.map((task) => (
                            <label
                              className={
                                saved.tasks[task.id] ? "study-task is-complete" : "study-task"
                              }
                              key={task.id}
                            >
                              <input
                                type="checkbox"
                                checked={!!saved.tasks[task.id]}
                                onChange={(e) =>
                                  props.onTask(record.id, day.id, task.id, e.target.checked)
                                }
                              />
                              <span>{task.label}</span>
                            </label>
                          ))
                        ) : (
                          <p className="exam-muted">
                            No checklist for this day. Use your notes to track your preparation.
                          </p>
                        )}
                      </div>
                      <p className="study-small">
                        Mark your preparation here. Your exam result determines whether the day is
                        passed.
                      </p>
                    </section>
                    <section className={`study-assessment ${revision ? "needs-revision" : ""}`}>
                      <div className="study-assessment-top">
                        <span className="study-assessment-icon">
                          {revision ? <BookOpen size={21} /> : <Flag size={21} />}
                        </span>
                        <div>
                          <p className="exam-eyebrow">
                            DAILY CHECKPOINT · PAPER {current.cycle.index + 1}
                          </p>
                          <h3>
                            {revision
                              ? "Revise, then come back with a fresh paper."
                              : isPassed
                                ? "Understanding confirmed."
                                : "Test your understanding."}
                          </h3>
                        </div>
                      </div>
                      <p className="exam-muted">{current.cycle.exam.exam.rules.meta.name}</p>
                      <div className="study-assessment-metrics">
                        <span>
                          <strong>{policy.passPercentage}%</strong> to pass
                        </span>
                        <span>
                          <strong>
                            {current.attemptsRemaining} / {current.maxAttempts}
                          </strong>{" "}
                          attempts left
                        </span>
                        <span>
                          <strong>
                            {current.cycle.exam.exam.rules.timing.durationMinutes} min
                          </strong>{" "}
                          exam
                        </span>
                      </div>
                      {current.status === "failed" && (
                        <p className="study-failed-message">
                          This day is marked failed. Your latest score was{" "}
                          {formatPercent(current.latestPercentage!)}; you need{" "}
                          {policy.passPercentage}% to move on. Review your mistakes and try again.
                        </p>
                      )}
                      {revision ? (
                        <div className="study-revision-flow">
                          <p>
                            You used all {current.maxAttempts} attempts without passing. The next
                            day stays locked. Your progress so far is saved.
                          </p>
                          <div className="study-revision-step">
                            <span className="study-revision-number">
                              {current.cycle.revisionCompletedAt !== undefined ? (
                                <Check size={15} />
                              ) : (
                                1
                              )}
                            </span>
                            <div>
                              <h4>Revisit what needs work</h4>
                              <p>
                                Use your weakness report, review your notes, and practice the
                                concepts you missed.
                              </p>
                              <button
                                disabled={current.cycle.revisionCompletedAt !== undefined}
                                onClick={() => props.onRevision(record.id, day.id)}
                              >
                                {current.cycle.revisionCompletedAt !== undefined
                                  ? "Revision completed"
                                  : "I've revised this topic"}
                              </button>
                            </div>
                          </div>
                          <div className="study-revision-step">
                            <span className="study-revision-number">2</span>
                            <div>
                              <h4>Use a new paper</h4>
                              <p>
                                At least {policy.rewriteDifficultyPercentage}% of its questions must
                                be tagged “{policy.difficultyLabel}”. The pass mark and attempt
                                limit stay the same.
                              </p>
                              <fieldset disabled={current.cycle.revisionCompletedAt === undefined}>
                                <label>
                                  Replacement paper
                                  <select
                                    aria-label="Replacement paper"
                                    value={replacement}
                                    onChange={(e) => setReplacement(e.target.value)}
                                  >
                                    <option value="">Choose an imported exam</option>
                                    {candidates.map((e) => (
                                      <option key={e.id} value={e.id}>
                                        {e.exam.rules.meta.name} ·{" "}
                                        {Math.round(
                                          (e.exam.paper.filter(
                                            (q) => q.difficulty === policy.difficultyLabel,
                                          ).length /
                                            e.exam.paper.length) *
                                            100,
                                        )}
                                        % {policy.difficultyLabel}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <div className="exam-actions">
                                  <button
                                    className="exam-primary"
                                    disabled={!chosen}
                                    onClick={() =>
                                      chosen && props.onRewrite(record.id, day.id, chosen)
                                    }
                                  >
                                    Use new paper
                                  </button>
                                  <button
                                    className="study-icon-button"
                                    onClick={() => rewriteInput.current?.click()}
                                  >
                                    <FilePlus2 size={16} /> Import new paper
                                  </button>
                                </div>
                                <input
                                  ref={rewriteInput}
                                  className="sr-only"
                                  type="file"
                                  multiple
                                  accept=".json,.md"
                                  aria-label="Import replacement exam files"
                                  onChange={(e) => {
                                    props.onRewriteFiles(
                                      record.id,
                                      day.id,
                                      Array.from(e.target.files ?? []),
                                    );
                                    e.target.value = "";
                                  }}
                                />
                              </fieldset>
                            </div>
                          </div>
                        </div>
                      ) : (
                        !isPassed && (
                          <div className="study-assessment-action">
                            <button
                              className="exam-primary study-icon-button"
                              onClick={() => props.onStart(record.id, day.id)}
                            >
                              {current.activeAttempt
                                ? "Resume exam"
                                : current.status === "failed"
                                  ? "Try again"
                                  : "Start today's exam"}
                              <ArrowRight size={16} />
                            </button>
                            <span className="study-small">
                              {current.status === "in_progress"
                                ? "The exam clock continues while you are away."
                                : "Your answers are saved as you go."}
                            </span>
                          </div>
                        )
                      )}
                    </section>
                    <section className="study-section">
                      <div className="study-section-title">
                        <h3>Your notes</h3>
                        <span>Saved automatically</span>
                      </div>
                      <textarea
                        className="study-notes"
                        aria-label="Daily study notes"
                        placeholder="What clicked today? What needs another look?"
                        value={saved.note}
                        maxLength={5000}
                        onChange={(e) => props.onNote(record.id, day.id, e.target.value)}
                      />
                    </section>
                    {current.attempts.length > 0 && (
                      <section className="study-section">
                        <div className="study-section-title">
                          <h3>Attempt history</h3>
                          <span>
                            {
                              current.attempts.filter((a) => a.session.startedAt !== undefined)
                                .length
                            }{" "}
                            started
                          </span>
                        </div>
                        <div className="study-attempt-list">
                          {[...current.attempts].reverse().map((a) => {
                            const graded =
                                !!a.analysis && ["submitted", "review"].includes(a.session.phase),
                              passed =
                                graded &&
                                meetsPassingScore(
                                  a.analysis!.score,
                                  a.analysis!.totalMarks,
                                  policy.passPercentage,
                                );
                            return (
                              <button
                                key={a.id}
                                className="study-attempt"
                                onClick={() => props.onOpenAttempt(a)}
                              >
                                <span
                                  className={`study-attempt-dot ${graded ? (passed ? "is-pass" : "is-fail") : ""}`}
                                />
                                <span>
                                  <strong>
                                    {graded
                                      ? passed
                                        ? "Passed"
                                        : "Failed"
                                      : a.session.phase.replaceAll("_", " ")}
                                  </strong>
                                  <small>
                                    Paper {a.study!.cycle + 1} ·{" "}
                                    {new Date(a.session.createdAt).toLocaleDateString()}
                                  </small>
                                </span>
                                {graded && (
                                  <strong>
                                    {formatPercent(
                                      scorePercentage(a.analysis!.score, a.analysis!.totalMarks),
                                    )}
                                  </strong>
                                )}
                                <ArrowUpRight size={16} />
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    )}
                  </>
                )}
              </main>
            )}
          </div>
        </>
      )}
    </div>
  );
}
