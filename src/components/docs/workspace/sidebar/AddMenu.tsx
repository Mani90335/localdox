import { useEffect, useRef, useState } from "react";
import { FilePlus, FolderPlus, PenTool, Plus, Upload } from "lucide-react";
import { isOutsideMenu, MenuItem, MenuPanel } from "./menu-primitives";

/**
 * The `+` menu: the three ways to add to a workspace. Shared by the expanded
 * sidebar's list header and the collapsed rail, so both offer the same options.
 */
export function AddMenu({
  onCreateFile,
  onCreateMermaid,
  onCreateBoard,
  onCreateFolder,
  onUpload,
  align = "right",
  className,
  buttonClassName,
}: {
  onCreateFile?: () => void;
  onCreateMermaid?: () => void;
  onCreateBoard?: () => void;
  onCreateFolder?: () => void;
  onUpload: () => void;
  align?: "left" | "right";
  className?: string;
  buttonClassName?: string;
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
    <div ref={rootRef} className={`relative shrink-0 ${className ?? ""}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Add to workspace"
        title="Add to workspace"
        className={
          buttonClassName ??
          "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground coarse:h-11 coarse:w-11"
        }
      >
        <Plus className="h-4 w-4" />
      </button>

      {open && (
        <MenuPanel align={align}>
          {onCreateFile && (
            <MenuItem
              icon={FilePlus}
              label="New file"
              onClick={() => {
                setOpen(false);
                onCreateFile();
              }}
            />
          )}
          {onCreateBoard && (
            <MenuItem
              icon={PenTool}
              label="New board"
              onClick={() => {
                setOpen(false);
                onCreateBoard();
              }}
            />
          )}
          {onCreateFolder && (
            <MenuItem
              icon={FolderPlus}
              label="New folder"
              onClick={() => {
                setOpen(false);
                onCreateFolder();
              }}
            />
          )}
          <MenuItem
            icon={Upload}
            label="Upload files"
            onClick={() => {
              setOpen(false);
              onUpload();
            }}
          />
        </MenuPanel>
      )}
    </div>
  );
}
