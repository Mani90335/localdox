import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Calculator as CalcIcon,
  Check,
  FileText,
  Grid3x3,
  Info,
  LockKeyhole,
  Pause,
  Play,
  SunDim,
} from "lucide-react";
import type { Exam } from "./validation";
import type { Session, Confidence } from "./session";
import { questionState, remainingSeconds } from "./session";
import type { Response } from "./scoring";
import { isAnswered } from "./scoring";
import { numeric } from "./parser";
import { ExamAssets, ExamMarkdown, type AssetSource } from "./ExamMarkdown";
import { Calculator } from "./CalculatorPanel";
import { Button, Chip, Dialog, DialogClose, EmptyState, Sheet } from "./ui/kit";
import { PaletteLegend, QuestionPalette, statusTally, SummaryTable } from "./ui/Palette";
import {
  crossedThreshold,
  formatClock,
  marksLabel,
  sameResponse,
  sectionIds,
  thresholdCopy,
  timerTone,
  TYPE_LABEL,
  TYPE_NAME,
  uiProfile,
  violationCopy,
} from "./ui/display";

export type SaveState = "idle" | "saving" | "saved" | "error";

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
    <div className="ex-seg" role="group" aria-label="Confidence">
      {levels.map((level) => (
        <button
          type="button"
          key={level}
          aria-pressed={value === level}
          onClick={() => onChange(value === level ? "none" : level)}
        >
          {level[0].toUpperCase() + level.slice(1)}
        </button>
      ))}
    </div>
  );
}

/** NAT answer: a readout plus the GATE-style on-screen keypad. */
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
    <div className="xr-nat">
      <input
        className="ex-input"
        aria-label="Numeric answer"
        inputMode={virtual ? "none" : "decimal"}
        readOnly={virtual}
        value={draft}
        onChange={(e) => update(e.target.value)}
        placeholder={virtual ? "Use the keypad" : "Enter a number"}
        autoComplete="off"
      />
      <p className="xr-nat-error" aria-live="polite">
        {draft && !numeric(draft)
          ? `Not a number yet.${value ? ` Your answer stays ${String(value)}.` : ""}`
          : " "}
      </p>
      {virtual && (
        <div className="xr-keypad" role="group" aria-label="Numeric keypad">
          <Button className="wide" onClick={() => update(draft.slice(0, -1))}>
            Backspace
          </Button>
          {["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ".", "-"].map((k) => (
            <Button
              key={k}
              aria-label={k === "-" ? "Minus" : k === "." ? "Decimal point" : k}
              onClick={() => update(draft + k)}
            >
              {k === "-" ? "−" : k}
            </Button>
          ))}
          <Button className="wide" disabled={!canClear && !!value} onClick={() => update("")}>
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}

const GLARE_KEY = "localdox-exam-glare";
function readGlare() {
  try {
    return localStorage.getItem(GLARE_KEY) === "low";
  } catch {
    return false;
  }
}

type Notice = {
  tone: "warning" | "danger" | "info";
  text: string;
  action?: { label: string; run: () => void };
};

