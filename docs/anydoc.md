# Optional document-to-Markdown conversion

Import keeps the original document. **Convert to Markdown** in the reader or document menu explicitly creates an editable `.md` document beside it. **Open original**, **Open Markdown copy**, and **Compare** connect the two. Repeating conversion creates a numbered copy and preserves edits to previous copies.

## Implementation

- `src/services/doc-conversion/use-document-conversion.ts` starts a disposable module worker for each conversion, handles cancellation and a 60-second timeout, and discards results when the workspace or source changes.
- `src/services/doc-conversion/anydoc-adapter.ts` wraps the pinned published `@firecrawl/anydoc-wasm@0.2.4`. It detects format from bytes with a filename fallback, hashes the input, and converts locally. The worker and WASM download only when conversion is requested. No document is sent to a conversion service.
- `DocsApp.tsx` creates the Markdown file only after conversion succeeds, checks available storage and source identity, and rolls back the new file on a failed IndexedDB save. Conversion saves reject a conflicting workspace revision from another tab.
- Optional `derivedFrom` metadata records source ID/name, input SHA-256, converter/version, and conversion time. Existing files need no migration. Workspace exports preserve this metadata; file imports remap source IDs, and sharing a copy without its original detaches the source ID.
- Generated documents reuse the existing Markdown editor, reader, search, export, and split panes. A restricted Markdown plugin handles AnyDoc line breaks and explicit anchors without enabling raw HTML. Paginated rendering retains footnote definitions. External images in converted documents require a click before loading.

Supported file extensions cover PDF, Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, and CSV, including supported legacy and macro-enabled variants. New CSV imports retain the original bytes as well as their text preview; RTF imports retain binary data. Files imported by older versions without original bytes can only be converted from their stored text.

## First-release limits

Conversion focuses on text, tables, and links. Embedded images remain in the original; layout fidelity is not guaranteed. Scanned or mixed PDFs that require OCR show the affected pages and create no partial copy. There is no cloud OCR fallback. Password-protected and malformed documents produce errors without changing the original.

The input limit is 30 MiB and the generated Markdown limit is 5 MiB. The 60-second timeout includes a cold converter download. Cancellation terminates the worker; it cannot reverse a storage commit that has already started. These limits bound accepted input/output and execution time, but are not a strict WASM memory cap for unusually complex or compressed documents.

## Verification

```sh
bun run typecheck
bun run test
PLAYWRIGHT_CHANNEL=chrome bun run test:e2e
bun run build
PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_PRODUCTION=1 bun run test:e2e
```

The browser suite uses installed Chrome with the commands above. Alternatively install Playwright Chromium and omit `PLAYWRIGHT_CHANNEL`. The production suite serves the completed build. A cold Vite preview can take about 11 seconds to compress the WASM asset, so browser assertions allow 20 seconds.

Fixtures test the actual published WASM against representative formats, scanned/mixed PDFs, encrypted and damaged documents. Other tests cover naming, provenance, sharing, rendering safety, footnotes, stale workspace revisions, editing/reconversion, cancellation, startup failures, and failed-save rollback.

## Dependency notices

`public/third-party/anydoc-notices.txt` is shipped with the static site. It includes AnyDoc's MIT license and a conservative inventory of 146 transitive crates from upstream commit `261fc257d17c3eab0f673be31c408fd9fdc2171a`. The inventory includes build and platform dependencies that may not occur in the WASM binary. Crate archives were checked against upstream Cargo.lock SHA-256 checksums.

The dependency roots inspected were `cfb`, `csv`, `flate2`, `encoding_rs`, `log`, `pdf-inspector`, `quick-xml`, `zip`, `js-sys`, `serde`, `serde_bytes`, `serde-wasm-bindgen`, and `wasm-bindgen`. License files come from their published archives, including `r-efi`'s `AUTHORS` file. The missing repository-root MIT texts for `defmt-parser` and `include_dir`/`include_dir_macros` were collected from their published VCS commits `4a8cdb44891ed57b8ff5a023b6bec7137c48708f` and `d742c6fffce99ee89da91b934e7ce6fb2a82680c` respectively. Review and refresh the notices when upgrading the converter.
