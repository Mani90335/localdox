# Localdox Exam & Study-Plan File Reference

The exact files Localdox Exam Workspaces imports. Anything not described here is rejected: every JSON object is strict, so an unknown or misspelt field fails the import.

## 1. What gets uploaded

The learner uploads **one `.zip`** (preferred) or the loose files together. Folders inside the zip are ignored, so **every file name must be unique**.

| File                                     | Purpose                                                                                               |
| :--------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| `<plan>.plan.json`                       | The study plan: a list of topics. At most one per upload.                                      |
| `<stem>.exam.json`                       | Exam ruleset (timing, sections, marking).                                                             |
| `<stem>.paper.md`                        | The exam's questions. Same stem as its `.exam.json`.                                                  |
| `<stem>.solutions.md`                    | The exam's answer key and explanations. Same stem. Sealed until the learner submits.                  |
| `<id>.practice.md`                       | Practice questions **and** their solutions in one file. The file name minus `.practice.md` is its id. |
| `<name>.taxonomy.json`                   | Optional shared vocabulary of topics and difficulty labels.                                           |
| `*.png` `*.jpg` `*.svg` `*.webp` `*.gif` | Images referenced by name from a paper, solutions or practice file.                                   |

Upload order does not matter inside one upload. Exams referenced by a plan must be in the same upload or already imported.

## 2. How a topic works (what the plan drives)

The plan's `days` array holds **topics** (the field name is historical). Topics are independent; the learner picks one and keeps their own schedule offline. Each topic has four steps, shown left to right and unlocked strictly in order:

1. **Learn**: the learner studies the topic (in Localdox), may tick a checklist and write notes, then marks the step done.
2. **Practice**: untimed questions from the topic's practice files; each answer is checked immediately against the key and its solution. Done when every practice question has been answered. A topic with no practice files skips this step.
3. **Exam**: the topic's timed exam. Done when the learner scores at least the pass mark. Attempts are limited; after the last failed attempt the learner revises and must use a different paper (see 4.3).
4. **Review**: the learner goes through every answer with the key and solution, then finishes the topic.

There are no dates, schedules or reminders.

## 3. Study plan: `<plan>.plan.json`

```json
{
  "schemaVersion": 1,
  "id": "gate-da-2027",
  "name": "GATE DA 2027",
  "description": "Topics to learn, practise and test.",
  "days": [
    {
      "id": "conditional",
      "title": "Conditional probability",
      "examId": "gate-da-conditional",
      "summaryMd": "- Definition of $P(A \\mid B)$\n- Multiplication rule\n- Independence vs mutual exclusivity",
      "tasks": [
        { "id": "notes", "label": "Read the conditional probability lesson" },
        { "id": "examples", "label": "Work the three solved examples" }
      ],
      "practice": ["gate-da-conditional"]
    }
  ]
}
```

