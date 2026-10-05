# Localdox Builder: a GPT that writes files Localdox imports

One GPT for every kind of Localdox content:

| Ask for                                         | You get                                                          | Where it goes in Localdox                       |
| :---------------------------------------------- | :--------------------------------------------------------------- | :---------------------------------------------- |
| "Teach me how HTTPS works"                      | A lesson (`.md`)                                                 | Drop into the reader                            |
| "20 practice questions on Bayes' theorem"       | `<id>.practice.md`                                               | Study plan → a topic → Practice → Add questions |
| "A 30-minute GATE-style test on linear algebra" | `.exam.json` + `.paper.md` + `.solutions.md` (+ images)          | Exam library → Import exam files                |
| "A GATE DA study plan, 40 topics"               | A `.zip`: plan, one exam and one practice file per topic, images | Study plan → Upload files                       |

## Files

| File                      | Where it goes                                                                | What it does                                                                        |
| :------------------------ | :--------------------------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| `instructions.md`         | GPT builder → **Instructions** (paste the whole file, ~5.5k of the 8k limit) | Picks the output type, delivery rules, plan and question quality, lesson shapes     |
| `format-reference.md`     | **Knowledge**                                                                | The Markdown dialect for lessons                                                    |
| `example-lesson.md`       | **Knowledge**                                                                | The quality bar for lessons                                                         |
| `exam-files-reference.md` | **Knowledge**                                                                | The contract for exams, practice files, study plans, taxonomies, images and the zip |
| `example-course.md`       | **Knowledge**                                                                | A complete two-topic upload, validated with Localdox's importers                    |

## Setup (ChatGPT → Explore GPTs → Create → Configure)

1. **Name:** Localdox Builder. **Description:** "Lessons, practice, exams and study plans that import straight into Localdox."
2. Paste `instructions.md` into **Instructions**.
3. Upload the four knowledge files.
4. Capabilities: **web search on** (real exam patterns and syllabi change), **code interpreter on** (it validates JSON and builds the zip). Image generation is not needed; diagrams are Mermaid or SVG.
5. Conversation starters:
   - "Prepare me for GATE 2027 DA: a study plan for the first 10 topics"
   - "20 practice questions on eigenvalues, GATE style"
   - "A full-length JEE Main mock test"
   - "Teach me conditional probability"

## Using what it produces

- **Zip or several files:** download, then in Exam Workspaces choose **Study plan → Upload files** (or **Exam library → Import exam files** for a single exam). Select the zip or all files at once.
- **A lesson:** copy the answer with ChatGPT's copy button (Markdown source), save as `.md`, open it in Localdox.
- **If an import fails,** Localdox lists each problem with the file and line ("paper.md, line 12: A ::: block is not closed"). Paste that message back to the GPT and ask for corrected files.

## Why it is shaped this way

- **The contract comes from the importers, not from generic Markdown.** Every JSON object is strict (`src/services/exams/schema.ts`, `study-plan.ts`), so the reference lists every allowed field and the GPT is told never to add others. MCQ option counts must equal `optionCount` (`validation.ts`), a frequent generation error, so it is repeated in the instructions.
- **One zip, flat names.** The importer ignores folders and routes files by suffix (`src/services/exams/bundle.ts`). Unique names are the only layout rule.
- **Practice in one file.** Questions and solutions sit together because practice shows the key right after each answer. Exam solutions stay in a separate, sealed file.
- **No analytics fields.** The product shows score, key and solutions only, so exams use `diagnostics.enabled: false` and need no taxonomy unless custom difficulty labels are wanted.
- **Images as SVG files the GPT writes.** They are small, sharp when zoomed, render offline, and an SVG shown through `<img>` cannot run script.
- **Lesson rules come from the reader.** Stepped mode orders arrows by their numbers (`src/services/diagrams/explainer/plan.ts`); node colours come from label words and shapes (`explainer/semantics.ts`), hence no `style`/`classDef`; mind maps read `name`/`children` (`src/services/mindmap/mindmap.ts`); callouts are defined in `markdown-viewer/Callout.tsx`. Raw HTML and front matter are not rendered.
