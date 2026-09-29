/**
 * The one question asked before binning: "this is open — close it and bin it?"
 *
 * Binning a document the reader is not looking at happens on a single click,
 * because it is recoverable from the Bin for thirty days. Binning the one on
 * screen is different: the page they are reading disappears under them. The
 * same applies to a folder, which leaves the list outright along with
 * everything inside it. Those two cases — and only those — stop here first.
 */

import { Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";

export interface BinRequest {
  fileIds: string[];
  folderIds: string[];
  /** Names of the documents open on screen right now, in any pane. */
  openNames: string[];
  /** Name of the lone document when exactly one is being binned. */
  singleName?: string;
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function MoveToBinDialog({
  request,
  onCancel,
  onConfirm,
}: {
  request: BinRequest | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const open = request !== null;
  const files = request?.fileIds.length ?? 0;
  const folders = request?.folderIds.length ?? 0;
  const openNames = request?.openNames ?? [];

  const what = request?.singleName
    ? `“${request.singleName}”`
    : [files ? plural(files, "document") : null, folders ? plural(folders, "folder") : null]
        .filter(Boolean)
        .join(" and ");

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onCancel()}
      size="sm"
      icon={<Trash2 className="h-4 w-4" />}
      // The title stays short so it never truncates; what is going is the
      // line under it, where a long document name can wrap.
      title="Move to the Bin?"
      description={what}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Move to Bin
          </button>
        </>
      }
    >
      <div className="space-y-2 px-5 py-4 text-sm text-muted-foreground">
        {openNames.length > 0 && (
          <p>
            {openNames.length === 1 ? (
              <>
                <span className="font-medium text-foreground">“{openNames[0]}”</span> is open right
                now. It will be closed.
              </>
            ) : (
              <>
                {plural(openNames.length, "document")} of these are open right now. They will be
                closed.
              </>
            )}
          </p>
        )}
        {folders > 0 && (
          <p>
            {folders === 1 ? "The folder is" : "The folders are"} removed, and the documents inside
            go to the Bin with the rest.
          </p>
        )}
        <p>Documents stay in the Bin for 30 days — restore them from Settings ▸ Storage.</p>
      </div>
    </Modal>
  );
}
