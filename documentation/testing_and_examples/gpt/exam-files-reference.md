# Localdox exam and practice files: the contract

Localdox runs exams and practice from three plain files that live in an **Exam Workspace**, organised in folders like any other files. Every rule below is enforced by the app's parsers; a file that breaks one is refused with a message naming the file and line. Follow it exactly.

| File | Format | Holds |
| :-- | :-- | :-- |
| `<name>.xrule` | JSON | **Exam rules**: name, time, pass mark, attempts, marking, calculator, sections. |
| `<name>.xam` | Markdown | **An exam paper**: questions, their keys and worked solutions. Keys stay sealed until the attempt is submitted. |
| `<name>.xp` | Markdown | **A practice set**: questions with solutions. Untimed; each answer is checked at once and its solution shown. No rules file. |
| `*.svg` `*.png` `*.jpg` `*.webp` `*.gif` | image | Figures referenced by file name from a paper or practice set. |

There is no plan file, zip bundle, `.exam.json`, `.paper.md`, `.solutions.md`, `.practice.md` or `.taxonomy.json` any more. Never produce them. A "study plan" is a **folder tree** of these files (section 8).

## 1. `.xrule`: how an exam runs

Strict JSON: double quotes, no comments, no trailing commas, **no fields other than these**.

| Field | Required | Rule |
| :-- | :-- | :-- |
| `xrule` | yes | Always `1`. |
| `name` | yes | The exam's display name, 1–160 characters. |
| `summary` | | Markdown shown on the paper above its Start button: what the exam covers. A short bullet list of syllabus terms. Up to 20000 characters. |
| `durationMinutes` | | Integer 1–600. Default 30. |
| `questionCount` | | Integer 1–500. The `.xam` must contain **exactly** this many questions. Omit to allow any number (except with `preset`, see below). |
| `passPercentage` | | 0–100. Default 70. Score is marks earned (after penalties) over total marks. |
| `maxAttempts` | | Integer 1–20. Default 3. |
| `mcqPenalty` | | `"none"` (default), `"third"` or `"quarter"`: marks lost for a wrong MCQ, as a fraction of its marks. **Only without `preset` and `rules`.** |
| `calculator` | | `"none"` (default), `"basic"` or `"scientific"`. **Only without `preset` and `rules`.** |
| `preset` | | `"gate"`: start from the built-in GATE ruleset (below). Not with `rules`. |
| `rules` | | A complete engine ruleset (section 2) for anything the plain fields can't say: named sections, per-section timers, marks-based penalties, MSQ partial credit, NAT penalties, shuffling, full-screen proctoring. Not with `preset`. |

Layers apply in order, each overriding the last: defaults (or the preset) → `rules` → the plain fields `durationMinutes`, `questionCount`, `passPercentage`, `maxAttempts`. Putting `mcqPenalty` or `calculator` beside `preset` or `rules` is an **error**; set them inside `rules.questionTypes` / `rules.tools` instead.

### What the plain (no preset, no rules) exam does

- MCQ: one correct option, 2–26 options per question (4 is conventional). Penalty per `mcqPenalty`.
- MSQ: all-or-nothing, no penalty, 2–26 options.
- NAT: typed on the keyboard, no penalty.
- Sections come from the questions' `section=` attribute, in first-appearance order, titled from the id (section 3.4). With no `section=` every question is in one section titled "Questions".
- Instructions screen says "Read the rules and acknowledge before starting."

### What `"preset": "gate"` does

GATE pattern: 180 minutes, scientific calculator, NAT on an on-screen keypad, MCQ −1/3 of marks when wrong, MSQ all-or-nothing with no penalty, NAT no penalty, and **Save & Next**: a choice counts only once saved with Save & next or Mark for review & next.

- **`questionCount` defaults to 65.** A shorter GATE-style paper must set `questionCount` to its real count, or it is refused ("Expected 65 exam questions").
- **Every MCQ and every MSQ must have exactly 4 options.**
- With all 65 questions, sections are fixed: `GA` (General Aptitude: 5×1 mark + 5×2 marks) and `subject` (25×1 mark + 30×2 marks). Every question needs `section=GA` or `section=subject` and those exact mark counts.
- With fewer questions, sections come from the questions' `section=` values; `GA` and `subject` keep their GATE titles.

