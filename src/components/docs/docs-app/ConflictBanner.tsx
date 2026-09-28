import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ConflictReason } from "@/lib/workspace/persistence";

/**
 * Shown when this tab and another changed the same document differently, or
 * another tab deleted the workspace. Changes to different documents merge on
 * their own (see merge.ts) and never reach this banner. It stays until the
 * reader decides: nothing in this tab is written in the meantime, and nothing
 * is lost by leaving it open.
 *
 * "Keep both" is the default because it cannot lose anything: this tab's
 * version becomes its own workspace and the other tab's version is untouched.
 */
export function ConflictBanner({
  reason,
  busy,
  onKeepBoth,
  onUseSaved,
}: {
  reason: ConflictReason;
  busy: boolean;
  onKeepBoth: () => void;
  onUseSaved: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const deleted = reason === "deleted";

  // Move focus here once, so a keyboard reader meets the decision; the banner
  // is not modal, so reading and scrolling keep working around it.
  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-(--z-modal) mx-auto max-w-xl rounded-lg border border-amber-500/40 bg-popover p-4 text-popover-foreground shadow-lg"
    >
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold">
              {deleted
                ? "This workspace was deleted in another tab"
                : "The same document changed in another tab"}
            </p>
            <p className="text-sm text-muted-foreground">
              {deleted
                ? "Your copy is still open here and has not been saved. Keep it as a workspace, or close it."
                : "Your changes here have not been saved, so nothing has been overwritten. Keep both versions, or load the saved one."}
            </p>
          </div>
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">
                {deleted ? "Close without keeping your copy?" : "Discard the changes in this tab?"}
              </span>
              <Button size="sm" variant="destructive" disabled={busy} onClick={onUseSaved}>
                {deleted ? "Close it" : "Discard mine"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button ref={primaryRef} size="sm" disabled={busy} onClick={onKeepBoth}>
                {deleted ? "Keep my copy" : "Keep both"}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(true)}>
                {deleted ? "Close it" : "Load saved version"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
