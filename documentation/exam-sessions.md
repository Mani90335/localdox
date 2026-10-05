# Exam Sessions

The reader now has a separate `/exams` route, linked from its home page. It combines configured exam rules with deterministic feedback about lost marks, pacing, confidence and known distractors.

The flow is `files → validation → instructions → timed session → sealed submission → reflection → scoring/analysis → review → cross-attempt dashboard`. The engine never identifies an exam by name. `schema.ts`, `parser.ts` and `validation.ts` establish the file boundary; `session.ts` replays events and enforces deadlines/navigation; `scoring.ts` applies question-type policies; `diagnostics.ts` interprets the rule data and aggregates evidence. These modules have no UI dependencies.

`storage.ts` owns a separate IndexedDB database and refuses to read solutions before submission. Imported keys remain opaque Blobs; bundled keys are non-inlined assets fetched only after the submission is persisted. The browser lock serializes writers across tabs. A synchronous localStorage recovery journal holds pending response/progress snapshots until their IndexedDB writes commit; startup restores unfinished writes before resuming. Paper and solution content never enters that journal. A storage error is visible and blocks further answer changes until saving succeeds. Reimporting content does not rewrite the exam snapshot held by an existing attempt.

The UI uses the existing typography/colors, Radix modal, KaTeX, Mermaid and Recharts. Exam Markdown deliberately does not execute the reader's interactive React/code fences. The rule interpreter and scientific calculator also execute no JavaScript strings. Marks-loss attribution is evidence, not a claim about a person's mental state; journals therefore preserve self-reports beside engine findings.

The main tradeoff is the conflicting solution-validation timing: keys cannot be checked before starting without reading them. Validation is deferred until after submission, and a malformed/missing key leaves a retryable locked submission. There is no pretense of server-backed secrecy or tamper-proof proctoring in a local Markdown reader.

For the complete field reference, file examples, rule authoring guide, sample caveats, diagnostics semantics and checks, see [Exam format](../docs/exam-format.md). Start with the two-section quiz to exercise the complete flow quickly, or use the development demo to view every built-in diagnostic flag.

## Daily study progression

Study plans add an ordered learning path above the exam engine. `study-plan.ts` validates plan files, derives day status from linked attempts, and enforces the daily gate. Manual task checks and notes are stored separately from exam outcomes, so completing a checklist cannot unlock a day. The exam JSON owns the passing percentage (80% by default), finite `attempts.max`, and replacement-paper difficulty percentage.

Each plan pins its initial exam policy and paper snapshots. Failed attempts leave the next day locked; exhaustion requires revision acknowledgement and a different qualifying paper. Content fingerprints ignore renamed IDs, shuffled ordering and whitespace so superficial edits do not reset the limit. A new paper gets its own attempt cycle, with the original policy retained. The UI keeps the current day, available action and reason for any lock visible together.

The IndexedDB upgrade adds a `plans` store without replacing existing exam/attempt stores. All writes use the same exclusive browser lock and serialized save queue. Tests cover exact thresholds, attempts, revision, policy retention, difficulty checks, progress durability and end-to-end unlock behavior. See [Study plan format](../docs/study-plan-format.md) for the complete authoring format and examples.
