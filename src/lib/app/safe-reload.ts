/**
 * Reloading the page without losing the reader's work.
 *
 * The page that owns documents (DocsApp) registers a guard: how to write
 * everything now, and whether anything would still be lost. Code that wants
 * to reload (today, stale-chunk recovery) asks here instead of calling
 * `location.reload()` directly, so no reload can race a pending save.
 *
 * Dependency-free so it runs under `node --test`.
 */

export interface ReloadGuard {
  /** Write every pending change now. Resolves false if storage refused it. */
  flush(): Promise<boolean>;
  /** Nothing unsaved remains on the page, so a reload changes nothing for the reader. */
  idle(): boolean;
  /**
   * A reload would lose changes outright: they are neither in storage nor in
   * the draft journal (which offers editor text back on the next load).
   */
  atRisk(): boolean;
}

/** Longest a reload waits for the guard's writes before deciding without them. */
export const FLUSH_TIMEOUT_MS = 5_000;

let guard: ReloadGuard | null = null;
/** Writes started by a guard that has since gone away (its page unmounted). */
const settling = new Set<Promise<unknown>>();
let confirmed = false;

/** Register the page's guard. Returns the unregister function. */
export function registerReloadGuard(next: ReloadGuard): () => void {
  guard = next;
  return () => {
    if (guard === next) guard = null;
  };
}

/**
 * Keep a write that outlives its page (an unmount's final save) in view, so a
 * reload that starts meanwhile still waits for it.
 */
export function holdReload(write: Promise<unknown>): void {
  const tracked = write.catch(() => {}).finally(() => settling.delete(tracked));
  settling.add(tracked);
}

function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export type ReloadReadiness =
  /** Nothing to lose. */
  | "clean"
  /** Only journalled editor text is outstanding; the next load offers it back. */
  | "recoverable"
  /** Changes that exist only in this tab would be lost. */
  | "at-risk";

/** Save what can be saved, then report what a reload would cost. */
export async function prepareReload(timeoutMs = FLUSH_TIMEOUT_MS): Promise<ReloadReadiness> {
  const current = guard;
  const pending = [...settling];
  const saved = current ? current.flush() : Promise.resolve(true);
  const writes = Promise.all([saved, ...pending]).then(([ok]) => ok);
  const ok = await within(writes, timeoutMs, false);
  if (!current) return ok ? "clean" : "at-risk";
  if (current.idle()) return "clean";
  return current.atRisk() || !ok ? "at-risk" : "recoverable";
}

/**
 * Set just before a reload the reader has already agreed to, so the page's
 * own `beforeunload` prompt doesn't ask the same question a second time.
 */
export function reloadConfirmed(): boolean {
  return confirmed;
}

export const AT_RISK_PROMPT =
  "Some changes couldn't be saved on this device and will be lost if Localdox reloads now. Reload anyway?";

/**
 * The reader asked to reload: save first, and ask before dropping anything
 * that couldn't be saved. Resolves false if they chose to stay.
 */
export async function reloadSafely({
  reload = () => window.location.reload(),
  confirm = (message: string) => window.confirm(message),
}: { reload?: () => void; confirm?: (message: string) => boolean } = {}): Promise<boolean> {
  const readiness = await prepareReload();
  if (readiness === "at-risk") {
    if (!confirm(AT_RISK_PROMPT)) return false;
    confirmed = true;
  }
  reload();
  return true;
}

/** Test seam: forget the registered guard and outstanding writes. */
export function resetReloadGuardForTests() {
  guard = null;
  settling.clear();
  confirmed = false;
}
