// The page's side of the offline service worker (`build/offline-sw.js`).
//
// Registration happens once per load, after the page has loaded, in production
// builds only. Everything the Settings panel shows comes from the worker
// itself: whether the app shell is cached, and how much of the optional
// features are. A preference is never taken as proof of offline readiness.

export const OFFLINE_WORKER_URL = "/sw.js";

export type OfflineProgress = { doneBytes: number; totalBytes: number };

export type OfflineStatus =
  /** No service worker support, or an insecure context. */
  | { state: "unsupported" }
  /** Development build: the dev server has no worker to register. */
  | { state: "disabled" }
  /** Registered; the first install is still caching the shell. */
  | { state: "preparing" }
  /** Registration or the shell install failed. */
  | { state: "failed"; message: string }
  | {
      state: "ready";
      version: string;
      /** The app shell is cached; a cold start works without a network. */
      shellReady: boolean;
      cachedFiles: number;
      totalFiles: number;
      cachedBytes: number;
      totalBytes: number;
      downloading: boolean;
    };

export class OfflineWorkerError extends Error {
  constructor(message: string, name = "OfflineWorkerError") {
    super(message);
    this.name = name;
  }
}

let registration: Promise<ServiceWorkerRegistration> | null = null;
let registrationError: string | null = null;

function supported(): boolean {
  return (
    typeof window !== "undefined" && window.isSecureContext === true && "serviceWorker" in navigator
  );
}

/** Build files the page fetched before the worker controlled it. */
function loadedUrls(): string[] {
  try {
    return performance.getEntriesByType("resource").map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Reports a first install that ended without an active worker. */
function watchInstall(result: ServiceWorkerRegistration) {
  const worker = result.installing;
  if (!worker || result.active) return;
  worker.addEventListener("statechange", () => {
    if (worker.state === "redundant" && !result.active && !result.waiting) {
      registrationError = "The app could not be saved to this device.";
      registration = null;
    }
  });
}

function register(): Promise<ServiceWorkerRegistration> {
  registrationError = null;
  const pending = navigator.serviceWorker
    .register(OFFLINE_WORKER_URL, { scope: "/" })
    .then((result) => {
      watchInstall(result);
      // Once a worker is active, let it keep what this load already fetched
      // (lazy chunks, fonts, workers), so a first visit is enough to go offline.
      void navigator.serviceWorker.ready.then((ready) =>
        ready.active?.postMessage({ type: "cache-loaded", urls: loadedUrls() }),
      );
      return result;
    });
  pending.catch((error: unknown) => {
    registrationError = error instanceof Error ? error.message : String(error);
    registration = null;
  });
  return pending;
}

/** Starts the offline worker for this origin. Safe to call more than once. */
export function registerOfflineShell(): void {
  if (!supported()) return;
  if (!import.meta.env.PROD) {
    // A production preview on the same host and port would otherwise keep
    // controlling the dev server's pages with its cached build.
    void navigator.serviceWorker
      .getRegistrations()
      .then((all) =>
        all
          .filter((entry) =>
            [entry.active, entry.waiting, entry.installing].some((worker) =>
              worker?.scriptURL.endsWith(OFFLINE_WORKER_URL),
            ),
          )
          .forEach((entry) => void entry.unregister()),
      )
      .catch(() => {});
    return;
  }
  if (registration) return;
  const start = () => {
    registration ??= register();
    registration.catch(() => {});
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

/** Asks the active worker a question over a private channel. */
function ask<T>(
  worker: ServiceWorker,
  message: { type: string },
  onProgress?: (progress: OfflineProgress) => void,
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const channel = new MessageChannel();
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        channel.port1.close();
        reject(new OfflineWorkerError("The offline worker did not respond."));
      }, timeoutMs);
    };
    channel.port1.onmessage = (event: MessageEvent) => {
      const data = event.data ?? {};
      if (data.type === "progress") {
        arm();
        onProgress?.({ doneBytes: data.doneBytes, totalBytes: data.totalBytes });
        return;
      }
      window.clearTimeout(timer);
      channel.port1.close();
      if (data.ok) resolve(data.result as T);
      else reject(new OfflineWorkerError(data.error?.message ?? "Unknown error", data.error?.name));
    };
    arm();
    worker.postMessage(message, [channel.port2]);
  });
}

async function currentRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  return (await navigator.serviceWorker.getRegistration("/")) ?? undefined;
}

export async function getOfflineStatus(): Promise<OfflineStatus> {
  if (!supported()) return { state: "unsupported" };
  if (!import.meta.env.PROD) return { state: "disabled" };
  const found = await currentRegistration();
  if (!found?.active) {
    if (registrationError) return { state: "failed", message: registrationError };
    return found && !found.installing && !found.waiting
      ? { state: "failed", message: "The app could not be saved to this device." }
      : { state: "preparing" };
  }
  const status = await ask<Omit<Extract<OfflineStatus, { state: "ready" }>, "state">>(
    found.active,
    { type: "status" },
  );
  return { state: "ready", ...status };
}

/** Tries registration (and so the shell install) again after a failure. */
export async function retryOfflineShell(): Promise<void> {
  if (!supported() || !import.meta.env.PROD) return;
  const found = await currentRegistration();
  if (found) {
    await found.update();
    return;
  }
  registration = register();
  await registration;
}

/**
 * Downloads every remaining app file, so features never opened online also
 * work offline. Joins a download already running in another tab or panel.
 */
export async function downloadOfflineFeatures(
  onProgress: (progress: OfflineProgress) => void,
): Promise<{ failed: number }> {
  const found = await currentRegistration();
  if (!found?.active) throw new OfflineWorkerError("Offline access isn't ready yet.");
  return ask<{ failed: number }>(found.active, { type: "download" }, onProgress, 60_000);
}
