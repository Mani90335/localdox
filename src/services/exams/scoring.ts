import type { Ruleset } from "./schema.ts";
import { natMatches, numeric, type Question, type Solution } from "./parser.ts";
export type Response = string | string[] | null;
export type Outcome = "correct" | "wrong" | "partial" | "unanswered";
export const isAnswered = (response: Response) =>
  Array.isArray(response) ? response.length > 0 : response !== null && response.trim() !== "";
export function scoreQuestion(
  rules: Ruleset,
  q: Question,
  s: Solution,
  response: Response,
  marked = false,
): { score: number; outcome: Outcome; marksLost: number; negativeMarksTaken: number } {
  let score = 0,
    outcome: Outcome = "unanswered";
  if (isAnswered(response) && (!marked || rules.navigation.markedForReviewAnswerCounts)) {
    const correct = s.answer.split(",").map((a) => a.trim());
    if (q.type === "nat")
      outcome =
        typeof response === "string" && numeric(response) && natMatches(Number(response), s)
          ? "correct"
          : "wrong";
    else {
      const selected = Array.isArray(response) ? response : [response as string];
      const valid = selected.every((a) => correct.includes(a));
      outcome = valid && selected.length === correct.length ? "correct" : "wrong";
      if (
        q.type === "msq" &&
        rules.questionTypes.msq?.scoring === "partial_no_wrong" &&
        valid &&
        selected.length < correct.length
      ) {
        outcome = "partial";
        score = (q.marks * selected.length) / correct.length;
      }
    }
    if (outcome === "correct") score = q.marks;
    if (outcome === "wrong") {
      const penalty = rules.questionTypes[q.type]?.negativeMarking;
      score = penalty
        ? -("marks" in penalty
            ? penalty.marks
            : (q.marks * penalty.fractionOfMarks[0]) / penalty.fractionOfMarks[1])
        : 0;
    }
  }
  return { score, outcome, marksLost: q.marks - score, negativeMarksTaken: Math.max(0, -score) };
}
