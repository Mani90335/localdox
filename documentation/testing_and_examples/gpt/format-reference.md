# Localdox Markdown Format Reference

This is the exact Markdown dialect the Localdox reader renders. Everything here is supported. Anything not listed here should be treated as unsupported.

## 1. Document structure

- The document starts with a `#` heading. Nothing comes before it: no front matter, no preamble.
- In **Paged** reading mode, every `#` heading starts a new page with previous and next controls. `##` and `###` are sections within a page and form the outline.
  - Short answer: one `#`.
  - Long lesson: one `#` per part (at most five). Each part should make sense on its own page.
- Every heading can be folded by the reader. A `### Answers` heading under a quiz works as a spoiler the reader can collapse.
- Headings get automatic ids (GitHub style: lowercase, spaces become hyphens, punctuation dropped). `[see the map](#map-of-the-topic)` jumps to `## Map of the topic`, even on another page.
- Readers can star tables, code blocks, quotes, images and diagrams, so each of those blocks should make sense on its own.

## 2. Text

GitHub Flavored Markdown: `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, links, autolinks, lists, nested lists, task lists (`- [ ]`, `- [x]`), footnotes (`[^1]`) and horizontal rules.

**Raw HTML is not rendered.** Do not use `<details>`, `<summary>`, `<br>`, `<div>`, `<span>`, `<sup>`, `<kbd>`, `<img>`, `<center>` or inline styles. The only exceptions are `<video>` and `<audio>`, which are for media files the user already has.

## 3. Callouts

A blockquote whose first line is a marker becomes a callout:

```md
> [!NOTE]
> Body text. Can span several lines, lists and code.
```

| Marker | Tone | Use for |
| :-- | :-- | :-- |
| `[!NOTE]`, `[!INFO]` | Blue | Context, the TL;DR, definitions |
| `[!TIP]` | Green | Advice, shortcuts, rules of thumb |
| `[!WARNING]`, `[!CAUTION]` | Amber | Common mistakes, gotchas |
| `[!IMPORTANT]`, `[!DANGER]` | Red | Consequences: data loss, security, irreversible actions |

Use at most one callout per section. A plain `>` blockquote stays a quotation.

## 4. Tables

GitHub tables, with alignment (`:--`, `:-:`, `--:`). Wide tables scroll sideways, but aim for:

- at most five columns, and cells under about twelve words;
- the first column as the row's name;
- a bold row label or a ✓ / ✗ in place of long prose when comparing.

Use tables for comparisons, glossaries, trade-offs, cheat sheets and step lists with columns.

## 5. Code

Always label fences with a language (`python`, `ts`, `bash`, `sql`, `yaml`, `http` and so on). Unlabelled fences are not highlighted. Use `text` for plain output. Each block gets a copy button. Keep examples minimal and runnable.

## 6. JSON tree

A ` ```json ` fence holding a valid JSON object or array renders as a collapsible tree with a full-screen button. Use it for API payloads, configuration and data shapes.

- Strict JSON only: double quotes, no comments, no trailing commas.
- Invalid JSON falls back to a plain code block.
- For JSON with comments, use ` ```jsonc `, which renders as highlighted code rather than a tree.

## 7. Mind map

A ` ```mindmap ` fence holding JSON renders as an interactive, collapsible mind map. Clicking a node opens an inspector showing its extra fields.

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
- Labels should be one to four words. Use three or four levels and about 8 to 40 nodes. Maps over 60 nodes open collapsed to one level.
- The top level must nest, meaning at least one child has its own children. A flat list has nothing to draw.
- Never include `id` fields; they are hidden anyway.
- Prefer this to Mermaid's `mindmap` diagram type, because this one has the inspector and collapsing.

## 8. Mermaid diagrams

