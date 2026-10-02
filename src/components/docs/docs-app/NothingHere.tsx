import { FileText } from "lucide-react";

/**
 * What the reading column shows when no document is open in it — after the
 * one on screen was moved to the Bin, say. The workspace still has documents
 * (an empty workspace gets `EmptyWorkspace` instead), so the only thing to
 * say is where to find them.
 */
export function NothingHere({ compact = false }: { compact?: boolean }) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center gap-3 px-6 text-center ${
        compact ? "py-16" : "min-h-[calc(100dvh-var(--app-chrome-h,0px)-4rem)] py-12"
      }`}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-muted/40 text-muted-foreground">
        <FileText className="h-5 w-5" strokeWidth={1.5} aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">Nothing here</p>
        <p className="text-xs text-muted-foreground">Pick a document from the sidebar.</p>
      </div>
    </div>
  );
}
