/**
 * Presentation rules for Exam Workspaces: formats, copy and derived view state.
 *
 * Everything here is pure and read-only over the engine's data. Nothing in this
 * file may change grading, timing, attempts or integrity; it only decides how
 * those facts are worded and when they are worth showing.
 */
import type { Ruleset } from "../schema.ts";
import type { Question, QuestionType } from "../parser.ts";
import { questionState, type Session } from "../session.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;

/** "6:57 pm" */
export function formatTime(ts: number): string {
  const d = new Date(ts),
    h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
/** "5 Oct 2026" */
export function formatDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
/** "Today, 6:57 pm", "Yesterday, 9:02 am", or "5 Oct 2026, 6:57 pm". */
export function formatDateTime(ts: number, now = Date.now()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  if (ts >= today && ts < today + DAY) return `Today, ${formatTime(ts)}`;
  if (ts >= today - DAY && ts < today) return `Yesterday, ${formatTime(ts)}`;
  return `${formatDay(ts)}, ${formatTime(ts)}`;
}
/** "33s", "4m 5s", "12m", "1h 20m", "3h". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60),
      rest = s % 60;
    return rest ? `${m}m ${rest}s` : `${m}m`;
  }
  const h = Math.floor(s / 3600),
    m = Math.round((s % 3600) / 60);
  return m === 60 ? `${h + 1}h` : m ? `${h}h ${m}m` : `${h}h`;
}
/** "03:59:12" for the exam clock (tabular digits, fixed width). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds)),
    pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s / 60) % 60))}:${pad(s % 60)}`;
}
/**
 * Integer percentage, rounded down. Rounding up could print "80%" beside an
 * attempt that scored 79.6% and failed an 80% gate; flooring never overstates.
 */
export function formatPercent(value: number): string {
  return `${Math.floor(value + 1e-9)}%`;
}
/** Up to two decimals with trailing zeros dropped: 0.67, 2, 1.5. */
export function trimNumber(value: number): string {
  return String(Number(value.toFixed(2)));
}
/** "gate-da" → "GATE DA", "reasoning" → "Reasoning". For ids without a name. */
export function humanizeId(id: string): string {
  return id
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

/* ── Timer and threshold notices ─────────────────────────────────────────── */

/** Length of the clock currently running: the exam, or the current section. */
export function timerTotalSeconds(r: Ruleset, sectionIndex: number, scale = 1): number {
  return (
    (r.timing.mode === "per_section"
      ? (r.sections[sectionIndex]?.durationMinutes ?? r.timing.durationMinutes)
      : r.timing.durationMinutes) *
    60 *
    scale
  );
}
/** Clock share for a short sample: its questions over the real pattern's. */
export function sampleScale(r: Ruleset, paper: Question[]): number {
  const pattern = patternQuestionCount(r),
    minutes = r.timing.durationMinutes;
  if (pattern <= paper.length) return 1;
  // Whole minutes, so the time shown is exactly the time that runs.
  return Math.max(1, Math.round((minutes * paper.length) / pattern)) / minutes;
}
/**
 * Warning thresholds that can actually be crossed. A threshold at or above the
 * clock's full length would be "crossed" from the first second, so it is noise.
 */
export function usableThresholds(r: Ruleset, sectionIndex: number, scale = 1): number[] {
  const total = timerTotalSeconds(r, sectionIndex, scale);
  return [...new Set(r.timing.warnAtMinutesLeft)]
    .filter((m) => m * 60 < total)
    .sort((a, b) => b - a);
}
export type TimerTone = "normal" | "warning" | "danger";
/** Colour only changes at the ruleset's thresholds: amber after the first, red after the last. */
export function timerTone(
  r: Ruleset,
  sectionIndex: number,
  remaining: number,
  scale = 1,
): TimerTone {
  const t = usableThresholds(r, sectionIndex, scale);
  if (!t.length || remaining > t[0] * 60) return "normal";
  return t.length > 1 && remaining <= t[t.length - 1] * 60 ? "danger" : "warning";
}
/** How long a threshold notice stays up after it is crossed. */
export const THRESHOLD_NOTICE_SECONDS = 10;
/** The threshold crossed within the last few seconds, if any. Never fires on resume. */
export function crossedThreshold(
  r: Ruleset,
  sectionIndex: number,
  remaining: number,
  scale = 1,
): number | null {
  for (const m of usableThresholds(r, sectionIndex, scale).reverse()) {
    const since = m * 60 - remaining;
    if (since >= 0 && since < THRESHOLD_NOTICE_SECONDS) return m;
  }
  return null;
}
export function thresholdCopy(minutes: number): string {
  return minutes === 1 ? "1 minute left" : `${trimNumber(minutes)} minutes left`;
}

/* ── Marking and rules copy ──────────────────────────────────────────────── */

export const TYPE_LABEL: Record<QuestionType, string> = { mcq: "MCQ", msq: "MSQ", nat: "NAT" };
export const TYPE_NAME: Record<QuestionType, string> = {
  mcq: "Single correct option",
  msq: "One or more correct options",
  nat: "Numerical answer",
};
/** Marks deducted for a wrong answer to a question of this type and value. */
export function penaltyFor(r: Ruleset, type: QuestionType, marks: number): number {
  const p = r.questionTypes[type]?.negativeMarking;
  if (!p) return 0;
  return "marks" in p ? p.marks : (marks * p.fractionOfMarks[0]) / p.fractionOfMarks[1];
}
/** "+2 / −0.67" or "+2". Uses a true minus sign. */
export function marksLabel(r: Ruleset, type: QuestionType, marks: number): string {
  const p = penaltyFor(r, type, marks);
  return p ? `+${trimNumber(marks)} / −${trimNumber(p)}` : `+${trimNumber(marks)}`;
}
export interface MarkingCard {
  type: QuestionType;
  title: string;
  rule: string;
  example: string;
}
export function markingCards(r: Ruleset, paper: Question[]): MarkingCard[] {
  return (Object.keys(r.questionTypes) as QuestionType[])
    .filter((type) => r.questionTypes[type])
    .map((type) => {
      const values = paper.filter((q) => q.type === type).map((q) => q.marks),
        marks = values.length ? Math.max(...values) : 1,
        penalty = penaltyFor(r, type, marks),
        p = r.questionTypes[type]!.negativeMarking;
      const rule =
        type === "msq"
          ? r.questionTypes.msq?.scoring === "partial_no_wrong"
            ? "Partial credit if you pick no wrong option."
            : "Pick every correct option to score."
          : type === "nat"
            ? r.questionTypes.nat?.inputMode === "keyboard"
              ? "Type a number."
              : "Enter a number with the on-screen keypad."
            : "Pick one option.";
      const penaltyRule = !p
        ? "No negative marking."
        : "marks" in p
          ? `Wrong answer costs ${trimNumber(p.marks)}.`
          : `Wrong answer costs ${p.fractionOfMarks[0]}/${p.fractionOfMarks[1]} of its marks.`;
      return {
        type,
        title: `${TYPE_LABEL[type]} · ${TYPE_NAME[type]}`,
        rule: `${rule} ${penaltyRule}`,
        example: penalty
          ? `${trimNumber(marks)} marks: wrong answer costs ${trimNumber(penalty)}`
          : `${trimNumber(marks)} marks: wrong answer costs nothing`,
      };
    });
}
/** Plain sentences for the integrity and timing rules (at most three). */
export function ruleSentences(r: Ruleset): string[] {
  const i = r.integrity,
    leaving = i.requireFullscreen ? "Leaving fullscreen or switching tabs" : "Switching tabs";
  const integrity =
    i.onViolation === "autosubmit"
      ? `${leaving} submits your exam immediately.`
      : i.onViolation === "warn_then_autosubmit" && i.maxTabSwitches !== null
        ? `${leaving} more than ${i.maxTabSwitches} ${
            i.maxTabSwitches === 1 ? "time" : "times"
          } submits your exam.`
        : `${leaving} is recorded with your attempt.`;
  const clock = r.timing.pausable
    ? "You can pause the timer."
    : "The timer keeps running if you close or leave the exam.";
  const end =
    r.timing.mode === "per_section"
      ? "Each section has its own timer. Once a section ends you can't return to it."
      : r.timing.autoSubmitOnExpiry
        ? "When time runs out, your answers are submitted automatically."
        : "When time runs out, answers lock and you submit.";
  return [integrity, clock, end];
}
/** Short notes about tools and restrictions. Only what applies. */
export function ruleNotes(r: Ruleset): string[] {
  const notes: string[] = [];
  if (r.integrity.requireFullscreen) notes.push("The exam runs in fullscreen.");
  if (r.integrity.blockCopyPaste) notes.push("Copy and paste are turned off.");
  if (r.integrity.blockContextMenu) notes.push("Right-click is turned off.");
  if (r.tools.calculator !== "none")
    notes.push(
      `A ${r.tools.calculator} calculator is available from the side panel${
        r.tools.calculator === "scientific" ? " (angles in radians)" : ""
      }.`,
    );
  if (r.navigation.markForReview)
    notes.push(
      r.navigation.markedForReviewAnswerCounts
        ? "Answers marked for review are counted."
        : "Answers marked for review are not counted.",
    );
  if (!r.navigation.free) notes.push("Questions go in order; you can't go back.");
  notes.push("Keyboard: A–D to choose, N next, P previous, M mark for review.");
  return notes;
}
/** Violation notice: "Warning 1 of 3: stay in fullscreen." */
export function violationCopy(r: Ruleset, violations: number): string {
  const what = r.integrity.requireFullscreen ? "stay in fullscreen" : "stay on this tab";
  return r.integrity.onViolation === "warn_then_autosubmit" && r.integrity.maxTabSwitches !== null
    ? `Warning ${violations} of ${r.integrity.maxTabSwitches}: ${what}.`
    : `Warning ${violations}: ${what}.`;
}
export function submitReasonCopy(reason: string | undefined): string | null {
  switch (reason) {
    case "expiry":
      return "Submitted automatically when time ran out.";
    case "integrity":
      return "Submitted automatically after integrity warnings.";
    case "section_complete":
      return "Submitted when the last section ended.";
    case "interrupted":
      return "Submitted because the attempt was interrupted.";
    default:
      return null;
  }
}

/* ── Paper facts ─────────────────────────────────────────────────────────── */

export function totalMarks(paper: Question[]): number {
  return paper.reduce((sum, q) => sum + q.marks, 0);
}
/** Questions the real pattern has; the paper may be a shorter sample. */
export function patternQuestionCount(r: Ruleset): number {
  return r.sections.reduce((sum, s) => sum + s.questionCount, 0);
}
export function isShortSample(r: Ruleset, paper: Question[]): boolean {
  return r.sampleMode || paper.length < patternQuestionCount(r);
}
export type ExamKind = "full" | "sectional" | "quiz";
/** `ui.kind` when the author set it; otherwise a conservative guess. */
export function examKind(r: Ruleset): ExamKind {
  if (r.ui?.kind) return r.ui.kind;
  if (r.timing.durationMinutes < 60) return "quiz";
  return r.sections.length === 1 ? "sectional" : "full";
}
/**
 * Papers that share a format (same instructions, sections and timing) are one
 * exam with several versions: a quiz and its rewrite paper, for instance.
 */
export function formatKey(r: Ruleset, taxonomyId: string): string {
  return JSON.stringify([
    taxonomyId,
    r.meta.instructionsMd,
    r.timing.mode,
    r.timing.durationMinutes,
    r.sections.map((s) => [s.id, s.questionCount, s.durationMinutes ?? null]),
  ]);
}
export function groupByFormat<T>(items: T[], key: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return [...groups.values()];
}

/* ── Session summaries ───────────────────────────────────────────────────── */

export interface StatusCounts {
  answered: number;
  notAnswered: number;
  marked: number;
  notVisited: number;
  total: number;
}
/** Answered + not answered + not visited = total; "marked" overlaps the first two. */
export function statusCounts(s: Session, ids: string[]): StatusCounts {
  const counts = { answered: 0, notAnswered: 0, marked: 0, notVisited: 0, total: ids.length };
  for (const id of ids) {
    const { status } = questionState(s, id);
    if (status === "answered" || status === "answered_marked") counts.answered++;
    else if (status === "not_visited") counts.notVisited++;
    else counts.notAnswered++;
    if (status === "marked" || status === "answered_marked") counts.marked++;
  }
  return counts;
}
export function sectionIds(s: Session, paper: Question[], sectionId: string): string[] {
  return s.order.filter((id) => paper.find((q) => q.id === id)?.section === sectionId);
}
/* ── Exam-style profiles ─────────────────────────────────────────────────── */

export type ProfileId = "gate" | "jee" | "upsc" | "generic";
export interface UiProfile {
  id: ProfileId;
  /** Palette glyph family. */
  glyphs: "pentagon" | "circle" | "square";
  labels: {
    saveNext: string;
    next: string;
    previous: string;
    markNext: string;
    unmarkNext: string;
    clear: string;
  };
}
const PROFILES: Record<ProfileId, UiProfile> = {
  gate: {
    id: "gate",
    glyphs: "pentagon",
    labels: {
      saveNext: "Save & next",
      next: "Next",
      previous: "Previous",
      markNext: "Mark for review & next",
      unmarkNext: "Unmark & next",
      clear: "Clear response",
    },
  },
  jee: {
    id: "jee",
    glyphs: "pentagon",
    labels: {
      saveNext: "Save & next",
      next: "Next",
      previous: "Back",
      markNext: "Mark for review & next",
      unmarkNext: "Unmark & next",
      clear: "Clear",
    },
  },
  upsc: {
    id: "upsc",
    glyphs: "circle",
    labels: {
      saveNext: "Save & next",
      next: "Next",
      previous: "Previous",
      markNext: "Mark for review",
      unmarkNext: "Unmark",
      clear: "Clear answer",
    },
  },
  generic: {
    id: "generic",
    glyphs: "square",
    labels: {
      saveNext: "Save & next",
      next: "Next",
      previous: "Previous",
      markNext: "Flag & next",
      unmarkNext: "Unflag & next",
      clear: "Clear",
    },
  },
};
/** Older attempts stored their ruleset before `ui` existed, so it may be absent. */
export function uiProfile(r: Ruleset): UiProfile {
  return PROFILES[r.ui?.profile ?? "gate"] ?? PROFILES.gate;
}

/* ── Import errors in plain words ────────────────────────────────────────── */

export interface IssueLike {
  severity: "error" | "warning";
  location: string;
  message: string;
}
const quote = (field: string) => `“${field}”`;
/** "plan.json.days.0.title" → { file: "plan.json", field: "days[0].title" }. */
function splitLocation(location: string): { file?: string; line?: string; field?: string } {
  // A root-level schema issue arrives as "file.json." (empty path).
  const m = /^(.*?\.(?:json|md))(?::(\d+))?(?:\.(.+))?$/.exec(location.replace(/\.$/, ""));
  const field = (m ? m[3] : location)?.replace(/\.(\d+)(?=\.|$)/g, "[$1]");
  return m ? { file: m[1], line: m[2], field: field || undefined } : { field };
}
function rephrase(message: string, field?: string): string {
  const f = field ? quote(field) : "A value";
  let m: RegExpExecArray | null;
  if (message === "Required") return `${f} is missing.`;
  if ((m = /^Unrecognized key\(s\) in object: (.+)$/.exec(message)))
    return `Unknown field ${m[1].replaceAll("'", "")}${field ? ` in ${quote(field)}` : ""}. Check the spelling, or remove it.`;
  if ((m = /^Expected (\w+), received (\w+)$/.exec(message)))
    return `${f} should be ${/^[aeiou]/.test(m[1]) ? "an" : "a"} ${m[1]}, not ${m[2] === "undefined" ? "empty" : m[2]}.`;
  if ((m = /^Invalid enum value\. Expected (.+), received '(.+)'$/.exec(message)))
    return `${f} can't be “${m[2]}”. Use one of: ${m[1].replaceAll("'", "").replaceAll(" | ", ", ")}.`;
  if ((m = /^Invalid literal value, expected (.+)$/.exec(message))) return `${f} must be ${m[1]}.`;
  if (message === "Invalid JSON")
    return "This isn't valid JSON. Look for a missing comma, quote or bracket.";
  if (message === "Unclosed directive")
    return "A ::: block is not closed. Add a line with just ::: after it.";
  if ((m = /^Missing solution for (.+)$/.exec(message)))
    return `Question ${m[1]} has no matching :::solution block.`;
  return message.endsWith(".") ? message : `${message}.`;
}
/** One readable line per problem, with the file and line when known. */
export function describeIssue(issue: IssueLike): string {
  const { file, line, field } = splitLocation(issue.location);
  const where = file ? (line ? `${file}, line ${line}` : file) : undefined;
  const text = rephrase(issue.message, line ? undefined : field);
  return where ? `${where}: ${text}` : text;
}
/** A short title plus up to `max` lines; warnings are left out. */
export function describeImportIssues(issues: IssueLike[], max = 6): string {
  const errors = issues.filter((i) => i.severity === "error"),
    lines = errors.slice(0, max).map((i) => `• ${describeIssue(i)}`);
  if (errors.length > max) lines.push(`• …and ${errors.length - max} more.`);
  return [
    errors.length === 1
      ? "Couldn't import. One thing to fix:"
      : `Couldn't import. ${errors.length} things to fix:`,
    ...lines,
  ].join("\n");
}