| Field                     | Rule                                                                                                                                                                                |
| :------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`           | Exactly `1`.                                                                                                                                                                        |
| `id`                      | Stable id: letters, digits, `.`, `_`, `-`; starts with a letter or digit. Re-importing the same id is refused (it protects progress), so a revised plan needs a new id.             |
| `name`                    | 1–160 characters.                                                                                                                                                                   |
| `description`             | Optional, up to 2000 characters, plain text.                                                                                                                                        |
| `days`                    | 1–366 entries, unique `id`s.                                                                                                                                                        |
| `days[].title`            | 1–160 characters.                                                                                                                                                                   |
| `days[].examId`           | `meta.id` of the day's exam. Required.                                                                                                                                              |
| `days[].summaryMd`        | Optional Markdown: what to study (Step 1). Keep it a short topic list; the app already tells the learner what to do.                                                                |
| `days[].tasks`            | Optional checklist, up to 50 `{ "id", "label" }`.                                                                                                                                   |
| `days[].practice`         | Optional, up to 20 practice file ids (the file name without `.practice.md`). Every listed file must be uploaded. A practice question must not repeat a question of that topic's exam. |
| `days[].estimatedMinutes` | Optional positive integer (not shown).                                                                                                                                              |
| `startDate`               | Optional `YYYY-MM-DD` (not shown). Prefer omitting it.                                                                                                                              |

## 4. Exam ruleset: `<stem>.exam.json`

### 4.1 Template for a study-plan exam

```json
{
  "schemaVersion": 2,
  "meta": {
    "id": "gate-da-conditional",
    "name": "Conditional probability",
    "version": "1",
    "instructionsMd": "Ten questions in 30 minutes. MCQ wrong answers cost one third of their marks."
  },
  "timing": { "mode": "global", "durationMinutes": 30, "warnAtMinutesLeft": [5, 1] },
  "sections": [{ "id": "main", "name": "Conditional probability", "questionCount": 10 }],
  "questionTypes": {
    "mcq": { "optionCount": 4, "negativeMarking": { "fractionOfMarks": [1, 3] } },
    "msq": { "scoring": "all_or_nothing" },
    "nat": { "inputMode": "virtual_keypad" }
  },
  "attempts": { "max": 3 },
  "progression": {
    "passPercentage": 70,
    "rewriteDifficultyPercentage": 50,
    "difficultyLabel": "hard"
  },
  "results": { "scoreVisibility": "immediate", "solutionsRelease": "immediate_after_submit" },
  "diagnostics": { "enabled": false },
  "ui": { "profile": "gate", "kind": "quiz" }
}
```

### 4.2 Fields that matter

| Field                                                         | Rule                                                                                                                                                                                                |
| :------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta.id`                                                     | Unique exam id. A plan's `examId` points here.                                                                                                                                                      |
| `meta.instructionsMd`                                         | Optional Markdown shown before the exam. Do not repeat the title or the marking rules; the app shows those.                                                                                         |
| `timing.mode`                                                 | `global` (one clock) or `per_section` (each section needs `durationMinutes`, and they must sum to `timing.durationMinutes`; finished sections lock).                                                |
| `timing.warnAtMinutesLeft`                                    | Minutes-left warnings. Thresholds at or above the exam length are ignored.                                                                                                                          |
| `sections[].questionCount`                                    | Must equal the number of paper questions in that section, unless `"sampleMode": true` at the top level.                                                                                             |
| `questionTypes`                                               | Only the types used. **Every MCQ must have exactly `mcq.optionCount` options (default 4).** MSQ may vary (2–26). NAT has no options.                                                                |
| `negativeMarking`                                             | `null` (none), `{ "fractionOfMarks": [1, 3] }` or `{ "marks": 0.5 }`.                                                                                                                               |
| `msq.scoring`                                                 | `all_or_nothing` or `partial_no_wrong`.                                                                                                                                                             |
| `nat.inputMode`                                               | `virtual_keypad` (GATE-style on-screen keypad) or `keyboard`.                                                                                                                                       |
| `attempts.max`                                                | **Required for study-plan exams**: a positive integer.                                                                                                                                              |
| `progression.passPercentage`                                  | Pass mark 0–100 (default 80).                                                                                                                                                                       |
| `progression.rewriteDifficultyPercentage`, `.difficultyLabel` | After the last failed attempt the replacement paper must have at least this % of questions tagged with this difficulty. The label must exist in the taxonomy (`easy`, `medium`, `hard` by default). |
| `results.scoreVisibility`                                     | Must be `immediate` for study-plan exams.                                                                                                                                                           |
| `integrity`                                                   | Optional: `{ "requireFullscreen": true, "maxTabSwitches": 3, "onViolation": "warn_then_autosubmit", "blockCopyPaste": true }`. Use for full mock tests only.                                        |
| `tools.calculator`                                            | `none` (default), `basic` or `scientific`.                                                                                                                                                          |
| `sampleMode`                                                  | `true` when the paper is a shorter sample of a real pattern. The learner is offered time scaled to the questions present.                                                                           |
| `ui.profile`                                                  | `gate` (default), `jee`, `upsc`, `generic`. Wording and palette shapes only.                                                                                                                        |
| `ui.kind`                                                     | `full`, `sectional` or `quiz`; drives the library filter.                                                                                                                                           |
| `diagnostics`                                                 | Use `{ "enabled": false }`. Analytics are not shown to learners.                                                                                                                                    |

### 4.3 Replacement papers

To make retakes possible after the attempt limit, ship one or more **extra exams with the same rules but different questions**, more of them tagged `difficulty=hard`. They need the same `attempts`, `progression` and taxonomy as the original. They are imported to the library; the learner picks one after revising.

## 5. Paper: `<stem>.paper.md`

Only `:::question` blocks at the top level. Everything belongs inside a block. Closing `:::` sits alone at column 0.

