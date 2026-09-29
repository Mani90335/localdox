# Import queue (R04)

## The problem

Picking or dropping files runs `addFiles` in `DocsApp.tsx`. It used to read
the whole batch with one `Promise.all`:

- **Every read started at once.** Picking 40 images put 40 `FileReader`s in
  flight. Each one holds the file's bytes and builds a base64 copy.
- **One bad file sank the batch.** If a file was moved or edited after it was
  picked, Chrome fails that read with `NotReadableError`. `Promise.all`
  rejects on the first failure, so the three good files beside it were thrown
  away too. The reader saw "Could not upload the selected file(s)" with no
  file named.
- **There was no way to stop it.** A long import ran to the end.

Measured on the HEAD build (`tests/e2e/import-queue.spec.ts`, production
preview):

| Case                           | Before                  | After                                             |
| ------------------------------ | ----------------------- | ------------------------------------------------- |
| 40 images, reads in flight     | 40                      | 4                                                 |
| 4 images, one unreadable       | 0 stored, generic error | 3 stored, error names `broken.png`                |
| Cancel during a 12-file import | no Cancel button        | reading stops, nothing stored, "Upload cancelled" |
| 300 × 20 KB, pick → saved      | 302–312 ms              | 280–299 ms                                        |
| 24 × 5 MiB, pick → saved       | 293–408 ms              | 346–391 ms                                        |

The two timing rows are 3 runs each on a loaded machine. They show the bound
costs no noticeable time. Whole-browser memory was also sampled (`ps` RSS
every 15 ms). Its peaks were dominated by noise at this scale (+207 to
+402 MiB on both builds), so no memory improvement is claimed. The 5%-of-quota
budget ([storage-budget.md](storage-budget.md)) already caps a batch's total
size (about 200–256 MiB in the test profile).

## The mental model

A checkout with four tills. Files queue up and at most four are served at
once. One very large file (a whole trolley) gets a till to itself. If one
customer's card is declined, that customer is turned away and the queue keeps
moving. Closing the shop sends away everyone still waiting, and the four being
served don't count.

## Architecture

| File                                | Role                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/lib/workspace/import-queue.ts` | `runBounded(items, task, options)`: a bounded queue. Results come back in input order, each `ok` or not. |
| `src/components/docs/DocsApp.tsx`   | `addFiles` reads through the queue, reports failures, and offers Cancel on the progress toast.           |
| `tests/import-queue.test.ts`        | Concurrency, byte budget, per-item failure, abort, order.                                                |
| `tests/e2e/import-queue.spec.ts`    | The three real-browser cases above, with `FileReader` instrumented.                                      |

`runBounded` starts the next item when both hold:

```
running < concurrency (4)
running bytes + next item's bytes ≤ maxBytes (48 MiB), or nothing is running
```

The bytes come from `estimateStoredBytes`, the same estimate the storage
reservation uses. A 30 MiB file (the per-file limit) weighs about 40 MiB as
base64, so it reads alone or beside small files. It is never stuck, because an
item always starts when nothing else is running.

## Flow

```
pick / drop
  → per-file size limit (30 MiB)
  → reserveStorage(estimate)            room held for the whole batch
  → toast "Uploading N files..." [Cancel]
  → runBounded(importDocumentFile)      ≤ 4 reads, ≤ 48 MiB in flight
      each file → { ok, value } or { ok: false, error }
  → toast loses Cancel                  from here the batch goes in whole
  → error toast naming unreadable files (console.warn has the cause)
  → duplicate check, name prompts
  → room.resize(real bytes)
  → cancel.signal.throwIfAborted()      last point Cancel can still win
  → workspace state + persistNow
  → "Successfully uploaded K files!"
```

Cancel works up to the point the files enter the workspace. Nothing is
written before that, so nothing needs undoing. The reservation is released in
`finally`.

## Why this approach

- **A small in-house queue, not a library.** `p-limit` and similar packages do
  the concurrency part. The byte weight, the ordered `ok`/error results and
  abort-rejects-now would all still be ours. The queue is about 90 lines, comments included, with
  no dependency.
- **Settled results, not fail-fast.** Each file is its own thing to the
  reader. Only a failure the whole batch shares, such as the storage cap or a
  failed save, still fails the batch.
- **Abort rejects at once.** Reads already running are not interrupted.
  `importDocumentFile` has no abort hook. Those reads finish in the background
  and their results are dropped, and no new ones start.
- **Four reads.** Timing showed no loss against reading everything at once.
  Higher limits were not measured, because there was nothing to win.

## Trade-offs and limits

- It doesn't lower peak memory for the finished batch. Every file's data URL
  is still held in memory and stored whole. That is D01/D02 (per-file access,
  Blob storage).
- The unreadable-file e2e test fakes the failure in `FileReader`. A real
  `NotReadableError` (edit the file on disk after picking it) takes the same
  path, but depends on timing and is not automated.
- Duplicate-name prompts still use `window.prompt` (a Package 7 UX item).

## Debugging

- A file missing after an import: look for a console warning
  `Could not read <name>` with the underlying `DOMException`.
- Count reads in flight in a real browser by wrapping
  `FileReader.prototype.readAsDataURL`. Count down inside the reader's own
  `onload`/`onerror`, as the e2e spec does. The app starts its next read from
  `onload`, before `loadend` or any listener added later runs, so a probe
  listening for those overcounts by one.
