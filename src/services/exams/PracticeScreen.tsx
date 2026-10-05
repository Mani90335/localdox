import { useEffect, useState } from "react";
import { ArrowLeft, Check, X } from "lucide-react";
import { ExamAssets, ExamMarkdown } from "./ExamMarkdown";
import { AnswerKey } from "./Reports";
import { numeric } from "./parser";
import { isAnswered, type Response } from "./scoring";
import { practiceKey, type PracticeAnswer, type PracticeSet } from "./practice";
import { Button, Chip, EmptyState, ProgressBar } from "./ui/kit";
import { TYPE_LABEL, TYPE_NAME } from "./ui/display";

/**
 * Step 2 of a study day. Untimed: answer, check, read the solution, move on.
 * Each question is checked once, so the step finishes when all are answered.
 */
export function PracticeScreen({
  title,
  sets,
  answers,
  onAnswer,
  onExit,
}: {
  title: string;
  sets: PracticeSet[];
  answers: Record<string, PracticeAnswer>;
  onAnswer: (setId: string, questionId: string, response: Response) => void;
  onExit: () => void;
}) {
  const items = sets.flatMap((set) =>
    set.questions.map((q) => ({
      set,
      q,
      solution: set.solutions.find((s) => s.id === q.id)!,
      key: practiceKey(set.id, q.id),
    })),
  );
  const attempted = items.filter((i) => answers[i.key]).length;
  const [index, setIndex] = useState(() => {
      const first = items.findIndex((i) => !answers[i.key]);
      return first < 0 ? 0 : first;
    }),
    [draft, setDraft] = useState<Response>(null);
  const item = items[index];
  useEffect(() => setDraft(null), [index]);
  if (!item)
    return (
      <div className="ex-page">
        <EmptyState
          title="No practice questions"
          actions={<Button onClick={onExit}>Back to study plan</Button>}
        />
      </div>
    );
  const saved = answers[item.key],
    response = saved?.response ?? draft,
    checked = !!saved,
    q = item.q,
    picked = Array.isArray(response) ? response : response ? [response] : [];
  const valid =
    q.type === "nat" ? typeof response === "string" && numeric(response) : isAnswered(response);
  const nextOpen = items.findIndex((i, n) => n > index && !answers[i.key]),
    anyOpen = items.findIndex((i) => !answers[i.key]),
    done = attempted === items.length;
  return (
    <div className="xi">
      <div className="xi-top" style={{ gap: 16 }}>
        <Button variant="ghost" onClick={onExit}>
          <ArrowLeft size={16} aria-hidden="true" /> {title}
        </Button>
        <span className="ex-spacer" />
        <span className="ex-small tabular" style={{ paddingRight: 8 }}>
          {attempted} of {items.length} answered
        </span>
      </div>
      <ProgressBar value={(attempted / items.length) * 100} label="Practice progress" />
      <ExamAssets source={item.set}>
        <main className="xi-content" style={{ gap: 20, maxWidth: 808 }}>
          <div className="xr-meta" style={{ marginBottom: 0 }}>
            <div className="xr-meta-left">
              <h1 style={{ fontSize: 16 }}>
                Question {index + 1} <span className="ex-muted">of {items.length}</span>
              </h1>
              <Chip tone="accent" large title={TYPE_NAME[q.type]}>
                {TYPE_LABEL[q.type]}
              </Chip>
              {sets.length > 1 && <span className="ex-small">{item.set.name}</span>}
            </div>
          </div>
          <div className="xr-body-md">
            <ExamMarkdown source={q.body} />
          </div>

          {checked ? (
            <>
              <p className={`xp-verdict is-${saved.outcome}`} role="status" aria-live="polite">
                {saved.outcome === "correct" ? (
                  <Check size={18} aria-hidden="true" />
                ) : (
                  <X size={18} aria-hidden="true" />
                )}
                {saved.outcome === "correct"
                  ? "Correct"
                  : saved.outcome === "partial"
                    ? "Partly correct"
                    : "Not quite"}
              </p>
              {q.type === "nat" ? (
                <p className="xs-answer-line tabular">
                  <span>
                    Your answer: <strong>{String(saved.response)}</strong>
                  </span>
                  <span>
                    Correct: <strong>{item.solution.answer.replace(":", " to ")}</strong>
                    {item.solution.tolerance !== undefined ? ` ± ${item.solution.tolerance}` : ""}
                  </span>
                </p>
              ) : (
                <AnswerKey
                  options={q.options}
                  correct={item.solution.answer.split(",").map((v) => v.trim())}
                  picked={picked}
                />
              )}
              <section className="xs-solution" aria-label="Solution">
                <h2 style={{ fontSize: 14, marginBottom: 4 }}>Solution</h2>
                <ExamMarkdown source={item.solution.body} />
              </section>
            </>
          ) : q.type === "nat" ? (
            <div className="xr-nat">
              <input
                className="ex-input"
                aria-label="Numeric answer"
                inputMode="decimal"
                autoComplete="off"
                placeholder="Enter a number"
                value={typeof draft === "string" ? draft : ""}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid) onAnswer(item.set.id, q.id, response);
                }}
              />
            </div>
          ) : (
            <div
              className="xr-options"
              role={q.type === "mcq" ? "radiogroup" : "group"}
              aria-label="Options"
              style={{ marginTop: 0 }}
            >
              {q.options.map((option, i) => {
                const label = String.fromCharCode(65 + i),
                  on = picked.includes(label);
                return (
                  <label className={on ? "xr-option is-selected" : "xr-option"} key={label}>
                    <input
                      className={q.type === "mcq" ? "ex-radio" : "ex-check"}
                      type={q.type === "mcq" ? "radio" : "checkbox"}
                      name={item.key}
                      checked={on}
                      onChange={() =>
                        setDraft(
                          q.type === "mcq"
                            ? label
                            : on
                              ? picked.filter((v) => v !== label)
                              : [...picked, label],
                        )
                      }
                    />
                    <span className="xr-letter">{label}</span>
                    <ExamMarkdown source={option} />
                  </label>
                );
              })}
              {q.type === "msq" && <p className="xr-hint">Select all that apply.</p>}
            </div>
          )}
        </main>
      </ExamAssets>
      <div className="xi-bar">
        <div className="xi-bar-inner" style={{ maxWidth: 808 }}>
          <Button variant="ghost" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
            Previous
          </Button>
          <span className="ex-spacer" />
          {!checked ? (
            <>
              <Button
                variant="ghost"
                disabled={index === items.length - 1}
                onClick={() => setIndex((i) => i + 1)}
              >
                Skip for now
              </Button>
              <Button
                variant="primary"
                disabled={!valid}
                onClick={() => onAnswer(item.set.id, q.id, response)}
              >
                Check answer
              </Button>
            </>
          ) : done ? (
            <Button variant="primary" onClick={onExit}>
              Finish practice
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setIndex(nextOpen >= 0 ? nextOpen : anyOpen)}>
              Next question
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
