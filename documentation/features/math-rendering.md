# Math rendering: typeset in the reader, within a budget

This note covers how equations get from Markdown to the page, and the rules
that keep a document with thousands of them responsive (audit item R05):

1. Equations are typeset by React components the reader's component map
   names.
2. Typesetting is charged to a per-task time budget. What doesn't fit waits
   for a later task.
3. Rendered markup is cached up to a byte budget, least recently used out.
4. Off-screen display equations skip style and layout (`content-visibility`).
5. The MathJax fallback gets every file it fetches in the production build,
   and nothing that lets a document style the page.

## The pipeline

```
$…$ / $$…$$ ─ remark-math ─▶ remarkMathNodes ─▶ <docs-math data-latex=…>
                                                     │  markdown-components.ts
                                                     ▼
                              MathNode (InlineMath / DisplayMath)
                                                     │  useMathRender
                                                     ▼
            renderer.ts:  cache? ─▶ KaTeX (sync) ─▶ sanitize ─▶ markup
                                     └─ can't ─▶ MathJax (lazy) ─▶ sanitize
```

The LaTeX travels as an attribute, never as rendered HTML, so Copy LaTeX and
the error panel always have the author's source. `MathProvider` (around the
rendered page in MarkdownViewer) numbers equations from the **whole**
document, so equation 12 stays 12 on any page.

**What was broken.** A refactor (522ccac) moved the math components into
`src/services/math/` and dropped them from the viewer's component map. Every
`$…$` rendered as an empty element. They are now spread into the constant map
in `markdown-components.ts`; they read everything through context, so the map
never changes identity (see long-markdown-rendering.md for why that matters).

## Rule 1–2: a budget per task

### The problem

Typesetting one equation is cheap: KaTeX ~0.05 ms, sanitizing ~0.2 ms. It is
the count that hurts. Measured on the production build, a 1,000-section
document with 2,000 distinct equations (7.5 MB of KaTeX markup):

```
KaTeX module arrives ─▶ 1,130 waiting equations resolve in one microtask burst
                        (typeset + sanitize all of them)         962 ms task
                     ─▶ their 1,130 setStates commit together      820 ms task
```

The page was frozen for about two seconds, then 350 ms more for layout.

### The fix: `TaskBudget` and `SlicedQueue` (render-budget.ts)

Think of a kitchen with one cook and a ticket rail. The cook works through
tickets in order but stops after 12 minutes to let the waiters through, then
comes back. No ticket is skipped and nobody waits behind a two-hour order.

- **`TaskBudget(12 ms)`** counts the milliseconds of typesetting spent in the
  current browser task. JavaScript has no "task started" event, so the first
  charge schedules a `setTimeout(0)` that resets the count in the next task.
- **The synchronous path** (`renderMathSync`, called during React render once
  KaTeX is loaded) asks the budget first. Past it, the equation keeps its
  source placeholder, and its effect sends it down the async path.
- **The async path** (`renderMath`) waits for KaTeX's module (network, not
  CPU), then queues the typeset-and-sanitize as **one synchronous job** on
  `SlicedQueue`. Each task runs jobs in order until the budget is spent, then
  yields. Every task runs at least one job, so the queue always drains.
- **MathJax and Temml** await inside `render()` (extensions, fonts), so they
  can't hold the queue. Only their sanitizing is queued.
- **Cache hits cost no budget.** Re-rendering a document is lookups.

Equations mount in document order, so the top of the page is typeset first.

Also in renderer.ts: KaTeX's MathML is the `<math>` island inside its HTML, so
it is now taken from the sanitized HTML instead of being sanitized a second
time (identical output for all 112 corpus equations).

### Sanitizing (sanitize.ts)

`DOMPurify.sanitize(html, CONFIG)` re-parses the config on every call. Math now
has its own DOMPurify instance with `setConfig()` applied once. It is a
separate instance so the `mjx-*` hook stays out of the app-wide one: with the
shared instance, the DOCX viewer's sanitizer let `<mjx-…>` elements through.
Output is identical to before for KaTeX, MathJax and hostile inputs (checked
in the browser).

Note: `USE_PROFILES` makes DOMPurify ignore `ALLOWED_TAGS`/`ALLOWED_ATTR`, so
the effective policy is its html, SVG and MathML profiles minus the FORBID
lists. That was already true and is unchanged; tightening it is a follow-up.

