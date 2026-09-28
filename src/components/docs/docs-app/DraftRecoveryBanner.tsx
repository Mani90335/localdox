import { History } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface RecoveredDraft {
  fileId: string;
  fileName: string;
  updatedAt: number;
  /** The saved document changed (or went away) since; restoring makes a copy. */
  asCopy: boolean;
}

/**
 * Edits that were typed but never reached storage — the tab closed or crashed
 * inside the autosave window. Offered, not applied: the saved document may be
 * the version the reader actually wanted.
 */
export function DraftRecoveryBanner({
  drafts,
  onRestore,
  onDiscard,
}: {
  drafts: RecoveredDraft[];
  onRestore: (fileId: string) => void;
  onDiscard: (fileId: string) => void;
}) {
  if (drafts.length === 0) return null;
  return (
    <section
      aria-label="Recovered edits"
      className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-(--z-modal) mx-auto max-h-[50dvh] max-w-xl overflow-y-auto rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg"
    >
      <div className="flex gap-3">
        <History className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold">Unsaved edits recovered</p>
            <p className="text-sm text-muted-foreground">
              This device kept edits that were not saved before the page closed.
            </p>
          </div>
          <ul className="space-y-2">
            {drafts.map((draft) => (
              <li key={draft.fileId} className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{draft.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(draft.updatedAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    {draft.asCopy ? " · the saved version changed, so it opens as a copy" : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  aria-label={`Restore edits to ${draft.fileName}`}
                  onClick={() => onRestore(draft.fileId)}
                >
                  {draft.asCopy ? "Restore as copy" : "Restore"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Discard edits to ${draft.fileName}`}
                  onClick={() => onDiscard(draft.fileId)}
                >
                  Discard
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
