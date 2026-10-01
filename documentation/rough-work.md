# Rough work

The Notes panel has a second tab, **Rough work**: scratchpads where the reader
tries equations, writes intermediate steps and pastes values, without touching
the document they are learning from. A pad is Markdown with `$…$` and `$$…$$`
math, drawn by the same renderer as notes, with the editor's toolbar and the
MathLive keyboard.

## The problem

A learner working through a derivation needs somewhere to make mistakes. The
app had two places to write, and both were wrong for this:

- **The document.** Working in the source pollutes the material being learnt,
  and every false start has to be cleaned out again.
- **A note.** A note is a copy of a passage, linked back to that passage. Rough
  work isn't copied from anywhere, is mostly wrong on the way to being right,
  and gets rewritten constantly.

## Mental model

A scratchpad is a sheet of scrap paper clipped to the workspace. You may write
a document's name at the top ("for guide.md") so you can find it again, but
the paper is never stapled into the document. Two things move work off it, and
both make a **copy**:

- **Save as note** copies a finished result into a durable note.
- **Insert into document…** copies it into the document, after a dialog that
  shows exactly what goes where and waits for the reader to confirm.

The scratchpad is never part of the document's text or its edits. Clearing,
renaming or deleting a pad changes no document. An insertion is one ordinary
edit of the document, with no live link back to the pad.

## Data model

`src/lib/workspace/rough-work.ts`, stored as `WorkspaceRecord.scratchpads`:

```ts
interface Scratchpad {
  id: string;
  title: string;          // "Scratchpad", "Scratchpad 2"…; ≤ 120 chars
  content: string;        // Markdown, ≤ 200,000 chars (MAX_SCRATCHPAD_CHARS)
  fileId: string | null;  // optional document association
  fileName?: string;      // that document's name when linked; shown once it's gone
  createdAt: number;
  updatedAt: number;
}
```

Why these choices:

- **A list on the workspace record, beside `notes`**, not a new store or
  model. Pads then use every path the record already has (autosave, merge,
  backup, transfer) and arrive in the same transaction as the documents.
  The cost: every autosave rewrites the record's metadata row, pads included.
  That is the same cost notes already pay, and pads are capped at 200k characters each.
- **The association is optional and outlives the document**, like a note's
  source. A pad made while reading `guide.md` is linked to it, which only
  groups it ("This document" first in the picker) and labels it. Unlink it,
  and it belongs to the workspace as a whole. When the document is deleted,
  the pad is marked "Deleted" but still kept.
- **Notes saved from rough work** carry `origin: { kind: "rough-work",
  scratchpadId, title }` and an empty `source`. Their link opens the pad, or
  says it was deleted. `fileId` is the pad's document (or `""`), so the note
  travels with that document like any other.

## Lifecycle

```
New scratchpad ── createScratchpad(existing, readerFile) ── linked to the open document
   │
typing ── ScratchpadEditor holds the draft (keystrokes re-render it alone)
   │         ├─ every change → draft journal (localStorage, flushed after 250 ms)
   │         └─ 500 ms pause → onChange → DocsApp.setScratchpads → markDirty
   │                                       └─ 700 ms → IndexedDB write → journal.settle
   │
reload ── hydrateWorkspace → scratchpads; panel open, tab and pad from localStorage
crash ─── next load: recoverableDrafts → "Recovered edits" banner
              restore in place if the pad still holds what the draft was typed against,
              else as a new pad "… (recovered)"
   │
Rename / Duplicate / Link·Unlink ── pure updates, autosaved
Clear contents… ── confirmation dialog → content "" (Undo in the toast)
Delete scratchpad ── immediate, Undo in the toast; its journal entry is dropped
   │
Save as note ── noteFromScratchpad(pad, selection or whole pad) → notes
Insert into document… ── InsertDialog (what, where) → Insert
       → DocsApp.insertRoughWork: re-check → insertIntoDocument → handleContentChange
       → open its page, flash it (pendingSaved with the exact span) → Undo in the toast
```

### Autosave and the journal

The pad editor works like the document editor (`MarkdownEditor`). The draft
is local state, so typing re-renders the field alone. The workspace hears
about it after a 500 ms pause. Every change is staged in the per-tab draft
journal (`draft-journal.ts`) under the id `rough:<padId>`, which can't
collide with a file id. On commit, `journal.settle` gets the pads alongside
the files (`scratchpadDrafts`), so an entry disappears once storage holds its
text.

The journal entry's `base` is the hash of what the workspace holds for the pad
*now*, not when the field opened. Work typed after an autosave therefore
restores in place.

