# Localdox Tutor: a GPT that writes Localdox-native lessons

Ask it about any topic, paste the answer into Localdox, and get a lesson with an interactive mind map, animated diagrams, JSON trees, callouts, tables and a live demo.

## Files

| File | Where it goes | What it does |
| :-- | :-- | :-- |
| `instructions.md` | GPT builder → **Instructions** (paste the whole file; about 6.7k of the 8k-character limit) | Response shapes, the lesson skeleton, visual and teaching rules |
| `format-reference.md` | GPT builder → **Knowledge** (upload) | The exact Markdown dialect Localdox renders, and what it does not render |
| `example-lesson.md` | GPT builder → **Knowledge** (upload) | The quality bar: a full lesson using every block type |

## Setup (ChatGPT → Explore GPTs → Create → Configure)

1. **Name:** Localdox Tutor. **Description:** "Explains any topic as a Localdox-ready lesson."
2. Paste `instructions.md` into **Instructions**.
3. Upload `format-reference.md` and `example-lesson.md` under **Knowledge**.
4. Capabilities: web search on, so facts are current. Image generation and code interpreter are not needed.
5. Suggested conversation starters:
   - "Teach me how HTTPS works"
   - "Deep dive: database indexing"
   - "Compare REST vs GraphQL"
   - "Quick: what is a vector embedding?"

Use it by copying the answer with ChatGPT's copy button (it copies the Markdown source), saving it as a `.md` file, and dropping it into Localdox.

## Why it is shaped this way

- **The rules come from the renderer, not from generic Markdown.** Stepped mode orders arrows by their numbers (`src/services/diagrams/explainer/plan.ts`). Node colours come from label words and shapes (`explainer/semantics.ts`), which is why the prompt bans `style`/`classDef`. Mind maps read `name`/`children`, and every other field goes into the inspector (`src/services/mindmap/mindmap.ts`). Callout markers are defined in `markdown-viewer/Callout.tsx`.
- **No raw HTML or front matter.** The viewer runs no `rehype-raw` or front-matter plugin, so `<details>` or a YAML header would appear as literal text.
- **Top-to-bottom flowcharts by default.** Diagrams scale to the reading column, so a left-to-right chain of six or more nodes becomes unreadably small (seen when rendering this example).

## Known limitation

Math (`$…$`, `$$…$$`, `{{eq:…}}`) currently renders blank in the live viewer. The math components exist but are not wired into the Markdown component map (see the note in `src/services/math/index.ts`). The prompt keeps math because the pipeline is designed for it, and it asks the GPT to explain every formula in words, so lessons still read correctly until the viewer is fixed.
