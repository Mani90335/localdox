# Localdox Builder: a GPT that writes files Localdox opens

One custom GPT for every kind of Localdox content:

| Ask for | You get | How it gets into Localdox |
| :-- | :-- | :-- |
| "Teach me how HTTPS works" | A lesson (`.md`) | + ▸ Upload files, or paste into + ▸ File |
| "25 practice questions on Bayes' theorem" | A practice set (`.xp`) | Exam Workspace ▸ + ▸ Upload files |
| "Probability mock on X, Y, Z, medium, 100 questions, with PYQs" | Exam rules (`.xrule`) + paper (`.xam`) | Exam Workspace ▸ + ▸ Upload files (both at once) |
| "GATE-style rules: 3 hours, 1/3 negative marking" | A ruleset (`.xrule`) | Upload, then Settings ▸ Exam rules |
| "A GATE DA study plan" | A workspace backup (`.json`) with a folder per topic | Settings ▸ Workspace ▸ Transfer ▸ Import workspace |

## Files

| File | Where it goes | What it does |
| :-- | :-- | :-- |
| `instructions.md` | GPT builder → **Instructions** (paste the whole file, ~7.4k of the 8k limit) | Picks the output, maps a request to rules, delivery, question quality, lesson shapes |
| `exam-files-reference.md` | **Knowledge** | The contract for `.xrule`, `.xam`, `.xp`, delivery, self-check, error messages |
| `example-files.md` | **Knowledge** | A complete exam, its rules and a practice set, validated with Localdox's parsers |
| `localdox_check.py` | **Knowledge** | Checks files before delivery; `--build` packs a folder into a workspace backup |
| `format-reference.md` | **Knowledge** | The Markdown dialect for lessons |
| `example-lesson.md` | **Knowledge** | The quality bar for lessons |

## Setup (ChatGPT → Explore GPTs → Create → Configure)

1. **Name:** Localdox Builder. **Description:** "Lessons, practice sets, exams and study plans that open straight in Localdox."
2. Paste `instructions.md` into **Instructions**.
3. Upload the five knowledge files.
4. Capabilities: **web search on** (exam patterns, syllabi and past papers change), **code interpreter on** (it runs `localdox_check.py`, verifies numeric answers and builds backups). Image generation is not needed; figures are Mermaid, `chart` or SVG.
5. Conversation starters:
   - "A 100-question probability mock, medium difficulty, GATE marking"
   - "20 practice questions on eigenvalues"
   - "Rules for a full-length GATE DA mock"
   - "A GATE DA study plan for the first 10 topics"
   - "Teach me conditional probability"

The instructions tell the GPT to run `python /mnt/data/localdox_check.py`, the folder where ChatGPT exposes knowledge files to the code interpreter. If a run reports the file missing, ask the GPT to `ls /mnt/data` and use the path it finds.

## Using what it produces

1. **Make an Exam Workspace first:** Settings ▸ Workspace ▸ New, kind **Exam**. An upload made with no workspace open creates a Reader workspace, where papers only preview.
2. **Loose files:** + ▸ **Upload files** and select the `.xrule`, `.xam`, `.xp` and any images **together**. Everything lands at the workspace root; make folders with + ▸ Folder and drag papers and practice sets in. Rulesets don't appear in the sidebar; they're under Settings ▸ Exam rules. Zips are not unpacked.
3. **A backup `.json`:** Settings ▸ Workspace ▸ Transfer ▸ **Import workspace**. It creates a new Exam Workspace with its folders.
4. **A lesson:** copy the answer with ChatGPT's copy button (Markdown source), then + ▸ File, a name ending `.md`, and paste.
5. **If a file is refused,** Localdox lists each problem with its file and line ("probability-mock-1.xam:14: Wrong option count"). Paste that back to the GPT and ask for the corrected file.

Two upload pitfalls the GPT can't prevent: a file whose name already exists prompts a rename (which breaks a paper's `rules:` header), and a file identical to one already in the workspace is skipped.

## Why it is shaped this way

- **The contract comes from the parsers.** `src/services/exams/xrule.ts` and `schema.ts` are strict Zod schemas, so the reference lists every allowed field. `parser.ts` reads papers with `remark-directive`, which is why ids can't contain dots (`#q1.a` is read as a class) and why a list right above the options merges with them. `exam-setup.ts` validates every paper against the built-in taxonomy, so `topic=` is refused and `difficulty` is limited to easy/medium/hard. Each rule in the reference was reproduced against the real parser.
- **A checker as a knowledge file.** A 100-question paper has 100 chances to break an import. `localdox_check.py` mirrors the parsers' rules in standard-library Python, so the GPT's code interpreter can run it. It was differentially tested against `readExamFile` / `readPracticeFile` on 58 cases, including the repo's `plans/` files; it never accepts what the app rejects, and is stricter only in rejecting spaces in `tags`. When the exam parsers change, re-run that comparison.
- **The `rules:` header on every paper.** Uploads land at the workspace root and rulesets can't be moved into folders, so folder-based rule lookup becomes ambiguous as soon as there are two rulesets. A header names its ruleset exactly, wherever the files end up (`paper-plan.ts`, `rulesFileFor`).
- **Study plans as workspace backups.** The plan file, bundle importer and Learn/Practice/Exam/Review stepper were removed. Folders are now the plan, and the workspace backup (`src/lib/workspace/persistence.ts`, `parseWorkspaceImport`) is the only import that preserves folders.
- **PYQs must be real or labelled as style.** Tags are not shown to learners, so provenance goes in the question text. A fabricated "GATE 2019 Q.23" is worse than an honest original.
- **Lesson rules come from the reader.** Callouts lose formatting on the marker's own lines (`markdown-viewer/Callout.tsx`), hence the blank `>` line. Stepped mode reads `3.1`, not `3a` (`src/services/diagrams/explainer/plan.ts`). Node colours come from whole label words (`explainer/semantics.ts`), hence no `style`/`classDef`. Raw HTML is shown as literal text (react-markdown without `rehype-raw`).