A change arriving from outside (Clear, Undo, a restore, another tab's write)
replaces the field's text **during render** (`held` state), and the journalled
draft is discarded. This used to happen in an effect, and that let a passive
effect run once with the new pad but the old text. It journalled the old text
as a fresh draft, which a reload then offered back over the restored work. The
crash-recovery e2e test caught it.

While the field holds unsent text, `roughDirtyRef` is true. Like
`editorDirtyRef`, it keeps the save indicator on "pending", counts as unsaved
work for the reload guard, and stops this tab from adopting another tab's write
underneath the reader.

### Insertion

`insertionPoints(file, page)` offers the end of the page being read (paged
reading; the first page when none is set; a heading resolves to its page) and
the end of the document. `insertIntoDocument` puts the work in as a block of its
own, with one blank line either side whatever was there, and returns its exact
`span`.

Three checks run when Insert is pressed, not when the dialog opened:

| Check | Why |
| --- | --- |
| The document still exists and isn't in the Bin | it may have been deleted meanwhile |
| Its text hashes to the dialog's `base` | the offsets were measured in that text |
| It isn't open in a source editor (`editor/open-editors.ts`) | the editor owns its draft and would autosave the old text over the insertion |

The dialog shows the last one up front, with Insert disabled. After inserting,
the reader is taken to the page that holds the work. The viewer lands on its
span (`rangeOfAddress`, as for note links) and flashes it. **Undo** restores
the previous text, but only while the document is exactly as the insertion left
it.

### Storage

| Path | Behavior |
| --- | --- |
| Autosave / reload | part of the record (`buildRecord`, `hydrateWorkspace`) |
| Two tabs | `merge.ts` merges by id; the same pad changed differently in both tabs is a conflict |
| Backup export/import | validated in `import-schema.ts`: blank titles repaired, bad links dropped, duplicate ids and oversize pads rejected; old backups import with `[]` |
| Move a document to another workspace | linked pads follow it (renumbered with it); unlinked pads stay |
| Share links | **never included**, with or without annotations |
| Storage accounting | pad titles + content and note content count, as UTF-8 (`recordTextBytes`) |

Storage accounting is new for notes too: the summary row's total
(`putWorkspaces`), the lazy re-measure of older rows (`storedBytesByWorkspace`,
which now reads the workspace row), the open workspace counted from memory
(`OpenWorkspace`), backup imports (`storedRecordBytes`), and Settings ▸
Storage all agree.

## UI

- Tabs at the top of the panel (`role="tablist"`, ← → to switch; the third,
  **Compute**, can append a computed result to the open pad with **Add to rough
  work**, see math-compute.md). The tab
  and the open pad are per-device conveniences in `localStorage`
  (`localdox:notes-tab`, `localdox:rough-pad`), like the panel's open state.
- Pad picker (the title, with a chevron), **+** for a new pad, **⋯** for
  Rename, Duplicate, Link/Unlink, Clear contents…, Delete. The menus use
  `z-(--z-menu)` so they open above the mobile sheet.
- Under the field: **Save as note** and **Insert into document…**. With text
  selected they read "Save selection as note" and "Insert selection…". The
  selection is tracked with native `select`/`selectionchange` events, because
  React's `onSelect` misses a selection set by script.
- A live **Preview** below. On a phone the same layout sits in the
  `BottomSheet`, with the tabs pinned to its top.

## Rendering cost

The preview goes through the notes' drawing path (`note-blocks.tsx`): the
reader's render cache first, then idle-time KaTeX, only for equations on screen,
never charged to the reader's 12 ms math budget. On top of that:

- **Debounced (250 ms) and deferred, starting empty** (`useDeferredValue(text, "")`).
  Even a long pad's first render is a background render that React can pause
  between components.
- **Segmented** with `splitMarkdownSegments`, each segment memoized on its
  source. Pads over 16k characters re-parse only the segment being typed in.
- The panel's first render still waits for an idle callback (see
  notes-panel.md), so a reload with a pad open doesn't share the document's
  first React task.

Measured in `tests/e2e/rough-work.spec.ts`, production build: a 2,000-equation
document plus a 600-equation pad (~45k characters), reloaded with the pad open,
stays under the 100 ms long-task bound `math.spec.ts` holds the document to on
its own. So does typing in the pad afterwards. The preview draws only the
equations near the screen, not all 600.

## Debugging

- **"Recovered edits" offers rough work that is already there.** Compare the
  entry's `text` with the pad's stored `content`. An entry staged with stale
  text points at the render/effect ordering above. Entries live at
  `localdox:draft:<workspaceId>:rough:<padId>`.
- **Restore makes a "(recovered)" pad instead of restoring in place.** The
  pad changed after the draft was typed (its hash isn't the entry's `base`), or
  the pad was deleted. That is by design: a version saved since is never
  overwritten.
- **Insert is disabled.** No Markdown/text document is open, or it is open in
  the editor. `isEditorOpen(fileId)` tells you which.
- **The page option is missing.** The reader is in single-page mode, or on
  the last page, where it would be the same as "end of the document".
- **An equation in the preview stays as source.** Same causes as in notes
  (off screen, KaTeX can't parse it, or KaTeX didn't load); see
  notes-panel.md.

## Known limits

- One pad open at a time. Comparing two pads means switching between them.
- Pads have no history of their own beyond the toast's Undo for Clear and
  Delete.
- Insert offers two positions only. Anywhere else means inserting at one of
  them and moving the text in the editor.
- Two tabs typing in the same pad at once end in the workspace conflict
  banner, as with any other record.

## Tests

- `tests/rough-work.test.ts` (18): model (titles, edit/rename/link
  no-ops, duplicate, ordering, selection), note origin and search, insertion
  points and exact spans, backup round trip and validation, IndexedDB reload,
  stored bytes (summary, legacy re-measure, open workspace; mutation-checked),
  two-tab merge and conflict, transfer, share exclusion, journal settle and
  recovery offers.
- `tests/e2e/rough-work.spec.ts` (8): create, link, preview, rename, reload,
  switch pads. Clear needs confirmation (Cancel keeps the text), then Undo.
  Insert needs confirmation (Cancel leaves the document byte-identical), then
  lands exactly, is shown, and Undo restores it. Insert is refused while the
  document is in the editor. Save as note links back to the pad. Crash recovery
  restores into the pad and leaves no journal entry. The phone-width sheet. The
  math-heavy long-task budget.
