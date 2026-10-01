import { useEffect, useState } from "react";
import { Section, Group, Row } from "./primitives";
import { capFromQuota, formatBytes } from "@/lib/workspace/storage-limits";
import { measureStoredBytes } from "@/lib/workspace/storage-budget";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { StorageProtection } from "./StorageProtection";
import { OfflineAccess } from "./OfflineAccess";

/** Fraction of the cap at which the Bin is worth pointing at. */
const STORAGE_PRESSURE = 0.8;

export function StorageSettings({
  onClearStorage,
  workspaceId,
  files,
  writing,
  binCount,
  onEmptyBin,
}: {
  onClearStorage: () => void;
  /** The open workspace, counted as this tab holds it (unsaved edits too). */
  workspaceId: string | null;
  files: MdFile[];
  /** Its notes and rough work, which count toward the same limit. */
  writing?: {
    notes: readonly { content: string }[];
    scratchpads: readonly { title: string; content: string }[];
  };
  /** How many documents the Bin is holding, for the pressure prompt. */
  binCount: number;
  onEmptyBin: () => void;
}) {
  // Documents, measured the way every import is checked (storage-budget.ts).
  const [usage, setUsage] = useState<number | null>(null);
  // The browser's own figures: its quota sets the cap; its usage covers the
  // whole origin (offline features, caches) and is only an estimate.
  const [browser, setBrowser] = useState<{ usage: number | null; quota: number | null }>();

  useEffect(() => {
    let alive = true;
    const estimate = navigator.storage?.estimate?.();
    if (!estimate) setBrowser({ usage: null, quota: null });
    estimate
      ?.then((e) => alive && setBrowser({ usage: e.usage ?? null, quota: e.quota ?? null }))
      .catch(() => alive && setBrowser({ usage: null, quota: null }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    measureStoredBytes(() => ({ id: workspaceId, files, ...writing }))
      .then((bytes) => alive && setUsage(bytes))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [workspaceId, files, writing]);

  const cap = browser?.quota ? capFromQuota(browser.quota) : null;
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
                {usage === null || browser === undefined
                  ? "Calculating…"
                  : cap !== null
                    ? `${formatBytes(usage)} of ${formatBytes(cap)}`
                    : formatBytes(usage)}
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
            {usage !== null && (
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                Documents in every workspace, Bin included.
                {browser?.usage != null &&
                  ` The browser estimates ${formatBytes(browser.usage)} for Localdox in all, including offline features.`}
              </p>
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
          <StorageProtection />
          <OfflineAccess />
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
