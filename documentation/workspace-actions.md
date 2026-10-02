# Where document actions live

Four small rules decide where a reader finds an action. Each came from the same
complaint: the same thing was offered in two places, or in a place that implied
the wrong scope.

## 1. The viewer header acts on the document on screen

**Before.** The header carried an **Export** dropdown and, for Markdown, a
**Download HTML + Media** button. The sidebar row's ⋮ ▸ Export offered the same
formats again. Two export surfaces, and a header crowded with labels.

**Now.** The header shows a pencil (**Edit**) and the per-view controls (reading
mode, zoom, fullscreen). All exporting is in ⋮ ▸ **Export**, one row per format
(`availableFormats` in `src/services/markdown-export/index.ts`). "Web page
(.html)" for a Markdown file is the old HTML + Media bundle: it goes through the
same `buildMarkdownHTML`, which zips local attachments.

**Flow.** `DocsApp` provides `editFile` through `EditFileContext`
(`src/components/docs/viewer/EditFileContext.ts`). `useEditAction(file)` returns
a handler only for kinds with an editor (`isEditableKind`) and only where a
provider exists. Previews have no provider, so they get no pencil. `ViewerFrame`
(`document-viewer/shared.tsx`) renders the pencil from it. The handler is the
sidebar's own Edit: it sets `startInEditFileId`, which every editing viewer
already listens for. A viewer that is mid-edit passes `editing`, and the pencil
hides. The Markdown viewer enters its editor directly (`enterEditMode`). The
Word and spreadsheet viewers used to add their own "✎ Edit" button beside it;
that was removed, so every viewer has exactly one edit control.

**Trade-off.** The header gives the reader no export while the sidebar is
closed. On a phone that means opening the drawer. We accepted this to keep one
export surface.

## 2. Rename lives in the editor, where there is one

Markdown and text documents are renamed from the **Document name** field that
`MarkdownEditor` puts above the source, so their ⋮ menu drops **Rename**.
Every other kind (PDF, image, JSON, spreadsheet, board…) has no name field in
its editor, or no editor at all, so it keeps the menu item. Removing it
everywhere would leave a PDF impossible to rename. The rule is in `Sidebar.tsx`
(`onRename={onEditFile && isTextual ? undefined : …}`).

## 3. Binning something on screen asks first, then leaves nothing on screen

**Mental model.** The Bin is recoverable for 30 days (`BIN_RETENTION_MS`), so
binning is normally one click. It asks first in two cases:

- **A document open on screen** (the active tab of any pane). It vanishes from
  under the reader.
- **A folder** (from multi-select). Folders have no Bin. The folder goes away,
  and its documents go to the Bin with everything else.

**Flow** (`DocsApp.tsx`):

```
⋮ Move to Bin / group "Move Selected to Bin"
  → requestBin(fileIds, folderIds)
      on screen or folders? ── yes → MoveToBinDialog → confirm → binNow
                             └─ no ─────────────────────────────→ binNow
binNow: files.deletedAt = now; drop folders (children lifted to top level);
        closeFileEverywhere(layout); panes that were *showing* a binned file
        get activeTabId = null
```

The last step matters. `closeTab` would otherwise switch the pane to another
tab from its history. Panes keep every document they have opened, with no tab
strip, so a different document would appear and look like the wrong file had
opened. With `activeTabId = null`, the column renders `NothingHere`.

**Failure modes.** `requestBin` reads the files and layout from `snapshotRef`,
so a bin fired from a stale closure still sees the current screen. A binned
document restored later whose folder was removed shows at the top level. The
sidebar already treats a file in an unknown folder as unfiled.

## 4. List modes are on right-click; the `+` menu is two decisions

**Right-click** (or long-press, which Radix `ContextMenu` gives touch) anywhere
in the file list offers **Select** and **Reorder**. These act on the list, so they
no longer only look like things you do to one file. They are still in the row's ⋮
menu for devices without either gesture. A right-click on a row
(`data-sidebar-file` / `data-sidebar-folder`) starts the selection with that
row ticked.

**Selection includes folders.** A ticked folder stands for itself and everything
under it (`selectedFolderTree`, `selectedFileIds`). Share and download apply to
its documents. Bin removes it and bins its documents (rule 3). Move to Workspace
moves the folder subtree (`planTransfer` already handled `folderIds`).

**Reorder includes folders.** In reorder mode a folder row drags
(`FOLDER_REORDER_DND`, its own type, so the re-parenting drop targets ignore it)
and `reorderFolder` moves it to the target's slot under the target's parent. It
refuses a drop into its own subtree. A document dropped beside a document in
another folder joins that folder. A document dropped on a folder row files into
it. Outside reorder mode, dragging still re-parents, as before.

**The `+` menu** (`sidebar/AddMenu.tsx`, shared by the sidebar and the collapsed
rail) is **Create** (File · Folder · Board as three equal tiles), an **or**
divider, then **Upload files**. The tiles are peers, so they sit side by side
rather than in a list that implies an order.
