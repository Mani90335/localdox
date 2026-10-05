# Exam Session format (schema version 2)

Open an **Exam Workspace** in Localdox, or use the compatibility link `/exams`. Create a GATE variation and upload one Markdown file, or import existing ruleset, paper, solutions and taxonomy files together through the Library. Data stays offline in the browser and is scoped to its owning workspace. See [Exam Workspaces](../documentation/exam-sessions.md) for workspace setup.

For bundled content, add files to `exams/<exam-id>/` and rebuild. Vite discovers every `*.exam.json` automatically; no registry or engine code change is needed. Companion files must share a stem (`quiz.exam.json`, `quiz.paper.md`, `quiz.solutions.md`). Shared taxonomies live in `exams/taxonomies/`. Import also works without rebuilding. Taxonomy references resolve by their filename within the selected files; duplicate filenames are rejected. Reimporting an exam replaces its library entry; existing attempts retain their own immutable copy.

The GATE sample follows the **recent GATE DA pattern**, not a verified 2027 specification. Its topic list is an approximation. **Verify both numbers and taxonomy against the official GATE 2027 brochure and syllabus**, and align the DA topics with the official syllabus before authoring a full paper. The 12-question sample uses `sampleMode: true`; composition warnings are expected.

Study plans link exams into an ordered path where each day is learn → practice → exam → review. See [Study plans](study-plan-format.md) for the upload format, practice files and the revision workflow. Diagnostics (rules, reflection, weakness reports) still run in the engine for compatibility but are no longer shown; new exams can set `"diagnostics": { "enabled": false }`.

## Validation and sealed solutions

JSON objects are strict: unknown fields, unsupported schema versions, wrong types and invalid rules are errors. Reports include field paths or Markdown line numbers. Paper section counts, composition, question types, option counts, duplicate IDs and taxonomy references are checked before starting. Missing `topic` or `difficulty` produces a warning and excludes the question from topic analytics.

**The requirement to inspect solutions before starting conflicts with the requirement never to load them until submission. The latter takes precedence.** At import, only the presence of a solution file is checked. Imported solutions remain opaque `Blob`s in IndexedDB; bundled solutions are separate, non-inlined assets. Only a persisted submitted session can request/read/parse them. Immediately after submission, the solution validator checks IDs, answers, traps, wrong-option mappings and NAT values. A failure leaves the submission locked and retryable, with a readable report and a control to attach a corrected solutions file. No result is fabricated. Authoring tools may call `importSolutions` directly to validate content outside a live exam.

Solutions release governs review and the diagnostic report, which can reveal trap metadata. Scoring still requires parsing the key after submission. This is local practice, not secure proctoring: the owner of the files/browser can inspect local assets or change the system clock. No backend secrecy is claimed.

## Ruleset fields and defaults

All blocks except `schemaVersion`, `meta`, `timing`, `sections`, and `questionTypes` are optional. Nested fields described as required have no default. Numbers must be finite. IDs use letters, digits, `.`, `_`, and `-`, beginning with a letter or digit.

