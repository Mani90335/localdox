import { useEffect, useState } from "react";
import { Section, Group, Row } from "./primitives";
import { STORAGE_QUOTA_FRACTION, formatBytes } from "@/lib/workspace/storage-limits";

/** Fraction of the cap at which the Bin is worth pointing at. */
const STORAGE_PRESSURE = 0.8;

export function StorageSettings({
  onClearStorage,
  binCount,
  onEmptyBin,
}: {
  onClearStorage: () => void;
  /** How many documents the Bin is holding, for the pressure prompt. */
  binCount: number;
  onEmptyBin: () => void;
}) {
  const [usage, setUsage] = useState<number | null>(null);
  const [quota, setQuota] = useState<number | null>(null);

  useEffect(() => {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((estimate) => {
        setUsage(estimate.usage || 0);
        setQuota(estimate.quota || 0);
      });
    }
  }, []);

  const cap = quota != null ? Math.floor(quota * STORAGE_QUOTA_FRACTION) : null;
  const pct = usage != null && cap ? Math.min(100, (usage / cap) * 100) : null;
  // Warned before writes start failing, not after: at this point there is still
  // room to act, and the Bin is the one place holding files nobody asked to
  // keep.
  const underPressure = pct !== null && pct >= STORAGE_PRESSURE * 100 && binCount > 0;

  return (
    <div className="space-y-10">
      <Section title="Storage">
        <Group>
          <div className="px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-foreground">On this device</span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {usage !== null && cap !== null
                  ? `${formatBytes(usage)} of ${formatBytes(cap)}`
                  : "Calculating…"}
              </span>
            </div>
            {pct !== null && (
              <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${
                    underPressure ? "bg-amber-500" : "bg-primary"
                  }`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
            )}
          </div>
          {underPressure && (
            <Row
              label="Storage is nearly full"
              hint={`The Bin is holding ${binCount} file${binCount === 1 ? "" : "s"}. Emptying it frees that space now.`}
              control={
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Permanently delete ${binCount} file${binCount === 1 ? "" : "s"} in the Bin?`,
                      )
                    ) {
                      onEmptyBin();
                    }
                  }}
                  className="coarse:min-h-11 coarse:px-3 rounded-md px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  Empty Bin
                </button>
              }
            />
          )}
        </Group>
      </Section>

      <Section
        title="Danger zone"
        description="Permanently deletes every workspace, file, highlight, saved item and preference stored in this browser. This cannot be undone."
      >
        <Group>
          <Row
            label="Clear all data"
            control={
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      "Are you absolutely sure you want to clear ALL data on this device?",
                    )
                  ) {
                    onClearStorage();
                  }
                }}
                className="coarse:min-h-11 coarse:px-4 rounded-md px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
              >
                Clear
              </button>
            }
          />
        </Group>
      </Section>
    </div>
  );
}