### Templates

A topic quiz:

```json
{
  "xrule": 1,
  "name": "Conditional probability: quiz",
  "summary": "- $P(A \\mid B)$ and the multiplication rule\n- Independence vs mutually exclusive events",
  "durationMinutes": 30,
  "questionCount": 12,
  "passPercentage": 70,
  "maxAttempts": 3,
  "mcqPenalty": "third",
  "calculator": "basic"
}
```

A 100-question mock with a GATE-like marking scheme but no fixed GATE sections:

```json
{
  "xrule": 1,
  "name": "Probability mock 1",
  "summary": "- Axioms, conditional probability, Bayes' theorem\n- Discrete and continuous random variables\n- Expectation, variance, standard distributions",
  "durationMinutes": 180,
  "questionCount": 100,
  "passPercentage": 60,
  "maxAttempts": 3,
  "mcqPenalty": "third",
  "calculator": "scientific"
}
```

A shorter paper on the GATE preset (4 options everywhere, GATE marking):

```json
{ "xrule": 1, "name": "GATE DA: probability sectional", "preset": "gate", "questionCount": 30, "durationMinutes": 90 }
```

A full-length GATE paper (65 questions, 100 marks, sections as above):

```json
{
  "xrule": 1,
  "name": "GATE DA full mock 1",
  "summary": "GATE pattern: 65 questions, 100 marks, 3 hours.\n\n- **General Aptitude**: 10 questions (5 of 1 mark, 5 of 2 marks).\n- **Subject**: 55 questions (25 of 1 mark, 30 of 2 marks).",
  "preset": "gate",
  "durationMinutes": 180,
  "questionCount": 65,
  "passPercentage": 25,
  "maxAttempts": 3
}
```

## 2. The `rules` block (engine ruleset)

Use it only when the plain fields can't express the pattern. Every object is strict; omit a field to take its default. Inside an `.xrule` the app overrides `meta.id` and `meta.name`, but they are still required.

```json
{
  "xrule": 1,
  "name": "JEE Main mock 1",
  "summary": "- Physics, Chemistry, Mathematics: full syllabus",
  "rules": {
    "schemaVersion": 2,
    "meta": {
      "id": "jee-main-mock-1",
      "name": "JEE Main mock 1",
      "version": "1",
      "instructionsMd": "Each section has 20 MCQs and 5 numerical questions. Wrong MCQs lose 1 mark."
    },
    "timing": { "mode": "global", "durationMinutes": 180, "warnAtMinutesLeft": [30, 5] },
    "sections": [
      { "id": "physics", "name": "Physics", "questionCount": 25 },
      { "id": "chemistry", "name": "Chemistry", "questionCount": 25 },
      { "id": "mathematics", "name": "Mathematics", "questionCount": 25 }
    ],
    "questionTypes": {
      "mcq": { "optionCount": 4, "negativeMarking": { "marks": 1 } },
      "nat": { "inputMode": "keyboard", "negativeMarking": null }
    },
    "tools": { "calculator": "none" },
    "attempts": { "max": 3 },
    "progression": { "passPercentage": 50 },
    "integrity": { "requireFullscreen": true, "maxTabSwitches": 3, "onViolation": "warn_then_autosubmit" },
    "diagnostics": { "enabled": false },
    "ui": { "profile": "jee", "kind": "full" }
  }
}
```

