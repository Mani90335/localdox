# Boards

A board is a whiteboard document: shapes, connectors, sticky notes, pen and
highlighter strokes, text and images on an endless canvas. New boards are
`.board` files. Older `.excalidraw` files open in the same editor.

Code: `src/services/board/`. Tests: `tests/board.test.ts` (model and scene
rules) and `tests/e2e/board.spec.ts` (the editor in a browser).

## Why boards have their own engine

Boards used to embed the Excalidraw editor. That had three costs:

- **Size.** Opening a board downloaded about 1.09 MB of gzipped JavaScript
  (2.9 MB raw) and 22 KB of CSS.
- **Identity.** Its toolbar, menus, icons and hand-drawn font made a board
  look like a different app inside localdox.
- **Control.** Every UX change meant overriding someone else's CSS variables.

The native engine is about 35 KB of gzipped JavaScript and 2.4 KB of CSS. Its
only dependency is `perfect-freehand` (MIT, ~4 KB), which turns pen input into
smooth, pressure-sensitive outlines.

We did not reskin Excalidraw instead. Even with every element of its UI hidden,
the reader would still download the whole editor. Its canvas behaviour
(handles, the hand-drawn look) would still give it away.

## The file format

Elements use the open `.excalidraw` element schema: `type`, `x`, `y`, `width`,
`height`, `angle`, `strokeColor`, `points`, `boundElements`, `containerId`,
`startBinding`… That buys two things:

1. Boards made before the switch open unchanged.
2. A board's content stays portable. The format is documented JSON, not ours
   alone.

Only the envelope differs:

| File                | Envelope                                                      | Written back as                          |
| ------------------- | ------------------------------------------------------------- | ---------------------------------------- |
| `.board` (new)      | `{ "type": "localdox-board", "version": 1, elements, files }` | same                                     |
| `.excalidraw` (old) | `{ "type": "excalidraw", elements, appState, files }`         | same, with fields we don't use preserved |

`model.ts` owns parsing and serialising:

- **Unknown fields and element types survive a round trip.** Frames and embeds
  from other tools are drawn as quiet placeholders and saved untouched.
- **Content that isn't a board throws `SceneParseError`.** The viewer then
  shows "This board can't be opened" instead of a blank canvas that the next
  autosave would write over the file.
- **Images live inline as data URLs** (`files`). Images that no element uses
  are dropped on save, so undoing an image insert also frees its bytes.

New elements use `roughness: 0` (crisp lines). Text offers three families:

| Id            | Name         | Draws with                                  |
| ------------- | ------------ | ------------------------------------------- |
| 100 (default) | Hyperlegible | Atkinson Hyperlegible, then the system sans |
| 2             | System       | the system sans                             |
| 3             | Mono         | JetBrains Mono, then system monospace       |

Any other id (hand-lettered faces from other tools) draws in the system sans.
We don't ship hand-lettered fonts. Atkinson has no id in the schema, so it
takes 100, well clear of the schema's own range. Another tool reading the file
falls back to its default face.

## Text face and its loading

Board text uses Atkinson Hyperlegible, the app's reading face. It was designed
for legibility, especially for low-vision readers. Each option in the font
picker previews itself ("Aa" set in that face).

Loading it costs almost nothing:

- **Same files as the app.** `font.ts` calls the app's own loader,
  `loadReadingFont("hyperlegible")` in `src/lib/fonts/fonts.ts`. Since
  Atkinson is the default reading font, the stylesheet and files are usually
  already loaded and cached, and the board downloads nothing.
- **Only what's used.** The stylesheet only _declares_ faces. The browser
  fetches a binary only for the weight and `unicode-range` subset that
  rendered text uses, which for a typical board is the Latin 400 file. The e2e
  suite asserts nothing is fetched twice.
- **Canvas re-measured once the face arrives.** HTML text re-flows by itself
  when a webfont swaps in; canvas text doesn't. `loadBoardFont()` waits for
  the stylesheet, then `document.fonts.load()` for the face itself, and then
  the board clears its text-width cache and redraws. Until then, text draws
  in the system sans, so a board is never blank while waiting.

`loadReadingFont` now returns a promise for exactly this use. Its existing
caller ignores it.

## Architecture

