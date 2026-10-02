# Source addressing

Every position on a rendered page can be named by its offset in the
document's Markdown file. Search hits, **Inspect source**, **Copy code** and
note links all use these addresses to land on the exact occurrence.

## The problem

Each of these features used to find its target by searching *rendered text*:

| Feature | Old method | Where it broke |
| --- | --- | --- |
| Search hit | the N-th match of the query on the page, if the page's count equalled the index's | any diagram (its SVG labels and Mermaid's stylesheet add matches), so every hit after it fell back… |
| …fallback | find the hit's indexed line on the page | table rows (indexed as `cell⇥cell`; the page has no tab), diagram source (not on the page) → **first match in the document** |
| Inspect / Copy code | search the whole file for the selected words | a phrase that occurs twice → the first copy |
| Note link | search the page for the note's quote | repeated passages; equations in the quote |

Reproduced before the fix: in a document with a table and a diagram, all 4 table
and diagram hits for "widget" flashed the intro paragraph's "widget".

## Mental model

A rendered page is a translation of the file. Instead of guessing where a
sentence came from by its words, every paragraph, cell and equation records
"I am characters 812–873 of the file", like a page in an annotated edition
with line numbers in the margin. To go from the page to the file, read the
margin and count within that one paragraph. To go back, find the paragraph
whose margin covers the number.

## Architecture

```
file.content ──(page strip, embed rewrite)──► rendered source ──(segments)──► react-markdown
                                                                   │
                     rehypeSourceAddress: data-src="start:end" ◄───┘  (file offsets)
                                                                   │
page ◄────────────────── blocks carry their file spans ────────────┘
  │
  ├─ addressOfRange(range)  → file span      Inspect, Copy code, Copy to notes
  └─ rangeOfAddress(span)   → page Range     note links, search hits
                 ▲
search hit (line, occurrence) ── searchHitSpan ──┘
note anchor { start, end, head, tail } ── relocateAnchor ──┘
```

**`lib/markdown/source-address.ts`** (pure, unit-tested):

- `rehypeSourceAddress` stamps `p, h1–h6, li, blockquote, pre, table, tr, td,
  th, dt, dd, img` and equations with `data-src="start:end"` from Markdown's
  own node positions. These are block-level only: inline elements outnumber
  blocks many times over, and alignment within one block is exact enough.
  Spans are Markdown's: a cell starts at its `|`, an item at its `-`.
- `renderSourceMap(file, rendered, base)` turns renderer offsets into file
  offsets. Paged mode renders a page with its heading and edge rules stripped
  (so `rendered` starts at `base`), and `prepareWorkspaceEmbeds` rewrites
  `![[x]]`. Both keep lines intact, so the map is per line: unchanged lines map
  column for column, rewritten lines clamp. Long documents render in segments
  (`markdown-segments.ts`), each with shared link definitions copied to its
  front. `MarkdownSegments` now reports `starts` and `prefix`, and
  `ProgressiveMarkdown` maps segment offsets through them.
- `alignTexts(rendered, projected)` lines a block's rendered text up with its
  projected source (`projectSource` in source-locate.ts strips Markdown syntax
  and keeps a map back). It is a linear walk that resynchronises after
  divergences such as collapsed whitespace, list numbers or footnote markers,
  with bounded look-ahead.
- `searchHitSpan(file, lineIndex, rowText, query, occurrence)` counts the
  occurrence in the *indexed* row text, exactly as the search index counted it
  (tabs between cells and all), then maps it through the line's projection.
- `anchorSpan` / `relocateAnchor`: a span plus its first and last 32 source
  characters. The offsets are tried first. If the file changed, the head
  occurrence nearest the old position whose tail follows at about the old
  length wins.
- `lineSpan`: widens a span to whole lines, for Copy code.

**`lib/markdown/dom-address.ts`** (browser): a block's text is split at its
stamped children into runs. Each run came from a known gap of source between
those children. A run is aligned with its gap's projection lazily, one block at
a time. Viewer chrome (`button, svg, style, script, [aria-hidden=true],
[data-viewer-ui]`) is not text.

- `addressOfRange(container, range, file)` → `{ start, end }`.
- `rangeOfAddress(container, span, file)` → `{ range, atomic }`, or null when
  the span isn't on this page.
- `queryRangeWithin(atomic, query)`: inside a diagram, the label showing the
  query (stylesheet text excluded).

**Atomic blocks.** Equations and drawn fences (Mermaid, mind map, JSON tree,
interactive example) have no character-level relation to their source. They
are wrapped in a `display: contents` element carrying `data-src` and
`data-src-atomic` (`services/math/components.tsx`, `CodeBlock.tsx`'s
`Drawn`). Any point inside one addresses the whole fence or equation. Section
folds still hide them: `hidden` beats `display: contents` (Tailwind's preflight
rule is `!important`).

## Where it is used

| Caller | Flow | Fallback |
| --- | --- | --- |
| Inspect source | `menuAddress()` → editor selects exactly that span | `locateInSource` (whole-file text search) |
| Copy code | `menuAddress()` → `lineSpan` | `sourceLinesForSelection` |
| Copy to notes | stores `source.anchor = anchorSpan(file, address)` | quote, prefix/suffix |
| Note link | `resolveNoteSource`: `relocateAnchor` → page → `pendingSaved.span` → `rangeOfAddress` | quote search (notes from before addressing) |
| Search hit | `searchHitSpan` → `rangeOfAddress`; a diagram hit lands on its label, or on the diagram | occurrence counting, for unaddressed content |

The fallbacks remain for content with no source positions, mainly converted
HTML documents.

## Also fixed (separate commit)

The selection menu opened downward from the selection, so selecting near the
bottom of the window (any document's last lines, which can't scroll higher) put
**Save**, **Highlight** and **Copy selection to notes** off screen. A layout
effect now measures the menu and keeps it inside the viewport, before paint.

## Cost (measured)

Production build, one page with about 2,300 stamped blocks (8,400 elements),
reload until fully rendered, 3 alternating runs: **391 ms with stamping vs
373 ms without** (medians; without varied 363–402 ms), with the same long
frames. The attribute is short, and only blocks carry it. Addressing work
(alignment) happens on demand, one block at a time.

## Debugging

- **A jump lands on a block's start, not the word.** The block's rendered text
  diverged from its projection beyond the resync window (256 chars). Inspect
  `alignTexts(blockText, projectSource(file.slice(start, end)).text)`.
- **Inspect falls back to text search.** The selection starts outside any
  `[data-src]` (the paged masthead, converted HTML). Check that the element has
  the attribute in DevTools.
- **Wrong offsets on a paged document.** `addressing.base` comes from walking
  pages in order (`MarkdownViewer`, `addressing` memo) plus the stripped
  heading length (`renderPage.lead`).

## Known limits

- Highlights still anchor by rendered offsets and quotes; moving them
  to source anchors is a natural next step.
- Within a Mermaid diagram, a hit lands on the first label showing the query,
  not the n-th.
- A table query that spans two cells isn't a hit (the index separates cells),
  same as before.

## Tests

- `tests/source-address.test.ts` (7): stamped spans through the real
  remark/rehype pipeline (whole document, a paged page, embed rewrites,
  segments with shared definitions), alignment, search hits in prose, cells,
  code, diagrams and bold, and anchors surviving edits or reporting their text
  gone.
- `tests/e2e/addressing.spec.ts` (3): each "widget" hit lands in its own cell,
  diagram label or line; Inspect selects the second of two identical sentences,
  and the second of two identical words in a table; a note copied from the
  second identical sentence lands there after a paragraph is added above it.