export function ExamScreen({
  exam,
  assets,
  session,
  now,
  saveState,
  instructions,
  onAnswer,
  onNavigate,
  onSave,
  onClear,
  onSubmit,
  onFinishSection,
  onPause,
  onConfidence,
}: {
  exam: Exam;
  assets?: AssetSource;
  session: Session;
  now: number;
  saveState: SaveState;
  /** The rules as read before starting, to re-read during the exam. */
  instructions?: ReactNode;
  onAnswer: (v: Response) => void;
  onNavigate: (id: string) => void;
  /**
   * One step on the current question, saved together: store `response`
   * (undefined keeps the saved one), set the review mark, then move to `nextId`.
   */
  onSave: (response: Response | undefined, step: { mark?: boolean; nextId?: string }) => void;
  onClear: () => void;
  onSubmit: () => void;
  onFinishSection: () => void;
  onPause: () => void;
  onConfidence: (c: Confidence) => void;
}) {
  const [confirm, setConfirm] = useState(false),
    [sectionConfirm, setSectionConfirm] = useState(false),
    [sheet, setSheet] = useState(false),
    [calc, setCalc] = useState(false),
    [reference, setReference] = useState<"instructions" | "paper" | null>(null),
    [lowGlare, setLowGlare] = useState(readGlare);
  const r = exam.rules,
    paper = exam.paper,
    profile = uiProfile(r),
    q = paper.find((q) => q.id === session.currentId)!,
    state = questionState(session, q.id),
    remaining = remainingSeconds(session, now),
    index = session.order.indexOf(q.id),
    paused = session.pausedAt !== undefined,
    locked = paused || remaining === 0;
  const section = r.sections[session.sectionIndex],
    currentSection = r.sections.find((s) => s.id === q.section) ?? section,
    nextId = session.order[index + 1],
    prevId = session.order[index - 1],
    next = paper.find((q) => q.id === nextId),
    prev = paper.find((q) => q.id === prevId),
    sameSection = next?.section === q.section,
    lastSection = session.sectionIndex === r.sections.length - 1;
  const ids = sectionIds(session, paper, q.section),
    tally = statusTally(session, ids);
  const prevDisabled =
    !prevId ||
    (r.timing.mode === "per_section" && prev?.section !== q.section) ||
    session.lockedSections.includes(prev?.section ?? "");
  const nextDisabled = !nextId || (r.timing.mode === "per_section" && !sameSection);

  // ── Answering. With requireSave (TCS iON / GATE) a choice is a draft until
  // Save & next or Mark for review & next; leaving the question any other way
  // (palette, Previous, a section tab) drops it, as in the real exam. ──
  const requireSave = r.navigation.requireSave;
  const [draft, setDraft] = useState<{ id: string; value: Response } | null>(null),
    [numericReset, setNumericReset] = useState(0);
  useEffect(() => setDraft(null), [session.currentId]);
  const shown: Response = requireSave && draft?.id === q.id ? draft.value : state.response,
    unsaved = requireSave && draft?.id === q.id && !sameResponse(draft.value, state.response),
    showsAnswer = isAnswered(shown);
  const choose = (value: Response) =>
    requireSave ? setDraft({ id: q.id, value }) : onAnswer(value);
  const advanceTo = nextDisabled ? undefined : nextId;
  const primary = () => {
    // Save & next records exactly what is on screen and clears a review mark.
    if (requireSave) onSave(shown, { mark: false, nextId: advanceTo });
    else if (advanceTo) onNavigate(advanceTo);
  };
  const markNext = () =>
    // Requiring a save, marking always marks (Save & next unmarks); otherwise it toggles.
    onSave(requireSave ? shown : undefined, {
      mark: requireSave ? true : !state.marked,
      nextId: advanceTo,
    });
  const clear = () => {
    setDraft(null);
    setNumericReset((n) => n + 1);
    if (isAnswered(state.response)) onClear();
  };

  // ── The one notice slot (fixed height; never pushes the question). ──
  const fullscreenMissing =
    r.integrity.requireFullscreen && typeof document !== "undefined" && !document.fullscreenElement;
  const violationEvents = session.events.filter(
    (e) =>
      e.type === "tab_hidden" || (e.type === "fullscreen_exit" && r.integrity.requireFullscreen),
  );
  const lastViolation = violationEvents.at(-1),
    seenAt = lastViolation
      ? (session.events.find((e) => e.type === "tab_visible" && e.at >= lastViolation.at)?.at ??
        lastViolation.at)
      : 0;
  const scale = session.timeScale ?? 1,
    crossed = crossedThreshold(r, session.sectionIndex, remaining, scale);
  const notice: Notice | null = paused
    ? { tone: "info", text: "Timer paused", action: { label: "Resume", run: onPause } }
    : remaining === 0
      ? {
          tone: "danger",
          text: "Time's up. Answers are locked.",
          action: { label: "Submit", run: () => setConfirm(true) },
        }
      : fullscreenMissing
        ? {
            tone: "danger",
            text: session.violations ? violationCopy(r, session.violations) : "Fullscreen is off.",
            action: {
              label: "Return to fullscreen",
              run: () => void document.documentElement.requestFullscreen().catch(() => {}),
            },
          }
        : session.violations > 0 && now - seenAt < 12_000
          ? { tone: "warning", text: violationCopy(r, session.violations) }
          : crossed !== null
            ? { tone: "warning", text: thresholdCopy(crossed) }
            : unsaved
              ? { tone: "info", text: `Not saved. ${profile.labels.saveNext} keeps this answer.` }
              : null;

  const noticeEl = notice && (
    <span className="xr-notice" data-tone={notice.tone} title={notice.text}>
      <span>{notice.text}</span>
      {notice.action && <Button onClick={notice.action.run}>{notice.action.label}</Button>}
    </span>
  );

  // ── Keyboard: A–D / 1–9 choose, N save & next, P previous, M mark. ──
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || locked) return;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        "input:not([type=radio]):not([type=checkbox]), textarea, select, [contenteditable], [data-no-shortcuts]",
      ) ||
      confirm ||
      sectionConfirm ||
      sheet ||
      reference
    )
      return;
    const key = e.key.toLowerCase();
    if (key === "n" && (requireSave || !nextDisabled)) primary();
    else if (key === "p" && r.navigation.free && !prevDisabled) onNavigate(prevId);
    else if (key === "m" && r.navigation.markForReview) markNext();
    else if (q.type !== "nat") {
      const i = /^[a-d]$/.test(key)
        ? key.charCodeAt(0) - 97
        : /^[1-9]$/.test(key)
          ? Number(key) - 1
          : -1;
      const label = session.optionOrder[q.id][i];
      if (!label) return;
      if (q.type === "mcq") choose(label);
      else {
        const list = Array.isArray(shown) ? shown : [];
        choose(list.includes(label) ? list.filter((v) => v !== label) : [...list, label]);
      }
    } else return;
    e.preventDefault();
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const panel = (inSheet: boolean) => (
    <>
      <div className="ex-section-head">
        <h2>{r.sections.length > 1 ? currentSection.name : "Questions"}</h2>
        <span className="ex-small tabular">
          {tally.answered + tally.answered_marked} of {ids.length}
        </span>
      </div>
      <QuestionPalette
        r={r}
        paper={paper}
        session={session}
        ids={ids}
        currentId={q.id}
        family={profile.glyphs}
        onNavigate={(id) => {
          onNavigate(id);
          if (inSheet) setSheet(false);
        }}
      />
      <PaletteLegend
        counts={tally}
        family={profile.glyphs}
        showMarked={r.navigation.markForReview}
      />
      <div className="xr-panel-foot">
        <div className="xr-panel-tools">
          {instructions && (
            <Button
              variant="ghost"
              onClick={() => {
                setSheet(false);
                setReference("instructions");
              }}
            >
              <Info size={16} aria-hidden="true" /> Instructions
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setSheet(false);
              setReference("paper");
            }}
          >
            <FileText size={16} aria-hidden="true" /> Question paper
          </Button>
          {r.tools.calculator !== "none" && (
            <Button
              variant="ghost"
              aria-pressed={calc}
              onClick={() => {
                setCalc((v) => !v);
                if (inSheet) setSheet(false);
              }}
            >
              <CalcIcon size={16} aria-hidden="true" /> Calculator
            </Button>
          )}
          {r.timing.pausable && (
            <Button variant="ghost" onClick={onPause}>
              {paused ? (
                <Play size={16} aria-hidden="true" />
              ) : (
                <Pause size={16} aria-hidden="true" />
              )}
              {paused ? "Resume timer" : "Pause timer"}
            </Button>
          )}
          <Button
            variant="ghost"
            aria-pressed={lowGlare}
            onClick={() => {
              const v = !lowGlare;
              setLowGlare(v);
              try {
                localStorage.setItem(GLARE_KEY, v ? "low" : "normal");
              } catch {
                /* a preference only */
              }
            }}
          >
            <SunDim size={16} aria-hidden="true" /> Low glare
          </Button>
        </div>
        {r.timing.mode === "per_section" && (
          <Button
            onClick={() => {
              setSheet(false);
              setSectionConfirm(true);
            }}
          >
            Finish section
          </Button>
        )}
        <Button
          variant="danger"
          onClick={() => {
            setSheet(false);
            setConfirm(true);
          }}
        >
          Submit exam
        </Button>
      </div>
    </>
  );

  const allSections = r.sections.map((s) => ({
    name: s.name,
    counts: statusTally(session, sectionIds(session, paper, s.id)),
  }));
  const tone = timerTone(r, session.sectionIndex, remaining, scale);

  return (
    <ExamAssets source={assets}>
      <div className="xr" data-glare={lowGlare ? "low" : undefined}>
        <header className="xr-top">
          <div className="xr-name" title={r.meta.name}>
            {r.meta.name}
          </div>
          {r.sections.length > 1 && (
            <nav className="xr-sections" aria-label="Sections">
              {r.sections.map((s, i) => {
                const first = session.order.find(
                  (id) => paper.find((q) => q.id === id)?.section === s.id,
                )!;
                const isLocked = session.lockedSections.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="xr-section"
                    aria-current={i === session.sectionIndex ? "page" : undefined}
                    disabled={
                      isLocked ||
                      (r.timing.mode === "per_section" && i !== session.sectionIndex) ||
                      (!r.navigation.free && i !== session.sectionIndex)
                    }
                    onClick={() => onNavigate(first)}
                  >
                    {(isLocked ||
                      (r.timing.mode === "per_section" && i !== session.sectionIndex)) && (
                      <LockKeyhole size={13} aria-hidden="true" />
                    )}
                    {s.name}
                  </button>
                );
              })}
            </nav>
          )}
          <div className="xr-top-right">
            <span className="xr-saved" aria-hidden={saveState === "idle"}>
              {saveState === "saving" ? (
                "Saving…"
              ) : saveState === "saved" ? (
                <>
                  <Check size={14} aria-hidden="true" /> Saved
                </>
              ) : null}
            </span>
            <div className="xr-timer" data-tone={tone} role="timer" aria-label="Time remaining">
              <span className="xr-timer-label">
                {r.timing.mode === "per_section" ? `${section.name} · time left` : "Time left"}
              </span>
              <span className="xr-timer-value">{formatClock(remaining)}</span>
            </div>
            <Button
              className="xr-palette-toggle"
              aria-label={`Questions: ${tally.answered + tally.answered_marked} of ${ids.length} answered`}
              onClick={() => setSheet(true)}
            >
              <Grid3x3 size={16} aria-hidden="true" />
              <span className="tabular">
                {tally.answered + tally.answered_marked}/{ids.length}
              </span>
            </Button>
          </div>
        </header>

        <div className="xr-body">
          <main className="xr-main">
            <div className="xr-question">
              <div className="xr-meta">
                <div className="xr-meta-left">
                  <h2>
                    Question {index + 1} <span className="ex-muted">of {session.order.length}</span>
                  </h2>
                  <Chip tone="accent" large title={TYPE_NAME[q.type]}>
                    {TYPE_LABEL[q.type]}
                  </Chip>
                  <Chip large title="Marks for a correct / wrong answer">
                    {marksLabel(r, q.type, q.marks)}
                  </Chip>
                </div>
                <div className="xr-notice-slot" role="status" aria-live="polite">
                  {noticeEl}
                </div>
              </div>
              {/* Notice actions and Resume live outside the fieldset so they stay usable. */}
              {paused ? (
                <div className="xr-paused">
                  <EmptyState
                    icon={<Pause size={20} />}
                    title="Timer paused"
                    actions={
                      <Button variant="primary" onClick={onPause}>
                        Resume
                      </Button>
                    }
                  >
                    The question is hidden while the timer is paused.
                  </EmptyState>
                </div>
              ) : (
                <fieldset disabled={locked} className="xr-fieldset">
                  <legend className="sr-only">Question {index + 1}</legend>
                  <div className="xr-body-md">
                    <ExamMarkdown source={q.body} />
                  </div>
                  {q.type === "nat" ? (
                    <NumericAnswer
                      key={`${q.id}-${state.response === null ? "empty" : "value"}-${numericReset}`}
                      value={shown}
                      virtual={r.questionTypes.nat?.inputMode === "virtual_keypad"}
                      canClear={r.navigation.clearResponse}
                      onChange={choose}
                    />
                  ) : (
                    <>
                      <div
                        className="xr-options"
                        role={q.type === "mcq" ? "radiogroup" : "group"}
                        aria-label="Options"
                      >
                        {session.optionOrder[q.id].map((label, i) => {
                          const checked = Array.isArray(shown)
                            ? shown.includes(label)
                            : shown === label;
                          return (
                            <label
                              className={checked ? "xr-option is-selected" : "xr-option"}
                              key={label}
                            >
                              <input
                                className={q.type === "mcq" ? "ex-radio" : "ex-check"}
                                type={q.type === "mcq" ? "radio" : "checkbox"}
                                name={q.id}
                                checked={checked}
                                aria-keyshortcuts={i < 4 ? String.fromCharCode(65 + i) : undefined}
                                // TCS iON: clicking the chosen option again deselects it.
                                onClick={() => {
                                  if (requireSave && q.type === "mcq" && checked) choose(null);
                                }}
                                onChange={() =>
                                  choose(
                                    q.type === "mcq"
                                      ? label
                                      : checked
                                        ? Array.isArray(shown)
                                          ? shown.filter((v) => v !== label)
                                          : []
                                        : [...(Array.isArray(shown) ? shown : []), label],
                                  )
                                }
                              />
                              <span className="xr-letter">{String.fromCharCode(65 + i)}</span>
                              <ExamMarkdown source={q.options[label.charCodeAt(0) - 65]} />
                            </label>
                          );
                        })}
                      </div>
                      {(q.type === "msq" || requireSave) && (
                        <p className="xr-hint">
                          {q.type === "msq"
                            ? "Select all that apply."
                            : "Click a chosen option again to deselect it."}
                        </p>
                      )}
                    </>
                  )}
                  {r.diagnostics.enabled && r.diagnostics.capture.confidence.mode === "in_exam" && (
                    <div className="xr-confidence">
                      <span>How sure are you?</span>
                      <ConfidenceChips
                        levels={r.diagnostics.capture.confidence.levels}
                        value={session.confidence[q.id] ?? "none"}
                        onChange={onConfidence}
                      />
                    </div>
                  )}
                </fieldset>
              )}
            </div>

            <div className="xr-actions" role="group" aria-label="Question actions">
              {/* Small screens show the notice here instead (one slot is display:none). */}
              <div className="xr-notice-mobile" role="status" aria-live="polite">
                {noticeEl}
              </div>
              {r.navigation.markForReview && (
                <Button disabled={locked} onClick={markNext} aria-keyshortcuts="M">
                  {state.marked && !requireSave
                    ? profile.labels.unmarkNext
                    : profile.labels.markNext}
                </Button>
              )}
              {r.navigation.clearResponse && (
                <Button
                  variant="ghost"
                  disabled={locked || (!showsAnswer && !isAnswered(state.response))}
                  onClick={clear}
                >
                  {profile.labels.clear}
                </Button>
              )}
              <span className="ex-spacer" />
              {r.navigation.free && (
                <Button
                  disabled={locked || prevDisabled}
                  onClick={() => onNavigate(prevId)}
                  aria-keyshortcuts="P"
                >
                  {profile.labels.previous}
                </Button>
              )}
              <Button
                variant="primary"
                // Requiring a save, the last question still needs Save & next to keep its answer.
                disabled={locked || (nextDisabled && !requireSave)}
                onClick={primary}
                aria-keyshortcuts="N"
                title={
                  nextDisabled && !locked
                    ? r.timing.mode === "per_section"
                      ? "Last question in this section"
                      : "Last question"
                    : undefined
                }
              >
                {requireSave || isAnswered(state.response)
                  ? profile.labels.saveNext
                  : profile.labels.next}
              </Button>
            </div>
          </main>

          <aside className="xr-panel" aria-label="Question palette and exam actions">
            {panel(false)}
          </aside>
        </div>

        <Sheet open={sheet} onOpenChange={setSheet} title="Questions">
          <div className="ex-stack" style={{ gap: 16 }}>
            {panel(true)}
          </div>
        </Sheet>

        {calc && r.tools.calculator !== "none" && (
          <Calculator
            scientific={r.tools.calculator === "scientific"}
            onClose={() => setCalc(false)}
          />
        )}

        <Dialog
          open={confirm}
          onOpenChange={setConfirm}
          title="Submit exam?"
          wide
          description="You can't change your answers after submitting."
          footer={
            <>
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <Button
                variant="primary"
                onClick={() => {
                  setConfirm(false);
                  onSubmit();
                }}
              >
                Submit exam
              </Button>
            </>
          }
        >
          <SummaryTable rows={allSections} counted={r.navigation.markedForReviewAnswerCounts} />
          {unsaved && (
            <p className="xs-note" style={{ marginTop: 16 }}>
              Your choice on question {index + 1} isn't saved, so it won't be counted. Cancel and
              use {profile.labels.saveNext} to keep it.
            </p>
          )}
        </Dialog>

        <Dialog
          open={sectionConfirm}
          onOpenChange={setSectionConfirm}
          title={lastSection ? "Finish the last section?" : `Finish ${section.name}?`}
          wide
          description={
            lastSection
              ? "This submits your exam. You can't change answers afterwards."
              : `You can't return to ${section.name}. Unused time doesn't carry over.`
          }
          footer={
            <>
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <Button
                variant="primary"
                onClick={() => {
                  setSectionConfirm(false);
                  onFinishSection();
                }}
              >
                {lastSection ? "Finish and submit" : "Finish section"}
              </Button>
            </>
          }
        >
          <SummaryTable
            rows={[
              {
                name: section.name,
                counts: statusTally(session, sectionIds(session, paper, section.id)),
              },
            ]}
            counted={r.navigation.markedForReviewAnswerCounts}
          />
        </Dialog>

        <Dialog
          open={reference !== null}
          onOpenChange={(open) => !open && setReference(null)}
          title={reference === "paper" ? "Question paper" : "Instructions"}
          description={
            reference === "paper"
              ? "Every question in this exam. Answer them on the question screen."
              : undefined
          }
          wide
          footer={
            <DialogClose asChild>
              <Button variant="primary">Back to the exam</Button>
            </DialogClose>
          }
        >
          {reference === "paper" ? (
            <QuestionPaper
              r={r}
              paper={paper}
              session={session}
              onGo={
                // Going there leaves this question: the same as the palette.
                (id) => {
                  setReference(null);
                  onNavigate(id);
                }
              }
            />
          ) : (
            instructions
          )}
        </Dialog>
      </div>
    </ExamAssets>
  );
}

