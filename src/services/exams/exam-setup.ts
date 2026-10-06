import gate from "./presets/gate.json" with { type: "json" };
/**
 * An exam is two parts. First its rules, from a short form (`ExamSetup`, read
 * from an `.xrule`); then one Markdown paper (`.xam`) holding its questions,
 * keys and solutions. This module turns that pair into the `ExamRecord` the
 * engine already runs, so sessions and scoring need no second code path.
 */
import { z } from "zod";
import {
  ExamImportError,
  defaultTaxonomy,
  idSchema,
  rulesetSchema,
  type Issue,
  type Ruleset,
} from "./schema.ts";
import { parseExamFile, type Question, type Solution } from "./parser.ts";
import { importSolutions, validateExam, validateSolutions } from "./validation.ts";
import type { ExamRecord } from "./storage.ts";
import { humanizeId } from "./ui/display.ts";

export const examSetupSchema = z
  .object({
    examTypeId: z.string().min(1).max(200).optional(),
    preset: z.literal("gate").optional(),
    rootRules: rulesetSchema.optional(),
    questionCount: z.number().int().min(1).max(500).optional(),
    name: z.string().trim().min(1, "Give the exam a name").max(160),
    /** Shown on the paper above its Start button: what the exam covers. */
    summaryMd: z.string().max(20000).default(""),
    durationMinutes: z.number().int().min(1).max(600),
    passPercentage: z.number().min(0).max(100),
    maxAttempts: z.number().int().min(1).max(20),
    /** Marks lost for a wrong MCQ answer, as a fraction of its marks. */
    mcqPenalty: z.enum(["none", "third", "quarter"]).default("none"),
    calculator: z.enum(["none", "basic", "scientific"]).default("none"),
  })
  .strict();
export type ExamSetup = z.infer<typeof examSetupSchema>;
export const DEFAULT_SETUP: ExamSetup = {
  name: "",
  summaryMd: "",
  durationMinutes: 30,
  passPercentage: 70,
  maxAttempts: 3,
  mcqPenalty: "none",
  calculator: "none",
};
export const GATE_RULESET = rulesetSchema.parse(gate);
export const GATE_SETUP: ExamSetup = {
  ...DEFAULT_SETUP,
  preset: "gate",
  rootRules: GATE_RULESET,
  questionCount: 65,
  durationMinutes: 180,
  mcqPenalty: "third",
  calculator: "scientific",
};
const PENALTY = {
  none: null,
  third: { fractionOfMarks: [1, 3] },
  quarter: { fractionOfMarks: [1, 4] },
};

function fail(location: string, message: string): never {
  throw new ExamImportError([{ severity: "error", location, message }]);
}

/** The full ruleset for a paper: sections come from the questions, in order. */
export function buildRuleset(setup: ExamSetup, id: string, paper: Question[]): Ruleset {
  if (setup.questionCount !== undefined && paper.length !== setup.questionCount)
    fail(
      "exam.xam",
      `Expected ${setup.questionCount} exam questions, found ${paper.length}. Make the paper and its rules' questionCount agree.`,
    );
  const root = setup.rootRules ?? (setup.preset === "gate" ? GATE_RULESET : undefined);
  if (root) {
    // Snapshot the root. Only the explicit variation fields override it.
    const fullPaper =
      setup.questionCount === root.sections.reduce((n, s) => n + (s.questionCount ?? 0), 0);
    const sections = fullPaper
      ? root.sections
      : [...new Set(paper.map((q) => q.section))].map((id) => ({
          id,
          name: root.sections.find((s) => s.id === id)?.name ?? humanizeId(id),
          questionCount: paper.filter((q) => q.section === id).length,
        }));
    return rulesetSchema.parse({
      ...root,
      meta: { ...root.meta, id, name: setup.name },
      sections,
      timing: { ...root.timing, durationMinutes: setup.durationMinutes },
      attempts: { ...root.attempts, max: setup.maxAttempts },
      progression: { ...root.progression, passPercentage: setup.passPercentage },
    });
  }
  const sections = [...new Set(paper.map((q) => q.section))];
  for (const q of paper)
    if (!idSchema.safeParse(q.section).success)
      fail(q.location, `Section "${q.section}": use letters, digits, dots, underscores or hyphens`);
  const rules = rulesetSchema.parse({
    schemaVersion: 2,
    meta: { id, name: setup.name, version: "1" },
    timing: { mode: "global", durationMinutes: setup.durationMinutes },
    sections: sections.map((s) => ({
      id: s,
      name: s === "exam" ? "Questions" : humanizeId(s),
      questionCount: paper.filter((q) => q.section === s).length,
    })),
    questionTypes: {
      mcq: { negativeMarking: PENALTY[setup.mcqPenalty] },
      msq: {},
      nat: { inputMode: "keyboard" },
    },
    tools: { calculator: setup.calculator },
    attempts: { max: setup.maxAttempts },
    progression: { passPercentage: setup.passPercentage },
    results: { scoreVisibility: "immediate" },
    diagnostics: { enabled: false },
    ui: { profile: "generic" },
  });
  // The schema defaults MCQs to exactly four options, a rule for authored exam
  // JSON. A learner's own file may vary per question; validation still keeps
  // every question between 2 and 26 options.
  delete (rules.questionTypes.mcq as { optionCount?: number }).optionCount;
  return rules;
}

