import { LoaderCircle } from "lucide-react";
import type { MdFile } from "@/lib/markdown/markdown-utils";

export function ConversionActions({
  file,
  files,
  runningId,
  onCancel,
  onOpen,
  onCompare,
}: {
  file: MdFile;
  files: MdFile[];
  runningId: string | null;
  onCancel: () => void;
  onOpen: (id: string) => void;
  onCompare: (id: string) => void;
}) {
  const source = file.derivedFrom?.sourceFileId
    ? files.find((f) => f.id === file.derivedFrom?.sourceFileId && !f.deletedAt)
    : undefined;
  const running = runningId === file.id;
  const button =
    "inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50 coarse:min-h-11";
  if (!file.derivedFrom && !running) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/50 px-4 py-2 text-xs text-muted-foreground"
      aria-label="Markdown conversion"
    >
      {file.derivedFrom ? (
        <>
          <span>
            Converted from {source?.name ?? file.derivedFrom.sourceName}
            {!source && " · Source unavailable"}
          </span>
          {source && (
            <>
              <button className={button} onClick={() => onOpen(source.id)}>
                Open original
              </button>
              <button className={button} onClick={() => onCompare(source.id)}>
                Compare
              </button>
            </>
          )}
          <span>Embedded images remain in the original.</span>
        </>
      ) : (
        <>
          {running && (
            <>
              <span role="status" className="inline-flex items-center gap-2">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Converting on this device…
              </span>
              <button className={button} onClick={onCancel}>
                Cancel
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