| Field                                              | Values / default                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                                    | Required, exactly `2`.                                                                                                                                                                                                                                                                                                                              |
| `sampleMode`                                       | `false`. Downgrades paper count/composition mismatches to warnings. When the paper has fewer questions than the pattern, the instructions offer **scaled time**: the official duration × questions present ÷ pattern questions, in whole minutes (12 of 65 GATE questions → 33 of 180 minutes). The choice is stored on the attempt as `timeScale`. |
| `meta.id`                                          | Required stable exam ID; also used for attempt limits.                                                                                                                                                                                                                                                                                              |
| `meta.name`                                        | Required display name.                                                                                                                                                                                                                                                                                                                              |
| `meta.version`                                     | Required string, saved with each attempt.                                                                                                                                                                                                                                                                                                           |
| `meta.instructionsMd`                              | Markdown; defaults to an acknowledgement prompt.                                                                                                                                                                                                                                                                                                    |
| `timing.mode`                                      | Required: `global` or `per_section`.                                                                                                                                                                                                                                                                                                                |
| `timing.durationMinutes`                           | Required positive duration. For per-section mode, equals the sum of section durations.                                                                                                                                                                                                                                                              |
| `timing.autoSubmitOnExpiry`                        | `true`. When false, expiry freezes answers and waits for manual submission. Per-section expiry advances to the next section; this option controls final submission.                                                                                                                                                                                 |
| `timing.pausable`                                  | `false`. True enables pause/resume and shifts the deadline by the paused duration. False exposes no pause path.                                                                                                                                                                                                                                     |
| `timing.warnAtMinutesLeft`                         | `[10, 1]`. Positive minute thresholds; the timer displays the closest crossed warning.                                                                                                                                                                                                                                                              |
| `sections[]`                                       | Required nonempty ordered array. IDs must be unique.                                                                                                                                                                                                                                                                                                |
| `sections[].id`, `.name`                           | Required section ID and display name.                                                                                                                                                                                                                                                                                                               |
| `sections[].questionCount`                         | Required positive integer.                                                                                                                                                                                                                                                                                                                          |
| `sections[].durationMinutes`                       | Required in per-section mode, otherwise optional. Each section receives its own absolute deadline. Finishing early forfeits unused time.                                                                                                                                                                                                            |
| `sections[].composition`                           | Optional list of `{marks, count}` positive values. Counts must sum to `questionCount`.                                                                                                                                                                                                                                                              |
| `questionTypes`                                    | Required object with at least one of `mcq`, `msq`, `nat`. Omitted types are forbidden.                                                                                                                                                                                                                                                              |
| `questionTypes.mcq.optionCount`                    | `4`; integer from 2 to 26.                                                                                                                                                                                                                                                                                                                          |
| `questionTypes.mcq.selection`                      | `single` only.                                                                                                                                                                                                                                                                                                                                      |
| `questionTypes.msq.optionCount`                    | Optional integer 2–26; otherwise any count in that range.                                                                                                                                                                                                                                                                                           |
| `questionTypes.msq.selection`                      | `multiple` only.                                                                                                                                                                                                                                                                                                                                    |
| `questionTypes.msq.scoring`                        | `all_or_nothing` default, or `partial_no_wrong`. Partial credit = marks × selected correct count / total correct count, only if no wrong option was selected.                                                                                                                                                                                       |
| `questionTypes.nat.inputMode`                      | `virtual_keypad` default, or `keyboard`.                                                                                                                                                                                                                                                                                                            |
| `questionTypes.*.negativeMarking`                  | `null` default; or `{ "fractionOfMarks": [numerator, denominator] }`; or `{ "marks": n }`. Numerator/fixed penalty nonnegative, denominator positive. Applied to wrong answers; partial and unanswered answers receive no penalty. A 2-mark MCQ with `[1,3]` loses exactly 2/3 marks before display rounding.                                       |
| `navigation.free`                                  | `true`. False allows only the next question.                                                                                                                                                                                                                                                                                                        |
| `navigation.sectionLocking`                        | `false`. True locks a global-timer section when leaving it. Per-section mode always locks completed sections.                                                                                                                                                                                                                                       |
| `navigation.markForReview`                         | `true`. Enables mark/unmark.                                                                                                                                                                                                                                                                                                                        |
| `navigation.markedForReviewAnswerCounts`           | `true`. False scores marked answers as unanswered.                                                                                                                                                                                                                                                                                                  |
| `navigation.clearResponse`                         | `true`. Enables clearing an existing response.                                                                                                                                                                                                                                                                                                      |
| `navigation.shuffleQuestions`                      | `false`. Shuffles within sections once, persists order.                                                                                                                                                                                                                                                                                             |
| `navigation.shuffleOptions`                        | `false`. Shuffles display order once, preserves canonical option labels and answer mapping.                                                                                                                                                                                                                                                         |
| `tools.calculator`                                 | `none` default, `basic`, or `scientific`. Scientific supports arithmetic, powers, factorial, `sin`, `cos`, `tan`, `sqrt`, `log` (base 10), `ln`, `abs`, `exp`, `pi`, and `e`. Trigonometry uses radians. No JavaScript evaluation.                                                                                                                  |
| `integrity.requireFullscreen`                      | `false`. When true, starting requires a successful browser fullscreen request; exits are violations.                                                                                                                                                                                                                                                |
| `integrity.maxTabSwitches`                         | `null` (unlimited) or nonnegative integer. Shared allowance for hidden-tab and required-fullscreen-exit violations.                                                                                                                                                                                                                                 |
| `integrity.onViolation`                            | `warn` default; `autosubmit` submits on first violation; `warn_then_autosubmit` submits when the count **exceeds** the allowance.                                                                                                                                                                                                                   |
| `integrity.blockCopyPaste`                         | `false`; when true blocks copy, cut and paste during the exam.                                                                                                                                                                                                                                                                                      |
| `integrity.blockContextMenu`                       | `false`.                                                                                                                                                                                                                                                                                                                                            |
| `results.scoreVisibility`                          | `immediate` default, `after_release`, or `hidden`.                                                                                                                                                                                                                                                                                                  |
| `results.solutionsRelease`                         | `immediate_after_submit` default, `at_time`, or `never`.                                                                                                                                                                                                                                                                                            |
| `results.releaseAt`                                | Optional ISO-8601 timestamp with timezone, required for `at_time` or `after_release`.                                                                                                                                                                                                                                                               |
| `results.showSectionBreakdown`                     | `true`.                                                                                                                                                                                                                                                                                                                                             |
| `results.showTimePerQuestion`                      | `true`.                                                                                                                                                                                                                                                                                                                                             |
| `results.rounding`                                 | `2`; integer 0–8. Display only; scoring/aggregation retain precision.                                                                                                                                                                                                                                                                               |
| `attempts.max`                                     | `null` or positive integer. Counts started, non-demo standalone attempts across versions of the same exam ID. For study plans, a finite maximum is required and applies per day, per paper cycle; see the study-plan guide.                                                                                                                         |
| `attempts.resumeInterrupted`                       | `true`. False finalizes an interrupted in-progress attempt on reopening. Closing an unpausable session never extends its deadline.                                                                                                                                                                                                                  |
| `progression.passPercentage`                       | `80`; number 0–100. Raw percentage required to pass a study day.                                                                                                                                                                                                                                                                                    |
| `progression.rewriteDifficultyPercentage`          | `50`; number 0–100. Minimum fraction of questions at the configured difficulty in a replacement paper after exhausting attempts.                                                                                                                                                                                                                    |
| `progression.difficultyLabel`                      | `hard`. Taxonomy difficulty used to measure replacement-paper composition.                                                                                                                                                                                                                                                                          |
| `diagnostics.enabled`                              | `true`. False suppresses rules, reflection and diagnostic UI.                                                                                                                                                                                                                                                                                       |
| `diagnostics.taxonomyRef`                          | Optional relative file reference. Cannot be combined with inline `taxonomy`.                                                                                                                                                                                                                                                                        |
| `diagnostics.taxonomy`                             | Optional inline taxonomy (format below). If neither is specified, a `general` taxonomy supplies standard causes and easy/medium/hard, with no topics or traps.                                                                                                                                                                                      |
| `diagnostics.capture.eventLog`                     | `true`. Controls detailed event-log visibility in results. Core replay events are always persisted because timing, responses and reload recovery depend on them.                                                                                                                                                                                    |
| `diagnostics.capture.confidence.mode`              | `post_submit` default; `off` or `in_exam`. Post-submit reflection occurs before answers/results are shown and can be skipped.                                                                                                                                                                                                                       |
| `diagnostics.capture.confidence.levels`            | `["sure", "unsure", "guess"]`; a nonempty subset of these labels.                                                                                                                                                                                                                                                                                   |
| `diagnostics.capture.selfTagging`                  | `true`; enables taxonomy cause/trap selection and notes in the mistake journal.                                                                                                                                                                                                                                                                     |
| `diagnostics.pacing.expectedSeconds.derive`        | `proportional_to_marks` only. Expected seconds = total duration seconds / actual paper marks × question marks. Paper `time` overrides this.                                                                                                                                                                                                         |
| `diagnostics.pacing.slowRatio`, `.fastRatio`       | `1.5`, `0.4`; positive numbers used by the default pacing rules.                                                                                                                                                                                                                                                                                    |
| `diagnostics.causePriority`                        | `["trap","overconfidence","careless","time_pressure","concept_gap","guess"]`. First matching cause wins. An unlisted fired cause follows listed causes.                                                                                                                                                                                             |
| `diagnostics.impact.marksLostWeight`               | `1`; nonnegative.                                                                                                                                                                                                                                                                                                                                   |
| `diagnostics.impact.timeWastedPerMinuteWeight`     | `0.25`; nonnegative.                                                                                                                                                                                                                                                                                                                                |
| `diagnostics.disabledRules`                        | `[]`; rule IDs to disable, including overrides.                                                                                                                                                                                                                                                                                                     |
| `diagnostics.rules`                                | `[]`; extends default rules. Matching ID replaces the default; duplicate IDs inside this array are invalid.                                                                                                                                                                                                                                         |
| `diagnostics.report.topWeaknessCount`              | `5`; positive integer, maximum action items.                                                                                                                                                                                                                                                                                                        |
| `diagnostics.report.minEvidenceQuestions`          | `2`; positive integer. Weakness entries below this count are omitted unless backed by severity 3 evidence.                                                                                                                                                                                                                                          |
| `diagnostics.report.persistentWeaknessMinAttempts` | `2`; positive integer. Dashboard persistence threshold, taken from the selected taxonomy's exam configuration. Keep consistent across exams sharing a taxonomy.                                                                                                                                                                                     |
| `ui.profile`                                       | `gate` default; `jee`, `upsc` or `generic`. Presentation only: palette glyph shapes and action-button wording in the exam runner. Never affects scoring, timing, navigation or integrity. Attempts stored before this field existed render as `gate`.                                                                                               |
| `ui.kind`                                          | Optional `full`, `sectional` or `quiz`. Drives the library's type filter. When absent: under 60 minutes is a quiz, one section is sectional, otherwise a full paper.                                                                                                                                                                                |

