import { useEffect, useRef, useState } from "react";
import { MoreVertical, CheckSquare, Share2, Download, Trash2 } from "lucide-react";
import { modKeyLabel } from "@/lib/platform/keyboard";
import { isOutsideMenu, MenuPanel } from "./menu-primitives";

export function GroupActionMenu({
  onShare,
  onMoveToBin,
  onDownload,
  onCancel,
  onSelectAll,
  allSelected,
}: {
  onShare?: () => void;
  onMoveToBin: () => void;
  onDownload?: () => void;
  onCancel: () => void;
  onSelectAll: () => void;
  allSelected: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  return (
    <div ref={rootRef} className="relative ml-0.5 flex shrink-0 items-center">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`flex h-6 w-6 items-center justify-center rounded text-primary transition-opacity hover:bg-accent hover:text-primary ${open ? "opacity-100" : "opacity-100"}`}
        aria-label="Group options"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <MenuPanel>
          {/* Also bound to Cmd/Ctrl+A while multi-select is on; shown here so
              the shortcut is discoverable rather than folklore. */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onSelectAll();
            }}
            disabled={allSelected}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <CheckSquare className="h-3 w-3" />
            Select All
            <kbd className="ml-auto text-3xs font-medium text-muted-foreground">{modKeyLabel}A</kbd>
          </button>
          <div className="my-1 h-px bg-border" />
          {onShare && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onShare();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent"
            >
              <Share2 className="h-3 w-3" />
              Share Selected
            </button>
          )}
          {onDownload && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onDownload();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent"
            >
              <Download className="h-3 w-3" />
              Download Selected
            </button>
          )}
          {/* One removal, not two. Binning is reversible for thirty days, so
              there is no separate "delete" to offer beside it. */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onMoveToBin();
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive hover:bg-accent/50"
          >
            <Trash2 className="h-3 w-3" />
            Move Selected to Bin
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onCancel();
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent"
          >
            Cancel Selection
          </button>
        </MenuPanel>
      )}
    </div>
  );
}
