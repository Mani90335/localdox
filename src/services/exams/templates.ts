/**
 * What a new `.xam`, `.xrule` or `.xp` starts with. Plain strings with no
 * imports, so the reader can create these files without loading the exam
 * engine. `tests/exam-paper-plan.test.ts` and `tests/practice-files.test.ts`
 * prove each reads cleanly.
 */

/** A starter `.xrule`: the default rules (`DEFAULT_SETUP`), named. */
export function xruleTemplate(name: string): string {
  return `${JSON.stringify(
    {
      xrule: 1,
      name: name.trim() || "Exam",
      durationMinutes: 30,
      passPercentage: 70,
      maxAttempts: 3,
      mcqPenalty: "none",
      calculator: "none",
    },
    null,
    2,
  )}\n`;
}

/**
 * A GATE ruleset: the built-in GATE preset (sections, marking, keypad,
 * calculator, Save & Next), with its paper-level facts spelled out so they
 * are visible and easy to change for a shorter mock.
 */
export function gateXruleTemplate(name: string): string {
  return `${JSON.stringify(
    {
      xrule: 1,
      name: name.trim() || "GATE mock",
      summary: [
        "GATE pattern: 65 questions, 100 marks, 3 hours.",
        "",
        "- **General Aptitude**: 10 questions (5 of 1 mark, 5 of 2 marks).",
        "- **Subject**: 55 questions (25 of 1 mark, 30 of 2 marks).",
        "- A wrong MCQ costs a third of its marks. MSQ and NAT answers are never penalised, and an MSQ scores only when every correct option is chosen.",
        "- An answer counts only once it is saved with **Save & next** or **Mark for review & next**.",
      ].join("\n"),
      preset: "gate",
      durationMinutes: 180,
      questionCount: 65,
      passPercentage: 25,
      maxAttempts: 3,
    },
    null,
    2,
  )}\n`;
}

/** Rulesets Settings ▸ Exam rules can start from. */
export function practiceXruleTemplate(name: string): string {
  return `${JSON.stringify(
    {
      xrule: 1,
      name: name.trim() || "Practice",
      practice: {
        questionTimeLimitSeconds: null,
        showElapsedTime: true,
        allowSkip: true,
      },
    },
    null,
    2,
  )}\n`;
}

export const RULES_TEMPLATES = {
  default: xruleTemplate,
  gate: gateXruleTemplate,
  practice: practiceXruleTemplate,
} as const;
export type RulesTemplate = keyof typeof RULES_TEMPLATES;

/** A starter `.xam`: one exam question of each type, with its key. */
export const XAM_TEMPLATE = `:::question{#q1 type=mcq marks=2}
What is $3 \\times 4$?

- 7
- 12
- 34
- 43
:::

:::solution{#q1 answer=B}
$3 \\times 4 = 12$.
:::

:::question{#q2 type=msq marks=2}
Select every prime number.

- 2
- 4
- 5
- 9
:::

:::solution{#q2 answer="A,C"}
2 and 5 have no divisors other than 1 and themselves.
:::

:::question{#q3 type=nat marks=1}
Write $\\frac{1}{4}$ as a decimal.
:::

:::solution{#q3 answer=0.25}
$1 \\div 4 = 0.25$.
:::
`;

/**
 * A starter `.xp`: practice needs no rules file. A heading groups the
 * questions below it, and `marks` may be left out.
 */
export const XP_TEMPLATE = `# Warm-up

:::question{#even type=mcq}
Which number is even?

- 7
- 12
- 15
- 21
:::

:::solution{#even answer=B}
12 is divisible by 2.
:::

:::question{#primes type=msq}
Select every prime number.

- 2
- 4
- 5
- 9
:::

:::solution{#primes answer="A,C"}
2 and 5 have no divisors other than 1 and themselves.
:::

:::question{#quarter type=nat}
Write $\\frac{1}{4}$ as a decimal.
:::

:::solution{#quarter answer=0.25}
$1 \\div 4 = 0.25$.
:::
`;
