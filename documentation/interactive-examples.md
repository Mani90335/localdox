# Interactive examples: a sandboxed frame that works

A Markdown fence written as ` ```interactive-react ` or ` ```interactive-html `
becomes a live example: the reader shows the code's result in a frame, and
with the `split` or `playground` flag, the code beside it (editable in a
playground). This note covers how that frame is built and kept isolated.

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

## Debugging

- Nothing in the frame: check the console for CSP reports. A `blocked:csp`
  request means the example tried the network, which is by design.
- "Preview error": compile errors come from the reader, runtime errors from
  the frame (window `error` or the React error boundary).
- Runtime changes: `frame-runtime.tsx` is not part of the app bundle. The dev
  server rebuilds it when files under `src/services/interactive/` change.

Tests: `tests/e2e/interactive.spec.ts`.
