import { useEffect, useRef, useState } from "react";
import { formatBytes } from "@/lib/workspace/storage-limits";
import {
  downloadOfflineFeatures,
  getOfflineStatus,
  retryOfflineShell,
  type OfflineProgress,
  type OfflineStatus,
} from "@/lib/offline/offline-shell";

type Download =
  | { state: "idle" }
  | { state: "running"; progress: OfflineProgress | null }
  | { state: "partial"; failed: number }
  | { state: "error"; message: string };

/** How often to re-read the worker while the first install is still running. */
const PREPARING_POLL_MS = 1000;

function statusMessage(status: OfflineStatus | null): string {
  if (!status) return "Checking offline access…";
  switch (status.state) {
    case "unsupported":
      return "Offline access isn't available in this browser. Your documents stay on this device, but opening Localdox needs a connection.";
    case "disabled":
      return "Offline access is off in development builds.";
    case "preparing":
      return "Preparing offline access… Localdox is saving the app to this device.";
    case "failed":
      return "Offline access couldn't be set up. Opening Localdox needs a connection until it is.";
    case "ready":
      return status.shellReady
        ? "Ready offline. Localdox and your local documents open on this device without a connection."
        : "The offline copy of Localdox is incomplete. Reconnect and download it again.";
  }
}

function downloadMessage(download: Download): string | null {
  switch (download.state) {
    case "idle":
      return null;
    // Byte counts are shown by the progress bar, outside the live region, so
    // a screen reader hears the start and the outcome rather than every tick.
    case "running":
      return "Downloading for offline use…";
    case "partial":
      return `${download.failed} file${download.failed === 1 ? "" : "s"} couldn't be downloaded. Try again when you're connected.`;
    case "error":
      return download.message;
  }
}

/** Offline readiness, read from the service worker each time the panel opens. */
export function OfflineAccess() {
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const [download, setDownload] = useState<Download>({ state: "idle" });
  const [check, setCheck] = useState(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const read = async () => {
      let next: OfflineStatus;
      try {
        next = await getOfflineStatus();
      } catch (error) {
        next = { state: "failed", message: error instanceof Error ? error.message : "" };
      }
      if (cancelled) return;
      setStatus(next);
      if (next.state === "preparing") timer = window.setTimeout(read, PREPARING_POLL_MS);
      // Another panel or tab may already be downloading; follow its progress.
      if (next.state === "ready" && next.downloading) void startDownload();
    };
    void read();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [check]);

  async function startDownload() {
    setDownload({ state: "running", progress: null });
    let next: Download;
    try {
      const { failed } = await downloadOfflineFeatures((progress) => {
        if (mounted.current) setDownload({ state: "running", progress });
      });
      next = failed ? { state: "partial", failed } : { state: "idle" };
    } catch (error) {
      next = {
        state: "error",
        message:
          error instanceof Error && error.name === "QuotaExceededError"
            ? "There isn't enough storage space to download everything for offline use."
            : "The download stopped before it finished. Try again when you're connected.",
      };
    }
    if (!mounted.current) return;
    setDownload(next);
    setCheck((value) => value + 1);
  }

  async function retry() {
    setStatus({ state: "preparing" });
    try {
      await retryOfflineShell();
    } catch {
      // The status read below reports the failure.
    }
    if (mounted.current) setCheck((value) => value + 1);
  }

  const ready = status?.state === "ready" ? status : null;
  const remaining = ready ? ready.totalBytes - ready.cachedBytes : 0;
  const running = download.state === "running";
  const detail = downloadMessage(download);

  return (
    <div className="space-y-3 px-4 py-3.5">
      <div className="text-sm text-foreground">Offline access</div>
      <p
        role="status"
        aria-label="Offline access"
        aria-atomic="true"
        className="text-sm leading-relaxed text-muted-foreground"
      >
        {statusMessage(status)}
        {detail && <span className="mt-1 block">{detail}</span>}
      </p>
      {download.state === "running" && download.progress && download.progress.totalBytes > 0 && (
        <div className="space-y-1.5">
          <progress
            aria-label="Offline download"
            value={download.progress.doneBytes}
            max={download.progress.totalBytes}
            className="h-1 w-full overflow-hidden rounded-full accent-primary"
          />
          <p className="text-xs tabular-nums text-muted-foreground">
            {formatBytes(download.progress.doneBytes)} of{" "}
            {formatBytes(download.progress.totalBytes)}
          </p>
        </div>
      )}
      {ready && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {remaining > 0
            ? `Features you open while online, like PDFs or diagrams, are kept for offline use as you go. ${formatBytes(ready.cachedBytes)} of ${formatBytes(ready.totalBytes)} is stored so far.`
            : `Every feature is available offline (${formatBytes(ready.totalBytes)} stored).`}
        </p>
      )}
      {ready && (remaining > 0 || running) && (
        <button
          type="button"
          disabled={running}
          onClick={() => void startDownload()}
          className="min-h-11 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60"
        >
          {running ? "Downloading…" : `Download all features (${formatBytes(remaining)})`}
        </button>
      )}
      {status?.state === "failed" && (
        <button
          type="button"
          onClick={() => void retry()}
          className="min-h-11 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          Set up offline access again
        </button>
      )}
    </div>
  );
}
