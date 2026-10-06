import { z } from "zod";

export const idSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, "Use letters, digits, dots, underscores or hyphens")
  .refine((value) => !Object.hasOwn(Object.prototype, value), "Reserved identifier");
const id = idSchema;
const positive = z.number().finite().positive();
const nonnegative = z.number().finite().nonnegative();
const named = z.object({ id, name: z.string().min(1) }).strict();
export interface Topic {
  id: string;
  name: string;
  children?: Topic[];
}
const topic: z.ZodType<Topic> = named
  .extend({ children: z.lazy(() => z.array(topic)).optional() })
  .strict();
export const taxonomySchema = z
  .object({
    id,
    difficulty: z.array(z.string().min(1)).min(1),
    causes: z.array(named).min(1),
    topics: z.array(topic),
    traps: z.array(named.extend({ cause: id }).strict()),
  })
  .strict();
export type Taxonomy = z.infer<typeof taxonomySchema>;
export const defaultTaxonomy: Taxonomy = {
  id: "general",
  difficulty: ["easy", "medium", "hard"],
  topics: [],
  traps: [],
  causes: ["concept_gap", "trap", "careless", "time_pressure", "overconfidence", "guess"].map(
    (id) => ({ id, name: id.replaceAll("_", " ") }),
  ),
};
export const questionSignals = {
  outcome: "string",
  type: "string",
  section: "string",
  marks: "number",
  topic: "string",
  difficulty: "string",
  spentSec: "number",
  expectedSec: "number",
  timeRatio: "number",
  visits: "number",
  answerChanges: "number",
  changedCorrectToWrong: "boolean",
  changedWrongToCorrect: "boolean",
  confidence: "string",
  markedForReview: "boolean",
  selectedTrap: "string",
  marksLost: "number",
  negativeMarksTaken: "number",
  answeredWithMinutesLeft: "number",
} as const;
export const aggregateSignals = {
  accuracy: "number",
  attemptRate: "number",
  avgTimeRatio: "number",
  unansweredCount: "number",
  guessPenaltyMarks: "number",
  accuracyFirstThird: "number",
  accuracyLastThird: "number",
  accuracyDrop: "number",
  timeLeftWhenFinishedSec: "number",
} as const;
export type Literal = string | number | boolean;
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | {
      signal: string;
      op: "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in";
      value: Literal | Literal[];
    };
const literal = z.union([z.string(), z.number().finite(), z.boolean()]);
export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema).min(1).max(50) }).strict(),
    z.object({ any: z.array(conditionSchema).min(1).max(50) }).strict(),
    z.object({ not: conditionSchema }).strict(),
    z
      .object({
        signal: z.string(),
        op: z.enum(["==", "!=", "<", "<=", ">", ">=", "in", "not_in"]),
        value: z.union([literal, z.array(literal).min(1)]),
      })
      .strict(),
  ]),
);
export const ruleSchema = z
  .object({
    id,
    scope: z.enum(["question", "section", "exam"]),
    label: z.string().min(1),
    cause: id.nullable(),
    severity: z.number().int().min(1).max(3),
    when: conditionSchema,
    advice: z.string(),
  })
  .strict();
export type Rule = z.infer<typeof ruleSchema>;
const negative = z
  .union([
    z.object({ fractionOfMarks: z.tuple([nonnegative, positive]) }).strict(),
    z.object({ marks: nonnegative }).strict(),
    z.null(),
  ])
  .default(null);