```
Board.tsx          React chrome: title, tool rail + options, selection bar, zoom/history, menus, text box
font.ts            loads Atkinson Hyperlegible through the app's font loader
   │  subscribes to coarse "ui" / "view" channels only
editor.ts          BoardEditor: scene, selection, gestures, history, keyboard
   │  owns the two canvases directly
render.ts          path building (SVG path data → Path2D), drawing, export
scene-ops.ts       pure scene rules: connectors, labels, delete, copy, z-order, groups
geometry.ts        bounds, hit testing, rotation, outline points
text.ts            measuring, wrapping, label layout
images.ts          downscale/encode on insert, decode-once store for drawing
BoardViewer.tsx    read-only embed (renderer only, no editor)
```

### Why the editor lives outside React

A pen sends up to 240 pointer events a second, and none of them needs a
component to re-render. `BoardEditor` is a plain class. It holds the scene and
draws to its canvases itself. React subscribes to two channels:

- `ui`: tool, selection, style, undo state. It changes on clicks, not on drags.
- `view`: zoom and pan. Only the zoom label and the text editor listen to it.

A stroke or a drag therefore re-renders zero components.

### Two canvases

- **Scene canvas:** the committed elements. It is redrawn only when they
  change or the view moves.
- **Overlay canvas:** everything that changes every frame. That covers hover
  outlines, selection handles, the marquee, snapping guides, the eraser trail,
  and the shape or stroke still being drawn.

Drawing a stroke repaints only the overlay. The stroke joins the scene on
pointer-up.

### Rendering cost

- Each element's outline is built once as SVG path data and turned into a
  `Path2D`.
- The cache key is the element's _geometry_ (a shape's size, a line's `points`
  array), not the element object. Moving a hundred shapes rebuilds no paths:
  a move only changes the transform the shape is drawn with.
- Elements outside the viewport are skipped.
- The dot grid is a single pattern fill, not thousands of dots.

Measured on 2026-10-02 (production build, headless Chromium, 1440×900, all
elements on screen while panning):

| Elements | Render cost p50 |    p95 | Frame interval p95 |
| -------: | --------------: | -----: | -----------------: |
|      500 |          0.1 ms | 0.5 ms |            16.8 ms |
|    5,000 |          0.3 ms | 3.4 ms |            16.8 ms |

"Render cost" is main-thread time inside the board's animation-frame
callback. The GPU rasterises the commands afterwards.

### Immutable elements, cheap undo

Elements are never mutated. `mutate()` returns a new object with `version`
bumped. That makes three things cheap:

- **Caching:** a `WeakMap` keyed by element is invalidated automatically.
- **Undo:** history stores whole element arrays by reference (up to 300
  steps). An unchanged element costs nothing to keep.
- **Change detection:** `commit()` compares arrays element by element and
  records a step only if something changed.

A gesture is one step. Pointer-down saves the scene and pointer-up commits it.
Escape or a second finger restores the saved scene.

## Scene rules (`scene-ops.ts`)

Keeping these as pure functions means every caller follows them, and the unit
tests check them directly:

- **Connectors stay attached.** An arrow end dropped on a shape binds to it.
  `settle()` re-routes bound arrows after any move, resize or rotation. An end
  is placed where the ray from the shape's centre leaves its outline
  (`outlinePoint`), plus a 6 px gap. Dragging an arrow on its own detaches it
  from shapes that stay behind.
- **Labels travel with their shape.** A label is a text element with
  `containerId`. It is laid out inside the shape's label area, which is
  inset: an ellipse by 1/√2, a diamond by 1/2. A shape too short for its text
  grows downward, so a sticky note expands as you type.
- **Delete is complete.** Deleting a shape deletes its label and clears every
  binding that pointed at it.
- **Copies are self-consistent.** References inside the copied set are
  remapped to the new ids. References to elements outside the set are
  dropped.
- **Z-order moves units.** A shape and its label move together.

## Theming

Colours are stored as plain hex, so a file means the same thing everywhere.
Only what's on screen adapts:

- **Palette colours** have hand-tuned dark variants (`displayColor`).
- **Any other colour,** from an imported file, has its lightness mirrored.
  Dark ink on paper becomes light ink on slate.
- **The chrome** uses the app's tokens (`--card`, `--primary`, `--border`…),
  read with `getComputedStyle`. Each value is checked against the canvas, which
  may not understand `oklch()`, and falls back to hex if needed.
- **Theme switches** are picked up by a `MutationObserver` on `<html>`.

