import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Download, Globe, Link2, Trash2 } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { fileLabel, getDocumentKind } from "@/lib/markdown/document-utils";
import { formatBytes } from "@/lib/workspace/storage-limits";
import { serializeWorkspace, type WorkspaceRecord } from "@/lib/workspace/persistence";
import {
  SHARE_HOST,
  buildWorkspaceShare,
  countAnnotations,
  serializeSharedFiles,
} from "@/lib/workspace/share";

/**
 * What the sender sees before a share link is made. A link means uploading the
 * documents to a third-party paste service, so this names the service, says
 * who can read the upload and that it can't be taken back, lists every file
 * that goes, and leaves the Bin and private annotations out unless they are
 * ticked. The payload uploaded is built from exactly what is shown here.
 */
export interface ShareRequest {
  /** `workspace` makes a `#share=` link; `files` a `#share-files=` one. */
  mode: "workspace" | "files";
  /** Snapshot of the workspace the files come from. */
  record: WorkspaceRecord;
  /** Files offered in the list; all of the workspace in `workspace` mode. */
  fileIds: string[];
}

export interface SharePreviewDialogProps {
  request: ShareRequest;
  onDismiss: () => void;
  /** Upload the payload and return the link. Throws on failure. */
  onUpload: (mode: ShareRequest["mode"], json: string) => Promise<string>;
  /** Copy the link; resolves false when the clipboard refused. */
  onCopy: (url: string) => Promise<boolean>;
  /** Save the same selection as a local, importable backup file. */
  onDownload: (json: string, name: string) => void;
}

type Phase =
  | { step: "review" }
  | { step: "uploading" }
  | { step: "done"; url: string; copied: boolean }
  | { step: "failed"; message: string };

