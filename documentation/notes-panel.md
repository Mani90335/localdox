# Notes panel

Select text in a Markdown document, choose **Copy selection to notes**, and the
passage is kept as clean Markdown in a panel beside the document. The source
document is never modified. Each note links back to the passage it came from.

## The problem

Readers already had two ways to keep something, and neither fits "I want this
passage, in my own words, next to what I'm reading":

- A **highlight** is a live mark *on* the document. It moves when the text
  moves and is orphaned when the text is deleted. You can't edit the passage,
  only label it.
- A **star** (saved item) is a bookmark. It points at a place and holds no text
  of its own.

A note is the missing third thing: a **copy**. Once taken, it belongs to the
reader. They can edit it, search it, and copy it out. Editing or deleting the
source never reaches into it.

## Mental model

Think of a note as a photocopy with a sticky tab. The photocopy (the Markdown
`content`) never changes unless you write on it. The tab (`source`) says where
the original was, so you can go back and look. If the original page has moved,
the tab still finds it. If it was torn out, the tab says so instead of opening
the wrong page.

## Data model

`src/lib/workspace/notes.ts`, stored as `WorkspaceRecord.notes`:

```ts
interface Note {
  id: string;
  fileId: string;      // source document; kept after it is deleted
  fileName: string;    // name at copy time; shown only once the source is gone
  content: string;     // the passage, as Markdown (≤ 200,000 chars)
  source: {
    quote: string;     // rendered text of the selection (textContent): the anchor
    prefix?: string;   // ~48 chars of rendered text either side,
    suffix?: string;   //   to tell repeated passages apart
    start?: number;    // offsets in the rendered page at copy time (hint only)
    end?: number;
    subtopicId?: string;   // page (H1 section) it was on; absent in single-page mode
    headingId?: string;    // nearest heading above, used when the passage is gone
    sectionTitle?: string; // shown on the source link
  };
  createdAt: number;
  updatedAt: number;
}
```

Why these choices:

- **Quote anchor, not offsets.** Any edit above a passage shifts every offset
  below it. The quote (with prefix and suffix) is the same scheme highlights
  use (`text-offsets.ts`), so a note survives edits around it.
- **The live name wins.** While the document exists, the panel shows its
  *current* name, looked up by `fileId`. A rename never leaves a note pointing
  at a stale name. `fileName` is only a fallback.
- **Notes outlive documents.** Stars and highlights are dropped with their
  file in import validation and merge. Notes are not: they carry their own
  text.

## Flow: copying a selection

```
mouseup in the article → MarkdownViewer.openCreateMenu
   keeps offsets, prefix/suffix and a cloned Range in the menu state
"Copy selection to notes" → copyToNotes
   selectionToMarkdown(range, container)  ← clean Markdown
   nearest heading above the selection    ← headingId / sectionTitle
   onCopyToNotes({ content, source })
DocsApp.addNote → createNote → setNotes → markDirty → autosave (700 ms)
```

The Range is cloned when the menu opens because the live selection is lost as
soon as the reader clicks or types in the menu. If a re-render has replaced the
nodes it points into, the range is rebuilt from the stored offsets.

The quote is taken with `textBetween(container, start, end)`, not
`Selection.toString()`. Chrome's `toString()` is layout-aware and adds line
breaks around KaTeX's spans, so it never matches the `textContent` index that
`findAnchor` searches. A jump across an equation would then flash only the
longest matching prefix. This was found in the browser, not in the unit tests.

### Clean Markdown (`src/lib/markdown/selection-markdown.ts`)

`Selection.toString()` flattens tables into tabs, drops list markers and fences,
and spells an equation out three times (KaTeX's visual spans, its MathML, its
annotation). So the selection is converted in two steps:

1. **capture**: walk the DOM in document order between the two boundary
   points, clipping text at the ends. Viewer chrome is dropped: buttons, SVG
   icons, `aria-hidden` decoration, equation numbers, callout icons and labels,
   anything marked `data-viewer-ui`. Any equation the selection touches becomes
   its LaTeX source.
2. **render**: paragraphs, headings, lists (with `[x]` task boxes and `start`
   numbers), GFM tables (`|` escaped), fenced code with its language, block
   quotes, `> [!NOTE]` callouts, emphasis, inline code, links and `$…$` /
   `$$…$$` math.

Context rules for partial selections:

| Selection | Result |
| --- | --- |
| Part of one paragraph, list item or table cell | that text, no wrapper |
| Any part of a code block | a fenced block of what was selected |
| Any part of an equation | the whole equation's LaTeX |
| Cells across rows | a table, with the header row added if it wasn't selected |

LaTeX comes from what KaTeX and Temml embed in their MathML. The app's
sanitizer (`services/math/sanitize.ts`) unwraps `<semantics>` and `<annotation>`
but keeps their text, so on the page the source is a bare text node directly
inside `<math>`, beside the `<mrow>`. `latexOf` reads that, and still accepts a
real `<annotation encoding="application/x-tex">` should the sanitizer change. An
equation still typesetting, or one that failed, shows its source as text.
**MathJax keeps no source in the DOM**, so a MathJax equation falls back to its
MathML text.

