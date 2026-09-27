/**
 * Choosing which workspace a selection moves to.
 *
 * A move between workspaces is not like filing something into a folder: the
 * documents leave the workspace the reader is looking at, and land somewhere
 * they are not. So it gets a dialog rather than another row in a flyout — there
 * is a destination to pick, a count to state plainly, and a result that is not
 * visible when it finishes, which is exactly the shape of thing that should be
 * confirmed rather than done on a single click.
 *
 * The summary line is the important part. "Move 12 documents and 3 folders to
 * Research" is a sentence a reader can check before committing; "Move to
 * workspace" is not, and a selected folder quietly carrying its subtree is the
 * detail they would otherwise only discover afterwards.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, FolderInput, Loader2, X } from "lucide-react";

export interface WorkspaceChoice {
  id: string;
  name: string;
  docCount?: number;
}

export interface MoveSummary {
  files: number;
  folders: number;
}

export function MoveToWorkspaceDialog({
  open,
  summary,
  workspaces,
  currentWorkspaceId,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** What is about to move, already expanded to include folder contents. */
  summary: MoveSummary;
  workspaces: WorkspaceChoice[];
  currentWorkspaceId: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (workspaceId: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // The workspace being looked at is not a destination — moving documents to
  // where they already are is a no-op the reader would have to undo.
  const targets = workspaces.filter((workspace) => workspace.id !== currentWorkspaceId);

  useEffect(() => {
    if (!open) return;
    setSelected(targets.length === 1 ? targets[0].id : null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `targets` is derived from props each render; keying the reset on the
    // dialog opening is what is actually wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const parts = [
    summary.files > 0 ? `${summary.files} document${summary.files === 1 ? "" : "s"}` : null,
    summary.folders > 0 ? `${summary.folders} folder${summary.folders === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return createPortal(
    <div
      className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Move to workspace"
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-border px-4 py-3">
          <FolderInput className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground">Move to workspace</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {parts.length ? parts.join(" and ") : "Nothing selected"} will leave this workspace.
            </p>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto p-2">
          {targets.length === 0 ? (
            // The only honest thing to say. An empty list with a disabled
            // button reads as a bug rather than as "there is nowhere to move
            // this yet".
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              There is no other workspace to move these to. Create one first.
            </p>
          ) : (
            targets.map((workspace) => {
              const active = selected === workspace.id;
              return (
                <button
                  key={workspace.id}
                  onClick={() => setSelected(workspace.id)}
                  disabled={busy}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors disabled:opacity-60 ${
                    active ? "bg-accent" : "hover:bg-accent/60"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-3.5 w-3.5 shrink-0 rounded-full border transition-colors ${
                      active ? "border-primary bg-primary" : "border-border"
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {workspace.name}
                  </span>
                  {typeof workspace.docCount === "number" && (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {workspace.docCount}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected || busy || targets.length === 0}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowRight className="h-3.5 w-3.5" />
            )}
            Move
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
