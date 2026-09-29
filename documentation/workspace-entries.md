# Reading other workspaces (D01, part 1)

## The problem

Three features look inside workspaces other than the open one:

- **Search all workspaces** indexes their names and text.
- **The attachment picker** lists their file names.
- **Link resolution** (`![](Library/photo.png)`) finds the file a path means.

All three used `persistence.getWorkspace`, the read the open workspace uses to
load itself. That read does two things these features don't need:

1. **It loaded binaries.** Before D02, every PDF and image was a base64 string
   inside its file row, and IndexedDB can't read part of a row. Search read
   ≈140 MB to index one note next to four PDFs, and the heap grew 264 MB.
   D02 fixed this at the root: a body is now a Blob, and reading a row hands
   back a Blob _handle_ without reading its bytes.
2. **It replaced the open workspace's write cache** (`lastWrite`). A save
   compares each file with the last write and skips unchanged ones. After a
   cross-workspace read that comparison belonged to the other workspace, so
   the open workspace's next save rewrote every file, Blobs included. D02
   didn't change this.

Search also started one read per workspace, all at once.

## The fix

| Call                           | Returns                                 | Write cache |
| ------------------------------ | --------------------------------------- | ----------- |
| `getWorkspace(id)`             | whole workspace, bodies included        | replaced    |
| `getWorkspaceEntries(id)`      | metadata, folders, files without `data` | untouched   |
| `getFile(workspaceId, fileId)` | one file with its body                  | untouched   |

- `use-search-index.ts` reads other workspaces with `getWorkspaceEntries`, at
  most two at a time (`withReadSlot`). A read that was queued but is no longer
  wanted (search closed, workspace dropped) is skipped.
- `AttachmentPicker.tsx` lists from entries, and doesn't re-read the open
  workspace, whose files are already in memory.
- `resolveWorkspaceArtifact` matches paths on entries, then reads only the
  matched file with `getFile`.
- The unused `listWorkspaces()`, which fully read every workspace at once, is
  gone.

Rule of thumb: `getWorkspace` is for the workspace that will be written back.
Anything that only looks uses entries.

## Measured

`bench/d01-workspace-bodies.mjs`: open workspace = 10 KB note + 5 MB image;
another workspace = 4 × 25 MB PDFs. Turn on "Search all workspaces", then
rename the note. 5 alternating rounds per build, medians, Chromium, each build
on its own Nitro server.

| Build                | Heap growth during search | Search → hit | Next save writes |
| -------------------- | ------------------------- | ------------ | ---------------- |
| Before D02 (88cb82c) | +264 MB                   | 372 ms       | 7 MB             |
| D02 only (upstream)  | +3 MB                     | 248 ms       | 5.25 MB          |
| D02 + this change    | +3 MB                     | 247 ms       | 0.01 MB          |

## The interim split-body layout (database version 4)

Before D02 arrived, this change first split bodies into their own
`file-bodies` store and called that database version 3 (commit 2ab5273). D02
also used version 3, for Blobs inside the file rows. With Blob handles the
separate store saved nothing, so the merge kept D02's layout. Version 4
exists only so that a database written by that interim build isn't read as
D02's v3, which would show its PDFs and images as empty:

- v3 with `file-bodies`: each body moves back into its row as a Blob, one at a
  time, then the store is dropped and summary totals are re-measured. It runs
  in the single upgrade transaction, so an abort leaves the v3 data untouched
  and the next open retries.
- v3 without it (D02's): nothing to do.
- v1 and v2 migrate as D02 describes (docs/d02-binary-storage.md).

`tests/workspace-entries.test.ts` covers both v3 variants, an aborted fold,
entries without bodies, the write cache, `getFile`, and a cross-workspace link
reading exactly one file. `tests/e2e/search.spec.ts` checks in the browser
that a rename after a cross-workspace search writes only the renamed file. It
fails on the D02-only build (it also writes the image).

## Limits

- The open workspace is still loaded whole and held in React state. Its Blob
  bodies are handles, so this costs little memory until a viewer reads them.
  PLAN.md's gate ("opening a 10 KB note next to 100 MB of PDFs loads no PDF
  bodies") is met at the byte level by D02, but not verified end to end.
- A move into another workspace reads the destination with `getWorkspace` and
  rewrites all of its files, because nothing is cached for it.
- Entries still carry every file's text. That is bounded by notes, not
  binaries.
