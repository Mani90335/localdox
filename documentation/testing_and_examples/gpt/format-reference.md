# Localdox Markdown Format Reference

This is the exact Markdown dialect the Localdox reader renders for lessons (`.md` files). Everything here is supported. Treat anything not listed as unsupported: it shows as literal text.

Exam papers (`.xam`) and practice sets (`.xp`) use a different, stricter grammar; see exam-files-reference.md.

## 1. Document structure

- The document starts with a `#` heading. Anything before the first `#` becomes an extra page titled with the file name, so put nothing there: no front matter, no preamble.
- In **Paged** reading mode, every `#` heading starts a new page with previous and next controls. `##` and `###` are sections within a page and form the outline. (Readers can also switch to Single page.)
  - Short answer: one `#`.
  - Long lesson: one `#` per part (at most five). Each part should make sense on its own page.
- **`#` titles are plain text.** The page title is printed as written, so no `**bold**`, `` `code` ``, links or `$math$` in a `#` line. `##` and lower headings may use inline formatting.
- Headings get automatic ids (GitHub style: lowercase, spaces become hyphens, punctuation dropped; repeats get `-1`, `-2`). `[see the map](#map-of-the-topic)` jumps to `## Map of the topic`, even on another page.
- Readers can fold any heading by hand (on wider screens), but nothing starts folded. A `### Answers` heading is not hidden; place answers after the questions and say "Try first, then read on."
- Use backtick fences (` ``` `) only. The page splitter does not recognise `~~~` fences, so a `#` line inside one would split the page.

## 2. Text

GitHub Flavored Markdown: `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, links, autolinks, lists, nested lists, tables, footnotes (`[^1]`) and horizontal rules.

- **Task lists are interactive.** `- [ ]` and `- [x]` render as checkboxes the reader can tick, and ticking rewrites the marker in the file. Use them for a recap or a to-do list the learner owns.
- **Footnotes:** keep each `[^1]` and its definition inside the same `#` part, because Paged mode renders one part at a time.

**Raw HTML is shown as literal text**, tags and all. Do not write `<details>`, `<summary>`, `<br>`, `<div>`, `<span>`, `<sup>`, `<sub>`, `<kbd>`, `<center>`, HTML comments (`<!-- -->`) or inline styles. The only exceptions are a block holding exactly one `<img>`, `<video>` or `<audio>` element (with `<source>` children allowed), for media files the user already has.

Not supported (shows as typed): `==highlight==`, `[[wiki links]]`, emoji shortcodes, `:::` admonitions, tabs, definition lists, abbreviations, `[TOC]`.

## 3. Callouts

A blockquote whose first line is a marker becomes a callout. **Leave a bare `>` line after the marker**: the marker's own paragraph is flattened to plain text, so bold, code, links and math on the lines directly below it would be lost.

```md
> [!NOTE]
>
> **In one breath:** body text. Can span several lines, lists, math and code.
```

| Marker | Tone | Use for |
| :-- | :-- | :-- |
| `[!NOTE]`, `[!INFO]` | Blue | Context, the TL;DR, definitions |
| `[!TIP]` | Green | Advice, shortcuts, rules of thumb |
| `[!WARNING]`, `[!CAUTION]` | Amber | Common mistakes, gotchas |
| `[!IMPORTANT]`, `[!DANGER]` | Red | Consequences: data loss, security, irreversible actions |

- The label is always the marker's word ("Note", "Tip"…); text after the marker on its line is body, not a title. Markers are case-insensitive.
- Other types (`[!SUCCESS]`, `[!QUESTION]`) and fold forms (`[!NOTE]-`) are not supported.
- Use at most one callout per section. A plain `>` blockquote stays a quotation.

## 4. Tables

GitHub tables, with alignment (`:--`, `:-:`, `--:`). Wide tables scroll sideways, but aim for:

- at most five columns, and cells under about twelve words;
- the first column as the row's name;
- a bold row label or a ✓ / ✗ in place of long prose when comparing.

Use tables for comparisons, glossaries, trade-offs, cheat sheets and step lists with columns.

## 5. Code

Always label fences with a language. Highlighted: `bash`/`sh`/`shell`, `c`, `cpp`, `csharp`, `css`, `diff`, `go`, `graphql`, `ini`/`toml`, `java`, `javascript`/`js`/`jsx`, `json`/`jsonc`, `kotlin`, `less`, `lua`, `makefile`, `markdown`, `objectivec`, `perl`, `php`, `python`/`py`, `r`, `ruby`, `rust`, `scss`, `sql`, `swift`, `typescript`/`ts`/`tsx`, `vbnet`, `wasm`, `xml`/`html`/`svg`, `yaml`/`yml`. Use `text` for plain output. Other languages (`http`, `dockerfile`, `powershell`, `haskell`, `latex`) show as plain monospace; label them anyway. Each block gets a copy button. Keep examples minimal and runnable.

## 6. JSON tree

A ` ```json ` fence holding a valid JSON object or array renders as a collapsible tree with a full-screen button. Use it for API payloads, configuration and data shapes.

- Strict JSON only: double quotes, no comments, no trailing commas.
- Invalid JSON falls back to a plain code block.
- For JSON with comments, use ` ```jsonc `, which renders as highlighted code rather than a tree.

## 7. Mind map

A ` ```mindmap ` fence holding JSON renders as an interactive, collapsible mind map with a full-screen button. Clicking a node opens an inspector showing its extra fields.

```mindmap
{
  "name": "Root topic",
  "children": [
    {
      "name": "Branch",
      "summary": "Shown in the inspector when clicked",
      "children": [
        { "name": "Leaf", "summary": "One-line explanation" }
      ]
    }
  ]
}
```

- The label key is `name` (also `label`, `title`, `text`). The child key is `children`.
- Every other field (`summary`, `example`, `why`) goes to the inspector and is not drawn on the map. Put a one-sentence `summary` on each node. This is where the map teaches.
- Labels should be one to four words. Use three or four levels and about 8 to 40 nodes. Maps up to 60 nodes open two levels deep; larger ones open collapsed to one level.
- Make the top level nest (at least one child with its own children); a flat fan teaches little.
- Never include `id` fields; they are hidden anyway.
- Invalid JSON shows the raw source with the reason.
- Prefer this to Mermaid's `mindmap` diagram type, because this one has the inspector and collapsing.

## 8. Mermaid diagrams

A ` ```mermaid ` fence renders with a mode switch:

- **Raw:** the static diagram.
- **Stepped:** walks the graph one arrow at a time and reveals each node as the arrow reaches it. Works for `flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram` and `erDiagram`.
- **Flow:** continuous animated packets, optionally choreographed with a `flow:` script (see 8.5).

Readers can zoom, pan, go full screen and recolour nodes.

### 8.1 Numbered arrows control Stepped order

By default, Stepped walks breadth-first from the entry nodes. Numbering the arrow labels makes it follow your story:

```text
A -->|1. Request| B
B -->|2. Validate| C
C -->|3.1 Valid| D
C -->|3.2 Invalid| E
```

Accepted forms: `1`, `1.`, `1)`, `(1)`, `1:`, `1 -`, `#1`, `Step 1`, and `1.2` for sub-steps, each optionally followed by text. Branches use sub-steps (`3.1`, `3.2`), **not** `3a`/`3b`, which are not read as numbers. `3 retries` is not a step number either, because a number followed directly by a word reads as a quantity; write `3. Retry`. Number the main path. Unnumbered edges play afterwards. Sequence diagrams always play in written order.

### 8.2 The app colours nodes by meaning

Localdox colours nodes automatically, and consistently in light and dark themes, from:

1. **Whole words in the label** (first matching role wins, in this order):

   | Role | Words (examples) |
   | :-- | :-- |
   | failure | error, fail, failed, rejected, denied, invalid, timeout, crash, missing, not found, unauthorized, 404, 500 |
   | success | success, ok, done, complete, approved, valid, ready, verified, passed, granted, 200 |
   | warning | retry, slow, pending, queued, fallback, stale, rate limit, waiting, degraded, throttled |
   | storage | database, db, cache, store, queue, log, bucket, index, redis, postgres, s3, table, disk |
   | security | auth, login, token, session, password, encrypt, permission, jwt, oauth, secret, tls, role |
   | external | user, client, browser, mobile, third-party, webhook, cdn, customer, vendor, internet |
   | terminal | start, begin, end, stop, finish, exit, init, shutdown |

   Matching is by whole word: "Authentication" or "Databases" do not match; "Auth service" and "User DB" do.
2. **Shape**, when the label is neutral: a rhombus `{…}` is a decision, a cylinder `[(…)]` is storage, a stadium `([…])` or circle `((…))` is a terminal.
3. **Edge labels** such as `yes` / `no`, `ok` / `error`, `hit` / `miss`, `200` / `500` colour the edge and its target.

So choose honest words and shapes, and **do not** add `style`, `classDef`, `class`, `linkStyle` or `%%{init}%%` theme directives. Manual fills override the theme and can become unreadable in dark mode.

### 8.3 Clean flowchart rules

- Default to `flowchart TD`. Use `flowchart LR` only for short pipelines whose longest path has at most four nodes. The diagram is scaled to fit the reading column, so a long left-to-right chain becomes tiny text. Do not use the older `graph` keyword.
- Node ids are short CamelCase words (`Client`, `AuthSvc`, `UserDB`). Put readable text in the label: `AuthSvc[Auth service]`.
- Never use `end` as an id (use `Done`). Do not start an id with `o` or `x` right after an arrow (`A-->oB` draws a circle arrowhead). Avoid ids that are keywords: `graph`, `subgraph`, `style`, `class`, `click`, `default`.
- Labels are two to five words. Wrap any label containing `( ) [ ] { } : ; # / < > |` or quotes in double quotes: `LB["Load balancer (L7)"]`. Never put Markdown, HTML or `<br>` in labels.
- Shapes: `[Process]`, `{Decision?}`, `[(Database)]`, `([Start])`, `((Event))`, `[/Input/]`, `{{Prepare}}`.
- Edges: `-->` normal, `-.->` optional or async, `==>` critical path, `-->|label|` labelled.
- Group with `subgraph Api["API layer"]` … `end`.
- Keep each diagram under about 15 nodes and 20 edges. Split larger ideas into several diagrams, each with one message and a one-line caption above it.
- Do not use semicolons at line ends, and give each statement its own line.

### 8.4 Sequence diagrams

Use these for protocols and request/response over time. Stepped mode plays the messages in order.

```text
sequenceDiagram
  autonumber
  participant C as Client
  participant S as Server
  C->>S: Request
  S-->>C: Response
  alt Success
    S-->>C: 200 OK
  else Failure
    S-->>C: 401 Unauthorized
  end
  Note over C,S: TLS already established
```

`->>` is a request and `-->>` is a reply. Keep message text short, and avoid `;` and `#` in it. Use `alt`/`else`, `opt`, `loop` and `par` for control flow.

### 8.5 Flow choreography (optional)

YAML front matter at the very top of the Mermaid fence scripts the Flow mode:

```text
---
flow:
  loop:
    - route: [Client, Gateway, Service]
      color: green
    - wait: 400
    - state: { Service: error }
    - route: [Client, Gateway, Fallback]
      color: amber
---
flowchart LR
  Client --> Gateway --> Service
  Gateway --> Fallback
```

- Steps: `route` (at least two node **ids**, each consecutive pair joined by an edge in either direction; optional `dur` in ms), `wait` (ms), `state` (`error`, `ok` or `busy`), `parallel` (nested steps at once) and `repeat: 3` with `steps:`.
- Top-level options: `speed` (pixels per second, default 220), `dim` (default `true`). `steps:` may replace `loop:` for a one-shot script.
- Colours: `amber`, `red`, `green`, `blue`, `cyan`, `purple`, `pink`, `yellow`, or a quoted hex such as `"#ff0088"`. An unknown colour or state is an error.
- Indent with spaces only. Use it only when motion teaches something, such as the happy path followed by a failure path.

### 8.6 Other diagram types

These render in Raw and Flow modes (Stepped is disabled for them):

| Type | Use for |
| :-- | :-- |
| `timeline` | History and evolution |
| `quadrantChart` | Two-axis positioning |
| `pie` | Proportions (at most six slices) |
| `gitGraph` | Branching workflows |
| `gantt` | Schedules |

`stateDiagram-v2` (lifecycles), `erDiagram` (data models) and `classDiagram` (object models) also step, like flowcharts.

## 9. Math

- Inline: `$E = mc^2$`. Display: `$$ … $$` with the `$$` lines on their own.
- Only dollar delimiters. `\( \)` and `\[ \]` are not supported.
- **Display equations that state a relation** (`=`, `<`, `\le`, `\approx`, `\to`, …) or use `align`/`gather`/`cases` **are numbered automatically**, counting through the whole document. Add `\nonumber` to skip one; `\tag{2a}` sets a custom number.
- To refer to an equation, put `\label{eq:short-name}` inside it (letters, digits, `_ : . -`). Refer to it in prose with `{{eq:short-name}}`, or inside math with `\eqref{eq:short-name}` (shows "(3)") or `\ref{eq:short-name}` (shows "3"). All render as clickable numbers.
- Multi-line derivations: use `aligned` inside `$$ … $$` (or `align*`); plain `align` gets a second, duplicate number on each row.
- Preloaded macros: `\R \C \Z \N \Q`, `\abs{x}`, `\norm{x}`, `\set{…}`, `\dd`, `\grad`, `\curl`, `\laplacian`, `\Tr`, `\bra{}`, `\ket{}`, `\braket{}{}`, `\expval{}`, `\vb{}`, `\vu{}`, `\unit{}`, `\degree`, `\eV`. Physics-package commands such as `\dv`, `\pdv` and `\qty` also work. Chemistry `\ce{}` does not.
- Escape a literal dollar sign in prose as `\$5`.
- After each important formula, say in words what each symbol means.

## 10. Interactive blocks

These run sandboxed live demos in the document. Use one per lesson at most, and only when manipulating something builds intuition (sliders, simulations, toggles).

````text
```interactive-html
<label>Rate <input id="r" type="range"></label>
<output id="o"></output>
<script>/* plain inline JS */</script>
```
````

````text
```interactive-react split
export default function Demo() {
  const [n, setN] = useState(3);
  return <button onClick={() => setN(n + 1)}>Clicked {n} times</button>;
}
```
````

- The default (or `preview`) shows the result only. `split` shows the code beside the result, and `playground` makes the code editable. The flag goes after the language, as in ` ```interactive-react playground `.
- React: a default-exported function component, with **no imports** (an `import` line is an error). `React`, `useState`, `useEffect`, `useLayoutEffect`, `useMemo`, `useCallback`, `useRef`, `useReducer` and `useContext` are already in scope. TypeScript is fine.
- Sandbox limits: no network (`fetch`), no external scripts, styles, fonts or CDNs, no `localStorage` or cookies, no `eval`, no popups, no clipboard, and images only as `data:` URLs. Everything must be self-contained. The frame is 176–960 px tall.
- Style with inline styles or a `<style>` tag. The frame follows light and dark themes (`body[data-theme="dark"]` in dark), so prefer `currentColor` and transparent backgrounds to hard-coded black and white.

## 11. Media and embeds

- **Embeds:** a paragraph that is only a URL (bare, `<url>`, or `[](url)`) renders as a player for YouTube (`watch?v=`, `youtu.be/`, `/embed/`; not Shorts), Vimeo, Loom (`/share/`), CodePen (`/pen/`), CodeSandbox, StackBlitz, GitHub Gist and Google Drive (`/file/d/`). A link with its own text (`[Watch](url)`) stays a plain link.
- `![alt](url)` shows images, and also videos and audio by file extension (images: png, jpg, webp, gif, svg, avif; video: mp4, webm, mov; audio: mp3, wav, ogg, m4a). Clicking an image opens a lightbox.
- **Files in the workspace:** `![alt](diagram.svg)` finds a uniquely named file anywhere in the workspace; `![alt](figures/diagram.svg)` resolves from the lesson's folder; a leading `/` means the workspace root. `![[notes/summary.pdf]]` embeds a workspace file inline (PDF, Word, sheets, slides, `.md`, `.mmd` diagrams, `.board` drawings).
- A path to a file that doesn't exist shows "Couldn't find …". Don't link to lessons or files you haven't delivered.
- Never invent URLs. Embed only links the user supplied or that are certain to exist.

## 12. What not to output

- Front matter at the top of the document (it renders as a stray rule and heading).
- Raw HTML, including comments, other than a lone `<img>`, `<video>` or `<audio>`.
- Formatting or math inside `#` titles.
- Mermaid `style`, `classDef`, `linkStyle` or `%%{init}%%` theming; `3a`-style step numbers.
- Unlabelled code fences, `~~~` fences, `\(…\)` or `\[…\]` math, or JSON with comments in a ` ```json ` fence.
- A ` ```chart ` fence: charts render only inside exam and practice files. In a lesson, use a Mermaid `pie`/`quadrantChart`, a table, or an interactive block.
- Callout markers followed directly by body text (leave a bare `>` line).
- Chatty preambles ("Great question!") or closing offers ("Let me know if…") inside the document.
