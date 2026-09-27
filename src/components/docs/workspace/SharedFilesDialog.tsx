import { useEffect, useMemo, useState } from "react";
import { FolderPlus, Share2, FolderInput } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { fileLabel, getDocumentKind } from "@/lib/markdown/document-utils";
import { formatBytes } from "@/lib/workspace/storage-limits";
import type { PersistedFile } from "@/lib/workspace/persistence";

/**
 * What a `#share-files=` link opens with. The sender picked the files; the
 * recipient picks where they land — a brand new workspace, or the workspace
 * they already have open. Nothing is written until one of those is chosen, so
 * closing the dialog leaves the local library untouched.
 */
export interface SharedFilesDialogProps {
  open: boolean;
  files: PersistedFile[];
  /** Workspace the files were shared from — seeds the new-workspace name. */
  sourceName: string;
  /** Name of the open workspace, or null when there isn't one yet. */
  currentWorkspaceName: string | null;
  busy?: boolean;
  onDismiss: () => void;
  onImport: (target: "new" | "current", fileIds: string[], newName: string) => void;
}

export function SharedFilesDialog({
  open,
  files,
  sourceName,
  currentWorkspaceName,
  busy = false,
  onDismiss,
  onImport,
}: SharedFilesDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState(sourceName);

  // A fresh link replaces whatever the previous one had selected.
  useEffect(() => {
    setSelected(new Set(files.map((f) => f.id)));
    setName(sourceName);
  }, [files, sourceName]);

  const totalBytes = useMemo(
    () =>
      files
        .filter((f) => selected.has(f.id))
        .reduce((sum, f) => sum + (f.size ?? f.content.length), 0),
    [files, selected],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const ids = [...selected];
  const nothingPicked = ids.length === 0;

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onDismiss()}
      size="lg"
      icon={<Share2 className="h-4 w-4" />}
      title={`${files.length} shared file${files.length > 1 ? "s" : ""}`}
      description={`Shared from “${sourceName}”`}
      footer={
        <>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={busy || nothingPicked || !currentWorkspaceName}
            onClick={() => onImport("current", ids, name)}
            title={
              currentWorkspaceName
                ? `Add to ${currentWorkspaceName}`
                : "No workspace open — create one instead"
            }
            className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-background"
          >
            <FolderInput className="h-4 w-4" />
            <span className="truncate">
              {currentWorkspaceName ? `Add to “${currentWorkspaceName}”` : "Add to this workspace"}
            </span>
          </button>
          <button
            type="button"
            disabled={busy || nothingPicked}
            onClick={() => onImport("new", ids, name)}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            <FolderPlus className="h-4 w-4" />
            New workspace
          </button>
        </>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {files.map((file) => {
            const kind = file.kind ?? getDocumentKind(file.name, file.mimeType);
            const bytes = file.size ?? file.content.length;
            return (
              <li key={file.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/50">
                  <input
                    type="checkbox"
                    checked={selected.has(file.id)}
                    onChange={() => toggle(file.id)}
                    className="h-4 w-4 shrink-0 cursor-pointer rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {file.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {fileLabel(kind)} · {formatBytes(bytes)}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            New workspace name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Shared files"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
          <span className="mt-1.5 block text-xs text-muted-foreground">
            Used only when you choose “New workspace”.
          </span>
        </label>

        <p className="text-xs text-muted-foreground">
          {ids.length} of {files.length} selected · {formatBytes(totalBytes)}
        </p>
      </div>
    </Modal>
  );
}
