// Browser glue for stale-chunk recovery (B04). The decisions live in
// `stale-chunk.ts`; saving before a reload lives in `safe-reload.ts`.
//
// The failed import is *not* swallowed (no `preventDefault`): it rejects as it
// would without this handler, so the lazy boundary around the feature shows
// that it didn't load instead of the page failing somewhere unrelated on an
// `undefined` module. This handler only decides whether and when to reload.

import { toast } from "sonner";

import { prepareReload, reloadSafely } from "./safe-reload";
import {
  AUTO_RELOAD_KEY,
  failedAssetUrl,
  planRecovery,
  probeAsset,
  recoveryMessage,
} from "./stale-chunk";

const TOAST_ID = "chunk-recovery";

function lastAutoReload(): number | null {
  try {
    const value = Number(sessionStorage.getItem(AUTO_RELOAD_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function markAutoReload(at: number): boolean {
  try {
    sessionStorage.setItem(AUTO_RELOAD_KEY, String(at));
    return true;
  } catch {
    // Without a record the loop guard can't work, so don't reload by ourselves.
    return false;
  }
}

let running: Promise<void> | null = null;
let rerun: unknown = undefined;
let waitingForNetwork = false;
let reloading = false;

async function recover(error: unknown): Promise<void> {
  const probe = await probeAsset(failedAssetUrl(error, location.origin), {
    fetch: (url, init) => fetch(url, init),
    online: navigator.onLine,
  });
  // Save whatever is pending in any case: it's what makes a reload safe, and
  // it costs nothing if the reader ends up staying.
  const readiness = await prepareReload();
  const now = Date.now();
  const plan = planRecovery({
    probe,
    idle: readiness === "clean",
    lastAutoReloadAt: lastAutoReload(),
    now,
  });
  if (plan.kind === "reload" && markAutoReload(now)) {
    reloading = true;
    location.reload();
    return;
  }
  const reason = plan.kind === "offer" ? plan.reason : "updated";
  const { title, description } = recoveryMessage(reason);
  if (reason === "offline") {
    toast(title, {
      id: TOAST_ID,
      description,
      duration: Infinity,
      action: { label: "Try again", onClick: () => handleChunkError(error) },
    });
    // Check again by ourselves when the browser reports a connection.
    if (!waitingForNetwork) {
      waitingForNetwork = true;
      window.addEventListener(
        "online",
        () => {
          waitingForNetwork = false;
          handleChunkError(error);
        },
        { once: true },
      );
    }
    return;
  }
  toast(title, {
    id: TOAST_ID,
    description,
    duration: Infinity,
    action: { label: "Reload", onClick: () => void reloadSafely() },
  });
}

/**
 * Handle one failed chunk. Failures that arrive while one is being handled
 * (a feature is often several chunks) are folded into a single rerun.
 */
export function handleChunkError(error: unknown): void {
  if (reloading) return;
  if (running) {
    rerun = error;
    return;
  }
  running = recover(error)
    .catch((failure) => console.error("Chunk recovery failed", failure))
    .finally(() => {
      running = null;
      if (rerun !== undefined) {
        const next = rerun;
        rerun = undefined;
        handleChunkError(next);
      }
    });
}

export function installChunkRecovery(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    handleChunkError((event as Event & { payload?: unknown }).payload);
  });
}
