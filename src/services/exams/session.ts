import type { Ruleset } from "./schema.ts";
import { numeric, optionLabel, type Question } from "./parser.ts";
import { isAnswered, type Response } from "./scoring.ts";
export type Phase =
  "idle" | "instructions" | "in_progress" | "submitting" | "reflection" | "submitted" | "review";
export type Confidence = "sure" | "unsure" | "guess" | "none";
export type EventKind =
  | "question_viewed"
  | "question_left"
  | "answer_set"
  | "answer_cleared"
  | "marked"
  | "unmarked"
  | "section_changed"
  | "tab_hidden"
  | "tab_visible"
  | "fullscreen_exit"
  | "submitted"
  | "paused"
  | "resumed";
export interface ExamEvent {
  type: EventKind;
  at: number;
  questionId?: string;
  section?: string;
  value?: Response;
  previous?: Response;
  reason?: string;
  deadlineAt?: number;
}
export interface SelfTag {
  cause?: string;
  trap?: string;
  note: string;
}
export interface Session {
  id: string;
  examId: string;
  examVersion: string;
  taxonomyId: string;
  phase: Phase;
  createdAt: number;
  startedAt?: number;
  submittedAt?: number;
  lastObservedAt?: number;
  deadlineAt?: number;
  sectionIndex: number;
  currentId: string;
  order: string[];
  optionOrder: Record<string, string[]>;
  events: ExamEvent[];
  confidence: Record<string, Confidence>;
  journal: Record<string, SelfTag>;
  lockedSections: string[];
  pausedAt?: number;
  violations: number;
  demo?: boolean;
}
function shuffle<T>(values: T[], random: () => number): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
export function createSession(
  r: Ruleset,
  paper: Question[],
  taxonomyId: string,
  now = Date.now(),
  random = Math.random,
): Session {
  const order = r.sections.flatMap((s) => {
    const ids = paper.filter((q) => q.section === s.id).map((q) => q.id);
    return r.navigation.shuffleQuestions ? shuffle(ids, random) : ids;
  });
  return {
    id: globalThis.crypto.randomUUID(),
    examId: r.meta.id,
    examVersion: r.meta.version,
    taxonomyId,
    phase: "idle",
    createdAt: now,
    sectionIndex: 0,
    currentId: order[0],
    order,
    optionOrder: Object.fromEntries(
      paper.map((q) => {
        const labels = q.options.map((_, i) => optionLabel(i));
        return [q.id, r.navigation.shuffleOptions ? shuffle(labels, random) : labels];
      }),
    ),
    events: [],
    confidence: {},
    journal: {},
    lockedSections: [],
    violations: 0,
  };
}
function append(s: Session, event: ExamEvent): Session {
  if (event.at < (s.events.at(-1)?.at ?? s.createdAt))
    throw new Error("Events must be chronological");
  return { ...s, lastObservedAt: event.at, events: [...s.events, event] };
}
export function showInstructions(s: Session): Session {
  if (s.phase !== "idle") throw new Error("Expected idle session");
  return { ...s, phase: "instructions" };
}
export function assertAttemptLimit(r: Ruleset, previousSessions: Session[]): void {
  const started = previousSessions.filter(
    (s) => s.examId === r.meta.id && s.startedAt !== undefined && !s.demo,
  ).length;
  if (r.attempts.max !== null && started >= r.attempts.max)
    throw new Error("The attempt limit for this exam has been reached.");
}
export function startSession(
  s: Session,
  r: Ruleset,
  acknowledged: boolean,
  fullscreen: boolean,
  now = Date.now(),
): Session {
  if (s.phase !== "instructions" || !acknowledged)
    throw new Error("Acknowledge the instructions before starting");
  if (r.integrity.requireFullscreen && !fullscreen)
    throw new Error("Fullscreen is required to start");
  const duration =
    r.timing.mode === "global" ? r.timing.durationMinutes : r.sections[0].durationMinutes!;
  return append(
    { ...s, phase: "in_progress", startedAt: now, deadlineAt: now + duration * 60000 },
    { type: "question_viewed", at: now, questionId: s.currentId },
  );
}
export function remainingSeconds(s: Session, now = Date.now()): number {
  return Math.max(0, ((s.deadlineAt ?? now) - (s.pausedAt ?? now)) / 1000);
}
export function questionState(s: Session, id: string) {
  let response: Response = null,
    marked = false,
    visited = false;
  for (const e of s.events)
    if (e.questionId === id) {
      if (e.type === "question_viewed") visited = true;
      if (e.type === "answer_set") response = e.value ?? null;
      if (e.type === "answer_cleared") response = null;
      if (e.type === "marked") marked = true;
      if (e.type === "unmarked") marked = false;
    }
  const answered = isAnswered(response);
  const status = marked
    ? answered
      ? "answered_marked"
      : "marked"
    : answered
      ? "answered"
      : visited
        ? "not_answered"
        : "not_visited";
  return { response, marked, visited, status };
}
function active(s: Session, r: Ruleset, now: number) {
  if (s.phase !== "in_progress" || s.pausedAt !== undefined)
    throw new Error("Session is not active");
  if (remainingSeconds(s, now) <= 0) throw new Error("Time has expired");
}
export function setAnswer(
  s: Session,
  r: Ruleset,
  q: Question,
  response: Response,
  now = Date.now(),
): Session {
  active(s, r, now);
  if (q.id !== s.currentId) throw new Error("Answer only the current question");
  if (!isAnswered(response)) {
    if (!r.navigation.clearResponse) throw new Error("Clearing is disabled");
    return append(s, {
      type: "answer_cleared",
      at: now,
      questionId: q.id,
      previous: questionState(s, q.id).response,
    });
  }
  const labels = q.options.map((_, i) => optionLabel(i));
  if (
    q.type === "nat"
      ? typeof response !== "string" || !numeric(response)
      : q.type === "mcq"
        ? typeof response !== "string" || !labels.includes(response)
        : !Array.isArray(response) ||
          new Set(response).size !== response.length ||
          response.some((a) => !labels.includes(a))
  )
    throw new Error("Invalid response");
  return append(s, {
    type: "answer_set",
    at: now,
    questionId: q.id,
    value: response,
    previous: questionState(s, q.id).response,
    deadlineAt: s.deadlineAt,
  });
}
export function markQuestion(s: Session, r: Ruleset, marked: boolean, now = Date.now()): Session {
  active(s, r, now);
  if (!r.navigation.markForReview) throw new Error("Marking is disabled");
  return append(s, { type: marked ? "marked" : "unmarked", at: now, questionId: s.currentId });
}
export function navigate(
  s: Session,
  r: Ruleset,
  paper: Question[],
  id: string,
  now = Date.now(),
): Session {
  active(s, r, now);
  if (id === s.currentId) return s;
  const target = paper.find((q) => q.id === id);
  if (!target) throw new Error("Unknown question");
  if (!r.navigation.free && s.order.indexOf(id) !== s.order.indexOf(s.currentId) + 1)
    throw new Error("Only sequential navigation is allowed");
  const nextSection = r.sections.findIndex((section) => section.id === target.section);
  if (s.lockedSections.includes(target.section)) throw new Error("Section is locked");
  if (r.timing.mode === "per_section" && nextSection !== s.sectionIndex)
    throw new Error("Finish the current section first");
  let result = append(s, { type: "question_left", at: now, questionId: s.currentId });
  if (nextSection !== s.sectionIndex) {
    result = append(
      {
        ...result,
        sectionIndex: nextSection,
        lockedSections: r.navigation.sectionLocking
          ? [...s.lockedSections, r.sections[s.sectionIndex].id]
          : s.lockedSections,
      },
      { type: "section_changed", at: now, section: target.section },
    );
  }
  return append({ ...result, currentId: id }, { type: "question_viewed", at: now, questionId: id });
}
export function submitSession(s: Session, now = Date.now(), reason = "manual"): Session {
  if (s.phase !== "in_progress") return s;
  let result = append(s, { type: "question_left", at: now, questionId: s.currentId });
  result = append(
    { ...result, phase: "submitting", submittedAt: now, pausedAt: undefined },
    { type: "submitted", at: now, reason },
  );
  return result;
}
export function finishSection(
  s: Session,
  r: Ruleset,
  paper: Question[],
  now = Date.now(),
): Session {
  if (s.phase !== "in_progress" || r.timing.mode !== "per_section")
    throw new Error("No timed section to finish");
  if (s.sectionIndex === r.sections.length - 1) return submitSession(s, now, "section_complete");
  const index = s.sectionIndex + 1,
    section = r.sections[index],
    currentId = s.order.find((id) => paper.find((q) => q.id === id)?.section === section.id)!;
  let next = append(s, { type: "question_left", at: now, questionId: s.currentId });
  next = append(
    {
      ...next,
      sectionIndex: index,
      currentId,
      deadlineAt: now + section.durationMinutes! * 60000,
      lockedSections: [...s.lockedSections, r.sections[s.sectionIndex].id],
    },
    { type: "section_changed", at: now, section: section.id },
  );
  return append(next, { type: "question_viewed", at: now, questionId: currentId });
}
export function tick(s: Session, r: Ruleset, paper: Question[], now = Date.now()): Session {
  let next = s;
  while (
    next.phase === "in_progress" &&
    next.pausedAt === undefined &&
    remainingSeconds(next, now) <= 0
  ) {
    if (r.timing.mode === "per_section" && next.sectionIndex < r.sections.length - 1)
      next = finishSection(next, r, paper, next.deadlineAt!);
    else {
      if (r.timing.autoSubmitOnExpiry) return submitSession(next, next.deadlineAt!, "expiry");
      if (
        !next.events.some(
          (e) => e.type === "question_left" && e.reason === "expiry" && e.at === next.deadlineAt,
        )
      )
        return append(next, {
          type: "question_left",
          at: next.deadlineAt!,
          questionId: next.currentId,
          reason: "expiry",
        });
      return next;
    }
  }
  return next;
}
export function resumeSession(
  s: Session,
  r: Ruleset,
  paper: Question[],
  now = Date.now(),
): Session {
  let interrupted = s;
  if (s.phase === "in_progress") {
    const lastVisibility = s.events
      .filter((e) => e.type === "tab_hidden" || e.type === "tab_visible")
      .at(-1);
    if (lastVisibility?.type !== "tab_hidden") {
      // A crash may omit pagehide. Bound the visible interval by the last
      // persisted observation rather than charging closed-app time.
      interrupted = append(s, {
        type: "tab_hidden",
        at: s.lastObservedAt ?? s.events.at(-1)?.at ?? s.createdAt,
        reason: "interrupted",
      });
    }
  }
  const next = tick(interrupted, r, paper, now);
  if (next.phase === "in_progress" && !r.attempts.resumeInterrupted)
    return submitSession(next, now, "interrupted");
  return next;
}
export function observeSession(s: Session, now = Date.now()): Session {
  return s.phase === "in_progress" && now - (s.lastObservedAt ?? 0) >= 5000
    ? { ...s, lastObservedAt: now }
    : s;
}
export function recordIntegrity(
  s: Session,
  r: Ruleset,
  type: "tab_hidden" | "tab_visible" | "fullscreen_exit",
  now = Date.now(),
): Session {
  if (s.phase !== "in_progress") return s;
  if (type !== "fullscreen_exit") {
    const previous =
      s.events.filter((e) => e.type === "tab_hidden" || e.type === "tab_visible").at(-1)?.type ??
      "tab_visible";
    if (previous === type) return s;
  }
  let next = append(s, { type, at: now });
  const violation =
    type === "tab_hidden" || (type === "fullscreen_exit" && r.integrity.requireFullscreen);
  if (violation) {
    next = { ...next, violations: next.violations + 1 };
    const policy = r.integrity.onViolation;
    if (
      policy === "autosubmit" ||
      (policy === "warn_then_autosubmit" &&
        r.integrity.maxTabSwitches !== null &&
        next.violations > r.integrity.maxTabSwitches)
    )
      next = submitSession(next, now, "integrity");
  }
  return next;
}
export function pauseSession(s: Session, r: Ruleset, now = Date.now()): Session {
  active(s, r, now);
  if (!r.timing.pausable) throw new Error("Pausing is disabled");
  return append({ ...s, pausedAt: now }, { type: "paused", at: now });
}
export function unpauseSession(s: Session, r: Ruleset, now = Date.now()): Session {
  if (!r.timing.pausable || s.pausedAt === undefined)
    throw new Error("Session cannot resume from pause");
  return append(
    { ...s, deadlineAt: s.deadlineAt! + now - s.pausedAt, pausedAt: undefined },
    { type: "resumed", at: now },
  );
}
export function beginReflection(s: Session, r: Ruleset): Session {
  if (s.phase !== "submitting") throw new Error("Submit before grading");
  return {
    ...s,
    phase:
      r.diagnostics.enabled && r.diagnostics.capture.confidence.mode === "post_submit"
        ? "reflection"
        : "submitted",
  };
}
export function finishReflection(s: Session): Session {
  if (s.phase !== "reflection") throw new Error("Expected reflection");
  return { ...s, phase: "submitted" };
}
export function setConfidence(s: Session, r: Ruleset, id: string, confidence: Confidence): Session {
  const mode = r.diagnostics.capture.confidence.mode;
  if (
    !r.diagnostics.enabled ||
    !(
      (mode === "post_submit" && s.phase === "reflection") ||
      (mode === "in_exam" && s.phase === "in_progress")
    ) ||
    !s.order.includes(id) ||
    (confidence !== "none" && !r.diagnostics.capture.confidence.levels.includes(confidence))
  )
    throw new Error("Confidence capture is unavailable");
  return { ...s, confidence: { ...s.confidence, [id]: confidence } };
}
export function canReleaseSolutions(r: Ruleset, now = Date.now()) {
  return (
    r.results.solutionsRelease === "immediate_after_submit" ||
    (r.results.solutionsRelease === "at_time" && now >= Date.parse(r.results.releaseAt!))
  );
}
export function canReleaseScore(r: Ruleset, now = Date.now()) {
  return (
    r.results.scoreVisibility === "immediate" ||
    (r.results.scoreVisibility === "after_release" && now >= Date.parse(r.results.releaseAt!))
  );
}
export function openReview(s: Session, r: Ruleset, now = Date.now()): Session {
  if (!["submitted", "review"].includes(s.phase) || !canReleaseSolutions(r, now))
    throw new Error("Solutions are not released");
  return { ...s, phase: "review" };
}
/** Sum only visible, focused intervals; all timing is reconstructed from events. */
export function focusedSeconds(
  s: Session,
  until = s.submittedAt ?? Date.now(),
): Record<string, number> {
  const totals: Record<string, number> = {};
  let current: string | undefined,
    visible = true,
    paused = false,
    last = s.startedAt ?? s.createdAt;
  for (const e of s.events) {
    if (e.at > until) break;
    if (current && visible && !paused)
      totals[current] = (totals[current] ?? 0) + Math.max(0, e.at - last) / 1000;
    last = e.at;
    if (e.type === "question_viewed") current = e.questionId;
    if (e.type === "question_left" || e.type === "submitted") current = undefined;
    if (e.type === "tab_hidden") visible = false;
    if (e.type === "tab_visible") visible = true;
    if (e.type === "paused") paused = true;
    if (e.type === "resumed") paused = false;
  }
  if (current && visible && !paused)
    totals[current] = (totals[current] ?? 0) + Math.max(0, until - last) / 1000;
  return totals;
}
