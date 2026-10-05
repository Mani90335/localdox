# Exam Sessions

The reader has a separate `/exams` route, linked from its home page: a place to upload study material and then read, practise and take tests. A learner uploads a study plan (a zip of plan, exams, practice files and images) and works through its topics in any order they like.

An exam's flow is `files → validation → instructions → timed session → sealed submission → scoring → result → answer review`. The engine can also run confidence reflection and rule-based diagnostics; the UI skips reflection and shows no analytics (learners judge their own mistakes from the key and solutions), but the engine and its tests are kept. The engine never identifies an exam by name. `schema.ts`, `parser.ts` and `validation.ts` establish the file boundary; `session.ts` replays events and enforces deadlines/navigation; `scoring.ts` applies question-type policies; `diagnostics.ts` interprets the rule data and aggregates evidence. These modules have no UI dependencies.

`storage.ts` owns a separate IndexedDB database and refuses to read solutions before submission. Imported keys remain opaque Blobs; bundled keys are non-inlined assets fetched only after the submission is persisted. The browser lock serializes writers across tabs. A synchronous localStorage recovery journal holds pending response/progress snapshots until their IndexedDB writes commit; startup restores unfinished writes before resuming. Paper and solution content never enters that journal. A storage error is visible and blocks further answer changes until saving succeeds. Reimporting content does not rewrite the exam snapshot held by an existing attempt.

The UI uses its own small token layer (below), Radix Dialog, KaTeX, Mermaid and Recharts. Exam Markdown deliberately does not execute the reader's interactive React/code fences, and the scientific calculator executes no JavaScript strings.

The main tradeoff is the conflicting solution-validation timing: keys cannot be checked before starting without reading them. Validation is deferred until after submission, and a malformed/missing key leaves a retryable locked submission. There is no pretense of server-backed secrecy or tamper-proof proctoring in a local Markdown reader.

For the complete field reference, file examples, rule authoring guide, sample caveats, diagnostics semantics and checks, see [Exam format](../docs/exam-format.md). Start with **Try the example plan** to exercise the complete flow quickly.

## Study plans: topics with four steps

**The problem.** A plan of "do these exams in order" told learners what to test but not what to do first, and a topic was "done" the moment an exam passed, before any learning from mistakes. Learners couldn't see the next action, and a day-by-day schedule duplicated what learners already track offline.