| Field | Rule (default) |
| :-- | :-- |
| `schemaVersion` | `2`. Required. |
| `meta` | Required: `id` (letters, digits, `-`, `_`), `name`, `version` (string, e.g. `"1"`). Optional `instructionsMd`: Markdown on the instructions screen. Do not repeat the marking scheme the app already shows. |
| `timing` | Required: `mode` `"global"` or `"per_section"`, `durationMinutes`. Optional `warnAtMinutesLeft` (`[10, 1]`), `autoSubmitOnExpiry` (`true`), `pausable` (`false`). With `per_section`, every section needs `durationMinutes` and they must sum exactly to `timing.durationMinutes`; finished sections lock. |
| `sections` | Required, at least one: `{ "id", "name", "questionCount" }`, optional `durationMinutes`, optional `composition: [{ "marks": 1, "count": 10 }, …]` (counts must sum to `questionCount`, and the paper must match it exactly). **Every question in the `.xam` must carry `section=<id>`** and each section's count must match. |
| `questionTypes` | Required; list **only the types allowed** (a paper using an unlisted type is refused). `mcq`: `optionCount` (default **4**, enforced exactly), `negativeMarking`. `msq`: `optionCount` (optional; enforced if set), `scoring` `"all_or_nothing"` (default) or `"partial_no_wrong"` (marks × chosen/correct when no wrong option is chosen), `negativeMarking`. `nat`: `inputMode` `"virtual_keypad"` (default) or `"keyboard"`, `negativeMarking`. |
| `negativeMarking` | `null` (none, default), `{ "fractionOfMarks": [1, 3] }`, or `{ "marks": 1 }`. |
| `navigation` | `free` (`true`), `sectionLocking` (`false`), `markForReview` (`true`), `markedForReviewAnswerCounts` (`true`), `clearResponse` (`true`), `requireSave` (`false`; `true` = TCS iON / GATE "Save & next": an unsaved choice is dropped when leaving the question), `shuffleQuestions` (`false`), `shuffleOptions` (`false`). |
| `tools` | `{ "calculator": "none" \| "basic" \| "scientific" }`. |
| `integrity` | `requireFullscreen` (`false`), `maxTabSwitches` (`null` = unlimited), `onViolation` `"warn"` / `"autosubmit"` / `"warn_then_autosubmit"`, `blockCopyPaste`, `blockContextMenu` (`false`). For full mocks only. |
| `results` | `scoreVisibility` must stay `"immediate"` (the default). `solutionsRelease` `"immediate_after_submit"` (default). `showSectionBreakdown`, `showTimePerQuestion` (`true`), `rounding` (2). |
| `attempts` | `{ "max": 3 }`. Set it; `maxAttempts` in the outer file overrides it. |
| `progression` | `passPercentage` (outer field overrides), `rewriteDifficultyPercentage` (50), `difficultyLabel` (`"hard"`; must be `easy`, `medium` or `hard`). |
| `diagnostics` | Always `{ "enabled": false }`. Analytics are not shown. Never add `taxonomy`, `taxonomyRef` or custom rules. |
| `ui` | `profile` `"gate"` / `"jee"` / `"upsc"` / `"generic"` (wording and palette only), `kind` `"full"` / `"sectional"` / `"quiz"`. |
| `sampleMode` | Do not use. Set `questionCount` in the outer file instead (next point). |

**A paper shorter than the ruleset's sections:** set the outer `questionCount` to the paper's real count. Sections are then rebuilt from the questions' `section=` values (keeping the ruleset's section names) and composition is not enforced.

## 3. `.xam`: an exam paper

```markdown
---
rules: probability-mock-1.xrule
---

# Exam

:::question{#q1 type=mcq marks=2 difficulty=medium}
Given $P(A \cap B) = 0.2$ and $P(B) = 0.5$, find $P(A \mid B)$.

- $0.1$
- $0.25$
- $0.4$
- $0.7$
:::

:::question{#q2 type=msq marks=2 difficulty=hard}
Which of the following are valid probability density functions on $[0, 1]$?

- $f(x) = 2x$
- $f(x) = 1$
- $f(x) = x$
- $f(x) = 3x^2$
:::

:::question{#q3 type=nat marks=1 difficulty=easy}
A fair die is rolled once. Find $P(\text{even})$. Give a decimal.
:::

# Solutions

:::solution{#q1 answer=C}
$P(A \mid B) = \dfrac{P(A \cap B)}{P(B)} = \dfrac{0.2}{0.5} = 0.4$.

**Trap:** $0.1 = 0.2 \times 0.5$ multiplies instead of dividing.
:::

:::solution{#q2 answer="A,B,D"}
A density must be non-negative and integrate to 1. $\int_0^1 2x\,dx = 1$, $\int_0^1 1\,dx = 1$, $\int_0^1 3x^2\,dx = 1$, but $\int_0^1 x\,dx = \tfrac12$.
:::

:::solution{#q3 answer=0.5}
Three of six faces are even: $3/6 = 0.5$.
:::
```

