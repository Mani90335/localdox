# Daily study plans

Open **Exam Sessions → Study plans**. Download the template or select **Try the example plan**. For your own plan, import its exam bundles into the exam library first, then import one `*.plan.json` file. The same browser stores tasks, notes, submitted attempts and the papers assigned to each day.

A day is unlocked only after the previous day's exam is passed. Tasks and notes are self-reported preparation; they cannot mark a day passed. The platform derives exam progress from recorded, graded attempts. An ordinary library attempt does not count toward a plan; launch its exam from the day's checkpoint.

## Plan format

All objects reject unknown fields. Day order is the array order, not a date or ID sort.

```json
{
  "schemaVersion": 1,
  "id": "my-first-week",
  "name": "Build probability foundations",
  "description": "A short daily learning routine.",
  "startDate": "2026-10-05",
  "days": [
    {
      "id": "day-1",
      "title": "Conditional probability",
      "examId": "probability-day-1",
      "estimatedMinutes": 45,
      "summaryMd": "Read the lesson, work through examples, then test your understanding.",
      "tasks": [
        { "id": "read", "label": "Read the conditional probability lesson" },
        { "id": "practice", "label": "Solve five examples without notes" }
      ]
    },
    {
      "id": "day-2",
      "title": "Bayes' theorem",
      "examId": "probability-day-2",
      "tasks": [{ "id": "review", "label": "Review yesterday's mistakes" }]
    }
  ]
}
```

| Field                     | Meaning / default                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`           | Required, exactly `1`.                                                                                        |
| `id`                      | Required stable plan ID. Importing an existing ID is rejected to protect its progress.                        |
| `name`                    | Required title, at most 160 characters.                                                                       |
| `description`             | Optional plain text, default empty, at most 2000 characters.                                                  |
| `startDate`               | Optional valid `YYYY-MM-DD` start date, used for display. It does not bypass or impose a calendar-based gate. |
| `days`                    | Required ordered array, 1–366 entries. IDs must be unique.                                                    |
| `days[].id`               | Required stable day ID.                                                                                       |
| `days[].title`            | Required title, at most 160 characters.                                                                       |
| `days[].examId`           | Required `meta.id` of an imported/bundled exam.                                                               |
| `days[].estimatedMinutes` | Optional positive integer for the planned study time.                                                         |
| `days[].summaryMd`        | Optional Markdown instructions, default empty, at most 20,000 characters.                                     |
| `days[].tasks`            | Optional checklist, default empty, at most 50 tasks.                                                          |
| `tasks[].id`, `.label`    | Required unique-per-day ID and label, at most 500 characters.                                                 |

The platform keeps each day's task selections and a note up to 5000 characters. Refresh resumes them. A passed day stays passed even if a task is later unchecked; mastery comes from the exam result.

## Passing, attempts and difficulty: configured only in exam JSON

The plan does **not** own or override passing/attempt/difficulty settings. Add these fields to each day's `*.exam.json`:

```json
{
  "attempts": {
    "max": 3,
    "resumeInterrupted": true
  },
  "progression": {
    "passPercentage": 80,
    "rewriteDifficultyPercentage": 50,
    "difficultyLabel": "hard"
  }
}
```

This is a fragment; the normal required exam fields are still needed. See [Exam format](exam-format.md).

- **Passing percentage** is `progression.passPercentage`, default **80**, configurable 0–100. Passing uses raw earned marks divided by available marks, including penalties. Display rounding never turns 79.999% into a pass at 80%.
- **MAX_ATTEMPTS** is the existing `attempts.max`, the single source of the limit. Study-plan exams require a positive finite value; `null` remains valid for standalone unlimited practice but is rejected for a study-plan checkpoint. The limit applies per day and per paper cycle. It counts started attempts, including interrupted/expired attempts, but not abandoned instructions or demo attempts.
- **Difficulty percentage** is `progression.rewriteDifficultyPercentage`, default **50**, configurable 0–100. It means the minimum percentage of replacement-paper **questions** tagged with `progression.difficultyLabel` (default `hard`). It does not mean a score boost, a question generator setting, or a percentage increase relative to an old paper.
- `difficultyLabel` must exist in the taxonomy. A taxonomy can use another label by configuring this field. Every replacement question must have a difficulty tag.
- Study exams require `results.scoreVisibility: "immediate"` so daily pass/fail is transparent. Solution-release settings still apply.

The original policy is pinned when the plan is imported. Reimporting an exam or lowering its threshold does not retroactively unlock an existing plan. Replacement papers must retain that day's original pass percentage, attempt limit and rewrite policy. Different plans can use different policies.

## Day states and retries

| State                  | What the user can do                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Locked**             | Preview the day's description. Cannot change preparation or start its exam before the preceding day passes.                         |
| **Ready to begin**     | Complete tasks, write notes, or start the assigned paper.                                                                           |
| **Exam in progress**   | Resume the same attempt, including an unfinished submission/reflection. Cannot start an overlapping attempt.                        |
| **Failed · try again** | The last graded attempt did not pass, but attempts remain. Review feedback and reattempt the same paper. The next day stays locked. |
| **Revision required**  | All allowed attempts were used without passing. A further attempt on that paper is blocked.                                         |
| **Passed**             | The exam met the configured threshold. The next day unlocks automatically.                                                          |

After reaching the attempt limit:

1. Review feedback and practice the missed concepts. Select **I've revised this topic** to record the revision acknowledgement.
2. Choose a previously imported new paper, or **Import new paper** with its ruleset, paper, solutions and taxonomy together.
3. The platform checks the taxonomy, unchanged progression policy, new paper content, and configured difficulty percentage. A failed check leaves the current state and attempt history intact.
4. A qualifying new paper starts a new cycle with the configured number of attempts. The day still requires a passing score; replacing a paper alone never unlocks the next day.

There is no automatic question generation. A user/author supplies the replacement paper. Difficulty tags are author-supplied; the platform checks their declared percentage, not the semantic difficulty of the questions.

Each paper gets a SHA-256 content fingerprint, without reading its solutions. It includes normalized question bodies, option text, question types and marks, ignoring IDs, question/option order, whitespace and diagnostic tags. Renaming IDs or shuffling an exhausted paper will not reset attempts. A fingerprint establishes content difference, not semantic originality.

Standalone attempts and attempts from a different plan/day do not count toward a gate. Day records retain their exam/paper snapshots, policy and cycles. Demo attempts are excluded. All graded attempts contribute to the normal weakness dashboard when their taxonomy and result release permit it.

## Examples and checks

- `plans/foundations.plan.json`: two-day sample referencing the reasoning quiz and GATE sample.
- `exams/section-quiz-rewrite/`: replacement reasoning paper with 100% hard-tagged questions. It satisfies the sample quiz's 50% minimum and retains its 80% / three-attempt policy.
- `tests/exam-study-plan.test.ts`: strict import, threshold boundary, manual progress isolation, maximum attempts, revision requirement, new-paper/difficulty validation, reuse protection and persistence.
- `tests/e2e/study-plans.spec.ts`: upload → checklist/notes → refresh → fail → retry → exhaust attempts → revise → validate new paper → pass → unlock next day, plus desktop/mobile rendering.

Storage is local to the browser profile. Changing device or clearing the site's storage does not transfer a plan. The feature is a personal learning workflow, not tamper-proof remote certification.
