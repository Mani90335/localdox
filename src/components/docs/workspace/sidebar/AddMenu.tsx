import { useEffect, useRef, useState } from "react";
import { FilePlus, FolderPlus, PenTool, Plus, Upload, type LucideIcon } from "lucide-react";
import { isOutsideMenu, MenuItem, MenuPanel } from "./menu-primitives";

/**
 * The `+` menu: create a file, folder or board, or upload. Shared by the
 * expanded sidebar's list header and the collapsed rail, so both offer the
 * same options.
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
  const creates = [
    onCreateFile && { label: "File", icon: FilePlus, run: onCreateFile },
    onCreateFolder && { label: "Folder", icon: FolderPlus, run: onCreateFolder },
    onCreateBoard && { label: "Board", icon: PenTool, run: onCreateBoard },
  ].filter((item): item is { label: string; icon: LucideIcon; run: () => void } => !!item);

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
          {/* Two decisions, in the order a reader makes them: make something
              new, or bring something in. The three things you can make are
              peers, so they sit side by side as equal tiles rather than as a
              list that implies an order of importance. */}
          {creates.length > 0 && (
            <>
              <p className="px-1.5 pb-1.5 pt-0.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                Create
              </p>
              <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Create">
                {creates.map(({ label, icon: Icon, run }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      run();
                    }}
                    aria-label={`New ${label.toLowerCase()}`}
                    className="flex flex-col items-center gap-1.5 rounded-lg border border-border/70 px-1 py-2.5 text-xs font-medium text-foreground transition-colors hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Icon
                      className="h-4.5 w-4.5 text-muted-foreground"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                    {label}
                  </button>
                ))}
              </div>
              <div className="my-2 flex items-center gap-2 px-1" aria-hidden>
                <span className="h-px flex-1 bg-border" />
                <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
                  or
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
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
