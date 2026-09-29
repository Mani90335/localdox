/**
 * What to do when a lazily loaded part of the app fails to download.
 *
 * Every optional feature (viewers, Settings, diagrams, the AI panel…) is a
 * separate build chunk fetched on first use. That fetch can fail for three
 * different reasons, and each needs a different answer:
 *
 * - **Offline.** The chunk exists but can't be reached. Reloading can't help
 *   and, offline, only brings back the same shell. Say so and wait.
 * - **Updated.** A deployment replaced the build, so this tab asks for a
 *   hashed file that no longer exists (the host answers with its SPA shell,
 *   which the browser refuses to run as a script). Only a reload fixes it.
 * - **Failed.** The file is there now; the request was unlucky. A failed
 *   dynamic import is remembered by the page (and by `React.lazy`), so again
 *   only a reload makes the feature usable.
 *
 * A reload is only automatic when it can't cost the reader anything: the
 * workspace has been written and nothing is waiting to be. Otherwise it is
 * offered, and the app saves before it happens. At most one automatic reload
 * per tab per `AUTO_RELOAD_WINDOW_MS`, whatever the error message, so a
 * broken release can't loop.
 *
 * Pure and dependency-free, so it runs under `node --test`. The browser glue
 * is `install-chunk-recovery.ts`; the save side is `safe-reload.ts`.
 */

export type ProbeResult = "offline" | "missing" | "present" | "unknown";

export type Recovery =
  /** Save, then reload now: nothing on the page can be lost. */
  | { kind: "reload" }
  /** Tell the reader and let them choose when to reload. */
  | { kind: "offer"; reason: "offline" | "updated" | "failed" };

/** How long an automatic reload suppresses the next one in the same tab. */
export const AUTO_RELOAD_WINDOW_MS = 5 * 60_000;
/** Longest wait for the server to answer the probe; beyond it we count as offline. */
export const PROBE_TIMEOUT_MS = 4_000;
export const AUTO_RELOAD_KEY = "localdox:chunk-reload-at";

// Chromium: "Failed to fetch dynamically imported module: <url>"
// Firefox:  "error loading dynamically imported module: <url>"
// Safari:   "Importing a module script failed." (no URL)
// Vite CSS: "Unable to preload CSS for <path>"
const CHUNK_ERROR =
  /dynamically imported module|Importing a module script failed|Unable to preload CSS|error loading dynamically imported/i;

/** Whether an error is a failed chunk download rather than a bug in the code it holds. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return CHUNK_ERROR.test(message);
}

/**
 * The build file a chunk error names, as an absolute same-origin URL.
 * `null` when the message has none (Safari) or it points elsewhere.
 */
export function failedAssetUrl(error: unknown, origin: string): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = /((?:https?:\/\/[^\s'"]+)?\/assets\/[^\s'"?#]+)/.exec(message);
  if (!match) return null;
  try {
    const url = new URL(match[1], origin);
    return url.origin === new URL(origin).origin ? url.href : null;
  } catch {
    return null;
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "headers">>;

/**
 * Ask the server, bypassing every cache, whether the file is still deployed.
 *
 * HEAD skips the offline service worker (it only answers GET), so the answer
 * is the network's. A thrown fetch or no answer within the timeout means the
 * server can't be reached. A successful answer that isn't the file (an error
 * status, or the host's HTML fallback for unknown paths) means the file is
 * gone, i.e. a newer build is deployed.
 */
export async function probeAsset(
  url: string | null,
  {
    fetch: fetchImpl,
    online,
    timeoutMs = PROBE_TIMEOUT_MS,
  }: { fetch: FetchLike; online: boolean; timeoutMs?: number },
): Promise<ProbeResult> {
  if (!online) return "offline";
  if (!url) return "unknown";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return "missing";
    const type = response.headers.get("content-type") ?? "";
    return /text\/html/i.test(type) ? "missing" : "present";
  } catch {
    return "offline";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decide between an automatic reload and an offer.
 *
 * `idle`: the page has nothing unsaved (checked after a save was attempted).
 * `lastAutoReloadAt`: when this tab last reloaded itself for a chunk error.
 */
export function planRecovery({
  probe,
  idle,
  lastAutoReloadAt,
  now,
}: {
  probe: ProbeResult;
  idle: boolean;
  lastAutoReloadAt: number | null;
  now: number;
}): Recovery {
  if (probe === "offline") return { kind: "offer", reason: "offline" };
  const reason = probe === "missing" ? "updated" : "failed";
  const recentlyReloaded =
    lastAutoReloadAt !== null &&
    now - lastAutoReloadAt >= 0 &&
    now - lastAutoReloadAt < AUTO_RELOAD_WINDOW_MS;
  if (idle && !recentlyReloaded) return { kind: "reload" };
  return { kind: "offer", reason };
}

/** What the reader is told for an offered reload. */
export function recoveryMessage(reason: "offline" | "updated" | "failed"): {
  title: string;
  description: string;
} {
  switch (reason) {
    case "offline":
      return {
        title: "You're offline",
        description:
          "This part of Localdox hasn't been saved to this device yet. Reconnect, then reload to use it. Your documents are safe.",
      };
    case "updated":
      return {
        title: "Localdox has been updated",
        description: "Reload to finish loading this part of the app. Your changes are saved first.",
      };
    case "failed":
      return {
        title: "Part of Localdox didn't load",
        description: "Reload to try again. Your changes are saved first.",
      };
  }
}
