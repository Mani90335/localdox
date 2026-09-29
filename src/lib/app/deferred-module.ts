import { useEffect, useState } from "react";

/**
 * A code-split module that renders the moment it arrives.
 *
 * `React.lazy` + `<Suspense>` would do the loading, but once a Suspense
 * fallback has been shown React holds the real content back until ~300 ms have
 * passed (its reveal throttle, meant to stop several boundaries popping in one
 * by one). For a chunk that arrives in a few milliseconds — from the HTTP
 * cache or the offline cache — that throttle *is* the wait: reopening a
 * document took ~300 ms longer than when the reader was in the main bundle.
 * Holding the module in state has no such floor.
 *
 * A failed download is rethrown during render, so the nearest error boundary
 * (LazyBoundary's chunk handling) sees it exactly as it would a lazy failure.
 * This wrapper doesn't keep a failure: the next mount or `preload` calls the
 * loader again. (Whether the browser refetches a module it failed to load
 * varies, which is why recovery from a missing chunk is a reload.)
 */
export function deferredModule<M>(load: () => Promise<M>) {
  let loaded: M | undefined;
  let pending: Promise<M> | undefined;

  const get = () =>
    (pending ??= load().then(
      (mod) => (loaded = mod),
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    ));

  return {
    /** The module, downloading it on the first call. */
    load: get,

    /** Start the download without waiting for it. */
    preload() {
      get().catch(() => {
        // Whoever renders it reports the failure.
      });
    },

    /** The module, or undefined while it downloads. */
    useModule(): M | undefined {
      const [module, setModule] = useState(() => loaded);
      const [, fail] = useState<never>();
      useEffect(() => {
        if (module) return;
        let live = true;
        get().then(
          (next) => live && setModule(() => next),
          (error: unknown) =>
            live &&
            fail(() => {
              throw error;
            }),
        );
        return () => {
          live = false;
        };
      }, [module]);
      return module ?? loaded;
    },
  };
}