A ` ```mermaid ` fence renders with a mode switch:

- **Raw:** the static diagram.
- **Stepped:** walks the graph one arrow at a time and reveals each node as the arrow reaches it. It works for `flowchart` and `sequenceDiagram`.
- **Flow:** continuous animated packets, optionally choreographed with a `flow:` script (see 8.5).

Readers can zoom, pan, go full screen and recolour nodes.

### 8.1 Numbered arrows control Stepped order

By default, Stepped walks breadth-first from the entry nodes. Numbering the arrow labels makes it follow your story:

```text
A -->|1. Request| B
B -->|2. Validate| C
C -->|3a. Valid| D
C -->|3b. Invalid| E
```

Accepted forms: `1`, `1.`, `1)`, `(1)`, `1:`, `#1`, `Step 1`, and `1.2` for sub-steps, each optionally followed by text. `3 retries` is **not** a step number, because a number followed directly by a word reads as a quantity. Write `3. Retry` if you mean step 3. Number the main path. Unnumbered side edges play afterwards.

### 8.2 The app colours nodes by meaning

Localdox colours nodes automatically, and consistently in light and dark themes, from:

1. **Words in the label:**

   | Role | Words |
   | :-- | :-- |
   | failure | error, fail, rejected, denied, invalid, timeout, crash, 404, 500 |
   | success | success, ok, done, complete, approved, valid, ready, 200 |
   | warning | retry, slow, pending, queued, fallback, stale, rate limit |
   | storage | database, db, cache, store, queue, log, bucket, index |
   | security | auth, login, token, session, password, encrypt, permission |
   | external | user, client, browser, mobile, third-party, webhook, cdn |
   | terminal | start, begin, end, stop, finish |

2. **Shape**, when the label is neutral: a rhombus `{…}` is a decision, a cylinder `[(…)]` is storage, a stadium `([…])` or circle `((…))` is a terminal.
3. **Incoming edge labels** such as `yes` / `no`, `ok` / `error`, `hit` / `miss`, `200` / `500`.

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

The steps are `route` (at least two node ids, and each consecutive pair must be joined by an edge), `wait` (ms), `state` (`error`, `ok` or `busy`), `parallel` (nested steps at once) and `repeat` (with `steps`).

The colours are `amber`, `red`, `green`, `blue`, `cyan`, `purple`, `pink` and `yellow`, or a quoted hex such as `"#ff0088"`. Indent with spaces only. Use it only when motion teaches something, such as the happy path followed by a failure path.

### 8.6 Other diagram types

These render in Raw mode:

| Type | Use for |
| :-- | :-- |
| `stateDiagram-v2` | Lifecycles and state machines |
| `erDiagram` | Data models |
| `classDiagram` | Object models |
| `timeline` | History and evolution |
| `quadrantChart` | Two-axis positioning |
| `pie` | Proportions (at most six slices) |
| `gitGraph` | Branching workflows |
| `gantt` | Schedules |

## 9. Math

- Inline: `$E = mc^2$`. Display: `$$ … $$` on their own lines.
- Only dollar delimiters. `\( \)` and `\[ \]` are not supported.
- To number an equation, put `\label{eq:short-name}` inside it. Refer to it in prose with `{{eq:short-name}}`, or inside math with `\eqref{eq:short-name}`. Both render as a clickable number.
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

- The default shows the result only. `split` shows the code beside the result, and `playground` makes the code editable. The flag goes after the language, as in ` ```interactive-react playground `.
- React components must use `export default function`, with **no imports**. `React`, `useState`, `useEffect`, `useLayoutEffect`, `useMemo`, `useCallback`, `useRef`, `useReducer` and `useContext` are already in scope. TypeScript is fine.
- Sandbox limits: no network (`fetch`), no external scripts, styles, fonts or CDNs, no `localStorage` or cookies, no `eval`, no popups, and images only as `data:` URLs. Everything must be self-contained.
- Style with inline styles or a `<style>` tag. The frame follows light and dark themes, so prefer `currentColor` and transparent backgrounds to hard-coded black and white.

## 11. Media and embeds

- A paragraph that is only a YouTube, Vimeo, Loom or CodePen URL renders as an embedded player.
- `![alt](url)` shows images, and also videos and audio by file extension.
- Never invent URLs. Embed only links the user supplied or that are certain to exist.

## 12. What not to output

- Front matter at the top of the document (it would render as stray text).
- Raw HTML other than `<video>` and `<audio>`.
- Mermaid `style`, `classDef`, `linkStyle` or `%%{init}%%` theming.
- Unlabelled code fences, `\(…\)` or `\[…\]` math, or JSON with comments in a ` ```json ` fence.
- Chatty preambles ("Great question!") or closing offers ("Let me know if…") inside the document.