## Paper and solutions

Use remark-directive containers at the top level. Put document prose/headings inside containers; unsupported top-level content is rejected. Leave closing delimiters at column zero (generic Markdown formatters may otherwise indent them into the last option).

```markdown
:::question{#prob-1 section=DA type=mcq marks=2 topic=prob.bayes difficulty=medium time=200 tags=skill.calculation,revision}
Given $P(A\cap B)=0.2$ and $P(B)=0.5$, find $P(A\mid B)$.

- 0.2
- 0.1
- 0.4
- 0.7
:::
```

Required question attributes: `#id`, `section`, `type`, `marks`. Optional: `topic` and `difficulty` from the taxonomy; positive `time` in seconds; comma-separated free `tags`. Diagnostic attributes never appear during the exam. IDs are unique. The **last top-level list** is the options for MCQ/MSQ; earlier lists remain part of the body. Labels are canonical A, B, C, etc. NAT has no option list (body lists remain prose). Markdown source ranges preserve math, nested lists and fences.

```markdown
:::solution{#prob-1 answer=C}
By definition, $P(A\mid B)=P(A\cap B)/P(B)=0.4$.

::distractor{option=A trap=conditional_vs_joint note="Used the joint probability."}
::distractor{option=B trap=sign_error note="Multiplied instead of dividing."}
:::
```

