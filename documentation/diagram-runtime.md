# Diagram runtime: one Mermaid at a time, caches by bytes, heavy diagrams on request

This note explains three rules for how the reader runs Mermaid (audit item R02):

1. Only one job uses Mermaid at a time.
2. Rendered diagrams are cached up to a byte budget, not an entry count.
3. A diagram that would freeze the page is shown as source until the reader
   asks for it to be drawn.

## 1. Mermaid is a single global

### The problem

`mermaid` is one object shared by the whole page. Using it takes two steps:

```ts
mermaid.initialize({ theme: "dark", htmlLabels: true, ... }); // set the settings
await mermaid.render(id, source);                            // draw with them
```

`initialize()` replaces the settings for everyone. `render()` reads them when
it starts, and the diagram's renderer reads them again partway through, after
an `await`. Mermaid queues its renders, but it doesn't queue the
`initialize()` in front of each one. So this could happen:

```
small diagram:  initialize(normal) → render starts … await …   draws with PERF settings
large diagram:                        initialize(perf) ↑
```

Five places called `initialize()` with different settings:

- the SVG render cache: theme, plus performance mode for huge diagrams
- the GPU engine's theme lookup: performance settings
- the Mermaid parse for the GPU engine: edge limit raised to 500,000
- mermaid-animator's Flow mode and its WebM export: their own theme and
  `securityLevel`

The visible result was that a normal diagram next to a large one came out
with plain-text labels (`htmlLabels: false`), so bold text, line breaks and
wrapping were lost. The render cache then stored that wrong SVG under the
normal key, and it stayed wrong for the rest of the session. On the HEAD build
the probe reproduced it in 7 of 15 page loads across four document layouts.
With the small diagram first it failed in 3 of 3 loads: 0 HTML labels instead
of 25.

### The fix: `withMermaid` (src/services/diagrams/mermaid-runtime.ts)

Think of a shared workshop machine with a sign-up sheet. Whoever is at the
machine sets it up the way they need, uses it, and leaves before the next
person starts. Nobody changes the settings while someone else is working.

```ts
withMermaid(
  (mermaid) => mermaid.render(id, code), // the job
  { config: { theme, ...settings }, label: "render" },
);
```

- **FIFO queue.** A job starts only after the previous one has settled.
  Setup (load Mermaid, `initialize(config)`) and the work run inside the job.
- **Failure isolation.** A rejected job doesn't block the ones behind it.
- **No throughput cost.** Mermaid layout runs on the main thread, so two
  renders never ran in parallel anyway.
- **Jobs that configure Mermaid themselves** (mermaid-animator) pass no
  `config`. They are queued so their `initialize()` can't leak out.
- **Never nest.** A job that calls `withMermaid` waits for itself.
- **Cancellation.** A queued job can't be withdrawn. A stage that unmounts
  checks, when its job starts, whether it is still wanted (AnimatorStage
  checks its `disposed` flag and render generation), and shared cache renders
  are kept for whoever asks next.

Every call site goes through it: `renderMermaid`, `diagramTheme`,
`parseWithMermaid`, `AnimatorStage`, and the WebM export in `Mermaid.tsx`.
`parseWithMermaid` also reads the parsed model inside the job, because a
diagram's database can be module state that the next render clears.

**Trade-off:** the WebM export holds the queue while it records (a few
seconds), because mermaid-animator doesn't say when its render has finished.
Other diagrams wait during that time.

### Observability

Each job leaves a User Timing entry named `mermaid:<label>` (`render`, `theme`,
`parse`, `animate`, `export`). Its `detail.waitedMs` is the time the job spent
in the queue. You can see them in the DevTools Performance panel's Timings
track, or from the console:

```js
performance.getEntriesByType("measure").filter((e) => e.name.startsWith("mermaid:"));
```

The e2e test checks that these entries never overlap.

## 2. Caches bounded by bytes

The SVG cache held 6 entries and the GPU scene cache held 3. Count is the
wrong unit. Six small diagrams are a few hundred KB, and a document with more
than six re-rendered each one the reader scrolled back to. Three 60,000-node
scenes are more than 100 MiB.