export function SharePreviewDialog({
  request,
  onDismiss,
  onUpload,
  onCopy,
  onDownload,
}: SharePreviewDialogProps) {
  const { mode, record } = request;
  const candidates = useMemo(() => {
    const offered = new Set(request.fileIds);
    return record.files.filter((f) => offered.has(f.id));
  }, [record, request.fileIds]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeAnnotations, setIncludeAnnotations] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: "review" });

  // Binned files are listed so nothing is hidden, but never pre-ticked.
  useEffect(() => {
    setSelected(new Set(candidates.filter((f) => f.deletedAt == null).map((f) => f.id)));
    setIncludeAnnotations(false);
    setPhase({ step: "review" });
  }, [candidates]);

  const picked = candidates.filter((f) => selected.has(f.id));
  const annotationCount = mode === "workspace" ? countAnnotations(record, selected) : 0;
  // What travels: the text plus the base64 body of any binary file.
  const approxBytes = picked.reduce((sum, f) => sum + f.content.length + (f.data?.length ?? 0), 0);
  const binned = candidates.filter((f) => f.deletedAt != null).length;

  const build = () =>
    buildWorkspaceShare(record, {
      fileIds: picked.map((f) => f.id),
      includeAnnotations: mode === "workspace" && includeAnnotations,
    });

  const upload = async () => {
    const shared = build();
    const json =
      mode === "workspace"
        ? serializeWorkspace(shared)
        : serializeSharedFiles(shared.files, record.name);
    setPhase({ step: "uploading" });
    try {
      const url = await onUpload(mode, json);
      setPhase({ step: "done", url, copied: await onCopy(url) });
    } catch (e) {
      console.error(e);
      setPhase({
        step: "failed",
        message: `Nothing was shared: the upload to ${SHARE_HOST} failed. Check your connection, or share fewer or smaller files.`,
      });
    }
  };

  const download = () => onDownload(serializeWorkspace(build()), record.name);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const busy = phase.step === "uploading";
  const nothingPicked = picked.length === 0;
  const done = phase.step === "done";

  const secondary =
    "flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-background";
  const primary =
    "flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40";

  return (
    <Modal
      open
      onOpenChange={(o) => !o && !busy && onDismiss()}
      size="lg"
      icon={<Link2 className="h-4 w-4" />}
      title={
        done
          ? "Link ready"
          : mode === "workspace"
            ? `Share “${record.name}”`
            : `Share ${candidates.length === 1 ? `“${candidates[0]?.name}”` : `${candidates.length} files`}`
      }
      description={
        done
          ? "Anyone with this link can open the shared files."
          : "Review what leaves this device."
      }
      footer={
        done ? (
          <button type="button" onClick={onDismiss} className={primary}>
            Done
          </button>
        ) : (
          <>
            <button type="button" onClick={onDismiss} disabled={busy} className={secondary}>
              Cancel
            </button>
            <button
              type="button"
              onClick={download}
              disabled={busy || nothingPicked}
              title="Save the selected files as a .json file you can send yourself"
              className={secondary}
            >
              <Download className="h-4 w-4" />
              Download instead
            </button>
            <button
              type="button"
              onClick={() => void upload()}
              disabled={busy || nothingPicked}
              className={primary}
            >
              <Globe className="h-4 w-4" />
              {busy ? "Uploading…" : "Upload and copy link"}
            </button>
          </>
        )
      }
    >
      <div className="space-y-4 px-5 py-4">
        {phase.step === "done" ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                readOnly
                value={phase.url}
                aria-label="Share link"
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={async () => {
                  const copied = await onCopy(phase.url);
                  setPhase({ ...phase, copied });
                }}
                className={secondary}
              >
                {phase.copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {phase.copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p role="status" className="text-xs text-muted-foreground">
              {phase.copied
                ? "Copied to the clipboard."
                : "Couldn't reach the clipboard — select the link and copy it."}{" "}
              The upload stays on {SHARE_HOST}; Localdox can't delete it.
            </p>
          </div>
        ) : (
          <>
            <div
              role="note"
              className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground"
            >
              <p>
                The selected files are uploaded to{" "}
                <strong className="text-foreground">{SHARE_HOST}</strong>, a free public paste
                service not run by Localdox. The upload isn't end-to-end encrypted, and anyone who
                gets the link can open and copy it.
              </p>
              <p className="mt-1.5">
                There is no expiry or revoke control here: once uploaded, Localdox can't delete it.
                To keep files off the internet, use <em>Download instead</em>.
              </p>
            </div>

            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Files to share
              </legend>
              <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                {candidates.map((file) => {
                  const kind = file.kind ?? getDocumentKind(file.name, file.mimeType);
                  const inBin = file.deletedAt != null;
                  return (
                    <li key={file.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/50">
                        <input
                          type="checkbox"
                          checked={selected.has(file.id)}
                          onChange={() => toggle(file.id)}
                          disabled={busy}
                          className="h-4 w-4 shrink-0 cursor-pointer rounded border-border text-primary focus:ring-primary"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {file.name}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            {fileLabel(kind)} · {formatBytes(file.size ?? file.content.length)}
                            {inBin && (
                              <>
                                {" · "}
                                <Trash2 className="h-3 w-3" aria-hidden />
                                In Bin
                              </>
                            )}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {binned > 0 && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {binned} file{binned > 1 ? "s" : ""} in the Bin {binned > 1 ? "are" : "is"} left
                  out unless ticked.
                </p>
              )}
            </fieldset>

            {mode === "workspace" && (
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={includeAnnotations}
                  onChange={(e) => setIncludeAnnotations(e.target.checked)}
                  disabled={busy || annotationCount === 0}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border text-primary focus:ring-primary"
                />
                <span className="text-sm text-foreground">
                  Include my stars, notes and highlights
                  <span className="block text-xs text-muted-foreground">
                    {annotationCount === 0
                      ? "The selected files have none."
                      : `${annotationCount} on the selected files. Left out by default — they're private reading notes.`}
                  </span>
                </span>
              </label>
            )}

            <p className="text-xs text-muted-foreground">
              {picked.length} of {candidates.length} selected · about {formatBytes(approxBytes)} to
              upload. Folders go only where a shared file sits; reading history and layout stay
              here.
            </p>

            {phase.step === "failed" && (
              <p role="alert" className="text-xs font-medium text-destructive">
                {phase.message}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
