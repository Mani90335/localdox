# Stale-chunk recovery (B04)

## The problem

Localdox downloads most features only when the reader first uses them:
viewers, Settings, the AI panel, diagrams. Each one is a separate build file
("chunk") with a content hash in its name, e.g. `DocumentViewer-oGpLUhCC.js`.

Suppose a tab is left open and a new release is deployed. The tab still runs
the old build, so it asks for old file names that are no longer on the host.
Firebase rewrites unknown paths to the SPA shell, so the answer is an HTML page
with status 200. The browser won't run HTML as a module, and the import fails.
The same import also fails when the device is offline.

Vite reports both cases as a `vite:preloadError` event. The old handler
reloaded the page as soon as it saw one. Measured on the production build
before this change:

| Situation                   | Old behaviour                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Save failing (disk full)    | Reloaded anyway, behind the browser's "leave site?" prompt; accepting it lost the unsaved import                             |
| Offline                     | Reloaded into the browser's offline error page                                                                               |
| Same failure after a reload | The loop guard stopped the reload. The import then resolved to `undefined`, and the root error screen replaced the whole app |
| Different message each time | No overall limit on reloads (the guard was keyed by message)                                                                 |

## The mental model

A failed download raises three questions, answered in this order:

1. **Why did it fail?** Ask the server directly (`probeAsset`).
2. **What would a reload cost?** Save first, then check (`prepareReload`).
3. **Reload now, or ask?** (`planRecovery`)

```
chunk import fails ─► vite:preloadError ─► handleChunkError
                           │                     │
     (the import still     │          probe: HEAD <asset>, no-store
      rejects; it isn't    │          ├─ network error / timeout / navigator.onLine=false → offline
      swallowed)           │          ├─ 404 or text/html → missing (a new build is deployed)
                           ▼          └─ JS/CSS → present (transient failure)
                     LazyBoundary                    │
                     shows an inline      prepareReload: flush the guard's writes
                     notice; the rest     ├─ idle        → clean
                     of the app stays     ├─ only journalled editor text → recoverable
                     mounted              └─ anything else → at-risk
                                                     │
                                          planRecovery
                                          ├─ offline                          → toast, wait for `online`
                                          ├─ clean and no auto-reload in 5 min → reload now
                                          └─ otherwise                         → toast with "Reload"
```

## Where the code is

| File                                            | Role                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/lib/app/stale-chunk.ts`                    | Pure decisions: recognise chunk errors, find the failed URL, probe, plan, and the messages. Unit-tested. |
| `src/lib/app/safe-reload.ts`                    | The reload guard registry: `prepareReload`, `reloadSafely`, `holdReload`. Unit-tested.                   |
| `src/lib/app/install-chunk-recovery.ts`         | Browser glue: the event listener, sessionStorage loop guard, toasts, the `online` retry.                 |
| `src/components/docs/docs-app/LazyBoundary.tsx` | `Suspense` plus an error boundary that catches only chunk failures.                                      |
| `src/components/docs/DocsApp.tsx`               | Registers the guard: how to flush, when the page is idle, and what is at risk.                           |
| `build/offline-sw.js`                           | Never caches the host's HTML fallback as a script.                                                       |

## Key decisions

**The import is not swallowed.** The old handler called `preventDefault()`,
so the import resolved to `undefined`. That failed later, somewhere unrelated,
with a confusing error. Now the import rejects as usual, and `LazyBoundary`
turns it into a contained notice. The handler only decides about the reload.
Because the probe is async, the handler couldn't make that decision
synchronously anyway.

**Boundaries sit inside DocsApp.** Previously a failed chunk reached the
root error screen, which unmounts DocsApp and everything it hadn't saved.
Now only the viewer area or the dialog is replaced. The sidebar, save state,
and save-error banner stay. `React.lazy` remembers a rejection, so the only
real retry is a reload. `resetKey` clears the notice when the reader opens
something else, which may not need that chunk.

**"Idle" is checked after saving, not before.** A pending import or rename
is written first. Only what still can't be written blocks an automatic
reload. Editor text in the draft journal counts as _recoverable_: the next
load offers it back. It still isn't reloaded automatically, because an
unexpected recovery prompt would surprise the reader.

**One automatic reload per 5 minutes per tab, whatever the message.** The
timestamp is kept in `sessionStorage`. If that storage fails, there's no
automatic reload at all, so the loop guard can't fail silently.

**The probe uses `HEAD` with `cache: "no-store"`.** The offline service worker
only handles `GET`, so the answer comes from the network. A response with the
wrong content type counts as missing. That covers hosts that rewrite unknown
paths to HTML.

**No double prompt.** Once the reader has confirmed "reload anyway", DocsApp's
`beforeunload` handler stands down (`reloadConfirmed()`). `saveErrorRef` is
cleared as soon as a write commits, so a reload decided before the next render
doesn't see a stale error.

## Service worker note

After a deploy, an open tab keeps its old service worker and its manifest.
Build files it has already cached keep working for that tab: the worker
precaches the shell, which includes Settings and the document viewer. Those
tabs never reach this handler. For files it hadn't cached, the worker used to
store the host's HTML fallback under the script's key. `isFile()` now refuses
to cache that.

## Debugging

- `sessionStorage["localdox:chunk-reload-at"]` records the last automatic
  reload. Delete it to allow another one.
- The toast uses id `chunk-recovery`. Repeated failures update it instead of
  stacking copies.
- To reproduce, use a production build (`vite:preloadError` doesn't exist in
  dev). Route `**/assets/DocumentViewer-*.js` to an HTML 200 response, then
  open a CSV. See `tests/e2e/stale-chunk.spec.ts`.

## Limits

- The old files aren't kept on the host during a rollout. That's a hosting
  change (publishing previous `/assets/` alongside the new build), not app
  code.
- Office editors don't journal drafts. With one dirty, the reload asks first
  rather than recovering the text.
- Tested on Chromium only.
