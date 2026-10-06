import { useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import type { AttemptRecord } from "./storage";
import type { Solution } from "./parser";
import { questionState, canReleaseScore, canReleaseSolutions } from "./session";
import { ExamAssets, ExamMarkdown } from "./ExamMarkdown";
import { scorePercentage, type DayProgress } from "./study-plan";
import { Button, Chip, EmptyState, PageHeader, Segmented, StatBlocks, type Tone } from "./ui/kit";
import {
  formatDateTime,
  formatDuration,
  formatPercent,
  humanizeId,
  submitReasonCopy,
  trimNumber,
} from "./ui/display";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function BarRow({ label, share, value }: { label: string; share: number; value: React.ReactNode }) {
  return (
    <div className="xs-bar-row">
      <span>{label}</span>
      <div className="ex-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(100, share * 100))}%` }} />
      </div>
      <span>{value}</span>
    </div>
  );
}

export function ResultScreen({
  attempt,
  onReview,
  studyDay,
  onStudyPlan,
  dev,
}: {
  attempt: AttemptRecord;
  onReview: () => void;
  studyDay?: DayProgress;
  onStudyPlan?: () => void;
  dev: boolean;
}) {
  const a = attempt.analysis!,
    s = attempt.session,
    r = attempt.exam.exam.rules;
  const scoreReleased = canReleaseScore(r),
    solutionsReleased = canReleaseSolutions(r);
  const percent = scorePercentage(a.score, a.totalMarks),
    attempted = a.questions.filter((q) => q.signals.outcome !== "unanswered").length,
    used =
      s.startedAt !== undefined && s.submittedAt !== undefined
        ? (s.submittedAt - s.startedAt) / 1000
        : null,
    reason = submitReasonCopy(s.events.find((e) => e.type === "submitted")?.reason);
  const scoreText = `${a.score.toFixed(r.results.rounding)} / ${trimNumber(a.totalMarks)}`;
  const passed = studyDay?.status === "passed",
    inPlan = !!studyDay && scoreReleased;
  return (
    <div className="ex-page">
      <section className="xs-hero" aria-label="Result">
        <p className="ex-meta">
          <span>{r.meta.name}</span>
          <span>{formatDateTime(a.at)}</span>
        </p>
        {inPlan ? (
          <div className="ex-stack" style={{ gap: 4 }}>
            <h1
              className={passed ? "xs-pass" : "xs-fail"}
              style={{ fontSize: 36, letterSpacing: "-0.03em" }}
            >
              {passed ? "Passed" : "Not passed"} · {formatPercent(percent)}
            </h1>
            <p className="ex-muted tabular">
              {studyDay!.passPercentage}% needed · {scoreText} marks
              {!passed &&
                (studyDay!.status === "revision_required"
                  ? " · No attempts left. A new paper comes from the edited file."
                  : ` · ${plural(studyDay!.attemptsRemaining, "attempt")} left`)}
            </p>
          </div>
        ) : (
          <div className="ex-stack" style={{ gap: 4 }}>
            <h1 className="sr-only">Exam result</h1>
            <div className="xs-verdict">
              {scoreReleased ? (
                <>
                  <span className="xs-score">{scoreText}</span>
                  <Chip tone="accent" large>
                    {formatPercent(percent)}
                  </Chip>
                </>
              ) : (
                <span className="xs-score">Score withheld</span>
              )}
            </div>
            {!scoreReleased && r.results.releaseAt && (
              <p className="ex-muted">
                Scores release {formatDateTime(Date.parse(r.results.releaseAt))}.
              </p>
            )}
          </div>
        )}
        <div className="ex-row">
          {solutionsReleased && (
            <Button variant="primary" onClick={onReview}>
              Review answers &amp; solutions
            </Button>
          )}
          {studyDay && <Button onClick={onStudyPlan}>Back to paper</Button>}
        </div>
        {!solutionsReleased && (
          <p className="ex-small">
            {r.results.solutionsRelease === "never"
              ? "This exam doesn't release solutions."
              : `Solutions release ${formatDateTime(Date.parse(r.results.releaseAt!))}.`}
          </p>
        )}
      </section>

      <div className="ex-stack" style={{ gap: 32, marginTop: 32 }}>
        <StatBlocks
          label="Summary"
          items={[
            ...(scoreReleased
              ? [{ label: "Accuracy", value: formatPercent(a.accuracy), detail: "of attempted" }]
              : []),
            ...(used !== null ? [{ label: "Time used", value: formatDuration(used) }] : []),
            { label: "Attempted", value: attempted, detail: `of ${a.questions.length}` },
          ]}
        />
        {(a.violations > 0 || reason) && (
          <div className="ex-stack" style={{ gap: 8 }}>
            {reason && <p className="ex-small">{reason}</p>}
            {a.violations > 0 && (
              <p className="xs-note">
                {plural(a.violations, "integrity warning")} recorded during this attempt.
              </p>
            )}
          </div>
        )}
        {scoreReleased && r.results.showSectionBreakdown && a.sections.length > 1 && (
          <section className="ex-section" aria-labelledby="xs-sections">
            <h2 id="xs-sections">Sections</h2>
            <div className="ex-surface xs-bars">
              {a.sections.map((sec) => (
                <BarRow
                  key={sec.id}
                  label={r.sections.find((v) => v.id === sec.id)?.name ?? humanizeId(sec.id)}
                  share={sec.totalMarks ? sec.score / sec.totalMarks : 0}
                  value={
                    <>
                      <strong>
                        {sec.score.toFixed(r.results.rounding)}/{trimNumber(sec.totalMarks)}
                      </strong>{" "}
                      · {formatPercent(scorePercentage(Math.max(0, sec.score), sec.totalMarks))}
                    </>
                  }
                />
              ))}
            </div>
          </section>
        )}
        {dev && (
          <details className="xi-author">
            <summary>Session event log (dev)</summary>
            <div className="ex-surface ex-surface--flush">
              <div className="ex-table-wrap" style={{ maxHeight: 360 }}>
                <table className="ex-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Event</th>
                      <th>Question / section</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.events.map((event, index) => (
                      <tr key={index}>
                        <td className="tabular">{new Date(event.at).toLocaleTimeString()}</td>
                        <td>{event.type}</td>
                        <td>{event.questionId ?? event.section ?? event.reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

export const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  correct: { label: "Correct", tone: "success" },
  wrong: { label: "Wrong", tone: "danger" },
  partial: { label: "Partly correct", tone: "warning" },
  unanswered: { label: "Not answered", tone: "neutral" },
};

/** Options with the key and the learner's choice marked. Shared with practice. */
export function AnswerKey({
  options,
  correct,
  picked,
}: {
  options: string[];
  correct: string[];
  picked: string[];
}) {
  return (
    <div className="ex-stack" style={{ gap: 8 }}>
      {options.map((o, idx) => {
        const label = String.fromCharCode(65 + idx),
          isCorrect = correct.includes(label),
          isPicked = picked.includes(label);
        return (
          <div
            className={`xs-review-opt${isCorrect ? " is-correct" : isPicked ? " is-wrong" : ""}`}
            key={idx}
          >
            <span className="xr-letter">{label}</span>
            <ExamMarkdown source={o} />
            {(isCorrect || isPicked) && (
              <Chip tone={isCorrect ? "success" : "danger"}>
                {isPicked && isCorrect
                  ? "Your answer · correct"
                  : isPicked
                    ? "Your answer"
                    : "Correct"}
              </Chip>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ReviewScreen({
  attempt,
  solutions,
  onBack,
  dev,
}: {
  attempt: AttemptRecord;
  solutions: Solution[];
  onBack: () => void;
  dev: boolean;
}) {
  const { exam, session, analysis } = attempt,
    rules = exam.exam.rules;
  const ordered = session.order
    .map((id) => exam.exam.paper.find((q) => q.id === id))
    .filter((q): q is NonNullable<typeof q> => !!q);
  const outcomeOf = (id: string) =>
      String(analysis!.questions.find((a) => a.id === id)?.signals.outcome ?? "unanswered"),
    mistakes = ordered.filter((q) => outcomeOf(q.id) !== "correct").length;
  const [filter, setFilter] = useState<"mistakes" | "all">(mistakes ? "mistakes" : "all");
  if (!canReleaseSolutions(rules))
    return (
      <div className="ex-page">
        <EmptyState
          title="Solutions aren't released yet"
          actions={<Button onClick={onBack}>Back to result</Button>}
        />
      </div>
    );
  const shown = ordered
    .map((q, i) => ({ q, n: i + 1 }))
    .filter(({ q }) => filter === "all" || outcomeOf(q.id) !== "correct");
  return (
    <ExamAssets source={exam}>
      <div className="ex-page">
        <div style={{ marginBottom: 8 }}>
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true" /> Back to result
          </Button>
        </div>
        <PageHeader
          title="Answer review"
          subtitle={rules.meta.name}
          actions={
            <Segmented
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "mistakes", label: `Mistakes (${mistakes})` },
                { value: "all", label: `All (${ordered.length})` },
              ]}
            />
          }
        />
        <div className="ex-stack">
          {!shown.length && (
            <EmptyState quiet icon={<Check size={20} />} title="No mistakes">
              Every question was answered correctly.
            </EmptyState>
          )}
          {shown.map(({ q, n }) => {
            const solution = solutions.find((s) => s.id === q.id)!,
              state = questionState(session, q.id),
              a = analysis!.questions.find((a) => a.id === q.id)!,
              outcome = OUTCOME[outcomeOf(q.id)] ?? OUTCOME.unanswered;
            const picked = Array.isArray(state.response)
              ? state.response
              : state.response
                ? [state.response]
                : [];
            return (
              <article className="ex-surface xs-review-q" key={q.id} aria-labelledby={`rq-${q.id}`}>
                <header className="ex-row">
                  <h2 id={`rq-${q.id}`} style={{ fontSize: 16 }}>
                    Question {n}
                  </h2>
                  <Chip tone={outcome.tone}>{outcome.label}</Chip>
                  <span className="ex-small tabular">
                    {a.score > 0 ? "+" : a.score < 0 ? "−" : ""}
                    {Math.abs(a.score).toFixed(2)} marks
                  </span>
                  {dev && <Chip>{q.id}</Chip>}
                </header>
                <ExamMarkdown source={q.body} />
                {q.options.length > 0 && (
                  <AnswerKey
                    options={q.options}
                    correct={solution.answer.split(",").map((v) => v.trim())}
                    picked={picked}
                  />
                )}
                {q.type === "nat" && (
                  <p className="xs-answer-line tabular">
                    <span>
                      Your answer: <strong>{state.response || "Not answered"}</strong>
                    </span>
                    <span>
                      Correct: <strong>{solution.answer.replace(":", " to ")}</strong>
                      {solution.tolerance !== undefined ? ` ± ${solution.tolerance}` : ""}
                    </span>
                  </p>
                )}
                <div className="xs-solution">
                  <h3 style={{ fontSize: 14, marginBottom: 4 }}>Solution</h3>
                  <ExamMarkdown source={solution.body} />
                </div>
              </article>
            );
          })}
        </div>
        <div className="ex-row" style={{ marginTop: 32 }}>
          <Button onClick={onBack}>Back to result</Button>
        </div>
      </div>
    </ExamAssets>
  );
}
