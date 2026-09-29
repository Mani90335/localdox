# Workspace storage layout: file rows and bodies (D01, part 1)

## The problem

Every document is one IndexedDB row in the `files` store. A PDF or image
kept its whole file in that row, as a base64 data URL in `data`. IndexedDB
can't read part of a row, so anything that read a workspace's file list also
loaded every PDF in it. That included things that only need names or text:

- **Search all workspaces** read each other workspace in full, all at once,
  just to index names and text.
- **The attachment picker** read every workspace in full to list file names.
- **Link resolution** (`![](Library/photo.png)`) read each candidate
  workspace in full, for every unresolved embed.

A full read of another workspace also replaced the open workspace's write
cache (`lastWrite` in `persistence.ts`). The open workspace's next save then
couldn't tell which files were unchanged, so it rewrote all of them, images
included.

Measured on the production build (`bench/d01-workspace-bodies.mjs`: open workspace = 10 KB note +
5 MB image, other workspace = 4 × 25 MB PDFs, ≈140 MB stored; 5 rounds,
medians, Chromium, each build served by its own Nitro server):

| Search all workspaces, then rename the note | Before   | After   |
| ------------------------------------------- | -------- | ------- |
| Bytes IndexedDB handed back for the search  | 139.8 MB | < 5 KB  |
| JS heap growth during the search            | +264 MB  | +3 MB   |
| Toggle → other workspace's hit shown        | 372 ms   | 247 ms  |
| Bytes written by the next save (a rename)   | 7 MB     | 0.01 MB |

## The mental model

A filing cabinet where every folder label had the whole document stapled to
it. To read the labels you had to lift every document. Now the labels (name,
folder, text, Bin state) sit in one drawer and the heavy attachments in
another, filed under the same key.

```
files         [workspaceId, id] → { name, content, folderId, deletedAt, kind, … }   (no data)
file-bodies   [workspaceId, id] → { data }                                            (binary files only)
```

Text stays with the row. Search indexes it, and notes are small next to
binaries. Splitting text out too would mean a third store for a small gain.

## The API

| Call                           | Reads                      | Use it for                                    |
| ------------------------------ | -------------------------- | --------------------------------------------- |
| `getWorkspace(id)`             | rows + bodies, sets cache  | Opening a workspace, conflicts, moves, export |
| `getWorkspaceEntries(id)`      | rows only, cache untouched | Listing, linking, searching                   |
| `getFile(workspaceId, fileId)` | one row + its body         | The one file a link resolves to               |

Callers moved to the body-free read: `use-search-index.ts` (at most two
workspace reads at a time), `AttachmentPicker.tsx` (skips the open workspace,
whose files are in memory), and `resolveWorkspaceArtifact` (matches by path on
rows, then `getFile` for the match only). The unused `listWorkspaces()`, which
read every workspace in full at once, is gone.

## Writes

`putWorkspaces` still compares each file with the cached last write
(`sameFile`) and skips unchanged ones. A changed file rewrites its row. Its body
is written only if `data` changed. Renaming, filing or binning a PDF now
rewrites a few hundred bytes, not the PDF. Without a cached copy (the first
save after another tab's change), the body is written too, because the stored
one is unknown. Removing a file or a workspace deletes its body in the same
transaction. `clearAll` clears the body store.

## Migration (DB version 2 → 3)

`openDb`'s upgrade walks the `files` store with a cursor, one row at a time.
It moves each `data` into `file-bodies` and rewrites the row without it. A v1
database (one row per workspace) goes straight to the v3 layout. Each upgrade
runs in the single `versionchange` transaction: if it aborts (quota, crash,
tab closed), the v2 data is untouched and the next open retries.
`tests/workspace-bodies.test.ts` checks both the abort and the retry.

Cost: it runs once, on first open after the update. It added about 200 ms to
opening a 140 MB database (112 → 312 ms median). Reopening afterwards is as
fast as before (55–100 ms on both builds).

An older build still open in another tab gets `versionchange`, closes its
connection and can't reopen a v3 database. That tab has to be reloaded, as with
the v1 → v2 upgrade.

## Failure and debugging

- **"Workspace has a missing file"**: a workspace's `fileIds` names a row that
  isn't in `files`. Bodies can't cause this. A missing body reads as a file
  with no `data`, and the viewer shows it as empty.
- **Inspect**: DevTools → Application → IndexedDB → `localdox`. Rows in
  `files` never have `data`. Each binary file has a `file-bodies` row with the
  same key.
- **e2e helpers** that read storage directly have to join the two stores
  (`tests/e2e/editing.spec.ts`, `storage-budget.spec.ts`, and `media.spec.ts`
  for seeding).

## Limits and next steps

- The **open** workspace is still loaded whole, bodies included, and held in
  React state. PLAN.md's gate, "opening a 10 KB note in a workspace with 100 MB
  of PDFs loads no PDF bodies", needs bodies loaded on demand by the viewers.
  That is part 2, together with D02 (Blob records instead of base64 strings,
  which this store is where they'd live).
- A **move** into another workspace still reads the destination in full, then
  rewrites all of its files, because nothing is cached for it.
- Search, the picker and link resolution still read every row's **text**.
  That is bounded by notes, not binaries.
