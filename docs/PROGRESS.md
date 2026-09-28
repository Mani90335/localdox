Latest update — 2026-09-28 (A10)

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

- Package 3: A03 and A10 are done (above). Still pending: A11 (no offline support, no request for persistent storage).
- Package 4: A06 is done (2026-09-28 update above). A07's unchanged-query refresh is covered; its remaining worker protocol/lifecycle work is pending.
- Package 5: A04 (500-edge Stepped diagram makes a 52,311 px page), A05 (3,000-section Markdown), A08 (PDF zoom memory), R01–R04.
- Package 6: B01–B03 (startup loading), D01–D03 (loading whole workspaces, binary storage, the storage cap).
- Package 7: A09 is done (latest update above); broader UX items remain pending.
- Package 2 is now complete (A01, D04, D06).
- Package 8: A12 (Gemini models, not yet checked against Google's current list), B04, B05, R05, R06, and the lint debt (76 errors).

None of PLAN.md's release gates are formally met yet. A01–A03 and A09/A10 now have passing reproductions, which is what the reliability gate asks for; A11 and the Package 3 offline criterion remain before calling Package 3 complete.

Historical working-tree note (superseded by the clean-tree check on 2026-09-28)

At the earlier update, another Claude session and a Codex process were editing
12 files, including DocsApp.tsx, the office viewers, ConversionContext.tsx and
viewers.spec.ts. Those changes were left untouched by the earlier audit fixes.
The working tree was clean when the A06 work above began.
