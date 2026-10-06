import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import type { AttemptRecord } from "./storage";
import type { Solution } from "./parser";
import { questionState, canReleaseScore, canReleaseSolutions } from "./session";
import { ExamAssets, ExamMarkdown } from "./ExamMarkdown";
import { scorePercentage, type DayProgress } from "./study-plan";
import { Button, Chip, EmptyState, Segmented, Skeleton, StatBlocks, type Tone } from "./ui/kit";
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

/**
 * One screen after submission: the result, then every answer with its key and
 * solution (once the rules release them). It sits in the reader beside the
 * workspace, not over it: the timed part is over.
 */
export function ResultScreen({
  attempt,
  solutions,
  studyDay,
  focusAnswers,
  onBack,
  dev,
}: {
  attempt: AttemptRecord;
  /** Empty while they load; the answers wait for them. */
  solutions: Solution[];
  studyDay?: DayProgress;
  /** Opened to review answers: start at them rather than the score. */
  focusAnswers?: boolean;
  onBack: () => void;
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
  const root = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    answersHeading = useRef<HTMLHeadingElement>(null);
  // The screen replaces the exam the learner just left, so focus lands on it
  // rather than on the page. Reviewing starts at the answers.
  useEffect(() => {
    const answers = focusAnswers && solutionsReleased;
    (answers ? answersHeading : heading).current?.focus({ preventScroll: true });
    // The reader's header is sticky; scroll-margin-top (exams.css) clears it.
    const target = (answers ? answersHeading : root).current;
    if (answers || (target && target.getBoundingClientRect().top < 64))
      target?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="ex-page xs-result" ref={root}>
      <div className="xs-back">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to paper
        </Button>
      </div>
      <section className="xs-hero" aria-label="Result">
        <p className="ex-meta">
          <span>{r.meta.name}</span>
          <span>{formatDateTime(a.at)}</span>
        </p>
        {inPlan ? (
          <div className="ex-stack" style={{ gap: 4 }}>
            <h1
              ref={heading}
              tabIndex={-1}
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
            <h1 ref={heading} tabIndex={-1} className="sr-only">
              Exam result
            </h1>
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
      </section>

      <div className="ex-stack" style={{ gap: 32, marginTop: 24 }}>
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
        <section className="ex-section" aria-labelledby="xs-answers">
          <h2 id="xs-answers" ref={answersHeading} tabIndex={-1}>
            Answers &amp; solutions
          </h2>
          {solutionsReleased ? (
            solutions.length ? (
              <Answers attempt={attempt} solutions={solutions} dev={dev} />
            ) : (
              <div className="ex-stack" role="status" aria-busy="true" style={{ gap: 16 }}>
                <span className="sr-only">Loading answers…</span>
                <Skeleton height={40} />
                <Skeleton height={160} />
              </div>
            )
          ) : (
            <p className="ex-small">
              {r.results.solutionsRelease === "never"
                ? "This exam doesn't release solutions."
                : `Solutions release ${formatDateTime(Date.parse(r.results.releaseAt!))}.`}
            </p>
          )}
        </section>
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
        <div className="ex-row">
          <Button onClick={onBack}>Back to paper</Button>
        </div>
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

/**
 * Every question with the learner's answer, the key and the solution, behind a
 * map that shows each outcome at a glance and jumps to it.
 */
function Answers({
  attempt,
  solutions,
  dev,
}: {
  attempt: AttemptRecord;
  solutions: Solution[];
  dev: boolean;
}) {
  const { exam, session, analysis } = attempt;
  const ordered = session.order
    .map((id) => exam.exam.paper.find((q) => q.id === id))
    .filter((q): q is NonNullable<typeof q> => !!q);
  const outcomeOf = (id: string) =>
      String(analysis!.questions.find((a) => a.id === id)?.signals.outcome ?? "unanswered"),
    mistakes = ordered.filter((q) => outcomeOf(q.id) !== "correct").length;
  const [filter, setFilter] = useState<"mistakes" | "all">(mistakes ? "mistakes" : "all");
  const shown = ordered
    .map((q, i) => ({ q, n: i + 1 }))
    .filter(({ q }) => filter === "all" || outcomeOf(q.id) !== "correct");
  const jump = (id: string) => {
    if (filter === "mistakes" && outcomeOf(id) === "correct") setFilter("all");
    // After the filter renders the card.
    requestAnimationFrame(() => {
      const card = document.getElementById(`xs-q-${id}`);
      card?.scrollIntoView({ block: "start", behavior: "smooth" });
      card?.focus({ preventScroll: true });
    });
  };
  return (
    <ExamAssets source={exam}>
      <div className="ex-stack" style={{ gap: 16 }}>
        <nav className="xs-map" aria-label="Questions by outcome">
          {ordered.map((q, i) => {
            const outcome = OUTCOME[outcomeOf(q.id)] ?? OUTCOME.unanswered;
            return (
              <button
                key={q.id}
                type="button"
                data-tone={outcome.tone}
                aria-label={`Question ${i + 1}: ${outcome.label}`}
                title={outcome.label}
                onClick={() => jump(q.id)}
              >
                {i + 1}
              </button>
            );
          })}
        </nav>
        <div className="ex-row">
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "mistakes", label: `Mistakes (${mistakes})` },
              { value: "all", label: `All (${ordered.length})` },
            ]}
          />
        </div>
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
            <article
              className="ex-surface xs-review-q"
              key={q.id}
              id={`xs-q-${q.id}`}
              tabIndex={-1}
              aria-labelledby={`rq-${q.id}`}
            >
              <header className="ex-row">
                <h3 id={`rq-${q.id}`} style={{ fontSize: 16 }}>
                  Question {n}
                </h3>
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
                <h4 style={{ fontSize: 14, marginBottom: 4 }}>Solution</h4>
                <ExamMarkdown source={solution.body} />
              </div>
            </article>
          );
        })}
      </div>
    </ExamAssets>
  );
}
