Latest update — 2026-09-28 (R04 spreadsheet viewer off the main thread)

Completed R04's viewer half (Package 5). Spreadsheets are now parsed,
filtered and sorted in a worker, one sheet at a time. The grid renders only
the rows and columns in view. The bounded mass-import queue is not done
(see Limits).

Before (HEAD 4178f45, production build, 1280×800, Playwright + long-task
observer, same script both sides; fixtures generated with SheetJS):
- 100,000 × 10 workbook (18 MiB): one 860 ms main-thread task to open
  (832 ms on reopen). The main-thread JS heap was 80 MiB after open and
  103 MiB after reopen. Sorting was an 84 ms task.
- 6 sheets × 25,000 × 8 (22 MiB): every sheet was parsed up front, a
  1,072 ms task, and 2,175 ms to first rows. Heap 87 / 115 MiB.
- 1,000 × 300: 8,128 cells mounted (every column of each rendered row),
  with a 281 ms task on open.
- In the browser test below, a 60,000 × 8 workbook opened with one 316 ms
  task.

Fix:
- src/lib/spreadsheet/engine.ts (SpreadsheetEngine, pure and injectable):
  - open() reads only the sheet names (bookSheets). A sheet is parsed with
    SheetJS's `sheets: [name]` the first time it is shown, then cached. In
    node on the 6-sheet file that is 130 ms for the names and 340 ms for one
    sheet, against 1,255 ms for the whole workbook.
  - Filter and sort keep the old viewer's semantics exactly: per-cell,
    case-insensitive and trimmed matching, numbers before text, one shared
    collator, and ties in sheet order in both directions.
  - Sort keys are read once per row, and sorted orders are cached per
    (sheet, column, direction), four at most. A filtered view walks the
    cached order instead of re-sorting.
  - A query that extends the previous one re-checks only its matches.
  - Filtering and sorting run in 12 ms slices. A newer view request stops
    an older one at its next slice (ViewSupersededError).
  - Rows are handed out in windows, by view position and column range. Only
    the latest two views are kept; an older one answers StaleViewError.
  - Column types are sampled from the first 200 rows, as before. Widths come
    from every cell's length, recorded in the stringify pass the engine
    already makes, so sorting never brings a clipped value to the top.
- protocol.ts / spreadsheet.worker.ts / client.ts: the same request/reply
  shape as the A07 search protocol.
  - Every request gets one reply: result, superseded, stale or error.
  - A worker error or messageerror terminates the worker, rejects everything
    pending and reports once. close() rejects work still in flight.
  - The local client runs the same engine on the main thread.
- connect.ts: one worker per open spreadsheet, closed (terminated) when the
  file changes or the viewer unmounts. It falls back to the local client
  where workers can't be created. The module is dynamically imported, so
  the worker and SheetJS inside it stay optional downloads. The offline
  shell list is unchanged (checked in the emitted sw.js).
- grid-window.ts: row and column windows, column fitting and block
  arithmetic.
  - A sheet narrower than the view stretches its columns in proportion, as
    the auto table layout used to.
  - A wider one keeps natural widths (64–360 px) and scrolls.
- use-spreadsheet.ts: drives the client.
  - Rows are fetched in 128-row × 48-column blocks, with 64 rows of
    prefetch; at most 48 blocks are kept on the main thread.
  - A new view (filter, sort or sheet) replaces the old one only once its
    first screen has arrived, so the table never flashes empty.
- SpreadsheetViewer.tsx:
  - Fixed table layout with a colgroup. Only the visible columns (plus 3 on
    each side) are rendered, with spacer columns for the rest; the sticky
    header and # column are unchanged.
  - Long cells are truncated with an ellipsis and a title.
  - aria-rowcount/colcount and aria-rowindex/colindex give the full size.
  - "Filtering…" / "Sorting…" status and aria-busy while the worker works.
  - A crashed worker shows an alert with Try again, which starts a new
    worker.
  - The filter input now has a name (a DevTools issue).

After (same script and fixtures; results identical over the runs made):
- 100,000 × 10: no main-thread task over 50 ms on open, reopen, filter or
  sort. Heap 6.2 MiB after open, 29.8 MiB after reopen.
- 6 sheets: no long task, 1,302 ms to first rows (reopen 1,324 ms, was
  1,966). Heap 6.2 / 34.9 MiB. Switching to an unparsed sheet now takes
  about 305 ms, off the main thread (it was 44 ms, because every sheet had
  been parsed at open).
- 1,000 × 300: 325 cells mounted, 433 after scrolling to the middle. No
  long task.
- Match counts and first sorted rows are identical to HEAD: 771 / 9 / 28
  matches; first sorted rows 78331 / 354 / 13689.

Validation:
- Unit, 22 new tests:
  - tests/spreadsheet-engine.test.ts, 12 tests:
    - Filter and sort compared against a verbatim copy of the old viewer's
      algorithm: 12 random sheets × 8 queries × 11 sorts, with accents,
      mixed and empty cells, short rows and an out-of-range column.
    - Lazy per-sheet reads, recorded through a SheetJS wrapper.
    - Narrowing equals a fresh filter.
    - Supersession counts yields, so an older view must stop at its first
      slice.
    - View eviction, column windows, and widths from rows beyond the
      sample.
    - Mutation checks: reversing the tie order, inverting the narrowing
      test, dropping the slice check, or sampling widths again each fail a
      test.
  - tests/spreadsheet-client.test.ts, 10 tests: protocol replies, the
    worker client on a fake worker (round trip, error/messageerror, close,
    late replies), the local client, and grid arithmetic.
  - npm test: 296/296.
- Browser: tests/e2e/spreadsheet-worker.spec.ts, 8 tests, production
  preview.
  - A 400 × 300 sheet: fewer than 900 cells mounted, correct cells in the
    middle and at the far end, full aria counts, and no page overflow.
  - A held "view" reply: "Filtering…", aria-busy, and the old rows stay;
    the latest query wins.
  - Sorting across 3,000 virtual rows, bottom row included.
  - No clipped cell after sorting a long value to the top.
  - Switching sheets after scrolling right: a MutationObserver checks that
    no row is ever rendered blank.
  - A crashed worker: alert, Try again, and a new worker.
  - No Worker: the main-thread fallback reads, filters and sorts.
  - A 60,000 × 8 upload with no task over 150 ms (0 measured in 5/5 runs);
    leaving the file terminates its worker.
  - 18/18 with --repeat-each=3 before the last two tests were added.
  - Against the HEAD build, the tests fail on substance: 7,225 cells, no
    "Filtering…" state, no worker to crash, a 316 ms long task. The
    no-worker test passes on HEAD, as it should.
- Existing spreadsheet tests pass: viewers.spec, including "spreadsheet
  controls…" (its selector fix landed in 0a06df2), and editing.spec (CSV
  and XLSX editing, the wide-sheet editor, the formula save error).
- Chrome DevTools MCP, production preview, isolated contexts, fixtures
  loaded through DataTransfer:
  - 6-sheet workbook: rows in 1,130 ms with no long task. Sheet 5, filter
    "golf 7" (1,391 rows), then sort ascending by Amount 4: rows correct
    and ascending, still no long task.
  - A screenshot showed the Id column clipping 5-digit ids ("226…") after a
    sort, because widths came from a 200-row sample. That is fixed
    (full-column lengths) and regression-tested.
  - Wide sheet sorted descending and scrolled to the middle: 406 cells,
    nothing clipped. At 390 px wide, no page overflow.
  - Console: only the unnamed filter-field issue, now fixed.
- npm run typecheck, npm run build (same warnings as HEAD), ESLint (0
  errors) and Prettier on every changed file pass.
- Full production browser suite (built on 4178f45 plus this change): 87
  passed, 1 skipped (dev-only), 5 failed.
  - Four were the known failures on that HEAD: the mobile-navigation drawer
    close, both sharing.spec previews, and viewers.spec spreadsheet controls
    (now fixed upstream).
  - The fifth, offline "deep link opens Settings", is flaky on both builds.
    Run ×8 each: HEAD failed 2/8, this build 1/16 (over two batches). It
    fails at the Storage tab click (line 167) or on a doubled /settings
    navigation, as the A07 entry recorded.
- Rebased onto 0a06df2 (A04, R03, R06 and PDF follow-ups; only PROGRESS.md
  overlaps): typecheck, npm test 355/355 and the build pass. Spreadsheet,
  viewers and editing specs: 17/17.

Environment: all validation ran in a detached worktree with its own
node_modules, on port 4391. Peer sessions were editing search, PDF outline,
Mermaid and AI files in the shared tree. This commit contains only the
spreadsheet files, their tests and this log.

Limits:
- Mass import still maps every picked file through one unbounded
  Promise.all in DocsApp.tsx (the rest of R04). That file has another
  session's uncommitted edits, so it was left alone.
- The row count is not capped for the browser's maximum element height.
  Above about 930,000 rows (36 px each) the bottom rows can't be scrolled
  to. That limit was already there.
- The status prompt still says "Select a column heading to sort" while a
  sort is active, as before.
- Column widths are estimated from character counts, not measured. Very
  wide glyphs outside the 200-row sample may still be truncated (the full
  text is in the title).
- The worker keeps every visited sheet's rows in memory until the file is
  closed. Nothing is measured on real phones, Safari or Firefox.
- The Office editor (OfficeEditor.tsx) still parses on the main thread; it
  was out of scope.

Previous update — 2026-09-28 (PDF follow-ups: pinch zoom rate, current Contents entry, windowed thumbnails, spreadsheet e2e)

Four follow-ups to R03/A08, requested by the user.