Both caches now use the shared `BoundedPromiseCache` (src/lib/, first written
for the PDF reader). It is least-recently-used, with a weight function:

| cache                           | weight                          | budget |
| ------------------------------- | ------------------------------- | ------ |
| SVG (`mermaid-render-cache.ts`) | `svg.length × 2` (UTF-16 bytes) | 12 MiB |
| scenes (`engine/engine.ts`)     | `sceneBytes(scene)` (scene.ts)  | 48 MiB |

- **The newest entry always stays**, even over budget. The diagram being read
  still opens in full screen or switches Raw ↔ Stepped without being laid out
  again.
- **In-flight renders are shared promises**, so two stages mounting together
  share one render.
- **A rejected promise is dropped**, so fixing a typo re-renders.
- **`sceneBytes` is an estimate.** Typed arrays are counted exactly, label text
  at 2 bytes per character, plus 256 bytes per node and edge for objects and
  maps. Against node's heap it measured 42 vs 33 MiB at 60,000 nodes and 14 vs
  13 MiB at 20,000.
- `mermaidRenderCacheStats()` and `sceneCacheStats()` report entries and bytes
  for debugging.

## 3. Heavy diagrams are held as source (preflight.ts)

Large flowcharts, ER, class and state diagrams go to the GPU engine, which lays
them out in a worker under a time limit. Mermaid lays out every other kind on
the main thread. Performance mode only flattens the result into an image, after
the layout has already frozen the page.

Measured in Chromium (Mermaid 11.16):

| kind     | size           | main-thread render |
| -------- | -------------- | ------------------ |
| sequence | 2,000 messages | 540 ms             |
| gantt    | 1,000 tasks    | 215 ms             |
| kanban   | 1,500 cards    | 1.4 s              |
| mindmap  | 200 nodes      | 1.0 s              |
| mindmap  | 400 nodes      | 2.8 s              |
| mindmap  | 1,000 nodes    | 19 s, then threw   |
| mindmap  | 2,000 nodes    | > 60 s             |

Mindmaps use a force layout whose cost grows much faster than the node count,
and the old source scan couldn't see them because mindmaps have no edge lines.
The preflight holds, before Mermaid is imported:

- a mindmap with more than **200** content lines (nodes)
- any other main-thread kind past **3,000** lines or **300,000** characters

A held diagram gets `renderer: "held"` in the render decision. Raw shows
`HeldStage`: the reason, a **Draw anyway** button, and the source in a
scrollable, focusable region. Stepped and Flow are disabled with a reason.
"Draw anyway" is remembered per source for the session (`allowHeavyRender`),
so a remount, a second pane and an export all respect it. The same block
also stays drawn while it is being edited.

`renderMermaid` refuses a held source with `DiagramHeldError`. Every export
(PDF, HTML, DOCX raster) already keeps the source when a render throws, so a
huge mindmap no longer freezes an export either.

The source is a `div` with `role="region"` rather than a `<pre>`. The reading
column styles every `pre` as a code block of its own (border, padding, shadow),
which fought the card around it.

## Debugging

- **Labels look plain-text in one diagram only.** Check that the call site goes
  through `withMermaid`. Any direct `mermaid.initialize()` brings the leak back.
- **A diagram stays on its spinner.** Look at the `mermaid:*` entries. A long
  `waitedMs` means another job is holding the queue, such as an export or a
  huge render.
- **A diagram is held unexpectedly.** Call `preflightDiagram(source)`. It
  returns the unit, count and limit that triggered.

## Tests

- `tests/diagram-runtime.test.ts`: queue order and isolation (against a fake
  Mermaid that reads config after an await), preflight limits, the held
  decision, `sceneBytes`, and byte-weighted eviction.
- `tests/e2e/diagram-runtime.spec.ts`: small diagrams beside performance-mode
  images and beside a GPU diagram, three loads each, keep all 25 HTML labels,
  and jobs never overlap. A 1,000-node mindmap is held with no Mermaid job and
  no long task over 1 s. "Draw anyway" draws a 230-node map with one render,
  and full screen reuses it.
