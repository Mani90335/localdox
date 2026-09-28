import { useEffect, useRef, useState } from "react";
import { FilePlus, FolderPlus, MoreVertical, Pencil, PenTool, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { isOutsideMenu, MenuPanel } from "./menu-primitives";

/** Three-dots menu on a folder row: create inside it, rename it, delete it. */
export function FolderMenu({
  onNewFile,
  onNewMermaid,
  onNewBoard,
  onNewFolder,
  onRename,
  onDelete,
}: {
  onNewFile?: () => void;
  onNewMermaid?: () => void;
  onNewBoard?: () => void;
  onNewFolder?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
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

  const item = (label: string, Icon: LucideIcon, run: () => void, destructive = false) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setOpen(false);
        run();
      }}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent ${
        destructive ? "text-destructive hover:bg-accent/50" : "text-foreground"
      }`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );

  return (
    <div ref={rootRef} className="relative ml-0.5 flex shrink-0 items-center">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground md:opacity-0 md:group-hover:opacity-100"
        aria-label="Folder options"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <MenuPanel>
          {onNewFile && item("New File here", FilePlus, onNewFile)}
          {onNewBoard && item("New Board here", PenTool, onNewBoard)}
          {onNewFolder && item("New Folder", FolderPlus, onNewFolder)}
          {(onNewFile || onNewBoard || onNewFolder) && (onRename || onDelete) && (
            <div className="my-1 h-px bg-border" />
          )}
          {onRename && item("Rename folder", Pencil, onRename)}
          {onDelete && item("Delete folder", Trash2, onDelete, true)}
        </MenuPanel>
      )}
    </div>
  );
}