### 3.1 File structure

- **Optional header**, the very first lines: `---`, `rules: <exact file name>.xrule`, `---`. Only the `rules` key is allowed. **Always write it** (section 7); the name must match the `.xrule` file name exactly, case included.
- **Top level holds only** headings, `:::question` blocks, `:::solution` blocks and optional `---` separators. Any other paragraph, list, image or table at the top level is an error: everything belongs inside a block.
- **Headings are optional and restricted.** Allowed (any level): `Exam`, `Question`, `Questions`; and `Solutions`, `Solution`, `Answers`, `Answer key`, `Keys`. Anything else (`# Section A`, `## Probability`) is an error. `# Practice` is refused: practice goes in an `.xp`. No question may follow a Solutions heading.
- Solutions may sit anywhere (right after each question, or all under `# Solutions`), matched by id. **Prefer all questions first, then `# Solutions`**: it reads like a real paper in the editor.
- Questions appear in the exam in file order. Section order is the order sections first appear.

### 3.2 `:::question{…}` attributes

Write attributes as `key=value` separated by spaces. Quote any value containing a space or comma: `answer="A,C"`.

| Attribute | Required | Rule |
| :-- | :-- | :-- |
| `#id` | yes | Unique in the file. **Letters, digits, `-` and `_` only. Never a dot** (`#q1.a` is read as a CSS class and fails). Use `q1`, `q2`, … |
| `type` | yes | `mcq` (one correct option), `msq` (one or more correct), `nat` (numeric answer, no options). |
| `marks` | yes | A positive number: `1`, `2`, `0.5`. |
| `difficulty` | strongly advised | Exactly `easy`, `medium` or `hard` (lowercase). Any other word is an error. Shown beside the question. Tag every question. |
| `section` | when sectioned | Section id: letters, digits, `-`, `_`. Default `exam`. Required on every question when the `.xrule` has `rules.sections`, or a full 65-question GATE paper. |
| `time` | | Expected seconds. Not shown. |
| `tags` | | Comma-separated, **no spaces**: `tags=pyq,gate-da-2024`. Not shown to the learner; useful for the author. |
| `topic` | **never** | Refused in `.xam` ("Unknown topic"). |

### 3.3 Body and options

- The body is Markdown (section 6). The **last list** inside an `mcq`/`msq` block is its options, labelled A, B, C, … in order. Use `- ` bullets, one option per line.
- **Statements before options:** a body list followed directly by the options list **merges into one list** (4 statements + 4 options become 8 options). Put a sentence between them (`Which of the above are correct?`), or number the statements (`1.`, `2.`) and bullet the options.
- NAT blocks have no option list. Say the required format in the question: "Give the answer to two decimal places."
- Do not write "A)", "(a)" or "Option 1" in option text; the app labels them.
- Close every block with `:::` alone on its own line at column 0. To nest something that uses `:::` inside a block, open the outer block with `::::` and close it with `::::`.

### 3.4 Section ids become titles

Without a `rules` block, a section's title is made from its id: split on `-`, `_` and `.`; words of **3 letters or fewer are uppercased**, longer ones capitalised. `linear-algebra` → "Linear Algebra"; `probability` → "Probability"; `ga` → "GA"; but `sets-and-counting` → "Sets AND Counting". Choose ids that read well, or use a `rules` block to name sections.

### 3.5 `:::solution{…}`

| Attribute | Rule |
| :-- | :-- |
| `#id` | The question's id. Exactly one solution per question. |
| `answer` | MCQ: one letter, `answer=C`. MSQ: letters in quotes, no spaces, `answer="A,C"` (a single letter is allowed). NAT: a decimal number, `answer=0.5`, `answer=-2`, `answer=1.2e-3`; or an inclusive range `answer="2.30:2.50"`. **Never a fraction, expression, unit, comma or percent sign** (`1/3`, `sqrt(2)`, `50%` are refused). |
| `tolerance` | NAT only, with a single number: `answer=0.333 tolerance=0.005`. Not with a range. |