```markdown
:::question{#q1 section=main type=mcq marks=2 difficulty=medium}
Given $P(A \cap B) = 0.2$ and $P(B) = 0.5$, find $P(A \mid B)$.

- 0.1
- 0.2
- 0.4
- 0.7
:::

:::question{#q2 section=main type=nat marks=1 difficulty=easy}
A fair die is rolled. What is $P(\text{even})$? Give a decimal.
:::
```

- Attributes: `#id` (unique), `section` (a section id), `type` (`mcq`, `msq`, `nat`), `marks` (positive). Optional: `difficulty` (taxonomy label; tag every question if you plan replacement papers), `topic` (only with a taxonomy that defines it), `time` (expected seconds), `tags` (comma-separated).
- The **last list** in the block is the options, labelled A, B, C… in order. Lists earlier in the body stay as text.
- NAT questions have no option list.

## 6. Solutions: `<stem>.solutions.md`

```markdown
:::solution{#q1 answer=C}
$P(A \mid B) = \dfrac{P(A \cap B)}{P(B)} = \dfrac{0.2}{0.5} = 0.4$.
:::

:::solution{#q2 answer=0.5 tolerance=0.01}
Three of six faces are even, so $3/6 = 0.5$.
:::
```

- Exactly one solution per question, same id.
- MCQ: one label, `answer=C`. MSQ: quoted labels, `answer="A,C"`. NAT: a number (`answer=0.5`, optional `tolerance=0.01`) or an inclusive range in quotes (`answer="2.3:2.5"`, no tolerance with a range).
- Explanations are Markdown and should show the working, not only the result.

## 7. Practice: `<id>.practice.md`

Questions and solutions together, usually each solution right after its question. `section` is not needed.

```markdown
:::question{#p1 type=mcq marks=1}
Events $A$ and $B$ are independent with $P(A)=0.3$, $P(B)=0.5$. Find $P(A \cap B)$.

- 0.15
- 0.8
- 0.2
- 0.35
:::

:::solution{#p1 answer=A}
Independence means $P(A \cap B) = P(A)P(B) = 0.3 \times 0.5 = 0.15$.
:::
```

Same answer rules as solutions. MCQ option counts may vary in practice files. Aim for 8–20 practice questions per day, easier than the exam, covering every topic in `summaryMd`.

## 8. Rich content inside questions, options and solutions

- **Math:** `$…$` inline, `$$…$$` display (KaTeX).
- **Diagrams:** a ```mermaid fence (flowchart, sequence, state, class, ER). Rendered static and sanitised: no `click`, no HTML in labels, no `style`/`classDef`. Quote labels with punctuation.
- **Charts:** a ```chart fence with strict JSON: `{"type":"bar"|"line"|"scatter"|"pie","title":"…","data":[{…}],"series":["key"] or [{"key":"…","name":"…"}],"xKey":"…"}`. Series values must be numbers; at most 12 series; prefer 1–3.
- **Images:** `![Describe the image](graph.svg)` with the file in the same upload. PNG, JPG, GIF, WebP or SVG. Always write meaningful alt text. HTTPS URLs also work but break offline; prefer files. Prefer SVG you write yourself for graphs, number lines and geometry.
- **Code:** fenced with a language; shown as text, never run.
- **Not supported:** raw HTML, links that navigate, interactive or executable fences.

## 9. Taxonomy (optional): `<name>.taxonomy.json`

Only needed for custom difficulty labels or `topic=` tags. Referenced from an exam with `"diagnostics": { "enabled": false, "taxonomyRef": "<name>.taxonomy.json" }`.

```json
{
  "id": "gate-da",
  "difficulty": ["easy", "medium", "hard"],
  "causes": [{ "id": "concept_gap", "name": "Concept gap" }],
  "topics": [
    {
      "id": "prob",
      "name": "Probability",
      "children": [{ "id": "prob.cond", "name": "Conditional probability" }]
    }
  ],
  "traps": []
}
```

## 10. Self-check before delivering

- Every JSON file parses (no comments, no trailing commas) and has no fields beyond this reference.
- Every plan `examId` matches an exam `meta.id`; every `practice` id matches a `.practice.md` file name.
- Every `.exam.json` has a `.paper.md` and `.solutions.md` with the same stem.
- Section `questionCount`s match the paper (or `sampleMode: true`); every MCQ has `optionCount` options.
- Every question has exactly one solution; answers use valid labels; MSQ answers are quoted.
- Study-plan exams have `attempts.max` and `results.scoreVisibility: "immediate"`.
- Every image referenced by name is included; file names are unique.
- Closing `:::` lines are alone at column 0.
