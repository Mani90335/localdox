D02 uses IndexedDB Blob bodies in the existing `files` records. A binary body
has an immutable `id` and `blob`; the ID survives structured cloning and changes
when an editor replaces the bytes. File keys remain `[workspaceId, id]`.
Persistence comparisons, three-way merges, and conversion completion checks use
the body ID so rereading a Blob does not create a false edit or conflict.

Database version 3 upgrades v1 workspace records or v2 data URLs in one atomic
upgrade transaction. The v2 cursor decodes one file at a time. Unreadable legacy
values are retained for recovery. Summary totals are refreshed using Blob sizes.
Save normalization is adopted only after commit and only when the caller still
holds the saved bytes, preserving edits made during the transaction.

File imports retain a Blob. The bounded import queue computes and caches binary
fingerprints for duplicate detection; a failed read affects only that file, and
cancellation prevents further queued reads. Text and binary fingerprints have
separate prefixes. CSV retains its original bytes (including BOM/encoding) until
edited. Office editors replace bodies, and binary downloads return Blob bytes.

Images and embedded media create object URLs only for mounted consumers and
revoke them on replacement or unmount. Spreadsheet and conversion workers receive
Blob handles and read bytes in the worker. PDF/office parsers read an ArrayBuffer
when needed. Base64 encoding is confined to explicit portable JSON backup/share
serialization, performed one binary at a time; existing backup/share formats
remain readable. Serialization is now asynchronous, including its tests.

Validation covers migration rollback and retry, byte fidelity, cross-tab merges,
incremental file writes, aborted saves, edits during a pending commit, backup
restore, sharing, CSV/office editing, media export, import failures/cancellation,
storage limits, and URL cleanup. `.gitattributes` preserves exact PDF fixture
bytes on Windows; line-ending changes invalidate PDF byte offsets.

To reproduce with the locked dependencies:

```sh
bun install --frozen-lockfile
npm run typecheck
npm test
npm run build
```

On Windows PowerShell, use `npm.cmd` if script execution is disabled. Set
`PLAYWRIGHT_PRODUCTION=1` for production preview tests and `PLAYWRIGHT_CHANNEL=chrome`
to use installed Chrome. The relevant suites are `binary-storage`, `editing`,
`import-queue`, `media`, `persistence`, `sharing`, and `storage-budget` under
`tests/e2e`.

Run `node scripts/bench-binary-storage.mjs` with no concurrent builds or tests.
It writes [raw results](d02-binary-storage-results.json) for five alternating
data URL/Blob trials, each containing eight 5 MiB deterministic binary bodies.
Preparation includes fixture generation; writes resolve on transaction completion;
reads measure IndexedDB `getAll` structured cloning without decoding Blob bytes.
Logical body sizes exclude metadata and browser disk overhead. These are local
microbenchmarks, not full-app startup, physical-device, retained-heap, or OPFS
measurements. Blob storage is the chosen implementation; D01 metadata/lazy-loading
work and broader performance acceptance gates remain separate tasks.

On Windows with Chrome 154.0.8037.58, the five-run medians were:

| Representation |   Logical bodies |  Prepare |   Commit | Read handles/bodies |
| -------------- | ---------------: | -------: | -------: | ------------------: |
| Data URLs      | 55,924,288 bytes | 572.9 ms | 412.4 ms |            185.3 ms |
| Blobs          | 41,943,040 bytes | 157.9 ms | 174.1 ms |             33.0 ms |

The same bodies use 25% fewer logical storage bytes. Blob reads return handles;
decoding/viewer work is paid when the consumer reads them. This result supports
using IndexedDB Blobs first; it does not establish an OPFS need.