export const rulesetSchema = z
  .object({
    schemaVersion: z.literal(2),
    sampleMode: z.boolean().default(false),
    meta: z
      .object({
        id,
        name: z.string().min(1),
        version: z.string().min(1),
        instructionsMd: z.string().default("Read the rules and acknowledge before starting."),
      })
      .strict(),
    timing: z
      .object({
        mode: z.enum(["global", "per_section"]),
        durationMinutes: positive,
        autoSubmitOnExpiry: z.boolean().default(true),
        pausable: z.boolean().default(false),
        warnAtMinutesLeft: z.array(positive).default([10, 1]),
      })
      .strict(),
    sections: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1),
            questionCount: z.number().int().positive(),
            durationMinutes: positive.optional(),
            composition: z
              .array(z.object({ marks: positive, count: z.number().int().positive() }).strict())
              .optional(),
          })
          .strict(),
      )
      .min(1),
    questionTypes: z
      .object({
        mcq: z
          .object({
            optionCount: z.number().int().min(2).max(26).default(4),
            selection: z.literal("single").default("single"),
            negativeMarking: negative,
          })
          .strict()
          .optional(),
        msq: z
          .object({
            optionCount: z.number().int().min(2).max(26).optional(),
            selection: z.literal("multiple").default("multiple"),
            scoring: z.enum(["all_or_nothing", "partial_no_wrong"]).default("all_or_nothing"),
            negativeMarking: negative,
          })
          .strict()
          .optional(),
        nat: z
          .object({
            inputMode: z.enum(["virtual_keypad", "keyboard"]).default("virtual_keypad"),
            negativeMarking: negative,
          })
          .strict()
          .optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0, "At least one question type is required"),
    navigation: z
      .object({
        free: z.boolean().default(true),
        sectionLocking: z.boolean().default(false),
        markForReview: z.boolean().default(true),
        markedForReviewAnswerCounts: z.boolean().default(true),
        clearResponse: z.boolean().default(true),
        /**
         * TCS iON / GATE: choosing an option only selects it. It counts once
         * saved with Save & next (or Mark for review & next); leaving the
         * question any other way drops an unsaved choice. Off: every choice
         * is saved as it is made.
         */
        requireSave: z.boolean().default(false),
        shuffleQuestions: z.boolean().default(false),
        shuffleOptions: z.boolean().default(false),
      })
      .strict()
      .default({}),
    tools: z
      .object({ calculator: z.enum(["none", "basic", "scientific"]).default("none") })
      .strict()
      .default({}),
    integrity: z
      .object({
        requireFullscreen: z.boolean().default(false),
        maxTabSwitches: z.number().int().nonnegative().nullable().default(null),
        onViolation: z.enum(["warn", "autosubmit", "warn_then_autosubmit"]).default("warn"),
        blockCopyPaste: z.boolean().default(false),
        blockContextMenu: z.boolean().default(false),
      })
      .strict()
      .default({}),
    results: z
      .object({
        scoreVisibility: z.enum(["immediate", "after_release", "hidden"]).default("immediate"),
        solutionsRelease: z
          .enum(["immediate_after_submit", "at_time", "never"])
          .default("immediate_after_submit"),
        releaseAt: z.string().datetime().optional(),
        showSectionBreakdown: z.boolean().default(true),
        showTimePerQuestion: z.boolean().default(true),
        rounding: z.number().int().min(0).max(8).default(2),
      })
      .strict()
      .default({}),
    attempts: z
      .object({
        max: z.number().int().positive().nullable().default(null),
        resumeInterrupted: z.boolean().default(true),
      })
      .strict()
      .default({}),
    progression: z
      .object({
        passPercentage: z.number().min(0).max(100).default(80),
        rewriteDifficultyPercentage: z.number().min(0).max(100).default(50),
        difficultyLabel: z.string().min(1).default("hard"),
      })
      .strict()
      .default({}),
    diagnostics: z
      .object({
        enabled: z.boolean().default(true),
        taxonomyRef: z.string().min(1).optional(),
        taxonomy: taxonomySchema.optional(),
        capture: z
          .object({
            eventLog: z.boolean().default(true),
            confidence: z
              .object({
                mode: z.enum(["off", "in_exam", "post_submit"]).default("post_submit"),
                levels: z
                  .array(z.enum(["sure", "unsure", "guess"]))
                  .min(1)
                  .default(["sure", "unsure", "guess"]),
              })
              .strict()
              .default({}),
            selfTagging: z.boolean().default(true),
          })
          .strict()
          .default({}),
        pacing: z
          .object({
            expectedSeconds: z
              .object({
                derive: z.literal("proportional_to_marks").default("proportional_to_marks"),
              })
              .strict()
              .default({}),
            slowRatio: positive.default(1.5),
            fastRatio: positive.default(0.4),
          })
          .strict()
          .default({}),
        causePriority: z
          .array(id)
          .default(["trap", "overconfidence", "careless", "time_pressure", "concept_gap", "guess"]),
        impact: z
          .object({
            marksLostWeight: nonnegative.default(1),
            timeWastedPerMinuteWeight: nonnegative.default(0.25),
          })
          .strict()
          .default({}),
        disabledRules: z.array(id).default([]),
        rules: z.array(ruleSchema).default([]),
        report: z
          .object({
            topWeaknessCount: z.number().int().positive().default(5),
            minEvidenceQuestions: z.number().int().positive().default(2),
            persistentWeaknessMinAttempts: z.number().int().positive().default(2),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),
    // Presentation only: never read by scoring, timing, navigation or integrity.
    ui: z
      .object({
        profile: z.enum(["gate", "jee", "upsc", "generic"]).default("gate"),
        kind: z.enum(["full", "sectional", "quiz"]).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export type Ruleset = z.infer<typeof rulesetSchema>;
export type Issue = { severity: "error" | "warning"; location: string; message: string };
export class ExamImportError extends Error {
  issues: Issue[];
  constructor(issues: Issue[]) {
    super(issues.map((i) => `${i.location}: ${i.message}`).join("\n"));
    this.name = "ExamImportError";
    this.issues = issues;
  }
}
export function parseJson<T>(
  source: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  location: string,
): T {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    throw new ExamImportError([{ severity: "error", location, message: "Invalid JSON" }]);
  }
  const pending: { value: unknown; depth: number }[] = [{ value: raw, depth: 0 }];
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (depth > 60)
      throw new ExamImportError([
        { severity: "error", location, message: "JSON nesting exceeds 60 levels" },
      ]);
    if (value && typeof value === "object")
      for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
  }
  const result = schema.safeParse(raw);
  if (!result.success)
    throw new ExamImportError(
      result.error.issues.map((i) => ({
        severity: "error",
        location: `${location}.${i.path.join(".")}`,
        message: i.message,
      })),
    );
  return result.data;
}
export function flattenTopics(topics: Topic[]): Topic[] {
  return topics.flatMap((t) => [t, ...flattenTopics(t.children ?? [])]);
}