1. Trackpad pinch zoom was far too fast (user report). A pinch arrives as a
   burst of small ctrl+wheel events, and each one was a full ×1.25 button
   step, so a light pinch went from 100% straight to 400%.
   - New pure module src/services/pdf-viewer/pdf-zoom.ts: zoom follows the
     gesture.
   - Chrome reports a pinch as deltaY = −100·ln(scale). pdf.js's viewer
     applies e^(−deltaY/100) to track the fingers 1:1; this reader uses half
     that rate (0.005 per px), a calmer pinch as asked.
   - Line and page delta modes are converted to pixels.
   - Each frame's change is capped at one button step, so Ctrl + a
     mouse-wheel notch is still exactly ×1.25.
   - PdfPageArea sums a burst of events and applies it once per animation
     frame, through a new `zoomBy` in the reader state. Buttons and keys are
     unchanged.
   - Measured, the same synthetic 40-event pinch (−120 px) goes 100% → 400%
     on HEAD and 100% → 182% now; pinching back returns to 100%. Checked in
     Chrome via DevTools MCP as well as Playwright.

2. Contents shows the current page's entry.
   - `locateOutlinePath` in pdf-outline.ts picks the entry whose page is the
     latest at or before the current page; on ties the shallowest wins, then
     the first (a chapter beats its first section on the same page, as in
     pdf.js).
   - Levels of ≤ 16 entries are scanned exactly, in any order. Longer levels
     are binary-searched, on the assumption that they're in page order, so a
     10,000-entry level costs ≤ 40 look-ups and the lazy resolution of R03
     stays intact. An out-of-order long level still yields an entry at or
     before the page.
   - The tree highlights that single entry (aria-current="page"; previously
     every entry that resolved to the current page) and opens its collapsed
     ancestors.
   - It scrolls the entry to the centre of the tree when it's off screen
     (keyboard moves still scroll just into view), and makes it the keyboard
     starting point unless the tree already has focus.
   - Page flips are debounced (120 ms).
   - The tree now scrolls only itself (manual scrollTop, not scrollIntoView).
   - Found by the unit tests: the "first entry on this page" search used
     ">=" and could return a later-page entry in an out-of-order outline.
     It now requires an exact page match.

3. The Pages thumbnail list is windowed.
   - It used to mount one button per page (300 for a 300-page PDF). Every
     slot is the same 3:4 box, so rows are absolutely positioned at exact
     offsets. Only the view plus 3 rows of overscan is mounted (11 at
     1280×800), along with any thumbnail that has focus.
   - The pitch is measured from a mounted thumbnail and follows the sidebar
     width.
   - The list scrolls to the current page as it changes, and carries
     aria-posinset/-setsize and an accessible name ("Pages").
   - Canvases still render lazily per thumbnail (IntersectionObserver), and
     are released on unmount.

4. viewers.spec "spreadsheet controls…" failed on every build since it was
   written (779bbfa). It looked for role="menuitem" in the sidebar's file
   menu, which has always been a popover of plain buttons. The header Export
   menu is a Radix menu, which is why the test's other menuitem steps passed.
   - The test now scopes to the sidebar menu panel and uses button roles.
   - It passes on both HEAD and this build.
   - Converting the sidebar menus to ARIA menus (roles plus arrow-key focus
     management) would change the role of every sidebar menu action, which at
     least five other specs rely on. That is a Package 7 UX decision, so it
     wasn't done here.

Validation (clean worktree of HEAD plus only these files, production preview
on a private port):
- Unit: npm test 304/304.
  - New tests/pdf-zoom.test.ts (6).
  - tests/pdf-outline.test.ts now has 17: current-entry rules, unresolvable
    entries, look-up bounds on 10,000 and 20×50×5 outlines, and in-order and
    out-of-order levels.
- Typecheck, build, ESLint and Prettier on the changed files pass.
- Browser: tests/e2e/pdf-thumbnails-zoom.spec.ts is new, with 2 tests
  (windowed Pages list, and pinch rate plus mouse-notch step).
  tests/e2e/pdf-outline.spec.ts has a new current-entry test: a collapsed
  chapter opens and the entry is in view and is the keyboard start; the
  highlight follows page turns; look-ups stay under 100.
  - All 3 new tests fail on the HEAD build. Pinch: expected 182%, received
    400%.
  - PDF and viewer specs (pdf-outline, pdf-thumbnails-zoom, pdf-keyboard,
    pdf-zoom-budget, viewers, highlighting): 26/26.
  - Full suite: 93/97. Three failures also fail on HEAD: the
    mobile-navigation drawer close and both sharing.spec previews. The
    fourth, offline.spec "fresh install…", failed once while I was copying a
    fixture into that same preview server's public directory and driving it
    from DevTools MCP. It then passed 3/3 in isolation, and passes on HEAD.
- Chrome DevTools MCP, 100-page PDF with a 6,020-entry outline:
  - Pinch 100% → 182%.
  - At page 73 the Pages list mounts 11 thumbnails with 73 in view.
  - Contents opens Chapter 15 and highlights Section 15.21 (the first heading
    on page 73), centred.
  - No console errors.

Limits:
- Safari reports trackpad pinch as gesture events rather than ctrl+wheel, so
  Safari pinch isn't handled by this change. Chromium desktop only.
- The current entry is the first heading on the page. When a page opens with
  the tail of the previous section, that section isn't the one highlighted
  (pdf.js behaves the same).

Previous update — 2026-09-28 (R06 Ask AI streaming ownership)

Completed R06 (Package 8). An Ask AI request can only change the answer it
started. Closing the panel cancels the request, streamed text reaches React
in batches, and blocked or cut-off answers are reported.

Before (HEAD 4178f45, production build, Chrome, Gemini's streaming endpoint
stubbed in the page so the test controls every chunk):
- Every token was a React state update, and each update re-rendered the whole
  answer as Markdown. 300 tokens meant 300 renders, and 2,000 tokens meant
  2,000.
- With 6× CPU throttling, a 2,000-token answer paced at 5 ms per token
  saturated the main thread: 48–50 s of main-thread task time (41–42 s
  scripting), and a stream paced to take about 12 s took 48.5–50.5 s.
  Results were consistent over 3 runs.
- Closing the panel unmounts it, but nothing aborted the request. The stream
  kept running and using the user's API quota for an answer nobody could see.
- `ask()`'s `finally` always set isStreaming=false. An older, superseded
  request finishing late therefore ended a newer request's streaming state:
  its Stop button disappeared and the action buttons re-enabled mid-answer.
  Its late tokens could also reach the new answer.
- Gemini ignored `promptFeedback.blockReason` and `finishReason`. A blocked
  prompt or withheld answer (SAFETY, RECITATION, PROHIBITED_CONTENT, …)
  showed as an empty or partial answer with Copy/Insert buttons. A
  MAX_TOKENS cut-off looked complete. Mid-stream error events were
  swallowed. OpenAI likewise ignored `length` and `content_filter`.
- readSSE ended quietly on abort, so a cancelled stream could be returned by
  runAgent as a complete result. Events already buffered were still yielded
  after an abort.

