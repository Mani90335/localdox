import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { WorkspaceStrip } from "./WorkspaceStrip";

interface WorkspaceLite {
  id: string;
  name: string;
}

interface Props {
  workspaces: WorkspaceLite[];
  currentId: string | null;
  onSwitch: (id: string) => void;
}

/**
 * Mobile / portrait-tablet workspace control: an icon in the header that opens
 * a bottom sheet with the same scrollable avatar strip the desktop dropdown
 * and expanded sidebar use, so switching looks and behaves identically
 * everywhere it appears. Creating and managing workspaces both live in
 * Settings now.
 */
export function WorkspaceSheet({ workspaces, currentId, onSwitch }: Props) {
  const [open, setOpen] = useState(false);

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

      <BottomSheet open={open} onOpenChange={setOpen} title="Switch workspace" className="lg:hidden">
        <div className="pb-2">
          <WorkspaceStrip
            workspaces={workspaces}
            currentId={currentId}
            onSelect={(id) => {
              setOpen(false);
              onSwitch(id);
            }}
          />
        </div>
      </BottomSheet>
    </>
  );
}