Every paper question must have exactly one solution with a matching ID. MCQ answers are one label (`B`); MSQ answers are comma-separated quoted labels (`"A,C"`), without duplicates. NAT answers are numeric (`"2.4"`) with optional nonnegative absolute `tolerance=0.01`, or an inclusive range (`"2.3:2.5"`). A range cannot also specify tolerance. Numeric inputs support signs, decimals and exponent notation; empty/NaN/Infinity are not answers. Floating-point comparison accommodates machine rounding at the tolerance boundary.

Distractor leaf directives belong directly inside their solution. They require `trap` and exactly one of `option` (MCQ/MSQ) or numeric `value` (NAT), with optional `note`. Correct options/accepted NAT values cannot be distractors. NAT trap matching uses the recorded numeric value exactly. All selected MSQ distractors are retained; `selectedTrap` is the first mapping in solution order for DSL evaluation. Missing MCQ distractors produce a warning. An incomplete MSQ selection is not automatically a known trap; infer it through a custom rule or self-report instead of mapping a correct option as wrong.

Questions, options, solutions and practice files support Markdown, GFM, KaTeX math, Mermaid, JSON chart fences and images. HTML and executable fences are inert. Links do not navigate away from the exam. Mermaid renders as a static figure with Mermaid's **strict** security level (sanitised labels, no click handlers), because exam files may come from anyone; click a diagram to enlarge it. The chart format is:

````markdown
```chart
{"type":"bar","data":[{"name":"A","value":3},{"name":"B","value":7}],"series":[{"key":"value","name":"Count","color":"#3b82f6"}],"xKey":"name"}
```
````

`type`: `bar`, `line`, `scatter`, or `pie`. `data`: 1–2000 flat rows of string/number/null cells. `series`: 1–12 key strings or `{key, name?, color?}` objects; colors must be hex. Series values are numeric; `xKey` must exist. Pie uses the first series. Scatter uses numeric `xKey` and each series as a y-axis value. Optional `title` captions the chart. Without explicit colours, series use the validated categorical order (blue, orange, aqua, …), stepped for dark mode. Unknown fields or invalid data display an inline note instead of the chart. Chart code is never evaluated.

**Images.** Write `![Alt text](graph.svg)` and include `graph.svg` in the same import (PNG, JPG, GIF, WebP or SVG; bundled exams: put it in the exam's folder). Images referenced by a paper attach to that exam; images no paper mentions (for example ones used only by sealed solutions) attach to every exam in the import. `https:` URLs and inline `data:image/…` URIs also work. Anything else shows a placeholder. Images render through `<img>`, so an SVG cannot run script; click to enlarge.

## Taxonomy

```json
{
  "id": "my-syllabus",
  "difficulty": ["easy", "medium", "hard"],
  "causes": [
    { "id": "concept_gap", "name": "Concept gap" },
    { "id": "trap", "name": "Known trap" },
    { "id": "careless", "name": "Careless" },
    { "id": "time_pressure", "name": "Time pressure" },
    { "id": "overconfidence", "name": "Overconfidence" },
    { "id": "guess", "name": "Guess" }
  ],
  "topics": [
    { "id": "math", "name": "Mathematics", "children": [{ "id": "math.signs", "name": "Signs" }] }
  ],
  "traps": [{ "id": "sign_error", "name": "Sign error", "cause": "careless" }]
}
```

All fields above are required; topics and traps may be empty. Topic `children` is optional and recursive. Topic, cause and trap IDs must be unique in their respective vocabularies. Trap causes must exist. Enabled rule causes and cause priorities must exist; retain `concept_gap` for fallback attribution. A different vocabulary can disable/override built-in rules and configure its own priority. Topic analytics use the exact question topic rather than double-counting parent categories. Shared taxonomy IDs allow cross-exam aggregation; use a new taxonomy ID when changing the meaning of its IDs.

## Session, event log and signals

State flow: `idle → instructions → in_progress → submitting → reflection → submitted → review`. Reflection is conditional. Instructions require acknowledgement. Grading is retryable from `submitting`. Answer changes after submission are rejected. Review/journal updates do not alter submitted answers.

Core events: `question_viewed`, `question_left`, `answer_set` (new and previous response), `answer_cleared` (previous response), `marked`, `unmarked`, `section_changed`, `tab_hidden`, `tab_visible`, `fullscreen_exit`, `submitted`. Pausable exams also use `paused` and `resumed`. Events have epoch-millisecond `at`; answer events include the applicable deadline. Events are append-only and chronological. Response, palette, visits, changes and focused time are reconstructed from this log. The palette has `not_visited`, `not_answered`, `answered`, `marked`, `answered_marked` states.

Remaining time is always derived from the absolute `deadlineAt`, never accumulated interval ticks. All meaningful changes are serialized to IndexedDB. A synchronous local recovery journal covers answers and manual study progress until their IndexedDB transactions commit, so an immediate refresh does not discard an acknowledged edit. Journals contain progress only, never paper or solution files. A browser lock prevents two tabs from concurrently editing exam storage. Visibility/page-exit events close focused intervals; hidden and paused intervals do not count toward question time. A five-second persisted observation bounds focused time if a crash omits the page-exit event; up to five seconds of the final visible interval can be lost after an abrupt crash. The clock continues while hidden unless explicitly paused. Per-section deadlines can advance across multiple expired sections after reload.

Question-scope signals:

| Signal                                           | Type / meaning                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `outcome`                                        | String: `correct`, `wrong`, `partial`, `unanswered`; uses marked-answer policy.                              |
| `type`, `section`                                | String question type and section ID.                                                                         |
| `marks`                                          | Number of available marks.                                                                                   |
| `topic`, `difficulty`                            | Taxonomy string or `none`.                                                                                   |
| `spentSec`                                       | Focused visible seconds across visits.                                                                       |
| `expectedSec`                                    | Derived or explicit time budget.                                                                             |
| `timeRatio`                                      | `spentSec / expectedSec`.                                                                                    |
| `visits`                                         | Number of question-viewed events.                                                                            |
| `answerChanges`                                  | Number of different nonempty answer revisions.                                                               |
| `changedCorrectToWrong`, `changedWrongToCorrect` | Booleans; any recorded answer revision crossed full-correctness status. Partial counts as not fully correct. |
| `confidence`                                     | `sure`, `unsure`, `guess`, or `none`.                                                                        |
| `markedForReview`                                | Boolean final marked state.                                                                                  |
| `selectedTrap`                                   | First matching trap ID, or `none`.                                                                           |
| `marksLost`                                      | Available marks minus earned marks, including penalties.                                                     |
| `negativeMarksTaken`                             | Positive magnitude of negative score, otherwise zero.                                                        |
| `answeredWithMinutesLeft`                        | Remaining minutes at last answer_set; zero if never answered.                                                |

Section/exam-scope signals:

| Signal                                    | Meaning                                                                                                                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accuracy`                                | Percent fully correct among attempted questions (0 if none).                                                                                                                      |
| `attemptRate`                             | Percent attempted out of all questions.                                                                                                                                           |
| `avgTimeRatio`                            | Mean ratio across all questions.                                                                                                                                                  |
| `unansweredCount`                         | Count under scoring policy.                                                                                                                                                       |
| `guessPenaltyMarks`                       | Sum of penalties on questions rated `guess`.                                                                                                                                      |
| `accuracyFirstThird`, `accuracyLastThird` | Percent accuracy in chronological thirds of answered questions, ordered by final answer timestamp. Third size is ceiling(answered / 3).                                           |
| `accuracyDrop`                            | First-third minus last-third percentage points; zero with fewer than three answers. This extra fixed signal lets `late_collapse` remain declarative without expression execution. |
| `timeLeftWhenFinishedSec`                 | Nonnegative seconds left on the final applicable deadline at submission.                                                                                                          |

## Rule DSL and defaults

Each rule has required `id`, `scope` (`question`, `section`, `exam`), `label`, `cause` (taxonomy ID or `null` for information only), `severity` (1–3), `when`, and `advice`. Custom rule conditions use only:

```json
{
  "all": [
    { "signal": "outcome", "op": "==", "value": "wrong" },
    { "not": { "signal": "confidence", "op": "in", "value": ["guess", "none"] } }
  ]
}
```

`all` and `any` take nonempty arrays; `not` takes one condition. Leaf operators: `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `not_in`. Membership requires an array; other operators require a scalar. Values must match the signal's primitive type. Ordering requires numeric signals. Signals are scope-specific. Trees deeper than 20 conditions are rejected. There is no code, expression string, property traversal, regex operator, network call, `eval`, or `new Function`.

Advice interpolates `{topic}`, `{spentSec}`, `{expectedSec}`, `{difficulty}`, `{trap}`, `{marksLost}` (and other available signal names). Numeric substitutions round to two places. Unknown placeholders remain literal. Trap names resolve through the taxonomy.

| Built-in ID                 | Condition                              | Cause                 |
| --------------------------- | -------------------------------------- | --------------------- |
| `slow_on_easy`              | easy and ratio ≥ configured slowRatio  | time_pressure         |
| `stuck_on_hard`             | hard, ratio ≥ 2, wrong/unanswered      | time_pressure         |
| `rushed_wrong`              | wrong and ratio ≤ configured fastRatio | careless              |
| `overconfident_wrong`       | sure and wrong                         | overconfidence        |
| `lucky_guess`               | guess and correct                      | guess                 |
| `underconfident_right`      | unsure, correct, easy                  | information only      |
| `unjustified_guess_penalty` | guess, wrong, positive penalty         | guess                 |
| `fell_for_trap`             | selectedTrap ≠ none                    | trap's taxonomy cause |
| `changed_right_to_wrong`    | changedCorrectToWrong                  | overconfidence        |
| `skipped_easy`              | easy and unanswered                    | concept_gap           |
| `late_collapse`             | accuracyDrop ≥ 20                      | time_pressure         |
| `guess_bleed`               | guessPenaltyMarks ≥ 3                  | guess                 |

Default rules are JSON-shaped data in `default-rules.ts`. The internal `$trap` cause is reserved for the built-in dynamic trap mapping; custom rules use a real taxonomy cause or null. Same-ID custom rules replace a default, then disabled IDs are filtered out.

### Worked custom rule

To flag slow, unsuccessful Bayes questions, add this object to `diagnostics.rules`, with `prob.bayes` and `concept_gap` present in the taxonomy:

```json
{
  "id": "bayes_rebuild",
  "scope": "question",
  "label": "Rebuild conditional probability",
  "cause": "concept_gap",
  "severity": 3,
  "when": {
    "all": [
      { "signal": "topic", "op": "==", "value": "prob.bayes" },
      { "signal": "outcome", "op": "in", "value": ["wrong", "partial"] },
      { "signal": "timeRatio", "op": ">=", "value": 1.2 }
    ]
  },
  "advice": "{topic}: spent {spentSec}s and lost {marksLost} marks. Write the conditioning event first, then retry three examples."
}
```

No TypeScript change is necessary. For an override, reuse a built-in ID. For removal, put that ID in `disabledRules`.

## Attribution, aggregation and dashboard

All fired flags remain visible. Every non-correct question receives one primary cause based on priority, with `concept_gap` as fallback. Correct questions may have pacing or confidence flags but no primary marks-loss cause. Therefore marks lost by primary cause sums to total marks lost. Informational flags do not add a cause.

Topic rows report attempted count, accuracy, mean ratio, marks lost and dominant primary cause. Traps retain question IDs; rules retain counts and examples. Pacing compares cumulative focused and expected seconds in the persisted question order. Weakness entries group topic × cause or trap, with:

`impact = marksLostWeight × marksLost + timeWastedPerMinuteWeight × minutesOverBudget`

Repeated evidence and severity determine inclusion. Topic/cause and trap views can overlap: do not sum their marks as if they were mutually exclusive. Only primary-cause totals are a partition. Advice is deterministic, capped by `topWeaknessCount`.

Review journals preserve a separate `self-reported` cause/trap and note. They update aggregation without rewriting engine attribution. Dashboards group by taxonomy ID across exam IDs, show the last 5/10/20 attempts per topic, trap frequency and persistent topic × cause evidence. Persistence counts distinct attempts, including evidence filtered from a single-attempt ranked list. Demo attempts never contribute to personal trends or limits. Reports/dashboard honor score and solution release restrictions.

## Samples and verification

- `exams/gate-2027-da/`: 12-question sample covering MCQ/MSQ/NAT, math, Mermaid, chart fences, and both GA mark values.
- `exams/section-quiz/`: ten minutes, two five-minute locked sections, partial MSQ scoring, a different taxonomy.
- Development library → **Developer demos → Load diagnostic demo** loads `demo-session.json`, a submitted fixture firing all twelve default rules. Regenerate with `node --experimental-strip-types scripts/seed-exam-demo.ts`; the script fails if a rule is missing.
- Unit tests: `node --experimental-strip-types --test tests/exam-*.test.ts`.
- Browser integration: `npx playwright test tests/e2e/exams.spec.ts`.

The implementation has no backend, accounts, authoring UI, real proctoring, or generated advice. Browser storage is local to this origin/profile; clearing it deletes attempts. File imports offer the most reliable offline key availability; a bundled key must be fetched successfully after submission.