- For NAT answers that are irrational or rounded, give a range covering every correct rounding: $1/3$ to two decimals → `answer="0.33:0.34"`. Integer answers can be exact: `answer=6`.
- The body is the worked solution, revealed only after submission: method, key step, final answer, and why the most tempting wrong option is wrong. 2–8 lines for routine items; more for hard ones.
- Optional `::distractor{option=B trap=…}` lines are accepted and ignored; don't write them.

## 4. `.xp`: a practice set

The paper's grammar, lighter:

```markdown
# Conditional probability

:::question{#cp1 type=mcq difficulty=easy}
A fair die shows an even number. What is the probability that it is a 6?

- $\tfrac16$
- $\tfrac13$
- $\tfrac12$
- $\tfrac23$
:::

:::solution{#cp1 answer=B}
Given "even", the outcomes are $\{2, 4, 6\}$, one of which is 6: $\tfrac13$.
:::

## Bayes' theorem

:::question{#bt1 type=nat difficulty=medium}
1% of people have a condition. A test detects it 90% of the time and has a 5% false-positive rate. Find $P(\text{condition} \mid \text{positive})$ to three decimal places.
:::

:::solution{#bt1 answer="0.152:0.155"}
$\dfrac{0.01 \times 0.9}{0.01 \times 0.9 + 0.99 \times 0.05} = \dfrac{0.009}{0.0585} \approx 0.154$.
:::
```

- No `.xrule`, no `---` header, no `section`.
- **Any heading (`#`, `##`, `###`) starts a group** shown as a title above its questions. Use headings freely to split by subtopic or by difficulty ("Warm-up", "Exam level").
- `marks` is optional (default 1). `difficulty` is optional and shown; use `easy`/`medium`/`hard`.
- Put each solution **right after its question**: the learner sees it the moment they answer.
- Each question: 2–26 options (any count, 4 conventional), one solution, a valid key. Same answer rules as section 3.5. No negative marking.
- Same top-level rule: only headings, `:::question`, `:::solution` and `---`. No intro paragraph; put context inside the first question or in a heading.

## 5. Ids, numbering and large files

- Ids: `q1`…`q100` for papers; a short topic prefix for practice (`cp1`, `bt1`). Unique within the file.
- 100 questions is fine. The app reads a 100-question paper in well under a second.
- Keep each `.xam` one sitting. For more than 500 questions, split into several papers.

## 6. What can go inside questions, options and solutions

| Content | Syntax | Notes |
| :-- | :-- | :-- |
| Math | `$…$` inline, `$$…$$` display (KaTeX) | Only dollar delimiters. Escape a literal dollar: `\$`. Inside JSON strings (`summary`), double every backslash: `"$P(A \\mid B)$"`. |
| Text | GitHub Markdown: bold, italic, code, tables, lists, block quotes | Tables are good for data given in a question. |
| Diagram | a ` ```mermaid ` fence | Static. Flowcharts, state, sequence, class, ER. No `click`, `style`, `classDef`, HTML. Quote labels with punctuation: `A["P(A) = 0.3"]`. |
| Chart | a ` ```chart ` fence, strict JSON on one or more lines | `{"type":"bar"\|"line"\|"scatter"\|"pie","title":"…","data":[{…}],"series":["key"] or [{"key":"…","name":"…"}],"xKey":"…"}`. Every series value must be a number; every row needs `xKey`; scatter needs numeric `xKey`; 1–12 series; pie uses the first series. No other keys. |
| Image | `![Meaningful alt text](figure-name.svg)` | Resolved **by file name** from the workspace, so the image file must be delivered too and its name unique. `https://` URLs and `data:image/…;base64,` URIs also work but break offline; prefer files. SVG you write yourself is best for graphs, trees, Venn diagrams and geometry. |
| Code | fenced with a language | Shown as text, never run. |

**Not rendered:** raw HTML (`<br>`, `<sup>`, `<img>`, `<details>`…), interactive or executable fences, callouts (`> [!NOTE]` shows as a plain quote), `mindmap` fences. Links show as plain text; don't use them.

