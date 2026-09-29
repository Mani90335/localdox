# Blocks that fit, labels that fit, a row a mouse can scroll

Three small layout rules. Each fixed something that looked broken to readers.

## 1. Every block in a document is the width of the text column

**Problem.** Code blocks reached up to 5.5rem past the column on each side (a
"bleed"). Mermaid frames did the opposite: a mid-height diagram's frame shrank
to the diagram's own width. So one document showed blocks at three different
widths, and the page looked misaligned.

**Rule now.** `pre` is no longer in the bleed selector in `src/styles.css`
(`.docs-prose :is(...)`), so a long code line scrolls *inside* the block. The
Mermaid frame (`src/services/diagrams/Mermaid.tsx`) no longer takes a
`maxWidth`. The *diagram box* inside it still caps a tall diagram to a
screenful and centres it (`stageWidthCap` in `stage-ratio.ts`, applied through
`centredBoxCap` in `mermaid-diagram-helpers.ts`). So the card spans the column,
and the picture stays the size it was.

The cap sits on the box the SVG draws in, never on the stage around it. The
stage is what the control rows (search/select top-left, isolation count
top-right, selection actions bottom-left, zoom bottom-right) are positioned
against; capping the stage dragged all four into the middle of a wide frame.

**If you change it:** artifacts and interactive blocks still bleed. The dead
`.docs-mermaid` entry in that selector matches nothing today. Any new stage must
cap its diagram box, not its outer wrapper, or its controls float again.

## 2. Mind-map labels are measured, not guessed

**Problem.** Node widths came from `label.length × 6.6px`, and labels were cut
at 30 characters. The map inherits the reader's chosen font. A wide font, or
text like `WWWW…`, ran out of its box, and a narrow font left boxes half empty.

**Mental model.** Ask the browser how wide the text really is, then size the
box to it.

**Flow** (`src/services/mindmap/MindMapView.tsx`):

1. `LABEL_FONT` gives each node kind (root / branch / leaf) a size and weight.
   The `<text>` renders with those values, and they are also what gets
   measured, so the two can't drift apart.
2. Before first paint, `textMeasurer` reads the font family the map inherits
   and builds a canvas `measureText` function. Results are cached per label.
3. `layout` calls `fitNode` on each node. The box hugs the text, up to
   `MAX_NODE_WIDTH`. Past that, a binary search finds the longest prefix that
   fits with `…`.
4. A cut label keeps its full text in an SVG `<title>` (hover) and in
   `aria-label` (screen readers).
5. When a web font finishes loading (`document.fonts` `loadingdone`), the map
   is measured again and refitted, because until then canvas measured the
   fallback font.

**Trade-off.** Canvas and SVG text can differ by a fraction of a pixel. The
15px right padding absorbs that. Before mount (and on the server), the old
per-character estimate stands in for that one frame.

## 3. The workspace row scrolls with a mouse

**Problem.** The row of workspace avatars scrolls sideways with no scrollbar,
by design. A trackpad or a finger can swipe it. A mouse can't: its wheel only
turns vertically, and nothing on screen can be grabbed.

**Fix** (`useMouseScroll` in `src/components/docs/workspace/WorkspaceStrip.tsx`):

- **Wheel.** A vertical wheel over the row scrolls it sideways. At either end
  the event is let through, so the page around the row still scrolls.
  Sideways gestures (trackpad, Shift+wheel) and pinch-zoom are left to the
  browser.
- **Drag.** A mouse press that moves more than 5px becomes a drag (the
  pointer is captured and the cursor shows `grabbing`). The click that ends a
  drag is swallowed, so letting go over an avatar doesn't switch workspace.
  The flag clears on the next task, so a drag released outside the row can't
  eat a later click.
- **Snap** is touch-only (`coarse:snap-x`). Under a mouse it pulled the row
  back to the nearest avatar in the middle of a drag or wheel.

The sidebar divider between the current workspace and the row now spans the
full row height (`self-stretch`). The old fixed 32px bar was centred on
avatar-plus-name, so it sat below the avatars.
