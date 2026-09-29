# Long Markdown documents (A05)

## The problem

A Markdown document is turned into a page by react-markdown in one
synchronous call: parse the source, run the plugins, build a React element
for every block, then commit them all to the DOM. The cost grows with the
document, and nothing else can run until it is done: no input, no paint.

The audit's workload is one `#` chapter holding 3,000 `##` sections (234 KB,
about 18,000 elements). Paged reading splits documents at `#` headings only,
so it gets no relief from a single long chapter.

Measured on the production build before this change (1280×800, Chromium, no
throttling; see "Measuring" below):

| Step              | Before                                                 |
| ----------------- | ------------------------------------------------------ |
| Open the document | one main-thread task of 1.3–1.4 s, first text at 1.6 s |
| Fold one section  | a 1.2 s interaction                                    |
| Unfold it         | a 1.2 s interaction                                    |

Half of the opening task wasn't parsing at all. A CPU profile showed 685 ms
in `removeChild` and 149 ms in `insertBefore`: React was deleting the whole
rendered document and building it again.

## Why the document was rebuilt

react-markdown renders each element with a component from its `components`
map. The viewer built that map inside a `useMemo` that depended on the file
object, the workspace's files and the set of folded sections. When any of
them changed, every entry became a new function, which is a new component
type, and React responds to a new type by unmounting the old element and
mounting a new one.

The file object is replaced once an upload has been persisted, so every
document was rendered twice when it opened. Folding a section changed the
set, so it rebuilt all 18,000 elements to hide a few.

## The mental model

Two separate fixes, for two separate costs:

1. **Never rebuild what hasn't changed.** The renderer map is a module
   constant. The few renderers that need the file or workspace (images,
   links, embeds) read it from a context, so a change re-renders only them.
   Folding no longer goes through React at all.
2. **Never do the whole document in one task.** A long document is split
   into segments, each rendered by its own react-markdown call. The first
   screenful renders straight away. The rest is mounted a few segments at a
   time, each step sized to take about 16 ms.

When mounting finishes, the DOM is the same one a single render produced,
down to its text (checked character by character against the old build), so
browser find, selection, copying, printing and highlight offsets are
unchanged. Nothing is virtualised or unmounted. A single render has a newline
text node between blocks; each segment but the last is followed by one, to
put back the one the cut removed.

```
source ─► splitMarkdownSegments ─► [seg 0][seg 1][seg 2] … [seg n]
                                      │
          first paint: segments up to ~8,000 characters
                                      │
          setTimeout ─► flushSync(mount the next ~budget characters)
                          │  measure how long it took
                          │  budget = what fits in 16 ms (2,000–48,000 chars)
                          └─ repeat until every segment is mounted
                                      │
                               onRendered(source)
                                      │
            the viewer is "settled": paint highlights, land on a search
            hit or saved passage, scroll to a pending heading
```

## Where the code is

| File                                                                 | Role                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/lib/markdown/markdown-segments.ts`                              | Pure: where a document may be cut, and the per-segment heading-id plugin. Unit-tested. |
| `src/components/docs/viewer/markdown-viewer/ProgressiveMarkdown.tsx` | Renders the segments in steps and reports when the whole source is mounted.            |
| `src/components/docs/viewer/markdown-viewer/markdown-renderers.tsx`  | The element renderers (headings, paragraphs, code, images, links, tables).             |
| `src/components/docs/viewer/markdown-viewer/markdown-components.ts`  | The constant `components` map built from them.                                         |
| `src/components/docs/viewer/markdown-viewer/contexts.ts`             | `MarkdownRenderContext`: the file, media context and navigation the renderers read.    |
| `src/components/docs/viewer/markdown-viewer/section-folds.ts`        | Folding as a DOM pass over the rendered blocks.                                        |
| `src/components/docs/viewer/MarkdownViewer.tsx`                      | Wires these together; waits for `settled` before reading the document as a whole.      |

## Where a document may be cut

A cut is allowed only where both halves parse exactly as they would inside
the whole document:

- before an unindented ATX heading (`## …`), because a heading can never be
  a lazy continuation line, so it always ends the paragraph, list, quote or
  table above it;
- before an unindented line that follows a blank line and doesn't start a
  list item, because after a blank line nothing continues lazily.

Never inside a fenced code block, a `$$` math block or an HTML block. The
scanner tracks those. Inside an HTML block it doesn't even look for fences:
a ` ``` ` there is HTML text, and treating it as a fence would put the
scanner out of step with the parser for the rest of the document.

A segment is cut at the next heading once it holds 4,000 characters, or at
any safe line once it holds 16,000. Documents under 16,000 characters are
never split and render exactly as before.

Three things reach across the whole document:

- **Link reference definitions** (`[id]: url`) apply everywhere. Every
  segment gets all of them, prepended in document order, so the first
  definition of a label still wins. A definition the scanner can't copy with
  certainty (inside a list or quote, or with its title on the next line)
  keeps the document in one piece.
- **Footnotes** are numbered and collected across the document. Any footnote
  definition keeps the document in one piece.
- **Heading ids** are de-duplicated across the document (`intro`,
  `intro-1`, …). `rehypeSegmentSlug` records the base slug of every heading a
  segment claims, and replays the earlier segments' records before slugging
  its own. Segments always render in document order, so those records exist
  in time. This covers setext headings and headings inside quotes too, which
  a source scan would miss.

The unit test renders random documents both ways (whole, and segment by
segment joined as the viewer joins them) and requires identical HTML. The documents mix everything above:
code containing `#` lines and blank lines, math, HTML comments and blocks,
fences inside HTML, lazy continuations, loose lists, tables, setext
headings, duplicate headings and reference links. Removing any one of the
scanner's rules makes a test fail.