Fix:
- src/services/ai/ask-session.ts (new): a React-free controller behind
  useAI.
  - Every request has a generation. Starting, stopping, resetting and
    unmounting bump it, and a request changes state only while it owns the
    current generation.
  - Streamed text is delivered at most every 50 ms. The first chunk shows
    immediately, and completion delivers the tail in the same update.
  - Stop keeps the text received so far, marks the answer "stopped" and
    ignores anything later. Any error from an aborted request reads as
    stopped, not as a failure.
  - dispose() (unmount) aborts and ignores all later events. It also refuses
    requests (e.g. the panel's deferred quick-action auto-run) until
    activate(), which covers StrictMode remounts.
- use-ai.ts: a thin binding over the session. It exposes `status` and
  `notice`, and `abort`/`reset` map to stop/reset.
- types.ts: streamChat now returns a StreamFinish. `reason` is "stop",
  "length" or "interrupted" (the stream closed with no finish reason). Adds
  the AIError kind "blocked".
- providers/gemini.ts:
  - promptFeedback.blockReason → "Gemini declined this request (…)".
  - Withholding finish reasons (checked against Google's current
    FinishReason list) → "Gemini withheld the answer (…)".
  - MAX_TOKENS → length. No finish reason → interrupted. No text → an error.
  - Mid-stream error events surface. Thought parts are skipped.
- providers/openai.ts: `length`, `content_filter` (blocked), empty answers,
  mid-stream errors, and a stream with no [DONE] and no finish reason
  (interrupted).
- agent.ts:
  - Reads the provider's finish result into AgentResult.finish.
  - Once the signal has aborted, any error (e.g. a fetch TypeError) is the
    cancellation. It never falls back to another provider, and a stream that
    ends after an abort is not returned as a result.
  - "blocked" is not retried with another key.
- sse.ts: throws the abort reason instead of ending quietly. It checks the
  signal before each buffered event and keeps a final line that has no
  trailing newline.
- AskAiPanel.tsx:
  - Shows "Stopped. The answer above is incomplete." for a stopped answer,
    and the length/interrupted notice, in a role="status" line.
  - Clears the deferred quick-action timer on close.
- agent.ts, registry.ts and the providers now import with .ts extensions (as
  keys.ts already did), so Node's test runner can load them.

After (same setup):
- 300 tokens: 27 renders. 2,000 tokens: 206 renders (206/195/196 across
  the 3 throttled runs).
- With 6× CPU throttling, the 2,000-token answer took 5.7–5.8 s of
  main-thread task time (4.4–4.5 s scripting, layout 1.4–1.6 s → 0.2 s).
  The stream finished in 15.7–15.9 s. That is 8.4× less main-thread work.
- Closing the panel mid-stream aborts the request. Stop keeps the partial
  answer, and later chunks are ignored.
- A SAFETY/RECITATION finish shows "Gemini withheld the answer (…)". A
  MAX_TOKENS cut-off keeps the text and adds "The answer reached the model's
  length limit and may be cut off."

Tests:
- tests/ai-streaming.test.ts (29 new unit tests):
  - A superseded request's late tokens, abort, error or success cannot touch
    the newer answer.
  - Stop keeps pending text and ignores late events.
  - An abort surfacing as TypeError still reads as stopped.
  - 500 tokens → 7 updates (manual flush clock), with the tail delivered on
    completion.
  - Length/interrupted notices. dispose aborts, goes quiet and refuses new
    requests until activated. reset.
  - readSSE: abort mid-buffer, and a final unterminated line.
  - Gemini: stop, thought parts, MAX_TOKENS, interrupted, 5 withholding
    reasons, blocked prompt, empty answer, mid-stream error.
  - OpenAI: stop, length, content_filter, interrupted.
  - runAgent (both providers keyed): abort mid-stream rejects with
    AbortError and makes no fallback request. An abort surfacing as a fetch
    TypeError is a cancellation. The finish reason reaches the result and
    quota still falls back. Blocked is not retried.
  - Against HEAD's sse.ts and providers, all 17 SSE/provider tests fail.
- tests/e2e/ai-streaming.spec.ts (4 browser tests; key saved through
  Settings; Ask AI opened from the real selection menu):
  - 300 tokens render in fewer than 60 updates.
  - Stop keeps the partial answer and ignores later chunks.
  - Closing the panel aborts the request.
  - A blocked answer and a length cut-off are reported.
  - All 4 fail on a clean HEAD build (300/300 renders, not aborted, no
    reporting) and pass with the fix.
- Checked by hand in Chrome via DevTools MCP (production preview, stubbed
  streaming endpoint): streamed Markdown renders, and the real Stop button
  aborts, keeps the text and ignores a late chunk. Copy/Insert remain
  available. A RECITATION finish shows the withheld message, and closing the
  panel mid-stream aborts. No console errors or warnings.
- Validated on HEAD 85aee16 plus these files only:
  - typecheck and build pass.
  - Unit suite 323/323 pass.
  - eslint is clean on src/services/ai and the new tests. This also fixes
    one existing prettier error there.
  - ai-streaming and ai-keys specs: 6 passed, 1 dev-only skipped.
- Full production browser suite (on 4178f45 plus these files): 85 passed,
  1 skipped, 4 failed. The 4 failures are the ones that already fail on
  plain HEAD: the mobile-navigation drawer close, both sharing.spec
  previews, and the viewers.spec spreadsheet controls.

Environment:
- A peer session's uncommitted search/MarkdownViewer/DocsApp edits were in
  the shared tree, and A04/R03 landed during this work.
- All validation therefore ran in a detached worktree with its own
  node_modules, on private ports and output directories.
- This commit contains only the Ask AI files, their tests and this log.

Limits:
- Streaming is still shown as re-rendered Markdown every 50 ms. For very
  long answers each render still parses the whole text. There is one
  ~50 ms long task at 6× throttling.
- Gemini keys still travel in the URL query string rather than the
  x-goog-api-key header. This is left for A12, which also covers retired
  model IDs.
- A stopped answer is not resumable.
- There are no real provider calls; all streams are stubbed. Chromium only.
- The floating AskAiButton is still dead code. Ask AI is reachable only from
  the reader's selection menu. That is unchanged here.

Previous update — 2026-09-28 (R03 lazy PDF outline and bounded Contents tree)

Completed R03's outline work (Package 5), so R03 is now done. Opening a PDF no
longer resolves its outline. The Contents tab resolves only the entries it
shows, opens large outlines collapsed, and mounts only the visible rows of a
long list.

Before (HEAD 4178f45, production build, 1280×800, Chrome-generated PDF with
a 6,020-entry outline: 20 chapters × 50 sections × 5 topics, 100 pages):
- As soon as the document loaded, before anyone opened Contents, the reader
  sent 6,020 GetPageIndex worker requests: `resolveOutline` walked the whole
  tree recursively with `Promise.all`.
- The Contents tab mounted all 6,020 entries fully expanded: 13,065 sidebar
  elements and a 144 ms long task.
- A `getOutline()` failure fell into the document-load catch, so a broken
  outline showed "This PDF could not be read" for a readable PDF.
- The outline list had no tree semantics. Every entry was its own Tab stop,
  and there was no way to collapse anything.

Fix:
- src/services/pdf-viewer/pdf-outline.ts (pure, unit tested):
  - `buildOutline` maps pdf.js's outline into ids, titles, unresolved
    destinations and the PDF's open/closed flag (negative /Count). It is
    iterative, so a very deep outline can't overflow the stack.
  - `initialExpanded` honors the PDF's open/closed flags, breadth first. It
    stops expanding before the visible rows would pass 200, so a small outline
    opens as its author set it and a huge one opens at its top levels.
  - `flattenOutline` produces the visible rows with aria level, position and
    set size. `windowRange` is the virtual window.
  - `PdfOutlineResolver` resolves destinations to pages on demand:
    - Cached per named destination or page reference, so entries on one page
      share one look-up.
    - At most 4 look-ups in flight.
    - `prefetch` replaces queued work when rows scroll away. A click jumps the
      queue and is never dropped.
    - Integer page-index destinations are supported, as in pdf.js's link
      service. Failures become inert (disabled) entries.
    - `dispose` stops everything when the document changes.
- PdfOutlineTree.tsx is a flat `role="tree"` with treeitems (aria-level,
  -posinset, -setsize, -expanded, -disabled, aria-current="page"):
  - It is one Tab stop. Focus stays on the tree via `aria-activedescendant`,
    so a row leaving the virtual window never drops keyboard focus.
  - Keys: Up/Down/Home/End move, Right expands or enters, Left collapses or
    goes to the parent, Enter/Space navigate. A chevron click toggles.
  - Past 300 visible rows only the window (plus 12 rows of overscan) is
    mounted, with fixed 28 px rows and spacers.
  - Rows on screen are prefetched for the current-page highlight. Updates are
    coalesced to one render per animation frame.
  - The latest click wins if an earlier entry is still resolving.
- PdfReader.tsx: the outline is loaded but not resolved. An outline failure
  only empties Contents and never becomes a document load error. There is one
  resolver per document.
- PdfSidebar.tsx: the tree is its own scroll container (it windows by scroll
  position).

After (same fixture, build settings and script):
- 0 GetPageIndex requests at load.
- Opening Contents: 32 look-ups. The 170 initially visible rows (20 chapters,
  with chapters 1–3 open) point into 32 distinct pages, checked independently
  with pdf.js in Node.
- 170 rows / 854 sidebar elements (was 6,020 / 13,065).
- Longest long task 94 ms (was 144 ms).
- JS heap 23.4 MiB (was 35.6 MiB).
- With all 1,020 chapter and section rows expanded, fewer than 80 rows are
  mounted and the scroll height is exact (1,020 × 28 + 16 px).

Validation:
- Unit: tests/pdf-outline.test.ts, 13 tests:
  - Mapping and closed flags.
  - A 20,000-level chain, built and flattened without recursion.
  - The initial expansion budget, including 10,050 entries.
  - aria positions, the window math and destination keys.
  - Lazy, cached resolution.
  - Named, missing and broken names, page indexes and bad refs.
  - The concurrency cap.
  - Scroll-away dropping, and click priority and promotion.
  - dispose.
- Browser: tests/e2e/pdf-outline.spec.ts, 3 tests, production preview:
  - A handcrafted PDF with explicit, named, missing, no-destination and
    closed-group entries: disabled states, navigation, aria-current, and full
    keyboard operation.
  - The 6,020-entry book: 0 look-ups before Contents opens, a bounded initial
    tree, ≤ 32 look-ups, and navigation to page 96.
  - Past 300 rows: windowing, a mid-list scroll with correct aria positions,
    End/Enter reaching the last row (page 100) with focus kept, and Home.
  - All 3 fail against the HEAD build. The load test fails with "Received:
    6020" look-ups.
- Existing browser specs pdf-keyboard, pdf-zoom-budget, highlighting and
  viewers: 19/20. The one failure, viewers.spec spreadsheet controls, also
  fails on the HEAD build (a known existing failure).
- npm test 287/287, typecheck, build, and ESLint/Prettier on the changed files
  all pass. All of it ran in a clean worktree of HEAD plus only this change,
  on private ports, because other sessions share the main tree.
- Chrome DevTools MCP, isolated context, same fixture:
  - GetOutline only, and 0 GetPageIndex requests at load.
  - Contents: 32 look-ups and 170 rows.
  - Keyboard End → Right → Right → Enter landed on Section 20.1 at page 96,
    with focus kept and the focus ring and current-page highlight visible.
  - No new console warnings. The one existing issue, a form field without
    id/name, isn't in the sidebar.

Limits:
- Outline entries that are URL/action links (no destination) stay inert, as
  before.
- The tree doesn't yet auto-reveal the entry for the current page when it is
  inside a collapsed branch.
- The thumbnail list still mounts one (unrendered) button per page.
- Chromium desktop only. No Safari/Firefox, screen-reader or
  physical-device testing.

Previous update — 2026-09-28 (A04 diagram mode parity and bounded Stepped stage)

Completed A04 / Package 5's diagram item. Raw and Stepped now use one
renderer decision for each diagram. Stepped plays in a stage one screenful
tall, whatever the diagram's shape.

Before (HEAD 4178f45, production build, 1280×800, `flowchart TD` chains):
- 499, 500 and 599 edges: Raw drew on the GPU canvas, because its render
  measured too large for live SVG. Stepped re-ran only the source check
  (GPU threshold 600 edges) and mounted the whole SVG.
  - 500 edges: a 52,126 px stage on a 52,543 px page (the audit measured
    52,311).
  - 599 edges: a 62,422 px stage.
  - The transport was off screen in every case.
- 600 and 1,000 edges: both modes used the canvas, with bounded stages.
- A tall chain small enough to stay SVG played at natural height with the
  camera off: 40 nodes gave a 4,286 px Stepped stage, 150 nodes 15,726 px.
- The results were the same whether Stepped was chosen after Raw finished or
  straight away.

Fix:
- src/services/diagrams/render-decision.ts: `decideDiagramRender(source,
  renderedTooLarge)` returns svg / gpu / image and what settled it (source or
  render). The rules are unchanged: the source scan first, then a measured
  render sends flowchart/ER/class/state to the GPU engine and other kinds to
  an image. A measured verdict is remembered per source (a 64-entry list of
  hashes), so a remount or a second pane doesn't lay the diagram out again to
  rediscover it.
- Mermaid.tsx computes the decision once. It passes `engine` to Stepped and
  records a verdict from either stage. The verdict is keyed by source, so an
  edited diagram starts fresh.
- MermaidExplainer.tsx:
  - Takes `engine` from the parent and no longer runs its own source gate.
  - After rendering, applies the same measured check as Raw. An oversized
    SVG is reported instead of mounted, and the stage moves to the GPU
    engine (or the diagram becomes a still image with Stepped disabled).
- stage-ratio.ts `playbackBoxStyle`: a tall diagram's Stepped stage takes the
  full column width and `min(32rem, 70vh)` of height, plus the transport
  gutter. The old natural-height CSS rule is gone. Raw keeps natural height
  for tall diagrams, as a still picture you scroll past.
- explainer/camera.ts + player.ts: an optional `CameraView` (the stage's
  aspect ratio, and a floor of natural size).
  - For a tall diagram, the home frame is widened to the stage's proportions.
  - Close-ups take that aspect, at no more than 1 diagram unit per pixel, and
    the camera now follows tall diagrams.
  - Without a view (every fitted diagram), framing is unchanged.
  - The stage is sized with `flushSync` before the camera measures it.
  - Zoom ceiling: enough to reach 2× natural size.

After (same script and build settings):
- 499/500/599/600/1,000 edges, with Stepped chosen after Raw and straight
  away: canvas in both modes, frame ≤ 367 px, page 800 px, transport on
  screen.
- 40- and 150-node chains in Stepped: SVG in a 568 px stage (512 + 56 gutter)
  on a 985 px page. The camera shows each step at natural size.
- Raw is unchanged: 40 nodes stays at 4,286 px natural height.
- Stepped after Raw has measured does no SVG layout at all. Stepped straight
  away lays it out once (shared render cache) and never mounts it.

Validation:
- Unit: tests/diagram-render-decision.test.ts, 7 tests.
  - Both sides of the 600-edge threshold (499/500/599/600/1,000).
  - Measured verdicts by kind, and the source scan still winning.
  - Per-source memory, an edited source not inheriting it, and the LRU bound.
  - playbackBoxStyle against stageBoxStyle.
  - Camera: a tall chain follows only with a view; frames have the stage
    aspect at natural width and stay inside home, with the active node in
    frame. Fitted framing is unchanged.
  - npm test: 281/281.
- Browser: tests/e2e/diagram-modes.spec.ts, 6 tests, production preview. An
  init-script MutationObserver records the tallest Stepped stage ever
  attached, so a tall SVG mounted briefly still fails.
  - 499/500/600 edges: canvas in Raw → Stepped → Raw, Flow disabled, frame ≤
    viewport, page < 2 viewports, transport in view, "/N" caption.
  - Stepped clicked before Raw's measurement arrives.
  - A 40-node chain: bounded Stepped stage, camera viewBox at the stage
    width, legible labels, and Raw still at natural height.
  - A fitted diagram keeps its aspect-ratio stage.
  - Against a HEAD build: 4 of 6 fail (499, 500, straight-to-Stepped, the
    40-node chain). The 600-edge and fitted cases pass on both, as controls.
- Full production suite on HEAD + this change (private port): 87 passed,
  1 skipped, 4 failed. The 4 are mobile-navigation drawer close, both
  sharing previews and viewers spreadsheet controls. They fail the same way
  on a clean HEAD build.
- npm run typecheck and npm run build pass. ESLint and Prettier are clean on
  every changed file. explainer.css's one Prettier warning is already on
  HEAD.
- Chrome DevTools MCP, isolated contexts on the production preview,
  1280×800:
  - 500-edge chain: Raw → Stepped both canvas, frame 354 px, page 800 px,
    transport in view.
  - 60-node chain: Stepped SVG, 568 px stage, the camera following step by
    step. Zoom out, then "Follow the explanation", handed control back.
  - Full screen kept playing with the transport visible.
  - No console errors or warnings.

Environment: another session had uncommitted search/Markdown work and
started R03's PDF outline work during this one. All building and testing ran
in a detached worktree of HEAD plus only these files. This commit contains
only the diagram files, their tests and this log.

Limits:
- A 499–599-edge diagram still costs one main-thread Mermaid layout (about
  3 s here) before the measured gate can move it. R02's pre-layout
  complexity limit is still open. The render cache and the verdict memory
  keep it to one layout per source per session.
- Flow is only disabled once Raw or Stepped has measured. A reader who picks
  Flow in the seconds before Raw's first render finishes still gets the
  animator. It clamps its stage to a screenful, so the page stays bounded.
- The camera view is measured when playback starts. Entering full screen
  keeps those proportions: close-ups are about 1.5× natural size and have
  extra side context, but aren't letterboxed away.
- The zoom percentage for a tall Stepped diagram is relative to the whole
  chain, so a natural-size close-up reads around 1,000%.
- R01 (per-frame React updates and offscreen playback), R02, A05 and R04
  remain in Package 5. Chromium desktop only; no real phone, Safari or
  Firefox check.

Previous update — 2026-09-28 (A08 PDF zoom pixel budget)

Completed A08 / Package 5's PDF memory item. Zooming a PDF no longer grows
its canvases without limit. Each visible page stays within 32 MiB of backing
pixels on desktop (16 MiB on a phone), and all visible pages together within
64 MiB (32 MiB on a phone). The part of the page in view stays at full device
resolution.

Before (HEAD fa5ca35, production build, DPR 2, 1280×800, 3-page fixture, 400%):
- One page: a single 3611×4672 canvas, 64.4 MiB. (The audit's own fixture and
  window measured 4435×6272, 106.1 MiB.)
- Two-page spread: 124.5 MiB still held. One replaced canvas, detached from
  the page, still held its pixels.
- Zoomed pages were centred with justify/align-center in the scroll area.
  The page's top 828 px and left 407 px (spread: left 1,266 px) were outside
  the scrollable range, so no scrolling could reach them.
- Page proxies and text content were cached for the document's lifetime, and
  a rejected page/text promise stayed cached.
- Results were identical over 3 runs.

Fix:
- src/services/pdf-viewer/pdf-raster-budget.ts: pure budget math.
  - Per-page and total budgets, and a live count of visible pages across
    every open reader.
  - A page that fits is one canvas at device resolution, as before.
  - Otherwise the full-page base canvas gets half the budget: a softer page,
    still readable while scrolling. The rest goes to a detail canvas that
    covers the visible region at device resolution. It adds margin around the
    view when the budget allows (the same approach as pdf.js's own
    maxCanvasPixels plus PDFPageDetailView).
  - Canvas sides are capped at 16,384 px.
- PdfPageCanvas.tsx:
  - Every raster goes into a fresh canvas, swapped in when complete. Until
    then the previous pixels stretch to the new size (the zoom preview), so
    the page never goes blank.
  - A re-raster waits 150 ms after the last zoom step, so rapid steps cost
    one render.
  - The detail canvas follows scroll and resize (100 ms settle) and is
    re-rendered only when the view nears its edge.
  - Replaced and unmounted canvases are released (width/height 0).
  - Rotation re-renders immediately, with no stretched preview of the wrong
    orientation.
  - A budget change that doesn't change the plan (a page joining the screen)
    doesn't re-render.
- PdfReader.tsx: page-proxy and text caches are bounded LRUs
  (bounded-promise-cache.ts).
  - Pages: 12 entries. An evicted page gets page.cleanup(), which frees its
    operator list and decoded resources.
  - Text: 200,000 text items / 2,000 pages.
  - A rejection evicts only its own entry, so the next call retries.
- PdfPageArea.tsx:
  - Pages are centred with auto margins, so every edge of a zoomed page is
    reachable.
  - Zoom keeps the same point of the page in the middle of the view. The
    anchor is a fraction of the page box. It is snapshotted when scale
    changes and restored by a ResizeObserver, and it ignores the browser's
    own clamp scroll.
- PdfThumbnailList.tsx releases thumbnail canvases on unmount.

After (same measurement script and build settings, 3 runs, identical):
- One page at 400%: 1800×2329 base (1.02 device px per CSS px) plus a
  2474×1696 detail canvas at exactly 2.0, 32.0 MiB in total.
- Spread at 400%: 56.9 MiB for both pages.
- No detached canvas holds pixels.
- 0 px of the page is out of reach.

Validation:
- Unit: tests/pdf-raster-budget.test.ts, 13 tests.
  - Budgets, including 1/2/4 pages sharing the total.
  - The audit's 2217.5×3136 CSS page at DPR 2 fits 32 MiB with DPR-2
    detail pixels.
  - A phone at DPR 3.
  - fitCanvas pixel/side limits, detail margin and clamping, and
    detailCovers hysteresis.
  - Registry notifications.
  - LRU eviction with onEvict, rejected-promise eviction, a late rejection
    not evicting its replacement, and weight bounds.
  - npm test: 274/274, on a clean worktree of HEAD plus only this change.
- Browser: tests/e2e/pdf-zoom-budget.spec.ts, 7 tests, production preview,
  DPR 2. Every canvas ever attached is tracked, so released canvases are
  checked, not only those in the DOM.
  - 400%: ≤32 MiB, base below DPR 2 and detail at DPR 2, text layer intact,
    all four edges reachable, detail follows the scroll, nothing retained.
  - Zoom keeps the centre, including zooming out from a lower-right view.
  - Three rapid zoom steps: the stretched preview is shown (never zero
    canvases), then exactly one base render.
  - A spread (≤32 MiB each, ≤64 MiB together).
  - Two readers in a split with spreads (4 pages, ≤16 MiB each).
  - Rotation at 400%.
  - Leaving the PDF releases every page canvas (0 bytes retained).
  - With --repeat-each=3, the new spec and pdf-keyboard.spec.ts passed 38 of
    39. The one failure was a beforeEach timeout while the machine's load
    average was about 11: the upload toast appeared, but the viewer never
    opened, so no PDF code ran. That test then passed 5/5 on a rerun.
  - Against a HEAD build every new test fails. They fail waiting for the new
    render state, so the before numbers above come from a markup-agnostic
    measurement script (in the session scratchpad, not committed).
- Chrome DevTools MCP (production preview, 1280×800 at DPR 2, real toolbar
  zoom):
  - Base 1800×2329 plus detail 2474×1696 at exactly 2.0 device px per CSS
    px, 32.00 MiB.
  - After scrolling to the top-left (reachable), the screenshot shows
    retina-sharp text at 400%.
  - PDF search on the zoomed page: 31 hits, the active one scrolled into
    view, the detail re-rendered there, 28.6 MiB.
  - No console errors or warnings.
- npm run typecheck, npm run build, and ESLint/Prettier on every changed
  file pass on the clean worktree.
- Full browser suite (clean worktree, production preview, private port): 72
  passed, 9 skipped, 5 failed. None of the failures are PDF tests. Rerun with
  PLAYWRIGHT_PRODUCTION=1, the master-key race test skips itself (it imports
  a dev-server module). The other 4 fail identically on a plain HEAD build:
  - mobile-navigation "close button and backdrop dismiss the drawer"
  - both sharing.spec preview tests
  - viewers.spec spreadsheet controls
  They are pre-existing failures, not caused by this change.

Environment:
- Another session was editing search files (DocsApp, SearchPanel, lib/search)
  and package.json/bun.lock in the shared tree during this work. Its
  reinstall removed @orama/orama from the shared node_modules.
- All validation therefore ran in a detached worktree of HEAD plus only these
  files, with its own node_modules, on private ports and output directories.
- This commit contains only the PDF files, their tests and this log.

Limits:
- While a raster or detail render is in flight, the old and new canvases
  briefly coexist (up to about 2× one page's budget). Steady state is within
  budget.
- At high zoom on DPR ≥2, scrolling past the detail area shows the softer
  base pixels for about 100 ms before the detail catches up.
- The device class is coarse pointer plus a short screen side under 768 px.
  There is no real-device memory measurement, and no Safari, Firefox or
  physical phone run.
- Native/GPU intermediate surfaces are not measured; this counts canvas
  backing stores (width × height × 4), as the audit did.
- Turning a page at high zoom keeps the view centred rather than jumping to
  the new page's top.
- R03's outline work, A04, A05, R01–R02 and R04 remain in Package 5.

Previous update — 2026-09-28 (A07 search worker protocol and lifecycle)

Completed A07, and with it Package 4 (A06 was done earlier). Search requests
now settle on every path. Mutations apply in order, and a replaced worker
starts with clean bookkeeping.

Before (measured on HEAD):
- DocumentIndex ran operations concurrently (the worker started a handler per
  message), and a sync yields between 15-file batches. Probe, 40 files:
  - Two back-to-back syncs: the newer one threw DOCUMENT_ALREADY_EXISTS, and
    the index kept the older draft.
  - A drop racing a sync left 40 orphaned rows. The cache no longer knew
    them, and their ids are deterministic, so a later re-sync would collide.
  - A search issued mid-sync saw 15 of 40 files.
- Closing search terminated the worker but kept syncedIds, so reopening it
  with "Search all workspaces" skipped the other workspaces: no results.
- A worker "error" reply left the panel on "Searching…" forever.
- Turning all-workspaces off while another workspace was indexing left
  "Indexing 1 other workspace…" on screen permanently.
- Initial indexing showed "No results", the same as a finished empty search.
- A terminated worker left per-request listeners and promises pending.

Fix:
- DocumentIndex (src/lib/search/document-index.ts) runs sync/drop/search
  one at a time, in call order. It keeps an index generation that advances
  only when rows change; sync and drop resolve with it.
- src/lib/search/protocol.ts: request/response types and
  handleSearchRequest. Every request gets exactly one reply: ack
  (with generation), hits, or a terminal error carrying the message. The
  worker file only wires it up.
- src/lib/search/search-client.ts: one client per backend (worker or
  main-thread fallback), used by both.
  - A single message listener; pending requests are keyed by reqId.
  - An error reply rejects only that request.
  - A worker error or messageerror terminates the worker, rejects every
    pending request and reports the failure once (the hook then switches to
    the fallback).
  - close() rejects in-flight work, and a closed fallback never delivers a
    stale result.
- use-search-index.ts: each backend is a session with its own indexed-set,
  so reopening or falling back re-indexes everything.
  - The query reruns when an acknowledged generation advances (not on
    no-op syncs).
  - Other-workspace loads are ref-counted and never abandoned mid-claim.
  - A load checks, after reading storage, whether it is still wanted. It
    skips a workspace that became current, whose live files are newer.
  - The "Indexing N other workspaces" indicator only counts workspaces
    still requested.
- SearchPanel shows "Indexing documents…" (status) instead of "No results"
  until the current workspace is indexed. A failed search, or indexing that
  failed, shows a persistent alert with "Try again".

Validation:
- Unit: 4 new DocumentIndex tests (overlapping syncs, a drop mid-sync then
  re-sync, a search mid-sync, generation and recovery after a failed op);
  all 4 fail against HEAD's document-index.ts. 8 new tests in
  tests/search-client.test.ts, on a fake worker that answers like the real
  one:
  - out-of-order replies, one listener
  - an error reply rejecting only its own request
  - worker error and messageerror: all pending settle, failure reported
    once, listeners removed, late replies ignored
  - close
  - a postMessage clone failure
  - a burst of edits, a drop and a search through a real index
  - the main-thread client
  npm test: 261/261.
- Browser (tests/e2e/search.spec.ts, production preview): 4 new tests, plus
  the held-initial-sync test now asserting "Indexing documents…". Against a
  HEAD build, 4 fail at their intended assertions:
  - "Indexing documents…" is absent
  - alpha.md is missing from the other workspace after reopening
  - the indicator is still shown after turning all-workspaces off
  - no alert appears after an error reply (HEAD stays on "Searching…")
  The fifth, a worker crashed mid-search (uncaught error inside the real
  worker) falling back and still answering, also passes on HEAD. HEAD
  already fell back on a worker error event, so this is coverage, not a
  regression proof. The spec passes 7/7 on the fixed build, and 21/21 with
  --repeat-each=3.
  - The tests control the real worker through a Worker subclass: they hold
    replies (not requests, so the worker still sees the app's order),
    inject the protocol's error reply, or hold searches.
  - Harness fixes during development: the new "Archive" workspace is
    imported through Settings. The helper waits for it in IndexedDB
    before navigating, and the test then switches to it whichever
    workspace reopens. The crash test enters edit mode before search takes
    over the sidebar.
- npm run typecheck, npm run build, focused ESLint and Prettier on every
  changed file pass.
- Full production Playwright suite (fixed build): 75 passed, 1 skipped
  (dev-only), 3 failed.
  - mobile-navigation "close button and backdrop" and viewers "spreadsheet
    controls…" are the known failures recorded above.
  - The third, offline "a fresh install imports…" (the save indicator
    stayed "Changes pending" after an offline import), is pre-existing
    flakiness. The test never opens search, so this hook creates no worker.
    Repeating offline.spec.ts ×4 with nothing else on the port gave 2/28
    failures on the fixed build and 3/28 on a HEAD build. The same two
    tests failed at the same lines on both: that one, and the deep-link
    Storage tab click at line 167. That flakiness is worth its own fix.
  - Another Claude session ran the suite on the same port from about 14:16
    to 14:25. My full run ended at 14:15:57, before it; the offline repeats
    that overlapped were discarded and rerun afterwards.
- Chrome DevTools MCP, in an isolated context against the production
  preview:
  - With alpha.md in "My workspace" and Archive current, "Search all
    workspaces" found alpha.md. After closing and reopening search, it was
    found again (the HEAD failure).
  - With a search error reply injected through an init script, the
    assertive "Search couldn’t run." alert appeared with Try again. Once
    the injection was off, Try again returned the result and cleared the
    alert.
  - The only console message was the warning for the injected failure.

Environment: the HEAD comparison was built in a detached git worktree with
node_modules symlinked. Building both trees at once shared Nitro/Vite caches
under node_modules, and the HEAD server manifest pointed at the other build's
asset hashes (every page 404'd its chunks). Sequential builds fixed it. While
this work was in progress, something outside this session removed the
"Historical working-tree note" paragraph at the end of this file. That
removal was kept as found.

Limits:
- A worker that stops silently (self.close(), or a kill with no error event)
  is not detected. There is no request watchdog, because a large first sync
  has no bound.
- Other workspaces are indexed from storage once per session. Edits made to
  them in another tab appear after search is closed and reopened.
- An "index" alert stays until Try again, even if a later automatic re-sync
  succeeds.
- No search latency budget on the 1,000-document corpus and no non-English
  text case: the PLAN gate's timing half is not measured here.
- Chromium desktop only.

Previous update — 2026-09-28 (A11 offline shell and offline readiness)

Completed A11's offline half, and with it Package 3's offline criterion. On a
production build, a populated workspace reopens with no network and the HTTP
cache disabled. At the audit baseline this reload failed with
ERR_INTERNET_DISCONNECTED and no service worker.
- Build: build/vite-offline-shell.ts (client build only) emits /sw.js. The
  worker logic is in build/offline-sw.js; build/offline-manifest.ts prepends a
  manifest of every file the app can request (795 files, 32.4 MB).
  - The shell is precached at install: 32 files, about 1.4 MB. It covers the
    client entry and every route chunk plus their static imports and CSS, and
    workers they reference by URL (search, conversion). It also covers the
    lazy core modules named in vite.config.ts (DocumentViewer, SettingsPage,
    SavedPage), and the build fails if one of those matches no chunk.
  - Dynamic imports (PDF, math, diagrams, conversion WASM, Babel…) stay
    optional.
  - The version hashes every file's bytes, the precached set and the worker
    code.
- Worker behaviour:
  - Navigations go network-first, so an online reload always gets the current
    deployment. With no network (or no answer within 5 s) the cached
    /_shell.html answers. The SSR preview and Firebase's rewrite both serve
    that file.
  - Build files are served cache-first and cached on first use. Files already
    loaded before the worker took control are cached too.
  - Hashed names are their own cache key; other files carry a content tag.
  - Documents never pass through it (they are in IndexedDB). Other origins
    (AI providers, the share service), non-GET and Range requests are left
    alone.
- Updates: the worker never calls skipWaiting. A new version installs and
  waits while any tab is open; a reload keeps the old one. It activates once
  every tab has closed, then deletes the old shell cache and prunes assets
  that are no longer part of the build.
- Settings → Storage → "Offline access" reads the worker's actual caches. It
  shows checking / preparing / ready / incomplete / failed with retry /
  unsupported / off in dev, and how much is stored. "Download all features
  (N MB)" fetches the rest in the worker, with a progress bar. The polite
  status region announces the start and the outcome, not every byte count.
  It reports partial and storage-full failures. Opening another panel joins a
  running download.
- Dev builds register nothing and unregister a stale /sw.js left by a
  production preview on the same host and port.
- firebase.json serves /sw.js with no-cache.

Validation:
- Before/after, the audit's reproduction (populated workspace, offline
  emulation, Network.setCacheDisabled, normal reload): HEAD had 0 service
  workers and the reload failed with net::ERR_INTERNET_DISCONNECTED. After the
  change there is 1 worker and the document is visible 816 ms after an
  offline reload.
- tests/e2e/offline.spec.ts adds 7 production tests; all 7 fail against a HEAD
  build. Offline means offline emulation, the HTTP cache disabled, and every
  request that still reaches the network aborted, including the worker's own
  fetches (asserted with an uncached file).
  1. Reopen, edit and save offline, then reload offline and online.
  2. An offline deep link to /settings without Settings ever opened online;
     the navigation is served by the worker.
  3. A fresh install imports and reads Markdown and JSON offline, having never
     opened a document online.
  4. Download all features: the progress bar, the status not announcing
     bytes, every manifest file cached, then a PDF opens offline.
  5. A new version waits while a tab is open, survives that tab's reload, and
     takes over after close, with the old shell cache deleted and offline
     reload working. Playwright can't intercept the browser's worker-script
     fetch, so this test serves .output/public from its own static host with
     Firebase-style rewrites.
  6. A failed first install is reported and can be retried.
  7. Browsers without service workers get an honest unavailable state.
- tests/offline-manifest.test.ts adds 8 unit tests for the shell planner:
  routes and core modules, dynamic imports staying optional, whole-path
  matching, missing-core detection, keys and tags, and versioning. One test
  caught that the version first ignored the precached set; that is fixed.
- npm run typecheck, npm test (249/249), npm run build, focused ESLint on every
  changed file, Prettier and git diff --check pass.
- Full production Playwright suite: 72 passed, 1 skipped (dev-only), 2
  failed. The 2 failures (mobile-navigation "close button and backdrop",
  viewers "spreadsheet controls…") fail identically on a HEAD build without
  this change, and match earlier notes here.
  tests/e2e/conversion.spec.ts's WASM hold moved from page.route to
  context.route so it still applies when the worker handles that fetch.
- Chrome DevTools MCP, in an isolated context against the production preview,
  independently confirmed: the worker activated and controlling; offline
  navigation to / and /settings served by it; the note and the "Ready
  offline" status rendered; the download going from progress to "Every
  feature is available offline (32.37 MB stored)", with 763 asset entries
  cached; and no console warnings or errors. It also caught the
  announce-every-tick live-region problem, which was fixed and put under
  test.

Environment: node_modules lacked @orama/orama and @firecrawl/anydoc-wasm, and
bun.lock did not list @orama/orama or github-slugger although package.json
does. `bun install` with bun 1.4 added only those two entries (4 lines). This is
committed separately, because the local bun 1.3 downgraded the lockfile format
and re-resolved every package. Playwright's Chromium was installed. The
bench/audit harness scripts are not in this checkout, so the before/after used
an equivalent probe.

Limits:
- A hard reload (Shift+Reload / "ignore cache") bypasses service workers by
  browser design, so it still fails offline.
- Interactive React blocks run in a sandboxed opaque-origin iframe, which no
  service worker controls, so they need a network.
- Optional features open offline only after first use online or the explicit
  download.
- Workers are not guaranteed to outlive a very long download on a slow link.
  The page then reports that the download stopped, and a retry skips files
  already stored.
- The worker's caches count toward origin storage (the Settings usage figure),
  a D03 accounting question left open.
- B04 is unchanged: an offline tab that needs an uncached chunk still hits the
  reload-once handler.
- Chromium desktop only; no Safari/Firefox, physical-device or screen-reader
  test. Firebase hosting itself was not deployed; the static-host test mimics
  its rewrite.

Previous update — 2026-09-28 (B01 lazy HTML-export renderer)

Completed B01 / Package 6. vite.config.ts's manualChunks put react-dom/server
into the long-lived "react" chunk, so every startup downloaded the renderer
that only lazy HTML export (src/services/markdown-export/media-bundle.tsx)
uses. react-dom/server entries and their CJS server builds now go to a separate
"react-dom-server" chunk that loads only behind that dynamic import. The
startup react chunk dropped from 378 KB raw / 115 KB gzip to 190 KB / 59.8 KB
(about 56 KB less gzipped JavaScript on every load); the renderer chunk is
187 KB / 57 KB and is fetched on first export.

Validation: the new tests/e2e/export-loading.spec.ts (production preview only)
inspects every downloaded script for renderToStaticMarkup rather than chunk
names, so renaming or re-merging the chunk can't hide a regression. It covers
empty startup, opening a document, two HTML exports (content checked, renderer
fetched once), editing after export, save state and reload (renderer not
fetched again), and no page errors. Both tests fail against the pre-change
vite.config.ts build (the renderer is in the startup scripts) and pass after
it. npm run typecheck, npm test (241/241) and npm run build pass. Production
Playwright passes 7/7 across export-loading and media, and 37/37 across
editing, persistence, storage-persistence, sharing, pdf-keyboard and
durability. The media suite's attachment-export test (the timeout noted
earlier) targeted a button named "Export this document"; its accessible name is
"Export", and the locator now matches. Chrome DevTools MCP, in an isolated
context against the production preview, confirmed startup scripts include the
190 KB react chunk and no react-dom-server; clicking "Download HTML + Media"
then fetched react-dom-server once; no console errors or warnings.

Limits: this completes B01 only. B02 (splitting the empty-workspace shell from
reader/editor and the Orama fallback) and B03 (per-journey optional bundles)
remain pending. Chromium desktop only; the full browser suite (viewers,
conversion, search, highlighting, mobile, ai-keys) was not rerun. The
uncommitted .gitignore change that un-ignores /docs, and the untracked
docs/PROMPT.md, docs/audit-2026-09-27/ and docs/performance/, were left out of
this commit.

Previous update — 2026-09-28 (R03 PDF keyboard isolation)

Completed the keyboard-input bug within R03 / Package 5. PDF navigation and
zoom no longer listen on window. Each PDF page area is a named, keyboard-
focusable region with shortcut instructions and a visible focus ring. Tab or
clicking its canvas/text activates that reader; only keys targeted at that
surface change pages or zoom. Nested controls, menus, other panes, browser
modifier shortcuts, Shift selection shortcuts, composing input and previously
handled events keep their own behavior. Pointer focus preserves native text
selection and ignores interactive descendants, including contenteditable.

Validation: the new toolbar regression failed against the pre-change production
build: ArrowRight on the focused Next page button changed page 1 to page 2.
Final npm run typecheck, npm test (241/241), npm run build, focused ESLint,
Prettier and git diff --check pass. Six new production-preview Playwright tests
pass in tests/e2e/pdf-keyboard.spec.ts: toolbar/menu/search isolation; Tab entry
and exit plus every page/zoom shortcut; real PDF text selection and pointer
focus; nested select/contenteditable/button/link/slider/input/textarea controls;
modifier/composition/default-prevented events; and two PDF panes whose page and
zoom state change independently. The 15 existing highlighting, search,
persistence and sharing browser tests also pass. Initial test locators were
corrected for the modal menu's accessibility isolation, PDF text split across
spans, the sidebar filename button and the split-view action's button role.
Browser inspection also caught and corrected the initial pointer filter's
handling of PDF.js role=presentation text spans.

Chrome DevTools MCP independently confirmed the named region and visible focus
ring, text-click focus, navigation inside the reader, no navigation from a
focused toolbar control, and no console warnings/errors. It used an isolated
browser context and a repository PDF fixture (passed through the browser File
input because the MCP upload tool's configured roots rejected the local path).
Build, preview and Playwright needed sandbox escalation for local servers and
Chromium. Original audit evidence was preserved; the tree was clean initially.

Limits: this completes only R03's shortcut bug. Lazy outline destination
resolution and bounded outline rendering remain pending, as do A08's PDF pixel
and cache budgets. Chromium desktop only; no Safari/Firefox, physical-device,
screen-reader or performance-release-gate claim. The full browser suite was
not rerun.

Previous update — 2026-09-28 (A11 persistent-storage enhancement)

Completed the persistent-storage request and capability-state enhancement from
A11. Settings → Storage now reads navigator.storage.persisted() each time the
panel opens. "Protect local data" invokes persist() directly from a user click;
opening settings never requests permission. The UI waits for the result and
shows the browser's actual grant, denial, unsupported API or failure. Requests
disable the button until settled; status-check and request failures can be
retried. An accessible status region announces changes. A backup reminder points
to Settings → Workspace → Export and remains visible after a grant, explaining
that clearing site data or losing the device can still lose the data. No local
preference is used as proof of protection.

Validation: the new request/reload browser regression fails on the pre-change
production build because the protection status is absent. After the change,
npm run typecheck, npm test (241/241), npm run build, focused ESLint on all
changed source/test files, and git diff --check pass. Production-preview
Playwright passes 25/25 across storage-persistence, durability, persistence and
sharing. The 11 new browser cases cover explicit user activation, a delayed
grant and disabled button, reload and existing grants, denial and retry,
rejected requests, failed status checks, missing storage/persisted/persist APIs,
leaving the panel during a request, keyboard activation and wrapping at 320px,
and agreement with the real unstubbed browser API. Grant/failure edge cases use
API stubs; the native Chromium request was denied, correctly shown as denied.

Chrome DevTools MCP independently confirmed the native denial, a simulated
grant, the accessible status and persistent backup copy, and no console warnings
or errors. Its default profile was busy, so the installed server ran with an
isolated temporary profile. The inspected MCP screenshot was 500px wide (Chrome
clamped the requested window width); the 320px assertion ran in Playwright.
Build, preview and browser processes needed sandbox escalation. Original audit
evidence was not overwritten, and the tree was clean before this enhancement.

Limits: A11 remains open for the offline shell, cached capabilities and
offline-readiness state. This change does not make offline reload work or meet
Package 3's offline acceptance criterion. Grant policy belongs to the browser;
no automatic-eviction simulation, Safari/Firefox, physical-device or screen
reader test was performed. Unrelated audit findings remain pending.

Previous update — 2026-09-28 (A10)

Completed A10: saving is now a visible, durable part of the UI.
- Save state is rendered (it was set but never shown): "Changes pending",
  "Saving…", "Saved on this device", "Not saved". It appears in the docked
  sidebar, the mobile header and the collapsed rail. A mutation now reads
  as pending until its write actually starts. An editor that has not yet
  handed its draft to the app also counts as pending.
- A failed write no longer shows a toast and then drops back to idle. A
  persistent alert (SaveErrorBanner) gives Retry save and Export backup.
  It stays through further edits until a write commits. Quota errors get
  their own message. While a save error or conflict is active, closing
  the tab asks for confirmation.
- Recoverable drafts: a new draft journal (src/lib/workspace/draft-journal.ts)
  records every Markdown editor draft to localStorage. It writes
  synchronously, 250 ms after a change and again on pagehide,
  visibilitychange and beforeunload. An entry is removed only when a
  committed workspace record holds exactly its text; otherwise it is
  re-based on what storage now holds. On the next load, drafts from tabs
  that are gone are offered via Restore or Discard. Web Locks decide which
  tabs are still open, so an open tab's draft is never offered elsewhere.
  Restore re-checks the saved document at click time. If the document
  changed since, or was binned or deleted, the draft opens as
  "name (recovered).md" instead of overwriting it. Cancel in the editor
  discards its draft.

Validation: 8 new unit tests (tests/draft-journal.test.ts) cover flushing and
reload, settling and re-basing, discarding, quota failure and retry, oversize
and missing storage, corrupt entries, the offer rules (dead, live and own
sessions, stale, binned and missing files, changed since) and hashing. There
are 6 new production-preview browser tests (tests/e2e/durability.spec.ts).
They cover the indicator's pending→saved cycle and three flows after a
renderer crash (CDP Page.crash, so no unload handler runs): restore, discard,
and restore as a copy after the document changed. They also cover a live
tab's draft not being offered to a second tab, Cancel clearing the journal,
and an injected QuotaExceededError on every file write: the alert persists
through edits and 3 s, Export downloads, Retry commits and clears it. All 6
fail on the pre-fix build. The crash test on HEAD confirmed the loss:
IndexedDB lacked the typed text.
npm run typecheck, npm test (241/241), npm run build and git diff --check
pass. Focused ESLint: no new errors or warnings (DocsApp still has its 12
existing hook warnings; persistence.ts keeps its 3 existing prettier errors).
Most of DocsApp's diff is re-indentation from the new provider wrapper; the
whitespace-insensitive diff is about 235 lines.
Production-preview Playwright: 33/35 across durability, persistence, editing,
media, sharing, search and mobile-navigation. The 2 failures reproduce
identically on clean HEAD: mobile-navigation "close button and backdrop"
(backdrop click at 380,400 does not dismiss on the second open) and media
"attachment picker…" (waits for an Export download that never fires).
Chrome DevTools MCP (production preview, isolated context) independently
confirmed the indicator in the docked sidebar, the journal entry after
typing, the quota alert and "Not saved" state, and Retry returning to
"Saved on this device" with the journal emptied. After reload the text was
present with no recovery offer. The only console error was the injected
QuotaExceededError.

Limits: only Markdown source-editor drafts are journalled. Office/CSV
editors, renames, stars and other mutations still rely on the 700 ms debounce
plus the best-effort pagehide write. Drafts over 1,000,000 characters are
not journalled, and localStorage quota failures silently skip the journal.
There is a crash window of up to 250 ms after the last keystroke. Browsers
without Web Locks offer every other tab's drafts; this is safe, because
restore never overwrites a changed document. The indicator is deliberately
not a live region; only the failure alert is announced. B04 (reload on
vite:preloadError) is not changed, though the journal now keeps editor
drafts across such a reload. A11 (offline shell, persistent storage request)
remains pending. Chromium only; no Safari/Firefox, real device or screen
reader testing.

Previous update — 2026-09-28 (A09)

Completed A09: mobile navigation now uses the existing Radix Sheet primitive
with an accessible name, contained focus, background isolation, scroll locking,
and focus restoration to the actual opener (Menu, Search, or a shortcut's
previous control). Close, backdrop, and Escape dismiss it; nested search and
sidebar menus consume Escape first. Menu panels and export flyouts owned by the
drawer now portal inside its focus boundary, so their actions remain usable.
The existing close button and safe-area spacing are retained. The viewport no
longer disables user zoom. The search shortcut now follows the sidebar's 1024px
breakpoint, fixing hidden search at tablet widths; moving to desktop closes the
modal and releases its focus/scroll locks without reopening it on shrink.

Validation: the pre-fix production build failed the new accessible-dialog and
zoom assertions. The initial browser test draft also exposed two harness
issues (hidden desktop search input selected alongside the mobile input, and
Ctrl used on macOS); those were corrected before final validation. A nested
menu regression caught and drove the portal/Escape integration fix.
Final npm run typecheck, npm test (233/233), npm run build, and git diff --check
passed. Focused ESLint has zero errors and 13 existing warnings (12 DocsApp
hook warnings, verified against HEAD, and one menu-primitives refresh warning).
Production-preview Playwright passed 24/24 across mobile-navigation, search,
sharing, persistence, and editing. Seven new mobile tests cover forward/reverse
Tab containment, programmatic background focus attempts, background accessibility
isolation, dismissal and restored focus, search result selection, tablet search,
desktop resize and reopening, 320px bounds, nested Escape handling, keyboard
rename, and focus in export flyouts. Tests emulate touch in Chromium.

Chrome DevTools MCP independently verified the named modal and accessibility
isolation, nested menu dismissal, focus returning to Menu, released pointer/
scroll locks, and the unrestricted viewport meta tag. No console warnings or
errors appeared in that final navigation. The configured MCP profile was busy,
so verification used the already installed MCP server with an isolated temporary
profile. Build/browser commands needed sandbox escalation for localhost servers.
No baseline audit evidence was overwritten; the working tree was clean initially.

Limits: no physical-device pinch gesture, Safari/Firefox, screen reader, or full
WCAG audit was performed. The 320px check covers navigation bounds, not all
viewers' reflow. The full browser suite and audit performance harnesses were not
rerun. Package 7's broader UX work remains pending, and A10 still blocks the
reliability release. This change does not claim any performance release gate.

Earlier update — 2026-09-28 (A06)

Completed A06: search now notices filename-only changes. DocumentIndex caches
the filename along with content and replaces both filename and content rows
on rename. Searches for the old name stop matching; searches for the new name
match, and content results show the new name. The search hook also refreshes
the current query after a successful current/other-workspace sync, covering
the unchanged-query refresh portion of A07. Cancelled sync effects do not
publish a refresh, and error replies are not treated as successful indexing.

Validation: the two new unit regressions and all three new browser regressions
failed on the pre-fix code at the expected stale-name/unchanged-query checks.
After the fix, npm run typecheck, npm test (233/233), npm run build, and focused
ESLint on all four changed source/test files passed. Production-preview
Playwright passed 16/16 tests across search.spec.ts, highlighting.spec.ts,
persistence.spec.ts, and editing.spec.ts. Search coverage includes worker and
main-thread fallback, rename with unchanged content/query, old/new filename
queries, edits removing/restoring a match, a second tab moving the file to Bin,
and initial indexing deliberately held until after the first search finishes.
Unit coverage also checks every row's label, workspace isolation, repeated
sync without duplicate rows, empty documents, repeated renames and deletion.
Chrome DevTools MCP independently verified rename/edit refresh and new-name
search in the production UI; no console warnings or errors were reported.

Environment: the initial dev server hit EMFILE, so browser checks used the
production preview. The build needed sandbox escalation for its local
prerender server and then passed. No audit measurement files were overwritten.
The tree was clean at the start; this commit contains only this search fix,
its regression tests and this log (previously ignored by /docs).

Limits: A07 remains open for serialized mutations, worker replacement and
cross-workspace reopen bookkeeping, terminal error/termination handling, and
generation ownership. This local refresh counter is not the full revisioned
worker protocol. No search latency/performance budget or non-Chromium browser
coverage is claimed, and the full browser suite was not rerun in this update.

Earlier completed fixes

Five earlier audit commits are done and tested; the rest of the audit is still pending.

Done and tested

Commit: 7075ab0
Findings: Table resize/wrap controls removed (this was already in your tree;
committed separately and not written by me)
How it was tested: Typecheck; its e2e table test passes
────────────────────────────────────────
Commit: afede02
Findings: A02 and D05: backups now keep stars, notes, Bin state, folders, panes
and conversion links, and bad files are rejected before anything is written
How it was tested: 8 new unit tests, including export → wipe the database →
import → reload giving an identical workspace. Also covers old v1 backups,
duplicate ids, folder loops, over-deep folders, oversized files and a 150 MiB
compressed share link. Typecheck and build pass
────────────────────────────────────────
Commit: 7e14de0
Findings: A01 and D04: saves from one tab can no longer overwrite another tab.
Edits to different things merge on their own; the same document changed in
both tabs shows a "Keep both" banner. Moves between workspaces happen in one
step, or not at all
How it was tested: 4 two-tab unit tests (stale save, delete while saving,
cross-tab notices, a move that fails halfway), 8 merge tests and 3 new two-tab
 browser tests. Unit suite 221/221, browser suite 22/22 (19 existing plus 3
new), typecheck and build pass

────────────────────────────────────────
Commit: 3b3188b
Findings: D06: AI key writes now resolve only after the IndexedDB transaction
commits (before, an aborted write still reported "saved"). The master key is
checked and installed in one readwrite transaction, so tabs racing on first use
all adopt a single stored key instead of each sealing secrets with its own.
Failed DB/key promises are reset rather than cached for the session. The
connection closes on versionchange (no longer blocks deletes or upgrades) and
forgets the cached master key so later secrets aren't sealed with a key that no
longer exists. keys.ts caches a key only after it is persisted; the settings
row shows a lasting error ("Couldn't save the key on this device") instead of
getting stuck on "checking" or showing a false check mark. The header comment
now says encryption at rest is not an XSS boundary.
How it was tested: 6 new unit tests (tests/ai-keys.test.ts): 2- and 6-tab
first-use race, injected abort after put success, failed open then recovery,
another tab deleting the DB, and keys.ts cache poisoning. All 6 fail or hang
against the old code. 3 new browser tests (tests/e2e/ai-keys.spec.ts): save
survives reload, forced commit abort shows the alert with no saved state (fails
on old code), and a real-Chromium two-tab race. Unit suite 227/227, typecheck,
lint and build pass. On a clean copy (HEAD plus D06 only), the production-preview
browser suite passes (22 passed and the dev-only race test skipped; the 4
conversion tests failed on the cold-WASM first run and passed on a rerun). On the
shared tree, 26/28 pass: the attachment-picker export and the viewers.spec
spreadsheet export time out on Export controls, which come from the other
session's uncommitted ExportMenu/viewer edits, not D06.
Limits: in real Chromium the old code happened not to interleave in the race
test, so the race is proven deterministically only in the fake-indexeddb test.
Keys already orphaned by the old race can't be recovered and read as "no key".

────────────────────────────────────────
Commit: bd2b1f6
Findings: A03: sharing no longer uploads straight from a menu click. Workspace
Share (Settings) and file Share link (sidebar) both open a preview dialog that
names the destination (bytebin.lucko.me, a third-party public paste service),
says the upload isn't end-to-end encrypted, that anyone with the link can read
it, and that there is no expiry/revoke control from Localdox. It lists every
file with its size; files in the Bin are listed but unticked, and stars, notes
and highlights are left out unless the sender ticks them. The uploaded payload
is built from that exact selection (buildWorkspaceShare in share.ts): only the
chosen files, only the folders on their path (empty folder names don't travel),
no Bin state, no recent-files history, panes, scroll or expanded state, and a
fresh workspace id. "Download instead" saves the same selection as an
importable .json and uploads nothing; backup Export stays separate and full.
The link stays visible in the dialog with a Copy button (clipboard failure is
reported rather than toasted as success), a failed upload shows an inline
"Nothing was shared" alert, and links now point at the app root instead of the
sender's current page (/settings#share=… before). Also fixed: an incoming
#share= link was imported twice when the restore effect ran twice (dev
StrictMode/remount) because the hash was cleared only after the async import;
imports are now shared per key.
How it was tested: 4 new unit tests in tests/backup.test.ts (default share
drops Bin/annotations/history/layout and keeps the source untouched; folders
only on shared paths and dangling derivation links cut; opt-in annotations only
for shared files and ticked binned files arrive live; share → import round
trip, and the file-link payload from the same selection). 5 new browser tests
(tests/e2e/sharing.spec.ts, bytebin intercepted with page.route so nothing is
uploaded): one import per incoming link (fails on the old code: two
"Research (Shared)" workspaces), preview + captured upload body contains no
Bin text, notes, highlight labels or unused folder names, opt-ins, cancel and
download upload nothing, failed upload stays visible, and single-file share
from the sidebar. Also checked by hand in Chrome via DevTools MCP with a
stubbed fetch. Unit suite 231/231, typecheck and build pass; no new lint
errors (DocsApp went from 2 errors to 0; share.ts's one `any` error is an
existing line). Dev browser suite: 31/33; the 2 failures (media attachment
picker export, viewers spreadsheet export) fail identically on clean HEAD
without this change.
Limits: the receiving side of a whole-workspace #share= link still imports on
load without a preview (the file link already asks). bytebin's retention isn't
documented to us, so the copy says Localdox can't delete it rather than
promising an expiry. Links made before this change still carry whatever they
carried. The duplicate import was reproduced in dev; a production build
doesn't double-run effects, so it may only have hit remounts there.

I ran every check on a clean copy containing only my changes, because of the other session editing the same files.

Limits: everything ran on Chromium on this machine. I haven't tested Safari, Firefox, real phones or a screen reader, and haven't re-run the audit's measurement scripts. A01 also has a gap. Typing the editor is still holding (its 600 ms private buffer) isn't saved or merged until it reaches the app, so if the tab closes before that it can still be lost. A10 covers this (addressed by the draft journal in the 2026-09-28 A10 update).

Pending (not started, or started but not committed)

- Package 3 is now complete: A03 and A10 (above), A11's persistent-storage request and backup reminder, and A11's offline shell, cached/downloadable capabilities and offline-readiness state (latest update).
- Package 4 is now complete: A06 (2026-09-28 update above) and A07 (latest update). Its latency budget on a 1,000-document corpus is not yet measured.
- Package 5: R03's PDF keyboard isolation is done (R03 update above), A08's PDF zoom pixel budget is done (A08 update above), A04's diagram mode parity and bounded Stepped stage is done (A04 update above), and R03's lazy outline resolution and bounded Contents tree is done (latest update), so R03 is complete. R04's spreadsheet viewer work (worker parsing/filtering/sorting, lazy sheets, visible-column rendering) is done (latest update); its bounded mass-import queue in DocsApp.tsx remains. A05 (3,000-section Markdown) and R01–R02 remain pending.
- Package 6: B01 is done (latest update above); B02–B03 (startup loading), D01–D03 (loading whole workspaces, binary storage, the storage cap).
- Package 7: A09 is done (A09 update above); broader UX items remain pending.
- Package 2 is now complete (A01, D04, D06).
- Package 8: R06 is done (latest update). A12 (Gemini models, not yet checked against Google's current list), B04, B05, R05 and the lint debt (76 errors) remain.

None of PLAN.md's release gates are formally met yet. A01–A03 and A09/A10 now have passing reproductions, which is what the reliability gate asks for, and Package 3's offline criterion now has a passing reproduction too.

Historical working-tree note (superseded by the clean-tree check on 2026-09-28)
