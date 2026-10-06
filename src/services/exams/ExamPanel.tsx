import { Check } from "lucide-react";
import type { AttemptRecord } from "./storage";
import { canReleaseSolutions } from "./session";
import { progressionPolicy, scorePercentage, meetsPassingScore } from "./study-plan";
import type { TopicItem } from "./topics";
import { ExamMarkdown } from "./ExamMarkdown";
import { Button, LinkButton } from "./ui/kit";
import { formatDateTime, formatPercent } from "./ui/display";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const graded = (a: AttemptRecord) =>
  !!a.analysis && ["submitted", "review"].includes(a.session.phase);
const percentOf = (a: AttemptRecord) => scorePercentage(a.analysis!.score, a.analysis!.totalMarks);

interface Props {
  item: TopicItem;
  /** The `.xam` file the exam is read from. */
  paperName: string;
  onStart: () => void;
  /** After the attempts ran out: take the paper file's current questions as the new paper. */
  onUseEditedPaper: () => void;
  onOpenAttempt: (attempt: AttemptRecord) => void;
  onReview: (attempt: AttemptRecord) => void;
}

/**
 * An `.xam` paper, ready to sit: what it is, one action for where the learner
 * stands (start, resume, retake, review), and the attempts so far. Keys and
 * solutions never show here; they open only from a submitted attempt.
 */
export function ExamPanel({
  item,
  paperName,
  onStart,
  onUseEditedPaper,
  onOpenAttempt,
  onReview,
}: Props) {
  const { record, topic } = item;
  const p = item.progress;
  const saved = record.days[topic.id];
  // The plan is built from the files before this panel shows.
  if (!p || !saved?.cycles.length) return null;
  const policy = progressionPolicy(saved.cycles[0].exam.exam.rules);
  const exam = p.cycle.exam.exam;
  const done = p.attempts.filter(graded);
  const passedAttempt = done
    .filter((a) =>
      meetsPassingScore(a.analysis!.score, a.analysis!.totalMarks, policy.passPercentage),
    )
    .at(-1);
  const last = done.at(-1);
  const reviewable = (a: AttemptRecord) => canReleaseSolutions(a.exam.exam.rules);

  return (
    <section className="ex-surface xp-step-panel" aria-label="Exam">
      {topic.summaryMd && <ExamMarkdown source={topic.summaryMd} />}
      <p className="ex-meta tabular">
        <span>{plural(exam.paper.length, "question")}</span>
        {p.status !== "passed" && <span>{plural(p.attemptsRemaining, "attempt")} left</span>}
        {p.cycle.index > 0 && <span>Paper {p.cycle.index + 1}</span>}
      </p>

      {p.status === "passed" && passedAttempt ? (
        <>
          <p className="xp-verdict is-correct" role="status">
            <Check size={18} aria-hidden="true" /> Passed ·{" "}
            {formatPercent(percentOf(passedAttempt))}
          </p>
          {reviewable(passedAttempt) && (
            <div className="xp-cta">
              <Button variant="primary" onClick={() => onReview(passedAttempt)}>
                Review answers
              </Button>
            </div>
          )}
        </>
      ) : p.status === "revision_required" ? (
        <div className="ex-surface xp-panel is-warning">
          <p style={{ fontSize: 14 }}>
            No attempts left on this paper. To sit it again, put new questions in {paperName} and
            save it: at least {policy.rewriteDifficultyPercentage}% of them tagged{" "}
            <code>difficulty={policy.difficultyLabel}</code>. The rules stay as they were.
          </p>
          <div className="ex-row">
            <Button variant="primary" onClick={onUseEditedPaper}>
              Use the edited paper
            </Button>
          </div>
        </div>
      ) : (
        <>
          {p.status === "failed" && last && (
            <p className="ex-small tabular">
              Last attempt {formatPercent(percentOf(last))}, {policy.passPercentage}% needed.
            </p>
          )}
          <div className="xp-cta">
            <Button variant="primary" onClick={onStart}>
              {p.activeAttempt
                ? "Resume exam"
                : p.status === "failed"
                  ? "Retake exam"
                  : "Start exam"}
            </Button>
          </div>
          {!p.activeAttempt && (
            <p className="ex-small">Answers, keys and solutions are shown after you submit.</p>
          )}
        </>
      )}

      {done.length > 0 && (
        <section aria-label="Attempts" className="ex-stack" style={{ gap: 8 }}>
          <h2 className="ex-small" style={{ fontWeight: 600 }}>
            Attempts
          </h2>
          <ol className="ex-surface ex-surface--flush ex-hairline-list xe-attempts">
            {done.map((a, i) => {
              const percent = percentOf(a);
              const pass = meetsPassingScore(
                a.analysis!.score,
                a.analysis!.totalMarks,
                policy.passPercentage,
              );
              return (
                <li key={a.id}>
                  <span className="tabular">
                    {i + 1}. {formatDateTime(a.analysis!.at)}
                  </span>
                  <span className={`tabular ${pass ? "xs-pass" : "xs-fail"}`}>
                    {formatPercent(percent)} · {pass ? "Passed" : "Not passed"}
                  </span>
                  <LinkButton onClick={() => onOpenAttempt(a)}>Result</LinkButton>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </section>
  );
}
