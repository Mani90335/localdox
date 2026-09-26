import { useState } from "react";
import { FolderOpen, Check, PlusCircle } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";

interface WorkspaceLite {
  id: string;
  name: string;
}

interface Props {
  workspaces: WorkspaceLite[];
  currentId: string | null;
  onSwitch: (id: string) => void;
  onNew: (name: string) => void;
  onDelete: (id: string) => void;
  /** Opens settings, optionally on a given section. */
  onSettings?: (tab?: "workspace") => void;
}

/**
 * Mobile / portrait-tablet workspace control: an icon in the header that opens
 * a bottom sheet with the workspace picker plus management actions (new,
 * import, export, share, delete). Desktop/landscape use WorkspaceMenu instead.
 */
export function WorkspaceSheet({
  workspaces,
  currentId,
  onSwitch,
  onNew,
  onDelete,
  onSettings,
}: Props) {
  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const current = workspaces.find((workspace) => workspace.id === currentId);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onNew(name);
    setIsCreating(false);
    setNewName("");
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-border bg-background px-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground coarse:h-11 coarse:min-w-11"
        title="Workspaces"
        aria-label="Workspaces"
      >
        <FolderOpen className="h-4 w-4 shrink-0" />
      </button>

      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setIsCreating(false);
            setNewName("");
          }
        }}
        title="Your workspaces"
        className="max-h-[78dvh] lg:hidden"
      >
        <div className="space-y-2 pb-2">
          {(() => {
            const current = workspaces.find((w) => w.id === currentId);
            return (
              <>
                {current && (
                  <div className="group relative mb-1 flex items-center justify-between rounded-xl bg-accent px-3 py-2.5 transition-colors hover:bg-accent/80">
                    <button
                      onClick={() => {
                        setOpen(false);
                        onSwitch(current.id);
                      }}
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground focus-visible:outline-none"
                    >
                      {current.name}
                    </button>
                    <Check className="ml-2 h-4 w-4 shrink-0 text-foreground" />
                  </div>
                )}

                {/* The full list lives in workspace settings. Inline it grew
                    without bound and pushed the actions off a phone screen. */}
                {onSettings && (
                  <button
                    onClick={() => {
                      onSettings("workspace");
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none"
                  >
                    <FolderOpen className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    All workspaces
                  </button>
                )}

                {/* Creating a workspace belongs beside the workspaces it would
                    join, not only in the action strip below. */}
                {!isCreating && (
                  <button
                    onClick={() => {
                      setIsCreating(true);
                      setNewName("");
                    }}
                    className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none"
                  >
                    <PlusCircle className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    New workspace
                  </button>
                )}
              </>
            );
          })()}

          {isCreating && (
            <div className="border-t border-border pt-4">
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1">
                <input
                  type="text"
                  autoFocus
                  placeholder="Workspace name..."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") {
                      setIsCreating(false);
                      setNewName("");
                    }
                  }}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  Save
                </button>
              </div>
            </div>
          )}

          {/* Import, export and share live in workspace settings now — rare
              actions that do not need a permanent strip on a phone screen. */}
        </div>
      </BottomSheet>
    </>
  );
}
