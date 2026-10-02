# The sidebar: expanded and slim

The sidebar has one job: keep you oriented in the workspace without pulling
your eyes off the document. Everything in it is judged against that. A control
that is always visible but rarely used is noise. A label that repeats what an
icon already says is noise. A control that moves when the sidebar changes
state costs you a hunt.

Code: `src/components/docs/workspace/Sidebar.tsx` (expanded, and the mobile
drawer), and the collapsed rail block in `src/components/docs/DocsApp.tsx`
(look for `Expand sidebar`).

## Anatomy

```
Expanded (288px)                         Slim (56px)
┌──────────────────────────────┐         ┌────┐
│ ▣  ←  →                    ⌕ │  ← 1    │ ▣  │  same spot, same glyph
│ ALL FILES ⌄                + │  ← 2    │ ⌕  │
│ › ▢ Research                 │         │ +  │
│   ▤ Product strategy 2026    │  ← 3    │    │
│   ▤ Onboarding guide       ⋮ │  (hover)│    │
│   …                          │         │ ✓  │  status, with the workspace
├──────────────────────────────┤         │ ⚙  │
│ MW My workspace ✓  A  CW   ⚙ │  ← 4    │ MW │
└──────────────────────────────┘         └────┘
```

1. **Chrome row.** Collapse, back, forward on the left; search (⌘K) on the
   right. One row. There is no wordmark: you already know which app you are
   in, and it was the loudest thing in the column while doing nothing.
2. **List header.** Which view is showing (All files / Grouped) and the `+`
   menu for creating or uploading.
3. **Rows.** Coloured type glyph and name. Nothing else at rest.
4. **Footer.** Current workspace, its save state, the other workspaces as
   one-tap avatars, then Settings. One row.

## The rules, and why

**The toggle never moves.** Both the expanded toggle and the rail's expand
button sit at x≈10px, y=10px, use the `PanelLeft` glyph and the same 36px
button (`CHROME_BUTTON`, exported from `Sidebar.tsx`). Before, the collapse
button was at the far right of the expanded sidebar and the rail's expand
button (a hamburger) was at the far left, so collapsing and re-expanding meant
crossing the column. This is Fitts's law: a target you just used should still
be under the pointer.

**Rows carry the name and nothing else at rest.** Each row used to end in a
column: `9m` for reading time on text, `CSV`/`JSON`/`HTML` on everything else.
The glyph's colour and shape already say the type (`file-glyphs.ts`), and the
column made every name hit its ellipsis earlier. Both facts now live in the
row's tooltip (`Product strategy 2026.md · 9 min read`), together with the
full file name the row truncates. The ⋮ menu appears on hover or keyboard focus
in the space the column used to take.

**Rhythm is 32px.** Rows went from about 42px (8px padding plus a 6px gap) to
32px (6px padding plus 1px). That is the density of Finder, Linear or VS Code
for a list you scan rather than read. On touch (`coarse:`) rows keep a 44px
minimum.

**Weight shows state, not structure.** Inactive rows are regular weight at 75%
foreground. The active row is medium weight, on a filled surface, with the
primary-coloured bar on its left edge. Folders use the same weight as files.
They used to be semibold, which made a folder look more important than the
document you are reading.

**A folder's count shows only when it is closed.** When it is open, its rows
are the count. When it is closed, the number is the only hint of what is
inside.

**Status sits with what it describes.** The save state is a fact about the
workspace ("everything here is stored on this device"), so it sits next to the
workspace name in the footer and at the bottom of the rail. In the rail it used
to sit among the action buttons, where a lone ✓ looked like one more thing to
click. When all is well it is a muted icon with an explanatory tooltip. It is
spelled out ("Not saved") only on failure (`compact={saveState !== "error"}`
in `DocsApp`). The full label is always present for screen readers.

**One footer row.** The footer used to be a pill-shaped avatar with a fused
gear and the name in 10px type underneath, then a divider and a strip of 44px
labelled circles. It is now one line. Other workspaces are 28px avatars
(`WorkspaceStrip size="sm"`): still one tap to switch (the Arc-style behaviour
is kept), but their names live in the tooltip and accessible label
(`A Archive`), not on screen.

## Accessibility

- Every icon-only control has an `aria-label` and a `title`. Tooltips show the
  shortcut where there is one (`Search docs (⌘K)`).
- Row ⋮ menus (`FileMenu`, `FolderMenu`) reveal on `focus-visible` and
  `group-focus-within`, not just hover. Before, keyboard users tabbed onto an
  invisible button. The folder menu now also stays visible on touch
  (`coarse:opacity-100`), as the file menu already did. Without it, a tablet
  could not reach folder actions.
- All interactive rows and buttons show a `focus-visible` ring.
- Small text (the empty-folder hint, the folder count) uses full
  `muted-foreground`, not a faded variant, so it keeps body-text contrast.

## Trade-offs

- **No brand in the docked sidebar.** The product name still appears in the
  tab title, in the mobile header, and in the header of the empty-workspace
  screen (`Header.tsx`), but not in the desktop reading layout. To bring it back,
  add it to the chrome row, not as a row of its own.
- **Reading time is a hover away.** If readers turn out to choose documents by
  length, it should come back as an opt-in view setting, not a permanent
  column.
- **Long workspace names truncate** once there are several other workspaces in
  the footer. The full name is in the tooltip and in Settings ▸ Workspace.

## Changing it

- New chrome control: use `CHROME_BUTTON` so it matches both states. If it
  belongs in the rail as well, put it in the same order in both.
- New per-row information: put it in the row's `title` first. Promote it to a
  visible column only if people need it to choose between rows at a glance.
- e2e tests depend on these labels: `Toggle sidebar`, `Expand sidebar`,
  `Settings` (exact, the rail), `Settings for <workspace>`, `A Archive`-style
  workspace buttons, `Options` on rows, and the `save-indicator` test id with
  its full text.