/**
 * Exam solutions stay sealed until submission, so they are stored as their
 * own Markdown blob. Rebuilt from the parsed blocks: only the keys and
 * explanations, without trap tags. The fence outgrows any colons inside.
 */
function solutionsSource(solutions: Solution[]): string {
  return solutions
    .map((s) => {
      const fence = ":".repeat(
        Math.max(3, ...(s.body.match(/^:{3,}/gm) ?? []).map((m) => m.length + 1)),
      );
      const tolerance = s.tolerance === undefined ? "" : ` tolerance=${s.tolerance}`;
      return `${fence}solution{#${s.id} answer="${s.answer}"${tolerance}}\n${s.body}\n${fence}`;
    })
    .join("\n\n");
}

export interface ExamFileContent {
  exam: ExamRecord;
}
/** Images a text names, e.g. `![graph](graph.png)`. */
const named = (texts: string[], images: Record<string, Blob>) => {
  const used = Object.entries(images).filter(([name]) => texts.some((t) => t.includes(name)));
  return used.length ? Object.fromEntries(used) : undefined;
};
const textsOf = (qs: Question[], ss: Solution[]) => [
  ...qs.flatMap((q) => [q.body, ...q.options]),
  ...ss.map((s) => s.body),
];

/**
 * Validate one exam file against its setup. Everything is checked now,
 * keys included: a broken key found after a timed attempt costs the attempt.
 */
export function readExamFile(
  setup: ExamSetup,
  examId: string,
  source: string,
  fileName = "exam.xam",
  images: Record<string, Blob> = {},
): ExamFileContent {
  const parsed = parseExamFile(source, fileName),
    paper = parsed.questions,
    // Trap tags feed exam analytics, which configured exams do not run.
    solutions = parsed.solutions.map((s) => ({ ...s, distractors: [] }));
  if (!paper.length)
    fail(fileName, "No exam questions. Add a :::question block and its :::solution.");
  const rules = buildRuleset(setup, examId, paper),
    issues: Issue[] = validateExam(rules, defaultTaxonomy, paper);
  const exam = { rules, taxonomy: defaultTaxonomy, paper, issues: [] as Issue[] };
  issues.push(
    ...validateSolutions(exam, solutions).map((i) => ({
      ...i,
      location: i.location.replace("solutions.md", fileName),
    })),
  );
  // Topic and difficulty tags are optional here, so only errors block.
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) throw new ExamImportError(errors);
  const sealed = solutionsSource(solutions);
  // Grading re-reads this blob after submission; prove now that it parses.
  importSolutions(exam, sealed);
  const examAssets = named(textsOf(paper, solutions), images);
  return {
    exam: {
      id: examId,
      exam,
      solutionFile: new Blob([sealed], { type: "text/markdown" }),
      ...(examAssets ? { assets: examAssets } : {}),
    },
  };
}