Exports (PNG, SVG) always use light colours on white, so they look the same
wherever they are pasted.

## UX decisions

- **Creating a board never blocks.** Other new files ask for a name with
  `window.prompt`, which freezes the whole page until answered. A board opens
  at once as "Untitled board" and is named in place: the title at its
  top-left is an input that renames the file (extension kept).
- **Tools return to Select** after one shape, connector, text or sticky note,
  the way Figma's do. Pen, highlighter and eraser stay active.
- **Styling happens next to the thing being styled.** A selection gets a
  compact toolbar floating just above it (below it when there's no room):
  colour, fill, stroke, arrowheads and text size open small panels that point
  _away_ from the selection, so the change is visible as it's made. The bar
  hides while a drag is in progress (`editor.interacting`), so it never chases
  the pointer. It replaced a side inspector that covered a quarter of the
  canvas — usually right over what you were drawing.
- **The tools live in a rail down the left edge, under the title, not in a
  bottom dock.** A bottom dock had four problems:
  - It competed with the phone's home indicator, the browser's bottom
    toolbar and the on-screen keyboard.
  - It sat at the very end of the page for keyboard and screen-reader users.
  - It was the last thing a screen-magnifier user panned to.
  - Its option strip floated over the middle of the canvas.

  The rail sits beside the workspace sidebar. In the DOM, the title and tools
  come before the canvas, so Tab and screen readers meet them first. It is a
  `role="toolbar"` with `aria-orientation="vertical"`, arrow keys move between
  tools, and tooltips open to the right. Buttons are 40 px.

- **Tool options are a slim column beside the rail.** With a drawing tool in
  hand and nothing selected, the column offers that tool's settings before
  you draw: colour and width, note colour, or font and size for text. It is
  pinned to the rail's top, two swatches wide, stacked vertically. It stays
  out of the drawing area and doesn't jump as tools change. An earlier
  version, a horizontal strip next to the active tool, sat right where people
  start drawing. The e2e suite caught it intercepting a drag. Changing a style
  also sets the default for what you draw next.
- **An empty shape is clicked anywhere inside.** Hit testing first looks for
  outlines, ink and filled areas, top-most first; only if nothing is hit does
  it fall back to the _smallest_ unfilled shape containing the point. So a
  click inside an empty box selects the box, while anything drawn inside it
  still wins.
- **Snapping:** a dragged selection snaps its edges and centre to nearby
  elements and shows pink guides. Hold ⌘/Ctrl to move freely.
- **Direct manipulation:**
  - Alt-drag drags a copy.
  - Shift keeps proportions and snaps angles to 15°.
  - Dragging the midpoint of a selected line or arrow adds a bend.
- **Text:**
  - Double-click empty canvas to type.
  - Double-click a shape or arrow to label it.
  - Enter edits the selected element's text.
  - Escape or ⌘/Ctrl+Enter finishes. Empty text is deleted.
- **Focus.** A board that opens while nothing has focus takes the keyboard, so
  shortcuts work at once. The canvas focus ring shows after Tab and hides once
  you start working.
- **Pointer handling.** `pointerdown` calls `preventDefault()` except for the
  right button. Without it, the browser's mousedown focus change would blur
  (and close) a text box that the same click had just opened.
- **Keyboard and screen readers:**
  - Toolbars use arrow-key roving focus and `aria-pressed`.
  - A polite live region announces selections, additions and deletions.
  - `?` opens the shortcut sheet.
- **Short screens** (≤ 660 px tall, e.g. a phone in landscape): the secondary
  tools (Pan, Highlighter, Ellipse, Diamond, Line) move into a "More tools"
  menu, so the rail never runs off the bottom. Height decides this, not width,
  because the rail is vertical. A portrait phone shows the whole rail.

## Custom colours

Every swatch row (stroke, fill, note, highlighter, and the tool column) ends
with a **Custom colour** swatch: a hue ring that, once a custom colour is in
use, shows it in the middle. It opens `ColorPicker.tsx`:

- **Hue/saturation wheel.** Drag on it: the angle is the hue and the distance
  from the centre is the saturation. It also works by keyboard: ←/→ turn the
  hue, ↑/↓ change saturation, and Shift takes bigger steps.
- **Brightness slider**, a native range input whose track runs from black to
  the current hue.
- **Hex field.** Accepts `#RGB` or `#RRGGBB`, with or without `#`, in any case.
  Valid input previews as you type and applies on Enter or blur. Escape
  restores the field.
- **Eyedropper** (`window.EyeDropper`, Chromium only; hidden elsewhere) picks a
  colour from anywhere on screen, e.g. to match a photo you're labelling.
- **Recent colours:** the last 8 picks, kept per device in `localStorage`.

**Why it's built here.** `react-colorful` (MIT, ~3 KB) draws a square, not a
wheel. Wheel packages bring several dependencies, and every new runtime
import would also need adding to `optimizeDeps.include`. The picker is one
canvas, painted once per brightness change, plus three inputs. Colour maths
lives in `color.ts` (pure, unit-tested).

**One undo step per drag.** `editor.setStyle(changes, { commit: false })`
restyles the selection without recording history. The wheel and slider use
it while the pointer is down, then commit once on release. Undo restores the
colour from before the drag.

**Custom colours show exactly.** In dark mode, colours that aren't in the
palette used to have their lightness mirrored, so a hand-picked red came out
a different red. Now only near-black, near-white and grey inks are mirrored,
since those would vanish on a dark surface. Any colour with saturation ≥ 35 %
and lightness 25–75 % is drawn exactly as chosen.

## Photos: drawing and labelling on them

A photo on a board is a surface to annotate (label a diagram, mark up a
screenshot, circle a detail). Five rules make that work:

- **Every tool works on top of a photo.** Pen, highlighter, shapes, arrows,
  sticky notes and text all draw over it. Double-click a photo to start a text
  label right there. A photo has no label of its own, so the double-click
  creates free text instead of trying to give the photo one.
- **Arrows point _into_ a photo.** A connector end binds to a photo only when
  dropped on its rim (`findBindTarget` + `nearBoxEdge`, a 12 px band at 100 %).
  Anywhere inside, the arrow ends exactly where it was drawn. Without this, a
  label arrow jumped to the photo's border.
- **The eraser never removes a photo.** Rubbing out a mark mustn't take the
  photo with it. A photo is removed on purpose: select it and press Delete.
- **Marks travel with their photo.** When a photo is moved, resized or rotated,
  the elements lying entirely within it and above it move, scale or rotate
  with it (`marksOnPhotos`). The photo's box gets 8 px of slack, so marks touching
  its edge still count.
- **A photo can be locked** (⌘/Ctrl+Shift+L, or "Lock photo" in the selection
  menu). A locked element can't be clicked, dragged, resized or erased. A drag
  across it becomes a marquee that selects the labels on it. Locked elements are
  reachable only by right-click, which offers "Unlock".

**Readable labels.** Free text that overlaps a photo is drawn with a halo in
the surface colour (`strokeText` under `fillText`; `paint-order="stroke"` in
SVG), the way map labels stay readable over any terrain. Photo bounds are
computed once per scene array, so the check costs nothing per frame.

## Embeds

`![[Sketch.board]]` in a document renders `BoardViewer`. It is mounted only as
it nears the viewport.

The viewer is read-only and uses only the renderer, with no editor and no
save path. You can drag to pan, and pinch or ⌘/Ctrl-scroll to zoom. A plain
scroll keeps scrolling the document. Double-click or "Reset view" re-frames
the board.

## Debugging

- **"This board can't be opened."** The content isn't JSON, or has no
  `elements` array. The file is untouched. Download it from the file menu to
  inspect it.
- **Text measured wrong after a font loads.** `clearTextMetrics()` runs on
  `document.fonts.ready`. A new font source would need the same.
- **Connector not following a shape.** Check that the arrow's
  `startBinding.elementId` or `endBinding.elementId` names the shape, _and_
  that the shape's `boundElements` lists the arrow. `bindConnectorEnd`
  maintains both sides.
- **Nothing saves.** Autosave runs 400 ms after `commit()` and flushes on
  unmount, `pagehide` and `visibilitychange`. A read-only board (no
  `onContentChange`) never saves.
- **In dev, opening a board reloads the whole page.** Vite found a dependency
  it hadn't pre-bundled, re-bundled _every_ dependency and forced a reload.
  Every package a lazy chunk imports directly must be listed in
  `optimizeDeps.include` in `vite.config.ts` (`perfect-freehand` is). Production
  builds are unaffected.
