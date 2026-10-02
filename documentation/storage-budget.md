# Storage budget (D03)

## The problem

Localdox promises to use at most 5% of the browser's storage quota for
documents (`STORAGE_QUOTA_FRACTION`). Before this change the promise was kept
by four separate checks that each counted differently, and two import paths had
no check at all:

| Path                          | What it counted                                                   |
| ----------------------------- | ----------------------------------------------------------------- |
| Upload                        | `file.size` of the open workspace only                            |
| Conversion (Markdown copy)    | Real bytes, open workspace only                                   |
| Shared files (`#share-files`) | The `size` the link claimed, open workspace only                  |
| Backup restore                | Nothing                                                           |
| Workspace link (`#share=`)    | Nothing                                                           |
| Settings meter                | `navigator.storage.estimate().usage`: the whole origin, estimated |

The measured results on the production build (quota stubbed so the cap is
1 MiB, `tests/e2e/storage-budget.spec.ts`):

- A 540,000-byte PNG is stored as a 720,022-character data URL. Uploading
  400,000 bytes of text next was allowed (540 + 400 KB "fits"), so storage held
  1.12 MB.
- The same upload into a second workspace was allowed, because the first
  workspace wasn't counted.
- A backup with 700,000 bytes of text and `size: 10` was restored.
- Two 600 KB uploads picked in quick succession both passed. Each was checked
  before the other had been read.
- A shared-files link claiming `size: 10` for 1.2 MB of text was accepted.
- Settings showed "48 MB of 1 MB". The 48 MB was offline features and caches,
  which the cap never counted.

## The mental model

There is one budget and one way to count against it:

```
stored bytes of a document = UTF-8 length of its text + length of its data URL
```

The data URL is counted because that string is what IndexedDB actually holds.
It is about 4/3 of the original file. A CSV keeps both its text and its
original bytes, so it counts twice. A file's `size` field is never used: it is
what was picked from disk, it goes stale after an edit, and in backups and
links it is only a claim made by the sender.

Text the reader writes that lives on the workspace record itself — note content,
scratchpad titles and content — counts too, as UTF-8 (`recordTextBytes`; see
rough-work.md). `storedRecordBytes(record)` is documents plus that text.

Every import asks one question before it writes anything:

```
saved totals of other workspaces         (summary rows, no documents read)
+ the open workspace, as this tab holds it (unsaved edits included)
+ room held by this tab's unfinished imports
+ this import
≤ cap (5% of quota)?
```

## Architecture

| File                                                | Role                                                                                                                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/workspace/storage-limits.ts`               | Pure: the cap, `utf8Length`, `storedFileBytes`, `StorageLimitError` (the one message), `isQuotaExceeded`.                                                                              |
| `src/lib/workspace/persistence.ts`                  | Each commit writes the workspace's `bytes` on its summary row, in the same transaction. `storedBytesByWorkspace()` reads them, and measures rows from older builds once with a cursor. |
| `src/lib/workspace/storage-budget.ts`               | `measureStoredBytes(open)` and `reserveStorage(bytes, open)`: the tab's ledger of held room.                                                                                           |
| `src/lib/markdown/document-utils.ts`                | `estimateStoredBytes(file)`: what `importDocumentFile` will store, before reading. It sits next to the importer so the two can't drift apart.                                          |
| `src/components/docs/DocsApp.tsx`                   | Every import path reserves first: `addFiles`, `commitConversion`, `acceptSharedFiles`, `importWorkspace`, `importSharedWorkspaceOnce`.                                                 |
| `src/components/docs/pages/settings/StorageTab.tsx` | The meter shows the same measurement. The browser's figure is shown separately and labelled as an estimate.                                                                            |

### Keeping totals cheap

Measuring every workspace by reading its documents would load every binary in
the database for each upload (that is D01's problem). Each summary row carries
a running total instead. `putWorkspaces` already compares every file with the
last write (`sameFile`) to skip unchanged rows. The same comparison lets it reuse
each unchanged file's byte count, so a save measures only the files it writes.
The first save after a load measures everything once.

A summary written by an older build has no `bytes`. The first measurement
walks that workspace's files through a cursor, one row at a time, and writes
the total back in the same readwrite transaction.

### Reservations

An upload is read (`importDocumentFile`) before it is added, and reading a
large PDF takes time. Without reservations, a second batch picked during that
time is checked against free space the first batch is about to take.

```
addFiles(batch)
  reserveStorage(estimate)       ← refused here if it can't fit; nothing read
  read files, drop duplicates
  room.resize(real bytes)        ← grows: re-checked; shrinks: always fine
  add to the open workspace
  room.release()                 ← now counted as part of the open workspace
  persist
```

Imports into another workspace (backup restore, a new workspace from a link)
release after their `putWorkspace` commits, because the summary row counts
them from then on.

A measurement is async. If a reservation is released while it is in
flight, those bytes may have moved into storage after the summaries were read.
They would then be counted in neither place. A `released` counter detects
this, and the measurement is retaken (up to three times).

## What the budget does not cover, on purpose

- **Edits, draft recovery and AI-written documents.** The cap limits content
  brought in from outside. What the reader writes is always saved; the browser's
  own quota is its only limit, and a failure there shows A10's "Not saved"
  banner. Refusing to save someone's typing to enforce a soft product limit
  would lose work.
- **"Keep both" after a two-tab conflict.** It copies a workspace to preserve
  work, so it is never refused.
- **Offline features and caches.** They are the service worker's (A11). They
  appear in the browser's estimate in Settings, not in the budget.
- **Export scratch space.** Exports are built in memory as Blobs, not written
  to IndexedDB.

## Failure behaviour and debugging

| Situation                                   | What the reader sees                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| An import doesn't fit                       | "Not enough space. This needs X, and Y of the Z Localdox can use on this device is free. Empty the Bin or remove files…" |
| Backup doesn't fit                          | "Nothing was imported." followed by the message above. It no longer says the backup is invalid.                          |
| Browser quota exceeded during an import     | "…This browser is out of storage space for Localdox."                                                                    |
| Quota unknown (`navigator.storage` missing) | No cap is enforced. Settings shows the documents total without "of".                                                     |

To inspect totals in DevTools, open IndexedDB → `localdox` →
`workspace-summaries` and read each row's `bytes`. Deleting a row's `bytes`
forces it to be measured again from the `files` store.

## Limits

- Reservations are per tab. Two tabs importing at the same instant can each
  pass the check. The overshoot is bounded by one import, and the browser's quota
  is still the hard stop.
- Counted bytes are logical. Chromium may store a non-Latin-1 string as UTF-16
  and compresses large values, so bytes on disk differ from the count. The
  cap is a product budget, not a disk measurement.
- The quota, and so the cap, is the browser's estimate and can change between
  sessions.