**The model.** A plan is a list of independent topics (stored in the plan's `days` field for compatibility); learners choose the order. Every topic is four steps, unlocked strictly in order: **Learn** (self-reported; study happens in the reader) → **Practice** (untimed, each answer checked against the key at once) → **Exam** (timed, pass mark and attempt limit from the exam JSON) → **Review** (read every answer with its key and solution). `study-plan.ts` derives `steps` and the current `step` for each topic from three facts stored with it (`learnedAt`, practice answers, `reviewedAt`) plus the linked graded attempts. A passed exam implies Learn and Practice, so practice added later never relocks a finished topic and plans imported before this change keep their passes.

**Data flow.** `bundle.ts` turns one upload (zip or loose files) into exams, practice sets and a plan source, matching images to the files that name them. `importStudyPlan` snapshots each topic's exam and practice sets into the plan record, so re-importing content never rewrites progress. Practice answers are recorded once per question (`answerPractice`) and graded with the same `scoreQuestion` as exams, without negative marking. Practice files hold their solutions in the clear, which is why a practice question may not duplicate that topic's exam question.

**Retries.** Failed attempts leave the topic on Step 3; exhausting `attempts.max` requires a revision acknowledgement and a different qualifying paper. Content fingerprints ignore renamed IDs, shuffled ordering and whitespace so superficial edits do not reset the limit. The plan pins its initial exam policy.

**Storage.** Plans live in the `plans` IndexedDB store; practice sets and their images (as Blobs) live inside the plan record. All writes use the same exclusive browser lock and serialized save queue. See [Study plans](../docs/study-plan-format.md) for the format and [docs/gpt](../docs/gpt/README.md) for the GPT that generates uploads.

## Interface: a calm exam platform

**The problem.** A practice tool only builds exam temperament if it feels like the real thing. GATE (TCS iON) and JEE (NTA) candidates expect a fixed layout: timer top-right, section tabs, a question palette whose shapes mean something, and a sticky action bar. Anything extra, such as internal IDs, validation reports or banners that move the question, costs attention during a timed sitting.

**The rule that shapes everything.** The UI only presents. `session.ts`, `scoring.ts`, `diagnostics.ts` and `study-plan.ts` decide; the screens never re-derive a grade, a deadline or an unlock. Data additions are all optional with safe defaults: the ruleset's `ui` block (`profile`, `kind`), a session's `timeScale` (scaled time for short samples), and a topic's `practice` list.

**Where things live.**

| File                                                                                                             | Owns                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/display.ts`                                                                                                  | Pure presentation rules: date/duration/percent formats, marking copy, rule sentences, threshold notices, scaled sample time, version grouping, profiles, plain-language import errors. Unit-tested in `tests/exam-display.test.ts`. |
| `ui/kit.tsx`                                                                                                     | Button, Chip, StatBlocks, ProgressBar/Ring, Tabs, Segmented, Dialog, Sheet, OverflowMenu, Toast, EmptyState, Skeleton, Zoomable (click-to-enlarge).                                                                                 |
| `ui/Palette.tsx`                                                                                                 | Question palette glyphs (shape + colour + glyph per state), legend, and the per-section summary table used by the confirm dialogs.                                                                                                  |
| `exams.css`                                                                                                      | Tokens on `.exam-app` (light, dark and low-glare), then components, then screens (`xr-` runner, `xi-` instructions, `xs-` result and review, `xl-` library, `xp-` plans and practice).                                              |
| `ExamScreen.tsx`, `Instructions.tsx`, `LibraryScreen.tsx`, `StudyPlans.tsx`, `PracticeScreen.tsx`, `Reports.tsx` | One screen each. `ExamApp.tsx` keeps all state, storage and integrity handling.                                                                                                                                                     |
| `ExamMarkdown.tsx`                                                                                               | Rendering for questions, options and solutions: KaTeX, strict static Mermaid, charts, images from the exam's assets, click-to-enlarge.                                                                                              |
| `bundle.ts`, `examples.ts`                                                                                       | One import path for zips and loose files; the example course as files and as a downloadable zip.                                                                                                                                    |

**Decisions worth knowing before you change them.**

- _One notice slot._ Timer thresholds, integrity warnings, pause and expiry all share one fixed-height slot beside the question number (inside the sticky action bar on phones). Nothing above the question changes height, so the question never jumps. Priority: paused → time's up → fullscreen off → recent warning → threshold.
- _Thresholds fire once, briefly._ A threshold at or above the clock's length is dropped (a 10-minute exam never says "10 minutes left" at the start). A crossed threshold shows for 10 seconds; the timer colour carries it after that (amber after the first, red after the last). Because this is derived from remaining time, a resumed attempt doesn't replay old warnings.
- _Percentages round down._ `formatPercent(79.6)` is `79%`, so a failed 80% gate can never display "80%".
- _Steps run left to right._ A horizontal stepper shows done, current and locked steps; the panel below shows one step, the current one unless the learner picks a finished one. That is the whole navigation model: the learner never has to work out what comes next.
- _Exam diagrams are strict and static._ Exam files may come from anyone, so `ExamMarkdown` calls Mermaid with `securityLevel: "strict"` and no reader chrome, instead of the reader's `MermaidBlock` (which uses `loose` for the user's own documents). Diagram and chart fences render outside the code container.
- _Images are resolved, not fetched blindly._ `ExamAssets` maps file names to object URLs (inferring the MIME type, without which browsers won't draw an SVG blob). Only shipped files, `https:` and `data:image` sources load, always through `<img>`.
- _Import errors are sentences._ `describeImportIssues` turns schema issues into "file, line N: what to fix", for learners and for pasting back to the GPT.
- _Instructions is mandatory, preview is free._ "Start" creates an attempt and opens the instructions page (the acknowledgement is part of the engine). The library's "Instructions" link opens a read-only dialog that creates nothing.
- _Author material is behind `?dev=1`._ The import report, rule IDs, impact scores, question IDs in review, the event log and the demo loader are hidden from learners. Import errors still show (the importer is acting as an author).
- _Dialogs sit above everything._ `Dialog` portals into the fullscreen element when one exists (see `use-portal-container`), so confirms remain visible during a fullscreen exam.

**Debugging.** If text is mis-coloured, check specificity: element defaults use `:where()` so any `ex-` class wins. If a dialog or menu is unstyled, it is missing the `ex-portal` class that carries the tokens outside `.exam-app`. Charts use `var(--ex-…)` in SVG attributes, which modern browsers resolve.
