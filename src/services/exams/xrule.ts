/**
 * The two exam file formats.
 *
 * `.xrule` (JSON) holds everything about how an exam runs: time, pass mark,
 * attempts, marking, tools, and optionally the full engine ruleset.
 * `.xam` (Markdown) holds only content: questions, keys and solutions, in the
 * `# Practice` / `# Exam` + `:::question` / `:::solution` grammar that
 * `parseExamFile` reads.
 *
 * Reading an `.xrule` produces an `ExamSetup`, the rules the exam engine
 * already runs on, so nothing downstream knows a file was involved. Which
 * `.xrule` governs which paper is decided by the folders (`paper-plan.ts`).
 */
import { z } from "zod";
import { ExamImportError, parseJson, rulesetSchema } from "./schema.ts";
import {
  DEFAULT_SETUP,
  GATE_RULESET,
  GATE_SETUP,
  examSetupSchema,
  type ExamSetup,
} from "./exam-setup.ts";

export const isXrule = (name: string) => /\.xrule$/i.test(name);

const notWith = "only applies to custom rules. With a preset or a rules block, set it inside rules";
export const xruleSchema = z
  .object({
    /** Format version, so the file can evolve without guessing. */
    xrule: z.literal(1),
    name: z.string().trim().min(1, "Give the exam a name").max(160),
    /** What to study first; shown in Step 1 (Learn). Markdown. */
    summary: z.string().max(20000).optional(),
    /** Start from a built-in ruleset. */
    preset: z.literal("gate").optional(),
    /** The complete engine ruleset (docs/exam-format.md), for anything the fields below don't cover. */
    rules: rulesetSchema.optional(),
    durationMinutes: z.number().int().min(1).max(600).optional(),
    /** Exact number of exam questions the .xam must contain. */
    questionCount: z.number().int().min(1).max(500).optional(),
    passPercentage: z.number().min(0).max(100).optional(),
    maxAttempts: z.number().int().min(1).max(20).optional(),
    mcqPenalty: z.enum(["none", "third", "quarter"]).optional(),
    calculator: z.enum(["none", "basic", "scientific"]).optional(),
  })
  .strict()
  .superRefine((file, ctx) => {
    if (file.preset && file.rules)
      ctx.addIssue({ code: "custom", path: ["rules"], message: "Use preset or rules, not both" });
    if (file.preset || file.rules) {
      if (file.mcqPenalty !== undefined)
        ctx.addIssue({
          code: "custom",
          path: ["mcqPenalty"],
          message: `mcqPenalty ${notWith}.questionTypes`,
        });
      if (file.calculator !== undefined)
        ctx.addIssue({
          code: "custom",
          path: ["calculator"],
          message: `calculator ${notWith}.tools`,
        });
    }
  });
export type XruleFile = z.infer<typeof xruleSchema>;

const defined = <T extends object>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;

/**
 * Parse an `.xrule` into the setup the rest of the app uses. Fields left out
 * come from the preset, then from the `rules` block, then from the defaults.
 */
export function parseXrule(source: string, fileName = "exam.xrule"): ExamSetup {
  const file = parseJson(source, xruleSchema, fileName);
  const base = file.preset === "gate" ? GATE_SETUP : DEFAULT_SETUP;
  const fromRules = file.rules
    ? {
        durationMinutes: file.rules.timing.durationMinutes,
        passPercentage: file.rules.progression.passPercentage,
        maxAttempts: file.rules.attempts.max ?? undefined,
        questionCount: file.rules.sections.reduce((n, s) => n + s.questionCount, 0),
      }
    : {};
  const result = examSetupSchema.safeParse({
    ...base,
    ...defined(fromRules),
    ...defined({
      durationMinutes: file.durationMinutes,
      questionCount: file.questionCount,
      passPercentage: file.passPercentage,
      maxAttempts: file.maxAttempts,
      mcqPenalty: file.mcqPenalty,
      calculator: file.calculator,
    }),
    name: file.name,
    summaryMd: file.summary ?? "",
    ...defined({
      preset: file.preset,
      rootRules: file.rules ?? (file.preset === "gate" ? GATE_RULESET : undefined),
    }),
  });
  if (!result.success)
    throw new ExamImportError(
      result.error.issues.map((i) => ({
        severity: "error",
        location: `${fileName}.${i.path.join(".")}`,
        message: i.message,
      })),
    );
  return result.data;
}
