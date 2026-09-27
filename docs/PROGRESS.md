Latest update — 2026-09-28

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

Limits: everything ran on Chromium on this machine. I haven't tested Safari, Firefox, real phones or a screen reader, and haven't re-run the audit's measurement scripts. A01 also has a gap. Typing the editor is still holding (its 600 ms private buffer) isn't saved or merged until it reaches the app, so if the tab closes before that it can still be lost. A10 covers this.

Pending (not started, or started but not committed)

- Package 3: A03 is done (above). Still pending: A10 (save status not shown; failures only appear as a toast; the typing-loss window above), A11 (no offline support, no request for persistent storage).
- Package 4: A06 is done (2026-09-28 update above). A07's unchanged-query refresh is covered; its remaining worker protocol/lifecycle work is pending.
- Package 5: A04 (500-edge Stepped diagram makes a 52,311 px page), A05 (3,000-section Markdown), A08 (PDF zoom memory), R01–R04.
- Package 6: B01–B03 (startup loading), D01–D03 (loading whole workspaces, binary storage, the storage cap).
- Package 7: A09 (mobile drawer focus and blocked zoom) and the UX items.
- Package 2 is now complete (A01, D04, D06).
- Package 8: A12 (Gemini models, not yet checked against Google's current list), B04, B05, R05, R06, and the lint debt (76 errors).

None of PLAN.md's release gates are met yet. The reliability release still needs A09 and A10 as well as what's done.

Historical working-tree note (superseded by the clean-tree check on 2026-09-28)

At the earlier update, another Claude session and a Codex process were editing
12 files, including DocsApp.tsx, the office viewers, ConversionContext.tsx and
viewers.spec.ts. Those changes were left untouched by the earlier audit fixes.
The working tree was clean when the A06 work above began.
