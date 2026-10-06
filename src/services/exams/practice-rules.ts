import { z } from "zod";

/** Practice is always sequential and unscored. These are its optional controls. */
export const practiceRulesSchema = z
  .object({
    questionTimeLimitSeconds: z.number().int().min(1).max(36000).nullable().default(null),
    showElapsedTime: z.boolean().default(true),
    allowSkip: z.boolean().default(true),
  })
  .strict();

export type PracticeRules = z.infer<typeof practiceRulesSchema>;
export const DEFAULT_PRACTICE_RULES = practiceRulesSchema.parse({});

export function practiceFacts(rules: PracticeRules): string[] {
  return [
    "One question at a time",
    rules.questionTimeLimitSeconds === null
      ? "No time limit"
      : `${rules.questionTimeLimitSeconds}s per question · auto-advance`,
  ];
}
