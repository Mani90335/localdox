# Element fullscreen

Six surfaces can go full screen: the image, PDF and presentation viewers, a
Mermaid diagram, a mind map and a JSON tree. Each one calls
`requestFullscreen()` on its own element instead of drawing an overlay. That
keeps its state (zoom, open branches, the current slide) when it goes in and
comes back out. The cost is that the browser treats that element differently,
and three things broke because of it.

## What the browser does

A fullscreen element moves to the **top layer**. Only that element's subtree
is painted, and the browser puts a black `::backdrop` pseudo-element behind it.

1. **Translucent surfaces turned grey.** The Mermaid frame is
   `bg-muted/30`, which is 70% transparent. Inline, the page shows through it.
   In fullscreen, the black backdrop shows through instead: a grey veil in the
   light theme and a frame that is too dark in the dark theme. The mind map's
   `rounded-xl` also beat `rounded-none` in the stylesheet, so black corners
   showed through.
2. **Overlays vanished.** Menus, tooltips, dialogs, the diagram colour picker,
   the highlight menu and toasts all portal to `<body>`. `<body>` is outside
   the fullscreen subtree, so they opened, took focus, and could not be seen.
   The Export menu looked like a dead button.
3. **Heights assumed app chrome.** Viewers size content as
   `100dvh - 4rem - 3.5rem` (the app chrome plus the viewer header). There is
   no app chrome in fullscreen, so a 4rem dead band sat under the content. The
   deck's slide had a fixed cap of 1100px at 16:9. On screens shorter than
   about 825px, the header, slide and rail did not fit, and the thumbnail rail
   was cut off with no way to scroll.

## The fixes

- `styles.css` paints `::backdrop` with `var(--background)`, so a translucent
  surface composites over the page colour exactly as it does inline.
- `usePortalContainer()` (`src/hooks/use-portal-container.ts`) returns the
  fullscreen element while one is up and `undefined` otherwise. `undefined`
  means "the library default", which is `<body>`. The Radix wrappers (dropdown
  menu, dialog, modal, select, tooltip), the Sonner toaster, the diagram colour
  popover and the highlight menu all portal there. A fullscreen `<video>` or
  `<iframe>` can't host children, so overlays stay on `<body>` in that case.
- `--app-chrome-h` is `4rem`, and `0px` inside `:fullscreen`. Viewer heights
  are written as `calc(100dvh - var(--app-chrome-h) - 3.5rem)`, so they fill
  the screen in fullscreen and are unchanged elsewhere.
- In fullscreen, the deck's stage is a size container, and the slide is
  `min(100cqw, 100cqh * 16/9)`: the largest 16:9 box that fits.
- The mind map follows its frame and re-fits whenever the frame is resized,
  until the reader pans or zooms. Entering or leaving fullscreen always
  re-fits. In fullscreen it fills its parent (`fill`) rather than sizing to
  the viewport.

## Trade-offs and failure modes

- **New overlay code:** a portal that bypasses these wrappers (a raw
  `createPortal(…, document.body)`) will disappear in fullscreen again. Portal
  into `usePortalContainer() ?? document.body`.
- **Toasts on transition:** the toaster remounts when fullscreen starts or
  ends, so a toast already on screen at that moment is dropped. New toasts
  appear normally.
- **Debugging:** when something opens but can't be seen in fullscreen, check
  in DevTools whether its node is inside `document.fullscreenElement`. For a
  grey or black tint, check the element's computed background for alpha.
