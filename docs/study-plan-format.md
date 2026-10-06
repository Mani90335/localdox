# Study plans

> The app no longer imports study-plan bundles (`.plan.json`, `.practice.md`). An exam is now a `.xam` paper and an `.xrule`, organised in an Exam Workspace's folders, and practice is its own `.xp` file; see [Exam and practice files](../documentation/exam-files.md). Papers no longer have Learn, Practice or Review steps. This page remains as a reference for data made by the earlier screens.

Everything stays in this browser (IndexedDB). There are no accounts, dates, schedules or reminders.

## How a topic works

A plan is a list of **topics** (the JSON field is still called `days`, for compatibility). Topics are independent: learners pick any one from the **Topic** picker and keep their own schedule. Inside a topic, four steps run left to right in a horizontal stepper, each unlocked only when the one before it is done.

| Step        | The learner                                                                           | Done when                                                                          |
| ----------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1. Learn    | studies the topic in Localdox, may tick the checklist and write progress notes | they select **I've finished studying**                                             |
| 2. Practice | answers untimed questions; each is checked at once and shows the key and solution     | every practice question is answered (a topic without practice files skips this step) |
| 3. Exam     | takes the topic's timed exam                                                            | a graded attempt reaches the pass mark                                             |
| 4. Review   | reads every answer with its key and solution (mistakes first)                         | they select **Finish review**                                                      |

The app shows only the current step open. Finished steps fold to one line; later steps show what unlocks them.

The stepper shows each step as done, current or locked; the panel below shows one step at a time. A passed exam implies Steps 1 and 2, so practice added later never relocks a finished topic. Learners can add their own practice to any topic (**Practice → Add questions**).

## What to upload

Folders are ignored and files are routed by name, so names must be unique.

| File                                                         | Purpose                                                |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| `<plan>.plan.json`                                           | The plan (below).                                      |
| `<stem>.exam.json`, `<stem>.paper.md`, `<stem>.solutions.md` | One exam; see [Exam format](exam-format.md).           |
| `<id>.practice.md`                                           | Practice questions with their solutions (below).       |
| `<name>.taxonomy.json`                                       | Optional; only for custom difficulty labels or topics. |
| `.png` `.jpg` `.gif` `.webp` `.svg`                          | Images referenced by file name.                        |

Limits for a zip: 2000 files, 200 MB unpacked.

## Plan format

All objects reject unknown fields. Topics appear in array order in the picker.

```json
{
  "schemaVersion": 1,
  "id": "prob-basics",
  "name": "Probability basics",
  "description": "Two topics: learn, practise, pass the exam, review.",
  "days": [
    {
      "id": "conditional",
      "title": "Conditional probability",
      "examId": "prob-conditional",
      "summaryMd": "- Definition of $P(A \\mid B)$\n- Multiplication rule",
      "tasks": [{ "id": "lesson", "label": "Read the conditional probability lesson" }],
      "practice": ["prob-conditional"]
    }
  ]
}
```

| Field                                  | Meaning / default                                                                                                                                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                        | Required, exactly `1`.                                                                                                                                                                                     |
| `id`                                   | Required stable id. Importing an existing id is rejected to protect its progress.                                                                                                                          |
| `name`                                 | Required, at most 160 characters.                                                                                                                                                                          |
| `description`                          | Optional plain text, at most 2000 characters.                                                                                                                                                              |
| `days` | Required, 1–366 topics, unique ids. The name is historical; there is no schedule. |
| `days[].title`                         | Required, at most 160 characters.                                                                                                                                                                          |
| `days[].examId`                        | Required `meta.id` of the day's exam.                                                                                                                                                                      |
| `days[].summaryMd`                     | Optional Markdown shown in Step 1: what to study. A short topic list works best.                                                                                                                           |
| `days[].tasks`                         | Optional checklist, at most 50 `{ id, label }`.                                                                                                                                                            |
| `days[].practice`                      | Optional, at most 20 practice file ids (file name without `.practice.md`). Each must be in the upload. A practice question may not repeat a question of that topic's exam, because practice reveals answers. |
| `startDate`, `days[].estimatedMinutes` | Optional, accepted for older files, not shown.                                                                                                                                                             |

## Practice files

`<id>.practice.md` holds questions and solutions together, in any order. The syntax is the exam paper and solutions syntax; `section` is not needed.

```markdown
:::question{#p1 type=mcq marks=1}
Events $A$ and $B$ are independent with $P(A)=0.3$, $P(B)=0.5$. Find $P(A \cap B)$.

- 0.15
- 0.8
- 0.2
:::

:::solution{#p1 answer=A}
Independence: $P(A \cap B) = P(A)P(B) = 0.15$.
:::
```

Every question needs exactly one solution. MCQ option counts may vary. Distractor/trap tags are accepted and ignored. Practice never applies negative marks; an answer is correct, partly correct or not. Each question is checked once.

## Passing, attempts and new papers (exam JSON)

The plan does not own the pass mark. Each topic's `*.exam.json` must set:

```json
{
  "attempts": { "max": 3 },
  "progression": {
    "passPercentage": 70,
    "rewriteDifficultyPercentage": 50,
    "difficultyLabel": "hard"
  },
  "results": { "scoreVisibility": "immediate" }
}
```

- **Pass mark:** `progression.passPercentage` (default 80). Raw marks over available marks, penalties included. Display rounding never turns 79.99% into 80%.
- **Attempts:** `attempts.max`, a positive integer, per topic and per paper. Interrupted or expired attempts count; abandoned instructions don't.
- **After the last failed attempt:** the learner selects **I've revised this topic**, then picks or imports a **different** paper with at least `rewriteDifficultyPercentage`% of questions tagged `difficultyLabel`. The new paper keeps the original pass mark, attempt limit and policy, and starts fresh attempts. Content fingerprints (normalised bodies, options, types, marks; ignoring ids and order) stop a renamed or shuffled copy from resetting attempts.

The policy is pinned at import. Re-importing an exam with a lower threshold does not change an existing plan.

## Examples and checks

- `plans/foundations.plan.json` with `plans/foundations-*.practice.md` and `plans/number-line.svg`: the bundled example (reasoning quiz, then the GATE sample).
- `docs/gpt/example-course.md`: a complete two-topic upload, validated with the importers; the template the GPT builder copies.
- `tests/exam-study-plan.test.ts`: strict import, thresholds, attempts, revision, new papers, and the four-step gates (learn before practice, practice before exam, review after a pass) and independent topics.
- `tests/e2e/study-plans.spec.ts`: one upload → learn → exam to the attempt limit → revise → new paper → pass → review; a zip with practice, an image and a diagram; plain-language import errors.