## Rule 3: cache by bytes

KaTeX markup is ~4 KB for an ordinary display equation and hundreds of KB for
a big matrix, so a count limit (2,000 before, oldest-inserted out) bounded
nothing. The cache now weighs each entry (key + HTML + MathML, UTF-16), holds
at most **32 MiB** and 8,000 entries, and evicts the least recently used
(`lookup` re-inserts on a hit). The benchmark document fits, so editing one
equation re-typesets just that one. `mathRenderStats()` reports entries,
bytes and queue length.

## Rule 4: skip what isn't on screen

After typesetting was bounded, returning from the editor was still ~1.6 s:
all cache hits, but style recalc (460 ms), layout (386 ms), hit-testing and
pre-paint over KaTeX's deeply nested spans. `.docs-math-block` joined the
existing `content-visibility: auto` rule for heavy blocks (styles.css), with a
remembered intrinsic size. Off-screen equations stay in the DOM (find,
selection, printing and highlights still see them) but skip rendering.

Paint containment clips at the block's edge, so the action tray moved inside
the block (`top: 0`) and the focus ring is inset. The waiting placeholder is a
`div`, not a `<pre>`: `.docs-prose pre` gave it code-block padding and a
240 px size estimate, 3.5× the equation that replaced it.

Equation references (`navigateToEquation`) jump instantly, like a fragment
link. A smooth scroll picks its destination once, and the blocks it passes
render at their real size on the way, so it stopped short.

## Rule 5: MathJax in production

The build published only `tex-mml-chtml.js`, but MathJax 4 fetches its TeX
packages, the assistive-MathML module and the speech-rule engine at runtime.
In production its startup waited forever and every equation KaTeX couldn't
draw (a `multline`, malformed LaTeX) stayed on its placeholder. The dev server
served the whole package, so dev looked fine.

`build/vite-mathjax-asset.ts` now publishes an allow-list (`RUNTIME`), and the
dev server serves the same list so the two can't drift. It is an allow-list
because `html.js` must stay out: MathJax autoloads it for `\style`, `\class`,
`\cssId` and `\href`. With it, `\style{position:fixed;inset:0}{x}` painted a
page-wide overlay in dev (2 fixed elements on HEAD); now it fails in place.
The adapter also times out a startup (20 s) or render (10 s) that never
settles, so a missing file ends in the error panel instead of a permanent
placeholder.

## Results (production build, Chromium, 1280×800)

| 1,000 sections, 2,000 distinct equations | wired, unbudgeted | now          |
| ---------------------------------------- | ----------------- | ------------ |
| longest task while opening (3 runs)      | 1,155–1,276 ms    | none > 50 ms |
| long-task total while opening            | 3.7–3.9 s         | 0            |
| all typeset                              | ~5.1 s            | ~4.1 s       |
| return from the editor (one edit)        | not measured      | 0.8–1.0 s    |

Returning from the editor with the budget but before `content-visibility` took
1.6–1.9 s with up to 16 long tasks; now 1–2 (max 151 ms once). The same
document without math returns in ~200 ms.

## Debugging

- Equations stuck on their monospace source: check the network for a 404
  under `/vendor/mathjax/`. A file MathJax needs is missing from `RUNTIME`.
- `mathRenderStats()` in a console (import it from `@/services/math/renderer`
  in dev): a growing `queued` means slices aren't running; `bytes` near 32 MiB
  means the working set doesn't fit.
- Long tasks while opening a math-heavy document: record a trace before
  changing a number, and see whether the time is script (the budget) or
  style/layout (containment).

## Trade-offs and limits

- Over-budget equations show their source briefly, then typeset. On a first
  screen that's rare (the top of the page is typeset first).
- A task that starts before the budget's reset callback runs sees a spent
  budget and defers early. That is harmless: it only defers more.
- MathJax's own work isn't budgeted (it's async inside MathJax); it only runs
  for what KaTeX can't draw.
- Queued jobs aren't cancelled when the reader leaves a document; they finish
  in slices and fill the cache.
- KaTeX numbers `align` rows itself, so an `align` shows its own "(1)" per row
  beside the registry's number. Unchanged here.