## 7. Linking a paper to its rules

**Always start every `.xam` with a header naming its `.xrule`** (`rules: <exact file name>.xrule`). The header is matched by exact file name anywhere in the workspace, so it works wherever the files end up. Without a header the app searches from the paper's folder up to the root for a same-stem `.xrule` (`mock-1.xrule` for `mock-1.xam`), else a folder holding exactly one `.xrule`; two candidates make the learner choose. Uploaded files all land at the workspace root, and `.xrule` files are not shown in the sidebar (they're edited in Settings ▸ Exam rules), so headerless papers become ambiguous as soon as there are two rulesets.

- One paper, its own rules: `probability-mock-1.xam` + `probability-mock-1.xrule`, header `rules: probability-mock-1.xrule`.
- Several papers sharing rules (ten chapter quizzes): one `.xrule`, and every paper's header names it. A shared `.xrule` must suit every paper: omit `questionCount` when their lengths differ.

## 8. Delivering files

**File names.** Lowercase words, digits and hyphens, with the extension: `probability-mock-1.xam`. Unique across everything the learner will hold in the workspace: a name already present triggers a rename prompt (which breaks `rules:` headers), and a file whose text is identical to an existing one is silently skipped. Prefix with the exam or subject (`gate-da-probability.xrule`, never `rules.xrule`). Images too: `gate-da-bayes-tree.svg`.

There are two ways into Localdox. Choose by size.

### 8.1 Loose files (one exam, one practice set, a few files)

Deliver the files themselves. The learner opens an **Exam Workspace** (Settings ▸ Workspace ▸ New, kind Exam), then **+ ▸ Upload files** and selects all of them at once (or drops them on the window). Alternatively **+ ▸ File**, a name ending `.xam`/`.xrule`/`.xp`, then paste the content over the template. Zips are **not** unpacked; never deliver a zip.

### 8.2 A workspace backup (a study plan, a course, many papers, folders)

Deliver one `<name>.json` that Localdox imports as a **new Exam Workspace with its folders**: Settings ▸ Workspace ▸ Transfer ▸ **Import workspace**. Build it with `localdox_check.py` (`build_workspace`) rather than by hand:

```json
{
  "format": "localdox-workspace",
  "version": 2,
  "workspace": {
    "kind": "exam",
    "name": "GATE DA 2027",
    "folders": [
      { "id": "f-probability", "name": "Probability" },
      { "id": "f-probability-mocks", "name": "Mocks", "parentId": "f-probability" }
    ],
    "files": [
      { "id": "x-1", "name": "gate-da-probability.xrule", "content": "{ … }" },
      { "id": "x-2", "name": "01-conditional.xam", "content": "---\nrules: gate-da-probability.xrule\n---\n…", "folderId": "f-probability" },
      { "id": "x-3", "name": "01-conditional.xp", "content": "# …", "folderId": "f-probability" },
      { "id": "x-4", "name": "gate-da-bayes-tree.svg", "content": "", "data": "data:image/svg+xml;base64,…", "mimeType": "image/svg+xml", "folderId": "f-probability" }
    ]
  }
}
```

- `kind` must be `"exam"`. File and folder `id`s are unique strings; `folderId` / `parentId` point at folder ids (omit for the root). Text files carry their full text in `content`; images carry `"content": ""` plus a base64 `data:` URL and `mimeType`.
- Put `.xrule` files at the root (no `folderId`); they are listed in Settings ▸ Exam rules, not the sidebar.
- Importing creates a new workspace each time; it does not merge into an existing one. To add to a workspace the learner already uses, deliver loose files (8.1).

### 8.3 Shape of a study plan

There is no plan file and no Learn/Practice/Exam/Review stepper any more. A plan is folders the learner works through in order:

