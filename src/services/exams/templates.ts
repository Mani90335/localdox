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
