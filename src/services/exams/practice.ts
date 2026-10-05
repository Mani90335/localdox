/**
 * Practice sets: untimed questions with their key shown right after each
 * answer. One `*.practice.md` file holds `:::question` and `:::solution`
 * blocks together. Practice is for learning, so solutions are not sealed;
 * that is also why a practice file can never be a day's exam.
 */
import { ExamImportError, defaultTaxonomy, rulesetSchema, type Issue } from "./schema.ts";
import { parsePracticeFile, type Question, type Solution } from "./parser.ts";
import { scoreQuestion, isAnswered, type Outcome, type Response } from "./scoring.ts";
import { validateSolutions } from "./validation.ts";

export interface PracticeSet {
  id: string;
  name: string;
  questions: Question[];
  solutions: Solution[];
  addedAt: number;
  /** Images shipped with the file, by name. */
  assets?: Record<string, Blob>;
}
export interface PracticeAnswer {
  response: Response;
  outcome: Outcome;
  at: number;
}
/** Correct-or-not only: practice never applies negative marks. */
const PRACTICE_RULES = rulesetSchema.parse({
  schemaVersion: 2,
  meta: { id: "practice", name: "Practice", version: "1" },
  timing: { mode: "global", durationMinutes: 60 },
  sections: [{ id: "practice", name: "Practice", questionCount: 1 }],
  questionTypes: { mcq: {}, msq: {}, nat: { inputMode: "keyboard" } },
  diagnostics: { enabled: false },
});
export const practiceKey = (setId: string, questionId: string) => `${setId}/${questionId}`;
/** "probability-basics.practice.md" → id "probability-basics". */
export const practiceIdFromFile = (fileName: string) =>
  fileName.replace(/^.*[\\/]/, "").replace(/\.practice\.md$/i, "");

export function importPracticeSet(
  id: string,
  name: string,
  source: string,
  now = Date.now(),
  assets?: Record<string, Blob>,
): PracticeSet {
  const file = `${id}.practice.md`,
    { questions, solutions } = parsePracticeFile(source, file);
  return practiceSet(id, name, questions, solutions, file, now, assets);
}
/** Validates parsed practice questions and their solutions into a set. */
export function practiceSet(
  id: string,
  name: string,
  questions: Question[],
  raw: Solution[],
  file: string,
  now = Date.now(),
  assets?: Record<string, Blob>,
): PracticeSet {
  const issues: Issue[] = [],
    seen = new Set<string>();
  if (!questions.length)
    issues.push({ severity: "error", location: file, message: "No questions found" });
  for (const q of questions) {
    if (seen.has(q.id))
      issues.push({ severity: "error", location: q.location, message: `Duplicate id: ${q.id}` });
    seen.add(q.id);
    if (q.type !== "nat" && (q.options.length < 2 || q.options.length > 26))
      issues.push({ severity: "error", location: q.location, message: "Wrong option count" });
  }
  // Trap tags belong to exam analytics; practice keeps only the explanation.
  const solutions = raw.map((s) => ({ ...s, distractors: [] }));
  issues.push(
    ...validateSolutions(
      { rules: PRACTICE_RULES, taxonomy: defaultTaxonomy, paper: questions, issues: [] },
      solutions,
    ).map((i) => ({ ...i, location: i.location.replace("solutions.md", file) })),
  );
  if (issues.some((i) => i.severity === "error")) throw new ExamImportError(issues);
  return { id, name, questions, solutions, addedAt: now, ...(assets ? { assets } : {}) };
}

export function checkPractice(q: Question, s: Solution, response: Response): Outcome {
  return scoreQuestion(PRACTICE_RULES, { ...q, section: "practice" }, s, response).outcome;
}
export function practiceProgress(
  sets: PracticeSet[],
  answers: Record<string, PracticeAnswer>,
): { total: number; attempted: number; correct: number } {
  let total = 0,
    attempted = 0,
    correct = 0;
  for (const set of sets)
    for (const q of set.questions) {
      total++;
      const a = answers[practiceKey(set.id, q.id)];
      if (a && isAnswered(a.response)) attempted++;
      if (a?.outcome === "correct") correct++;
    }
  return { total, attempted, correct };
}
