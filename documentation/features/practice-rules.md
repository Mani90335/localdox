# Practice rules and solve times

Practice files (`.xp`) now display one question at a time. Answering reveals its key and explanation and stops the solve timer. Next advances after an answer or skip; Previous reviews completed questions without revealing future ones. A deadline records an unanswered timeout and moves to the next question automatically. On the last question it shows the solution and completion state.

## Authoring

Create a Practice ruleset in **Settings → Exam rules → New ruleset**, or use **New practice rules** beside a practice file. Select it using the file's Practice rules menu. The menu writes the same header an author can enter in code:

```markdown
---
rules: Timed practice.xrule
---
```

```json
{
  "xrule": 1,
  "name": "Timed practice",
  "practice": {
    "questionTimeLimitSeconds": 90,
    "showElapsedTime": true,
    "allowSkip": true
  }
}
```

`questionTimeLimitSeconds` is an integer from 1 to 36000; `null` means untimed. Expiry always advances. `showElapsedTime` controls the elapsed/solve-time display, while a timed question always shows its countdown. `allowSkip` enables Skip and reveal answer. Defaults are untimed, visible solve times, and skipping enabled. Practice remains sequential, with immediate feedback and no negative marking. The practice block can also be added to an exam ruleset: `.xam` scoring remains unchanged.

The ruleset form has Primary controls and a collapsed Advanced section. JSON edits the same draft. Full exam rules expose the engine schema's nested fields, optional values, arrays, marking variants, and diagnostic conditions. Customize all exam rules expands a preset or simple ruleset; explicit primary values still override corresponding nested rules. Save validates with the existing importer. Cancel/Escape discards the draft. Normal settings continue to apply immediately.

## Ownership and timing

Rules and their header links belong to workspace files and travel with export. Answers and timings do not. `practice-progress.ts` writes only to `localStorage`, under `localdox:practice-answers:<fileId>` and `localdox:practice-times:<fileId>`; nothing is sent to exam storage, IndexedDB, exports, or a server.

The displayed question owns its clock. Wall-clock differences avoid drift when interval callbacks are delayed. Time checkpoints are saved once per elapsed second and on page exit/unmount. Leaving practice, opening settings, or reviewing a previous answer pauses the unanswered question; a background browser tab continues counting. Reopening resumes the saved elapsed time, excluding time away. A delayed callback times out only the displayed question, giving the next question its own full interval rather than expiring unseen questions.

Question/key signatures invalidate obsolete answers and times after edits. Start over clears both stores. An in-memory generation prevents an outgoing timer's cleanup from restoring cleared times. Missing or invalid linked rules block practice and offer the rules selector/editor, so a broken link cannot silently disable a deadline. Blocked or full localStorage does not prevent practice; reload recovery is then unavailable.

## Implementation and verification

`practice-rules.ts` owns the small Zod schema; `.xrule` embeds it. `PracticeFileViewer` resolves workspace rules, owns sequential progress, and mounts one timed question. `RulesetEditor` and `RulesetFields` reuse the installed MIT-licensed Zod schema and existing controls instead of adding a form-generator package and its second validation model. The trade-off is a small schema-driven editor tied to the existing Zod version.

Unit coverage checks rule validation, header line handling, corrupt/blocked storage, file isolation, reset races, and edit invalidation. Playwright covers sequential disclosure, all three answer types, deadlines through the final question, reloads, form authoring, nested exam controls, keyboard cancellation, and phone layouts.
