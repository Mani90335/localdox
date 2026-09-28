import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Shown for as long as the workspace's latest changes are not on disk. It used
 * to be a toast, which could be dismissed or scrolled past while the status
 * quietly went back to normal; this stays until a write actually commits.
 */
export function SaveErrorBanner({
  message,
  retrying,
  onRetry,
  onExport,
}: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
  onExport: () => void;
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-(--z-modal) mx-auto max-w-xl rounded-lg border border-destructive/40 bg-popover p-4 text-popover-foreground shadow-lg"
    >
      <div className="flex gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold">Changes not saved</p>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={retrying} onClick={onRetry}>
              {retrying ? "Retrying…" : "Retry save"}
            </Button>
            <Button size="sm" variant="outline" onClick={onExport}>
              Export backup
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
