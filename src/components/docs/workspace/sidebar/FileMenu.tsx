import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Check,
  CheckSquare,
  Columns2,
  FileText,
  Folder,
  FolderInput,
  GripVertical,
  MoreVertical,
  Pencil,
  Share2,
  SquarePen,
  Trash2,
  Upload,
} from "lucide-react";
import { FORMAT_LABEL, type ExportFormat } from "@/services/markdown-export";
import type { SidebarFolder } from "./types";
import { FORMAT_ICON } from "./file-glyphs";
import { preloadMarkdownEditor } from "../../editor/MarkdownEditorLazy";
import { isOutsideMenu, MenuFlyout, MenuItem, MenuPanel, MenuSeparator } from "./menu-primitives";

export function FileMenu({
  onEdit,
  onConvert,
  conversionDisabled,
  hasMarkdownCopy,
  onOpenMarkdown,
  onRename,
  onMoveToBin,
  folders = [],
  currentFolderId = null,
  onMoveToFolder,
  onAddToSplit,
  alreadyInSplit,
  onDownload,
  formats = ["original"],
  onShare,
  reordering,
  onToggleReorder,
  onSelectMode,
}: {
  /** Show this document in a column of its own, beside what is being read. */
  onAddToSplit?: () => void;
  /** Already has a column — the item says so rather than offering it twice. */
  alreadyInSplit?: boolean;
  /** Open this document in the editor. Absent for non-editable file types. */
  onEdit?: () => void;
  onConvert?: () => void;
  conversionDisabled?: boolean;
  hasMarkdownCopy?: boolean;
  onOpenMarkdown?: () => void;
  onRename: () => void;
  /**
   * Send the document to the Bin. Recoverable for 30 days, which is why this
   * replaced both "Archive" and "Delete" — two ways to make a file go away,
   * neither of which was reversible in an obvious place.
   */
  onMoveToBin: () => void;
  folders?: SidebarFolder[];
  currentFolderId?: string | null;
  onMoveToFolder?: (folderId: string | null) => void;
  /**
   * Write the document out in one of the offered formats.
   *
   * A format rather than a bare "download", because Word and PDF are the two
   * ways a document actually leaves this app and get the same reach as handing
   * back the original bytes did. `formats` says which ones this document can
   * produce — a spreadsheet the app only reads has no markdown to convert, so
   * it offers the original alone rather than three items that would fail.
   */
  onDownload?: (format: ExportFormat) => void;
  formats?: ExportFormat[];
  onShare?: () => void;
  reordering?: boolean;
  onToggleReorder?: () => void;
  onSelectMode?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Which flyout is open beside the menu, and the row it hangs off.
  const [submenu, setSubmenu] = useState<"move" | "export" | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Opening one flyout closes the other, and both close with the menu.
  const openFlyout = (which: "move" | "export") => (e: React.MouseEvent) => {
    e.stopPropagation();
    setAnchor(e.currentTarget as HTMLElement);
    setSubmenu((sub) => (sub === which ? null : which));
  };

  const canEdit = Boolean(onEdit);
  useEffect(() => {
    if (!open) {
      setSubmenu(null);
      setAnchor(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // An open menu with Edit in it is the moment to fetch the editor, so it is
    // usually there by the time Edit is chosen.
    if (canEdit) preloadMarkdownEditor();
    const onDown = (e: MouseEvent) => {
      if (isOutsideMenu(e.target as Node, rootRef.current)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, canEdit]);

  return (
    <div ref={rootRef} className="relative ml-0.5 flex shrink-0 items-center">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        /* From `md` up this reveals on hover, which on a touch tablet means it
           never reveals at all — every per-file action (edit, rename, share,
           remove) was unreachable there. `coarse:opacity-100` restores it, and
           the ::before pads the 24px glyph to a 44px target; growing the button
           itself would have re-flowed every row in the tree. */
        className={`relative flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground coarse:before:absolute coarse:before:-inset-2.5 coarse:before:content-[''] ${open ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100 coarse:opacity-100"}`}
        aria-label="Options"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <MenuPanel>
          {/* Working on the document itself. */}
          {onEdit && (
            <MenuItem
              icon={SquarePen}
              label="Edit"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onEdit();
              }}
            />
          )}
          <MenuItem
            icon={Pencil}
            label="Rename"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onRename();
            }}
          />
          {onAddToSplit && (
            <MenuItem
              icon={Columns2}
              label={alreadyInSplit ? "Already in split view" : "Add to split view"}
              disabled={alreadyInSplit}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onAddToSplit();
              }}
            />
          )}
          {onMoveToFolder && folders.length > 0 && (
            <MenuItem
              icon={FolderInput}
              label="Move to folder"
              onClick={openFlyout("move")}
              trailing={<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
            />
          )}

          {/* Getting the document out of the app. Share and Download were two
              rows saying the same thing — "a copy, elsewhere" — so they share
              one flyout instead of two slots in the top-level list. */}
          {(onShare || onDownload || onConvert || onOpenMarkdown) && (
            <>
              <MenuSeparator />
              <MenuItem
                icon={Upload}
                label="Export"
                onClick={openFlyout("export")}
                trailing={<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
              />
            </>
          )}

          {/* How the list behaves — not about this document at all, so it sits
              apart from the rows that are. */}
          {(onToggleReorder || onSelectMode) && <MenuSeparator />}
          {onToggleReorder && (
            <MenuItem
              icon={reordering ? Check : GripVertical}
              label={reordering ? "Done reordering" : "Reorder"}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onToggleReorder();
              }}
            />
          )}
          {onSelectMode && (
            <MenuItem
              icon={CheckSquare}
              label="Select"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onSelectMode();
              }}
            />
          )}

          <MenuSeparator />
          <MenuItem
            icon={Trash2}
            label="Move to Bin"
            destructive
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onMoveToBin();
            }}
          />
        </MenuPanel>
      )}

      {open && submenu === "move" && onMoveToFolder && (
        <MenuFlyout anchor={anchor}>
          <MenuItem
            icon={FileText}
            label="Top level"
            disabled={currentFolderId === null}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onMoveToFolder(null);
            }}
          />
          {folders.map((folder) => (
            <MenuItem
              key={folder.id}
              icon={Folder}
              label={folder.name}
              disabled={currentFolderId === folder.id}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onMoveToFolder(folder.id);
              }}
            />
          ))}
        </MenuFlyout>
      )}

      {open && submenu === "export" && (
        <MenuFlyout anchor={anchor}>
          {onOpenMarkdown && (
            <MenuItem
              icon={FileText}
              label="Open Markdown copy"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onOpenMarkdown();
              }}
            />
          )}
          {onConvert && (
            <MenuItem
              icon={FileText}
              label={hasMarkdownCopy ? "Convert again" : "Convert to Markdown"}
              disabled={conversionDisabled}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onConvert();
              }}
            />
          )}
          {onShare && (
            <MenuItem
              icon={Share2}
              label="Share link"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onShare();
              }}
            />
          )}
          {/* One row per format rather than a single "Download" that always
              produced the source file. Word and PDF are what a document is
              usually wanted as; the original stays last for the cases where the
              bytes themselves are the point. */}
          {onDownload &&
            formats.map((format) => (
              <MenuItem
                key={format}
                icon={FORMAT_ICON[format]}
                label={FORMAT_LABEL[format]}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onDownload(format);
                }}
              />
            ))}
        </MenuFlyout>
      )}
    </div>
  );
}
