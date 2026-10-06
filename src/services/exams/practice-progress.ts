import type { Question, Solution } from "./parser.ts";
import type { Outcome, Response } from "./scoring.ts";

export interface PracticeAnswer {
  response: Response;
  outcome: Outcome;
  sig: string;
  elapsedMs?: number;
  reason?: "answered" | "skipped" | "timeout";
}
export type PracticeAnswers = Record<string, PracticeAnswer>;
const generations = new Map<string, number>();
export const practiceGeneration = (fileId: string) => generations.get(fileId) ?? 0;
const answersKey = (fileId: string) => `localdox:practice-answers:${fileId}`;
const timesKey = (fileId: string) => `localdox:practice-times:${fileId}`;

function read(key: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
function write(key: string, value: object) {
  try {
    if (Object.keys(value).length) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    /* Storage is optional; the current view still works. */
  }
}
export function loadPracticeAnswers(fileId: string): PracticeAnswers {
  return Object.fromEntries(
    Object.entries(read(answersKey(fileId))).filter(([, value]) => {
      if (!value || typeof value !== "object") return false;
      const a = value as PracticeAnswer;
      return (
        typeof a.sig === "string" &&
        ["correct", "partial", "wrong", "unanswered"].includes(a.outcome) &&
        (typeof a.response === "string" ||
          a.response === null ||
          (Array.isArray(a.response) && a.response.every((v) => typeof v === "string"))) &&
        (a.elapsedMs === undefined || (Number.isFinite(a.elapsedMs) && a.elapsedMs >= 0)) &&
        (a.reason === undefined || ["answered", "skipped", "timeout"].includes(a.reason))
      );
    }),
  ) as PracticeAnswers;
}
export const savePracticeAnswers = (fileId: string, value: PracticeAnswers) =>
  write(answersKey(fileId), value);
export function loadPracticeTime(fileId: string, questionId: string, sig: string): number {
  const t = read(timesKey(fileId))[questionId] as { sig?: string; elapsedMs?: number } | undefined;
  return t?.sig === sig &&
    typeof t.elapsedMs === "number" &&
    Number.isFinite(t.elapsedMs) &&
    t.elapsedMs >= 0
    ? t.elapsedMs
    : 0;
}
export function savePracticeTime(
  fileId: string,
  questionId: string,
  sig: string,
  elapsedMs: number,
  generation = practiceGeneration(fileId),
) {
  if (generation !== practiceGeneration(fileId)) return;
  write(timesKey(fileId), { ...read(timesKey(fileId)), [questionId]: { sig, elapsedMs } });
}
export function clearPracticeProgress(fileId: string) {
  generations.set(fileId, practiceGeneration(fileId) + 1);
  write(answersKey(fileId), {});
  write(timesKey(fileId), {});
}
/** A question or answer-key edit retires both the answer and its timing. */
export function practiceSignature(q: Question, s: Solution): string {
  let hash = 0x811c9dc5;
  for (const char of [q.type, q.body, ...q.options, s.answer, String(s.tolerance)].join("\u0000")) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}
export function formatPracticeTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