## Things that wait for the whole document

While a long document is mounting, its content element has `aria-busy`, and
the viewer isn't _settled_. These wait for it:

| Reader action                            | Why it waits                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Highlights are painted (and re-anchored) | Anchoring against part of the document can match an earlier repeat of the quote and store that position as a repair |
| A search hit or saved passage is shown   | Its text may not be mounted yet                                                                                     |
| A heading is scrolled to                 | Same; kept in `pendingHeading` and scrolled to once settled                                                         |

A section link clicked before its heading exists still lands on it: the
target is kept until the render completes.

## Folding

Folding used to be decided during render: each block asked whether a heading
above it was folded, and returned `null` if so. That tied every block to the
fold state, and it can't work across separately rendered segments.

The rendered blocks are the direct children of the content element in both
cases (segments render as fragments, with no wrapper), so
`applySectionFolds` walks them once, tracking open headings by rank, and sets
`hidden`. A `MutationObserver` re-applies it when blocks mount or re-render.

Folded text now stays in the DOM, so highlight offsets no longer shift when a
section above is folded. Lists are now folded along with their section; they
used to stay visible.

## Measuring

The measuring scripts aren't part of the repo; `tests/e2e/long-markdown.spec.ts`
carries the regression checks. Numbers are from the production build of HEAD
and of this change, the audit's 3,000-section document, 1280×800, headless
Chromium, five runs each (ranges shown). Other sessions' test runs were
sharing the CPU.

| Measure (no throttling)          | Before         | After                                 |
| -------------------------------- | -------------- | ------------------------------------- |
| First section on screen          | 1,568–1,603 ms | 73–88 ms                              |
| Whole document mounted           | 1,577–1,655 ms | 504–1,065 ms                          |
| Longest task while opening       | 1,370–1,393 ms | none over 50 ms (two runs: 53, 55 ms) |
| Fold one section (interaction)   | 1,184–1,216 ms | 192–200 ms                            |
| Select a paragraph (interaction) | 64–88 ms       | 56–88 ms                              |
| Elements once mounted            | 18,018         | 18,018                                |

| Measure (4× CPU throttling) | Before         | After      |
| --------------------------- | -------------- | ---------- |
| First section on screen     | 6.5–6.9 s      | 282–299 ms |
| Longest task while opening  | 5,646–5,855 ms | 154–194 ms |
| Fold one section            | 4.9–5.4 s      | 792–840 ms |

In Chrome via DevTools (performance trace, no throttling): first section at
71 ms, all 3,000 mounted at 672 ms, no long task, CLS 0.

At 4× the longest task is the app's own work of opening a file: a 40-section
document costs 117–144 ms on both builds. The mount steps stay near their
16 ms target, but at 4× the rendering after each step reaches ~50 ms near the
end, and a few 100–190 ms tasks remain. They weren't attributed further.

Measurement trap: Playwright's `getByText` evaluates inside the page and
walks the whole DOM. Polling it against an 18,000-element document creates
long tasks of its own at 4× throttling. Wait on id selectors instead.

## Debugging

- `aria-busy="true"` on the content element means segments are still
  mounting. If it never clears, `onRendered` isn't firing: check that the
  document's source hasn't changed identity on every render.
- To see where a document was cut, call `splitMarkdownSegments(source)` in a
  unit test; `sizes` gives each segment's length.
- A heading id that differs from a whole-document render means a segment
  rendered before an earlier one. Look for code that renders segments out of
  order.
- `tests/e2e/long-markdown.spec.ts` throttles the CPU for the cases that must
  act while the document is still mounting, and checks that it was.

## Limits

- **Folding is still ~190 ms** (target 100 ms). Script is ~30 ms; the rest is
  the compositor's Layerize step (~220 ms in a trace). Every heading is
  `position: relative` and its chevron is absolutely positioned, so a
  3,000-heading document has thousands of paint layers, and folding moves
  all the later ones. Making the headings static in a CSS experiment removed
  Layerize entirely. Fixing it means restyling the heading controls (for
  example an inline chevron with negative margins), which wasn't done here.
  Hover and scrolling don't pay this cost.
- The mounted element count isn't bounded; the whole document ends up in the
  DOM, as before. Windowing would break find, selection, printing and the
  offset-based highlights. What is bounded is the work per task.
- A document is only split when it is 16,000 characters or longer, has no
  footnotes, and has no link definitions the scanner can't copy line by
  line. Other documents render in one task, as before.
- One heading or chapter with no safe cut point (for example a single 1 MB
  code block) is still one segment.
- A jump to a heading or search hit waits until the whole document has
  mounted (672 ms for the audit document), not just the segment it's in.
- When the source changes while it is shown, every mounted segment is
  re-rendered as a transition. The render is time-sliced between segments;
  the commit isn't.
- Math doesn't render in the reader on either build: `docs-math` elements
  stay empty. That existing bug was found while checking this change and is
  unrelated to it.
- Measured on Chromium only; no Safari, Firefox or phone.
