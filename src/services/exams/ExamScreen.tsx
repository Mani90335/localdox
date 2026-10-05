import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import type { Exam } from "./validation";
import type { Session, Confidence } from "./session";
import { questionState, remainingSeconds } from "./session";
import type { Response } from "./scoring";
import { isAnswered } from "./scoring";
import { numeric } from "./parser";
import { ExamMarkdown } from "./ExamMarkdown";
import { Calculator } from "./CalculatorPanel";
export function ConfidenceChips({
  levels,
  value,
  onChange,
}: {
  levels: ("sure" | "unsure" | "guess")[];
  value: Confidence;
  onChange: (c: Confidence) => void;
}) {
  return (
    <div className="exam-actions" role="group" aria-label="Confidence">
      {levels.map((level) => (
        <button
          key={level}
          aria-pressed={value === level}
          onClick={() => onChange(value === level ? "none" : level)}
        >
          {level}
        </button>
      ))}
    </div>
  );
}
function NumericAnswer({
  value,
  virtual,
  onChange,
  canClear,
}: {
  value: Response;
  virtual: boolean;
  onChange: (v: Response) => void;
  canClear: boolean;
}) {
  const [draft, setDraft] = useState(typeof value === "string" ? value : "");
  const update = (v: string) => {
    setDraft(v);
    if (numeric(v)) onChange(v);
    else if (!v && canClear) onChange(null);
  };
  return (
    <div className="exam-numeric">
      <label>
        Numeric answer
        <input
          aria-label="Numeric answer"
          inputMode="decimal"
          readOnly={virtual}
          value={draft}
          onChange={(e) => update(e.target.value)}
          placeholder="Enter a number"
        />
      </label>
      {draft && !numeric(draft) && (
        <p role="alert">Finish entering a valid number. Saved answer: {String(value ?? "none")}</p>
      )}
      {virtual && (
        <div className="exam-keypad">
          {["7", "8", "9", "4", "5", "6", "1", "2", "3", "-", "0", "."].map((k) => (
            <button key={k} onClick={() => update(draft + k)}>
              {k}
            </button>
          ))}
          <button onClick={() => update(draft.slice(0, -1))}>⌫</button>
        </div>
      )}
    </div>
  );
}
export function ExamScreen({
  exam,
  session,
  now,
  onAnswer,
  onNavigate,
  onMark,
  onClear,
  onSubmit,
  onFinishSection,
  onPause,
  onConfidence,
}: {
  exam: Exam;
  session: Session;
  now: number;
  onAnswer: (v: Response) => void;
  onNavigate: (id: string) => void;
  onMark: () => void;
  onClear: () => void;
  onSubmit: () => void;
  onFinishSection: () => void;
  onPause: () => void;
  onConfidence: (c: Confidence) => void;
}) {
  const [confirm, setConfirm] = useState(false),
    [sectionConfirm, setSectionConfirm] = useState(false),
    r = exam.rules,
    q = exam.paper.find((q) => q.id === session.currentId)!,
    state = questionState(session, q.id),
    remaining = remainingSeconds(session, now),
    index = session.order.indexOf(q.id),
    paused = session.pausedAt !== undefined;
  const section = r.sections[session.sectionIndex],
    nextId = session.order[index + 1],
    next = exam.paper.find((q) => q.id === nextId),
    sameSection = next?.section === q.section;
  const states = session.order.map((id) => questionState(session, id)),
    answered = states.filter((s) => isAnswered(s.response)).length,
    marked = states.filter((s) => s.marked).length;
  const warning = [...r.timing.warnAtMinutesLeft]
    .sort((a, b) => a - b)
    .find((m) => remaining <= m * 60);
  return (
    <>
      <header className="exam-session-header">
        <div>
          <strong>{r.meta.name}</strong>
          <p>{r.timing.mode === "per_section" ? `${section.name} timer` : "Exam timer"}</p>
        </div>
        <div
          className={warning ? "exam-timer exam-warning" : "exam-timer"}
          role="timer"
          aria-label="Time remaining"
        >
          {Math.floor(remaining / 3600)
            .toString()
            .padStart(2, "0")}
          :
          {Math.floor((remaining / 60) % 60)
            .toString()
            .padStart(2, "0")}
          :
          {Math.floor(remaining % 60)
            .toString()
            .padStart(2, "0")}
        </div>
        <button className="exam-primary" onClick={() => setConfirm(true)}>
          Submit exam
        </button>
      </header>
      {warning && (
        <p role="status" className="exam-notice">
          {remaining === 0
            ? "Time expired. Answers are locked. Submit to continue."
            : `${warning} minutes or less remaining.`}
        </p>
      )}
      {session.violations > 0 && (
        <p role="status" className="exam-notice">
          Integrity warning: {session.violations} violation(s) recorded.
        </p>
      )}
      {r.integrity.requireFullscreen && !document.fullscreenElement && (
        <button onClick={() => void document.documentElement.requestFullscreen()}>
          Return to fullscreen
        </button>
      )}
      <div className="exam-tabs" aria-label="Sections">
        {r.sections.map((s, i) => {
          const id = session.order.find(
            (id) => exam.paper.find((q) => q.id === id)?.section === s.id,
          )!;
          return (
            <button
              key={s.id}
              aria-current={i === session.sectionIndex ? "page" : undefined}
              disabled={
                session.lockedSections.includes(s.id) ||
                (r.timing.mode === "per_section" && i !== session.sectionIndex) ||
                (!r.navigation.free && i !== session.sectionIndex)
              }
              onClick={() => onNavigate(id)}
            >
              {s.name}
            </button>
          );
        })}
      </div>
      <div className="exam-layout">
        <main>
          <fieldset disabled={paused || remaining === 0} className="exam-card exam-question">
            <legend className="sr-only">Question {index + 1}</legend>
            <div className="exam-actions">
              <span>
                Question {index + 1} of {session.order.length}
              </span>
              <span className="exam-tag">
                {q.type.toUpperCase()} · {q.marks} marks
              </span>
            </div>
            <ExamMarkdown source={q.body} />
            {q.type === "nat" ? (
              <NumericAnswer
                key={`${q.id}-${state.response === null ? "empty" : "value"}`}
                value={state.response}
                virtual={r.questionTypes.nat?.inputMode === "virtual_keypad"}
                canClear={r.navigation.clearResponse}
                onChange={onAnswer}
              />
            ) : (
              <div className="exam-options">
                {session.optionOrder[q.id].map((label) => {
                  const checked = Array.isArray(state.response)
                    ? state.response.includes(label)
                    : state.response === label;
                  return (
                    <label className={checked ? "exam-option selected" : "exam-option"} key={label}>
                      <input
                        type={q.type === "mcq" ? "radio" : "checkbox"}
                        name={q.id}
                        checked={checked}
                        onChange={() =>
                          onAnswer(
                            q.type === "mcq"
                              ? label
                              : checked
                                ? Array.isArray(state.response)
                                  ? state.response.filter((v) => v !== label)
                                  : []
                                : [...(Array.isArray(state.response) ? state.response : []), label],
                          )
                        }
                      />
                      <span>{label}.</span>
                      <ExamMarkdown source={q.options[label.charCodeAt(0) - 65]} />
                    </label>
                  );
                })}
              </div>
            )}
            {r.diagnostics.enabled && r.diagnostics.capture.confidence.mode === "in_exam" && (
              <ConfidenceChips
                levels={r.diagnostics.capture.confidence.levels}
                value={session.confidence[q.id] ?? "none"}
                onChange={onConfidence}
              />
            )}
            <div className="exam-actions exam-question-actions">
              {r.navigation.free && (
                <button
                  disabled={
                    index === 0 ||
                    (r.timing.mode === "per_section" &&
                      exam.paper.find((q) => q.id === session.order[index - 1])?.section !==
                        q.section) ||
                    session.lockedSections.includes(
                      exam.paper.find((q) => q.id === session.order[index - 1])?.section ?? "",
                    )
                  }
                  onClick={() => onNavigate(session.order[index - 1])}
                >
                  Previous
                </button>
              )}
              {r.navigation.clearResponse && <button onClick={onClear}>Clear response</button>}
              {r.navigation.markForReview && (
                <button onClick={onMark}>
                  {state.marked ? "Unmark" : "Mark for review"} &amp; Next
                </button>
              )}
              <button
                className="exam-primary"
                disabled={!nextId || (r.timing.mode === "per_section" && !sameSection)}
                onClick={() => onNavigate(nextId)}
              >
                Save &amp; Next
              </button>
            </div>
          </fieldset>
          {r.timing.mode === "per_section" && (
            <button className="exam-primary" onClick={() => setSectionConfirm(true)}>
              Finish section
            </button>
          )}
          {r.timing.pausable && (
            <button onClick={onPause}>{paused ? "Resume timer" : "Pause timer"}</button>
          )}
          {paused && <p role="status">Paused. Resume to answer.</p>}
        </main>
        <aside className="exam-stack">
          <section className="exam-card">
            <h2>Question palette</h2>
            <div className="exam-palette">
              {session.order.map((id, i) => {
                const qs = questionState(session, id),
                  target = exam.paper.find((q) => q.id === id)!;
                return (
                  <button
                    key={id}
                    className={`palette-${qs.status}`}
                    aria-label={`Question ${i + 1}: ${qs.status.replaceAll("_", " ")}`}
                    aria-current={id === q.id ? "true" : undefined}
                    disabled={
                      (!r.navigation.free && id !== q.id) ||
                      session.lockedSections.includes(target.section) ||
                      (r.timing.mode === "per_section" && target.section !== q.section)
                    }
                    onClick={() => onNavigate(id)}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className="exam-palette-legend">
              {["not_visited", "not_answered", "answered", "marked", "answered_marked"].map(
                (status) => (
                  <span key={status}>
                    <i className={`palette-${status}`} />
                    {status.replaceAll("_", " ")}
                  </span>
                ),
              )}
            </div>
            <p>
              {answered} answered · {states.length - answered} unanswered · {marked} marked
            </p>
          </section>
          {r.tools.calculator !== "none" && (
            <Calculator scientific={r.tools.calculator === "scientific"} />
          )}
        </aside>
      </div>
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title="Submit exam?"
        description="Submission is final. You cannot change answers afterwards."
      >
        <p>
          {answered} answered · {states.length - answered} unanswered · {marked} marked for review.
        </p>
        {!r.navigation.markedForReviewAnswerCounts && (
          <p>Answers marked for review will not count.</p>
        )}
        <div className="exam-actions">
          <button onClick={() => setConfirm(false)}>Keep working</button>
          <button
            className="exam-primary"
            onClick={() => {
              setConfirm(false);
              onSubmit();
            }}
          >
            Confirm submission
          </button>
        </div>
      </Modal>
      <Modal
        open={sectionConfirm}
        onOpenChange={setSectionConfirm}
        title="Finish this section?"
        description="This section will be locked. Unused time does not carry forward."
      >
        <button
          className="exam-primary"
          onClick={() => {
            setSectionConfirm(false);
            onFinishSection();
          }}
        >
          Confirm finish section
        </button>
      </Modal>
    </>
  );
}
