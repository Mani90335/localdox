# Markdown source editor

The source editor uses CodeMirror for Markdown and fenced-code highlighting, line numbers, section folding, line wrapping, and undoable formatting. It loads with the existing lazy editor rather than the reader shell.

`MarkdownSource` owns the editing document and exposes selection, source jumps, formatting, and focus through a ref. Each edit reports its text to `MarkdownEditor`, which retains the existing file-specific draft, journal, autosave, save shortcut, and cancel behavior. Formatting is a minimal editor transaction so it preserves folded sections and creates its own undo step without removing recently typed text. Switching files remounts the source field.

Upstream's shared math and shortcut helpers and open-editor tracking remain in use. Inspect source selects the requested range and unfolds any enclosing section; the Notes panel continues to link to upstream's source addresses. A source jump scrolls within the editor, and selection remains available when opening an attachment or equation picker.

The dependency and lockfile changes add only the editor packages. First editing adds 193.2 KiB gzip in the measured production journey, bounded by a 210 KiB ceiling; the bundle gate checks that CodeMirror and Lezer stay out of the startup shell. Browser coverage checks highlighting, folding, wrapping, formatting, undo, save and cancel, as well as source inspection and note links after edits. When investigating a save failure, inspect the draft's file identity and the existing journal before changing the source field.
