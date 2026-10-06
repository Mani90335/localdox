# Interactive examples: a sandboxed frame, compiled off the main thread

A Markdown fence written as ` ```interactive-react ` or ` ```interactive-html `
becomes a live example: the reader shows the code's result in a frame, and
with the `split` or `playground` flag, the code beside it (editable in a
playground). This note covers how that frame is built and kept isolated, and
how React examples are compiled without freezing the reader (audit item R05).

## The frame is a different, untrusted origin

The example's code is whatever the document says. The reader must run it
without letting it read the workspace, the AI keys or anything else the app
stores. So it runs in an `<iframe sandbox="allow-scripts">`: scripts run, but
without `allow-same-origin` the frame gets an **opaque origin** (`null`). To
the browser it is a stranger: no access to the app's storage, cookies or DOM,
and messages are the only way in or out.

Each frame document also carries its own Content-Security-Policy:

```
default-src 'none'; img-src data: blob:; style-src 'unsafe-inline';
script-src 'unsafe-inline' ['unsafe-eval' for React]; connect-src 'none'; …
```

No `http:` source anywhere, so an example can't send what it sees to a server,
not even by setting an image's URL. (The runtime also stubs `fetch`, storage
and a few other APIs, but those stubs only give nicer errors: the sandbox and
the CSP are the boundary.)

## What was broken: a frame that loaded the app

The React frame used to navigate to `/interactive-runtime`, a route of the app
itself. That can't work from an opaque origin:

1. Module scripts are always fetched with CORS. A `null` origin needs
   `Access-Control-Allow-Origin` on every chunk, which neither the dev server,
   `vite preview` nor Firebase Hosting sends. Every chunk was blocked.
2. Allowing CORS only moves the failure: the app's root then registers the
   offline service worker, and reading `navigator.serviceWorker` throws in a
   sandboxed frame. The root error screen replaced the runtime.
3. Even working, every example would have booted the whole app shell.

So React examples never ran, in dev or production.

## The fix: React and the runtime inline, through `srcdoc`

```
build/vite-interactive-runtime.ts
   frame-runtime.tsx + React ─ Vite lib build (iife) ─▶ one classic script
                                                        │
   virtual:interactive-frame-runtime  (export default "<script text>")
                                                        │  import() on the first
                                                        ▼  React example
InteractiveBlock ─ reactFrameDocument(runtime) ─▶ <iframe srcdoc=…>
                                                        │ "booted"
                          compiled component ◀──────────┘
                          postMessage(run) ───────────▶ mounts it, "ready"
```

- A classic inline script needs no CORS and no request at all. The frame never
  touches the network.
- The script text lives in its own chunk (193 KB, 60 KB gzip), imported the
  first time a React example appears. It is an optional capability like PDF
  or math: not in the offline shell, cached once used.
- `srcdoc` is built once per runtime. The theme travels with each run message,
  so switching the page theme doesn't reload the frame.
- The block counts `booted` messages rather than setting a flag, and sends the
  current code on each. A frame that reloads (a remount, a layout change) is
  sent its code again instead of staying blank.

`inlineScript()` escapes `</script`. The build refuses a runtime containing
`<!--`, because after one the HTML parser can skip the closing tag. React DOM
contains `<script`, which is harmless without the `<!--`.

### The height loop

The frame is sized to its content (176–960 px). It used to report
`documentElement.scrollHeight`, which is never smaller than the frame itself,
and the block added 2 px: each report grew the frame, which grew the next
report, one pixel per round up to 960 px, re-rendering the reader each time.
Both frames now report the body's own height and set no `min-height` on it.
Beside the code (split, playground), CSS stretches the frame to fill its
pane; the size it reports still follows its content.

## Compiling: a worker, a cache, and a pause

A React example is TypeScript + JSX. Babel turns it into plain JavaScript
the frame can run. Babel is big (2.9 MB), and it used to run on the reader's
own thread, the one that also handles scrolling and typing.

Think of a restaurant where the waiter also cooked every dish. While a big
order cooks, nobody gets served. Three changes:

1. **A separate cook (the worker).** `compiler.worker.ts` loads Babel and
   compiles in a Web Worker, a background thread. The reader only sends
   source text and receives code (`compiler-client.ts`).
2. **Remember past orders (the cache).** Results are kept by source text:
   reopening a document, or undoing an edit, doesn't compile again. The cache
   is bounded by bytes (4 MiB of source + output, least recently used out),
   and two blocks with the same source share one compile.
3. **Wait until the order is complete (the pause).** A playground compiles
   400 ms after the last keystroke, not on every one. Before, each keystroke
   compiled, remounted the example (so a counter you had clicked reset while
   you typed a comment), and flashed "Preview error" for each half-typed line.
   An HTML playground reloaded its frame per keystroke; it waits too now.

```
playground edit ─ 400 ms pause ─▶ compiler.compile(source)
                                     │ cache hit ─▶ result
                                     │ miss
                                     ▼
                         queue ─▶ worker (one at a time, 10 s limit)
                                     │ { ok, code } or { ok: false, message }
                                     ▼
                     block ─▶ frame (run) or error panel (at once)
```

**Failure behavior.** A compile _error_ (bad syntax) is a normal result:
cached and shown in the block. A failure of the _compiler_ is different and is
never cached, so the next attempt starts over:

| What happens                  | Result                                            |
| ----------------------------- | ------------------------------------------------- |
| Compile runs past 10 s        | Worker terminated; that block shows the error     |
| Worker crashes mid-compile    | That compile fails; the queue goes on, new worker |
| Worker never starts (offline) | Everything waiting fails once, not one per block  |
| No `Worker` in the browser    | The block says live examples need Web Workers     |

**Why no main-thread fallback.** Search and spreadsheets have one. Here, the
likely reason a worker can't start (its script isn't cached and the network is
gone) stops a main-thread Babel the same way, and a worker bundle can't share
a chunk with the page, so a fallback would ship Babel twice (it did while this
was written: 2.97 MB more in the offline download).

### Measured (production build, same server, Chromium)

`bench/interactive-jsx.mjs` (bench/ is not committed). Before = the build with
the working frame but main-thread Babel:

| Journey (4× CPU)                                  | Before                         | After                |
| ------------------------------------------------- | ------------------------------ | -------------------- |
| Open one example: longest task                    | 407 ms                         | none over 50 ms      |
| Open: block mounted → preview ready (median of 5) | 665 ms                         | 354 ms               |
| Type a 31-char comment, 614-line playground       | 29 runs, 21 long tasks (1.2 s) | 1 run, no long tasks |
| 12 examples on one page                           | 405 ms task, 1.4 s task time   | no long tasks, 0.8 s |

At 1× CPU, the first preview takes ~60 ms longer (185 → 245 ms median): the
worker starts after the compiler module arrives. The 93 ms main-thread task
it replaces is gone.

## Debugging

- Nothing in the frame: check the console for CSP reports. A `blocked:csp`
  request means the example tried the network, which is by design.
- "Preview error": compile errors come from the reader, runtime errors from
  the frame (window `error` or the React error boundary).
- Runtime changes: `frame-runtime.tsx` is not part of the app bundle. The dev
  server rebuilds it when files under `src/services/interactive/` change.

- Compiler state: `compiler.stats()` from `services/interactive/compiler`
  (cache entries and bytes, workers started, compiles posted, queued).

Tests: `tests/interactive-compiler.test.ts` (worker protocol, cache, timeout,
crash, failed start) and `tests/e2e/interactive.spec.ts`.
