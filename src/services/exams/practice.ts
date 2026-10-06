/**
 * Practice files (`.xp`): untimed questions whose key is shown the moment
 * each is answered. Same Markdown as an exam paper, but with no ruleset and
 * nothing sealed: practice is for learning, so solutions sit beside their
 * questions and are revealed by answering. That is also why practice and
 * exams are separate files: an exam's keys must stay hidden until it is
 * submitted, and a practice file never hides its own.
 */
import { ExamImportError, defaultTaxonomy, rulesetSchema, type Issue } from "./schema.ts";
import { parsePracticeFile, type PracticeFile, type Question, type Solution } from "./parser.ts";
import { scoreQuestion, type Outcome, type Response } from "./scoring.ts";
import { validateSolutions } from "./validation.ts";

/** Correct-or-not only: practice never applies negative marks. */
const PRACTICE_RULES = rulesetSchema.parse({
  schemaVersion: 2,
  meta: { id: "practice", name: "Practice", version: "1" },
  timing: { mode: "global", durationMinutes: 60 },
  sections: [{ id: "practice", name: "Practice", questionCount: 1 }],
  questionTypes: { mcq: {}, msq: {}, nat: { inputMode: "keyboard" } },
  diagnostics: { enabled: false },
});

export interface PracticeSheet extends PracticeFile {
  questions: Question[];
  /** Each question's solution, by question id. Every question has one. */
  solutionFor: Record<string, Solution>;
}

/**
 * Parse and check an `.xp` file. Everything a question needs to be checked is
 * verified here (option counts, a solution per question, valid keys), so a
 * file that reads cleanly can be answered without surprises.
 */
export function readPracticeFile(source: string, file = "practice.xp"): PracticeSheet {
  const parsed = parsePracticeFile(source, file),
    questions = parsed.groups.flatMap((g) => g.questions),
    issues: Issue[] = [];
  if (!questions.length)
    issues.push({
      severity: "error",
      location: file,
      message: "No questions yet. Add a :::question block and its :::solution.",
    });
  for (const q of questions)
    if (q.type !== "nat" && (q.options.length < 2 || q.options.length > 26))
      issues.push({
        severity: "error",
        location: q.location,
        message: `${q.id} needs 2 to 26 options, listed with - at the end of the question`,
      });
  // Trap tags belong to exam analytics; practice keeps only the explanation.
  const solutions = parsed.solutions.map((s) => ({ ...s, distractors: [] }));
  issues.push(
    ...validateSolutions(
      { rules: PRACTICE_RULES, taxonomy: defaultTaxonomy, paper: questions, issues: [] },
      solutions,
    ).map((i) => ({ ...i, location: i.location.replace("solutions.md", file) })),
  );
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) throw new ExamImportError(errors);
  return {
    ...parsed,
    solutions,
    questions,
    solutionFor: Object.fromEntries(solutions.map((s) => [s.id, s])),
  };
}

export function checkPractice(q: Question, s: Solution, response: Response): Outcome {
  return scoreQuestion(PRACTICE_RULES, { ...q, section: "practice" }, s, response).outcome;
}