```text
GATE DA 2027                       (the workspace)
  gate-da-topic-quiz.xrule         shared by every topic quiz (no questionCount)
  gate-da-full-mock.xrule          "preset": "gate", 65 questions
  01 Probability/
    01-conditional-probability.xp
    01-conditional-probability.xam     header: rules: gate-da-topic-quiz.xrule
    02-bayes-theorem.xp
    02-bayes-theorem.xam
  02 Linear algebra/
    …
  Mocks/
    gate-da-full-mock-1.xam            header: rules: gate-da-full-mock.xrule
```

- Number folders and files (`01-`, `02-`) so the sidebar sorts in study order.
- Per topic: one `.xp` (8–25 questions, a step easier, covering every subtopic, each with a worked solution) and one `.xam` (10–20 questions, exam level). No question appears in both.
- An `.xrule`'s `summary` is the place for "what this exam covers"; there is no separate study-notes field. For notes or a lesson, add a Markdown lesson `.md` (see format-reference.md) in the topic's folder.

## 9. Retakes

A paper that used all its attempts without passing must be **rewritten in place** (the learner edits the `.xam`, then **Use the edited paper**). The new version must have different questions, the same rules, **every question tagged `difficulty`**, and at least `rewriteDifficultyPercentage`% (default 50%) tagged with `difficultyLabel` (default `hard`). When asked for a retake paper, produce a complete replacement `.xam` meeting that, with the same file name, header and question count.

## 10. Self-check before delivering

1. Every `.xrule` parses as JSON and uses only the fields in sections 1–2. Not both `preset` and `rules`; no `mcqPenalty`/`calculator` beside either.
2. `questionCount` equals the number of `:::question` blocks in the paper. With `preset: "gate"` it is set explicitly unless the paper has exactly 65 questions.
3. The `.xam` header names the delivered `.xrule` exactly.
4. Top level holds only allowed headings, `:::question`, `:::solution` and `---`. Every block closes with `:::` alone on its line.
5. Ids unique, made of letters, digits, `-` and `_`. No dots.
6. Every question has `type` and `marks` (`.xam`) and one matching solution.
7. MCQ/MSQ option counts: 2–26, exactly 4 under `preset: "gate"` or a `rules.questionTypes.mcq` without its own `optionCount`. No statement list directly above the options.
8. Answers: MCQ one letter; MSQ quoted letters without spaces; NAT a decimal or `"lo:hi"` range, never a fraction. Every letter exists among the options.
9. `difficulty` is `easy`, `medium` or `hard` on every exam question; no `topic=`.
10. With `rules.sections`, every question has a matching `section=`, and counts (and `composition`) match.
11. Every image named in a block is delivered, with a unique name.
12. Each answer key was re-derived independently, not copied from the question's intended answer.

## 11. Error messages and their fixes

| Message | Fix |
| :-- | :-- |
| `Expected N exam questions, found M` | Make `questionCount` match the paper (with `preset: "gate"`, set it). |
| `Wrong option count` | Give the MCQ/MSQ the required number of options (4 under GATE). Check for a merged statements list. |
| `Unknown difficulty X` | Use `easy`, `medium` or `hard`, lowercase. |
| `Unknown topic X` | Remove `topic=` from the `.xam`. |
| `Unrecognized key(s) in object: 'class'` | An id contains a dot. Use `-` or `_`. |
| `Expected a heading or a :::question or :::solution block` | Text sits outside a block; move it inside. |
| `Unknown heading "…"` | Only Exam/Questions and Solutions/Answers headings are allowed in an `.xam`. |
| `Unclosed directive` | A block's closing `:::` is missing or not alone at column 0. |
| `Invalid NAT answer or tolerance with range` | NAT answer must be a decimal or `"lo:hi"`, without `tolerance` on a range. |
| `Invalid option answer or tolerance` | MCQ needs one existing letter; MSQ quoted existing letters; no `tolerance`. |
| `Section "X" isn't in these rules. Tag the question section=…` / `Expected N questions, found M` (per section) | Add the right `section=` to each question, or match the section counts. |
| `Question type msq is not allowed` | Add the type to `rules.questionTypes`, or change the question. |
| `mcqPenalty only applies to custom rules` | Move it into `rules.questionTypes.mcq.negativeMarking`, or drop the preset. |
| `Missing solution for X` / `No question for solution X` | Pair every question with exactly one solution of the same id. |