Both steps read nodes through a structural interface (`DomNodeLike`), not
browser globals, so the conversion is unit-tested in Node.

## Flow: following a source link

```
click "guide.md › Measurements" → DocsApp.openNoteSource(note)
  resolveNoteSource(note, file)       pure; reads Markdown, not the DOM
    no file            → toast "no longer in this workspace"
    file in Bin        → toast "is in the Bin" (restore from Settings ▸ Storage)
    quote found        → handleSelect(file, page it is on now)
                         + setPendingSaved({ quote, prefix, suffix, start? })
                         → viewer scrolls to the passage and flashes it
    quote gone         → open the heading it sat under (or its page) + toast
```

`resolveNoteSource` searches the document's Markdown with `locateInSource` in
**exact mode**. Inspect's fuzzy fallbacks (a prefix, a rare word) are fine for
placing a caret *near* lost text, but would make a link claim a deleted passage
still exists. It tries the whole quote first, then each line of the quote that
is at least 20 characters long. A selection that crossed an equation carries
KaTeX glyphs the Markdown never contains, but its plain lines still match
exactly. Lines shorter than 20 characters ("Introduction") recur too often to
trust. The page the note came from is searched first, so a repeated passage
resolves to the reader's own copy.

Once the right page is open, the viewer re-finds the exact characters with
`findAnchor` (same quote, prefix and suffix) and flashes them. This reuses the
star jump (`pendingSaved`, now typed `PassageTarget`). In split view, only the
focused pane takes the jump. The stored `start` offset is passed as a
tie-breaking hint only when it was measured in the same space: same page, same
reading mode.

## Persistence

`notes` is threaded through every path a workspace record takes:

| Path | Where | Behavior |
| --- | --- | --- |
| Autosave / reload | `DocsApp` `buildRecord`, `hydrateWorkspace` | the record is written as a whole |
| Two tabs | `merge.ts` | merged by id; the same note edited differently in both tabs is a conflict |
| Backup export/import | `serializeWorkspace`, `import-schema.ts` | validated; malformed fields repaired, duplicate ids rejected, old backups import with `[]` |
| Move to another workspace | `workspace-transfer.ts` | notes follow their document, renumbered with it |
| Share links | `share.ts` | **never included**: shares upload to an external host, and notes are private |

No backup version bump was needed. Older builds drop the unknown `notes` field,
and newer builds default it to `[]`.

Panel open/closed is a per-device convenience in `localStorage`
(`localdox:notes-open`), not workspace data.

## UI

- **Desktop (≥1024px):** a docked column (`w-80`, `xl:w-88`) right of the
  reading column, sticky to the viewport. It stays open across documents and
  reloads.
- **Narrower:** the app's `BottomSheet`. Opening a source link closes the sheet,
  since it would cover the passage.
- Open with the notebook button in the viewer header (`aria-pressed`). Each
  note shows its source link, its rendered Markdown (folded past 288px; GFM
  plus `remark-math` with no typesetter, so equations show as LaTeX source and
  `\,` or `_` aren't eaten as Markdown escapes or emphasis), when
  it was taken or edited, and Copy / Edit / Delete. Edit opens a Markdown
  textarea: ⌘/Ctrl+Enter saves, Esc cancels. Delete is immediate, with **Undo**
  in the toast. Search matches every word across content, the source's current
  name and the section.
- The panel downloads on first open (`NotesPanelLazy`, via `deferredModule` so
  a reload with the panel open doesn't pay React's 300 ms Suspense reveal
  throttle). Cards are memoized, so autosave re-renders don't re-parse every
  note.

## Debugging

- **"Passage is no longer in the document" when it obviously is.** The quote
  probably crosses rendered-only text and has no plain line of 20+ characters.
  Check with `locateInSource(file.content, line, undefined, { exactOnly: true })`.
- **The right page opens but nothing flashes.** The source match succeeded and
  the DOM match didn't. Compare `note.source.quote` with the page's rendered
  text (`textBetween`). A different math renderer since copy time changes the
  glyph text.
- **Copied Markdown contains UI text.** A component draws chrome without a
  button, `aria-hidden` or `data-viewer-ui`. Mark it, and add a case to
  `tests/notes.test.ts`.

## Known limits

- Mermaid diagrams, embeds and media copy as nothing. A selection of only those
  falls back to the plain selected text.
- Local images (blob URLs) copy as their alt text. The URL dies with the page.
- With no documents left in the workspace, the empty-workspace screen has no
  viewer, so the Notes panel can't be opened until a document is added.

## Tests

- `tests/notes.test.ts` (25 cases): clean copy (formatting, chrome removal, lists,
  tables, code, math, callouts, element boundaries), snapshot semantics,
  search, anchors that moved, repeated, crossed math, broke, or lost their
  document, and storage (backup round trip, validation, IndexedDB,
  two-tab merge, cross-workspace move).
- `tests/e2e/notes.spec.ts`: select a paragraph and a list on page 2 → copy →
  verify the stored Markdown → reload → search → follow the link from page 1
  back to the flashed passage. Plus the narrow-screen sheet.