/**
 * TCS iON's "Question Paper": every question at once, read-only. A question
 * the rules let you reach can be opened from here; answering happens on the
 * question screen, so the save rules stay in one place.
 */
function QuestionPaper({
  r,
  paper,
  session,
  onGo,
}: {
  r: Exam["rules"];
  paper: Exam["paper"];
  session: Session;
  onGo: (id: string) => void;
}) {
  const current = paper.find((q) => q.id === session.currentId)!;
  return (
    <ol className="xr-paper">
      {session.order.map((id, i) => {
        const q = paper.find((q) => q.id === id)!,
          reachable =
            r.navigation.free &&
            !session.lockedSections.includes(q.section) &&
            (r.timing.mode !== "per_section" || q.section === current.section);
        return (
          <li key={id} className="xr-paper-q">
            <div className="ex-row">
              <strong>Question {i + 1}</strong>
              <Chip>{TYPE_LABEL[q.type]}</Chip>
              <Chip>{marksLabel(r, q.type, q.marks)}</Chip>
              {r.sections.length > 1 && (
                <span className="ex-small">{r.sections.find((s) => s.id === q.section)?.name}</span>
              )}
              <span className="ex-spacer" />
              {reachable && id !== session.currentId && (
                <Button variant="ghost" onClick={() => onGo(id)}>
                  Go to question
                </Button>
              )}
            </div>
            <ExamMarkdown source={q.body} />
            {q.options.length > 0 && (
              <ol className="xr-paper-options">
                {session.optionOrder[q.id].map((label, j) => (
                  <li key={label}>
                    <span className="xr-letter">{String.fromCharCode(65 + j)}</span>
                    <ExamMarkdown source={q.options[label.charCodeAt(0) - 65]} />
                  </li>
                ))}
              </ol>
            )}
          </li>
        );
      })}
    </ol>
  );
}
