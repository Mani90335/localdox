import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { persistence } from "@/lib/workspace/persistence";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { artifactUrl, fileReference, filePath } from "@/lib/markdown/media-references";
import type { MediaContext } from "@/lib/markdown/media-context";
import { toast } from "sonner";

interface Attachment {
  id: string;
  name: string;
  path: string;
  workspaceId: string;
  workspaceName: string;
}
const markdownFor = (file: Attachment) =>
  `![${file.name.replace(/[\\[\]]/g, "\\$&")}](${artifactUrl(fileReference(file.workspaceId, file.id))})`;
export function AttachmentPicker({
  open,
  onOpenChange,
  context,
  onInsert,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: MediaContext;
  onInsert: (markdown: string) => void;
  onImport?: (files: File[]) => Promise<MdFile[]>;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setQuery("");
    void (async () => {
      const summaries = await persistence.listWorkspaceSummaries();
      const result: Attachment[] = [];
      for (const summary of summaries) {
        const workspace = await persistence.getWorkspace(summary.id);
        const current = summary.id === context.workspaceId;
        const files = current
          ? (context.workspaceFiles ?? workspace?.files ?? [])
          : (workspace?.files ?? []);
        const folders = current
          ? (context.workspaceFolders ?? workspace?.folders ?? [])
          : (workspace?.folders ?? []);
        for (const file of files) {
          if (file.deletedAt || file.id === context.sourceFile?.id) continue;
          result.push({
            id: file.id,
            name: file.name,
            path: filePath(file, folders),
            workspaceId: summary.id,
            workspaceName: current ? (context.workspaceName ?? summary.name) : summary.name,
          });
        }
      }
      if (alive) setItems(result);
    })()
      .catch(() => {
        if (alive) toast.error("Could not load workspace attachments.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [
    open,
    context.workspaceId,
    context.workspaceFiles,
    context.workspaceFolders,
    context.workspaceName,
    context.sourceFile?.id,
  ]);
  const insert = (markdown: string) => {
    onInsert(markdown);
    onOpenChange(false);
  };
  const upload = async (files: File[]) => {
    if (!onImport || !files.length) return;
    setBusy(true);
    try {
      const imported = await onImport(files);
      if (imported.length && context.workspaceId)
        insert(
          imported
            .map((file) =>
              markdownFor({
                ...file,
                path: file.name,
                workspaceId: context.workspaceId!,
                workspaceName: context.workspaceName ?? "",
              }),
            )
            .join("\n\n"),
        );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not attach these files.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent onCloseAutoFocus={(event) => event.preventDefault()}>
        <DialogTitle>Attach media or files</DialogTitle>
        <DialogDescription>
          Upload files, choose from any workspace, or embed a web link. Uploaded files stay in
          Localdox.
        </DialogDescription>
        {onImport && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => input.current?.click()}
              className="rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
            >
              {busy ? "Importing…" : "Upload and attach files"}
            </button>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              aria-label="Upload attachments"
              onChange={(event) => {
                void upload(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </>
        )}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const parsed = new URL(url);
              if (!["https:", "http:"].includes(parsed.protocol)) throw new Error();
              insert(`![Media](<${parsed.href.replaceAll(">", "%3E")}>)`);
              setUrl("");
            } catch {
              toast.error("Enter a valid http or https media URL.");
            }
          }}
        >
          <input
            aria-label="Media web URL"
            placeholder="https://…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          />
          <button
            disabled={busy || !url.trim()}
            className="rounded-md border px-3 text-sm disabled:opacity-50"
          >
            Attach link
          </button>
        </form>
        <input
          aria-label="Search attachments"
          placeholder="Search files, folders, or workspaces…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        />
        <div className="max-h-72 overflow-y-auto" aria-label="Workspace attachments">
          {loading ? (
            <p role="status">Loading files…</p>
          ) : (
            items
              .filter((item) =>
                `${item.workspaceName}/${item.path}`.toLowerCase().includes(query.toLowerCase()),
              )
              .map((item) => (
                <button
                  key={`${item.workspaceId}/${item.id}`}
                  type="button"
                  disabled={busy}
                  onClick={() => insert(markdownFor(item))}
                  className="block w-full rounded-md px-3 py-2 text-left hover:bg-accent"
                >
                  <span className="block truncate text-sm">{item.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.workspaceName} / {item.path}
                  </span>
                </button>
              ))
          )}
          {!loading && !items.length && (
            <p className="text-sm text-muted-foreground">
              No other files yet. Upload an attachment to get started.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
