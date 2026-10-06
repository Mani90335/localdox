# Startup loading: a small shell first, the reader and editor when needed

This note explains what Localdox downloads before it can paint, and why the
Markdown reader, the editor, split view and search's fallback index aren't in
that download (audit item B02).

## The problem

A browser can't show the app until it has downloaded, parsed and run every
script the first screen imports. Imports are followed statically: if
`DocsApp.tsx` imports `MarkdownViewer`, and the viewer imports the Markdown
parser, all of it is on the startup path, even when the workspace is empty and
there is nothing to read.

At ac2fad3 an empty workspace downloaded 19 scripts, 338 KB gzipped
(1,098 KB raw). The largest pieces the first screen didn't use:

| Code                                                      | Why it was there                                |
| --------------------------------------------------------- | ----------------------------------------------- |
| `MarkdownViewer` and its helpers (source maps, renderers) | imported by `DocsApp` and `PaneDocument`        |
| the Markdown parser (micromark, mdast, hast), ~45 KB gz   | imported by the viewer                          |
| `MarkdownEditor`, toolbar, math keyboard                  | imported by the viewer                          |
| react-resizable-panels, ~12 KB gz                         | split view, imported by `DocsApp`               |
| Radix select, dropdown menu and popper                    | the viewer's header and export menus            |
| search's main-thread index                                | a fallback for when the search worker can't run |

## The model

Think of a shop. The front door, the counter and the shelves (the shell:
header, sidebar, empty state, saving, search box) must be there when the shop
opens. The reading room is set up just after opening, while the first customer
is still looking around. The workshop in the back (the editor) opens when
someone asks for it. The spare generator (the fallback index) comes out only
if the power (the worker) fails.

In code, "set up later" is a **dynamic import**: `import("./MarkdownViewer")`
returns a promise, and the bundler puts that module and everything only it
uses into a separate file (a **chunk**) that is fetched when the promise is
first created.

## What loads when

```
first paint ─ shell only: 20 scripts, 220 KB gz
   │
   ├─ idle after first paint ──────► reader + parser (~119 KB gz)
   ├─ files dropped / picked ──────► reader (if a text document is coming)
   ├─ file menu opened / New doc ──► editor (~9 KB gz)
   ├─ first split ─────────────────► react-resizable-panels
   └─ search worker fails ─────────► main-thread index
```

- `viewer/MarkdownViewerLazy.tsx`: the `MarkdownViewer` that `DocsApp` and
  `PaneDocument` render. It shows a skeleton of the reading column until the
  real one arrives. `preloadMarkdownViewer()` starts the download early.
- `editor/MarkdownEditorLazy.tsx`: the same for the editor, with its
  imperative handle (`select`) forwarded. `preloadMarkdownEditor()` runs when a
  file menu with an Edit item opens, when a document is created, and on Edit.
- `ui/resizable-lazy.tsx`: split view's group, panel and handle.
- `lib/search/local-search-client.ts`: the fallback index, imported by
  `use-search-index` only after the worker fails. Until it arrives, the search
  panel says "Indexing documents…", not "No results".

## Why not `React.lazy`?

`React.lazy` with `<Suspense>` was the first version, and it made reopening a
document ~300 ms slower even though the chunk arrived in 29 ms. Once a Suspense
fallback has been shown, React 19 holds the real content back until at least
300 ms have passed (`FALLBACK_THROTTLE_MS` in react-dom). The throttle stops
several boundaries from popping in one after another. Here there's one
boundary and a chunk that's usually already cached, so the throttle was the
whole wait.

`lib/app/deferred-module.ts` keeps the module in component state instead:

```ts
const viewer = deferredModule(() => import("./MarkdownViewer"));

function MarkdownViewer(props) {
  const mod = viewer.useModule(); // undefined until the chunk arrives
  return mod ? <mod.MarkdownViewer {...props} /> : <ReaderPlaceholder />;
}
```

- The first caller starts one download, and every other caller shares it.
- Once loaded, later mounts render it straight away, with no placeholder at
  all.
- A failed download is thrown during render, so the content column's
  `LazyBoundary` shows "This part of Localdox didn't load" and B04's recovery
  runs, as it does for a `React.lazy` failure. The failure isn't kept, so a
  later mount tries again.

The placeholders are invisible for their first 300 ms (`delay-300`, then a
fade), so a fast load shows nothing rather than a flash.

## Why warm the reader at idle?

Moving the reader out of startup makes the shell paint sooner, but the next
thing almost everyone does is open a document. Without a warm-up, that open
had to wait for the download. On a slow connection (150 ms RTT, 1.6 Mbps) it
went from 0.16 s to 2.3 s. Fetching the reader in the first idle period after
first contentful paint keeps it off the startup path and usually ready before
a file has been chosen. The editor is small (9 KB gz) and less common, so it
waits for a sign of intent instead.

The offline service worker precaches all of these chunks (the `core` list in
`vite.config.ts`), so they never need the network once the app is installed.

## Measurements

Production build, Chromium, 4× CPU throttle, 5 runs each, medians. "Before" is
ac2fad3.

| Journey                                       | Before | After  |
| --------------------------------------------- | ------ | ------ |
| Startup JS, empty workspace (gzip)            | 338 KB | 220 KB |
| Scripts on the startup path                   | 19     | 20     |
| Shell ready, slow network                     | 7.07 s | 5.56 s |
| First contentful paint, slow network          | 6.90 s | 5.32 s |
| Shell ready, localhost                        | 243 ms | 231 ms |
| First open after idle, slow network           | 163 ms | 156 ms |
| Reload with a document open, slow network     | 346 ms | 365 ms |
| First Edit, slow network, ~300 ms human pause | 496 ms | 505 ms |
| First Edit, slow network, clicked instantly   | 208 ms | 454 ms |

The last row is the cost: the editor is one round trip away when Edit is
clicked the instant its menu opens.

## Trade-offs and limits

- **The reader is still downloaded in most sessions**, just after first paint.
  That is deliberate (see above). The gain is a faster first paint, not fewer
  bytes per session.
- **Opening a file before idle** (within about a second of the shell
  appearing, on a slow connection) waits for the reader. Picking a file takes
  longer than that in practice. Dropping a file starts the download at once.
- **Startup is still above the 200 KiB target** (220 KB ≈ 215 KiB). The next
  largest piece is zod (~18 KB gz), which backup and share validation
  (`import-schema.ts`) pulls into `persistence.ts`. Moving it out means making
  `parseWorkspaceImport` and `parseSharedFiles` asynchronous. That's a separate
  change.
- **A failed idle warm-up** goes through B04's chunk recovery like any other
  failed chunk. Offline with the service worker installed it doesn't fail,
  because the chunk is precached.
- **Fast Refresh**: the two `*Lazy.tsx` files export a preload function next to
  a component, so editing them in dev reloads the page instead of hot
  swapping.

## Debugging

- DevTools → Network, filter `JS`, reload an empty workspace. Nothing named
  `MarkdownViewer`, `MarkdownEditor` or `resizable` should load before the
  first paint marker. Chunk names can change, so
  `tests/e2e/startup-loading.spec.ts` recognizes chunks by strings in their
  code instead.
- A reader that never appears: check the console for a failed dynamic import
  and whether the "didn't load" notice is shown. The download lives in
  `deferredModule`; its state is per page load.
- An Inspect jump that lands at the top of the editor: the selection waits in
  `pendingSelect` until the editor's handle exists (`MarkdownViewer`, the
  `setEditor` ref). If the editor is rendered without that ref, the jump is
  lost.
