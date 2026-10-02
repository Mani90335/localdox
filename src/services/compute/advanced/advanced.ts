// The advanced engine's client, loaded on demand (like compute.ts): its worker
// holds Pyodide and SymPy, an optional ~10 MB download the reader agrees to.
import { PYODIDE_BASE } from "virtual:pyodide-assets";
import { createComputeClient } from "../compute-client";
import type { AdvancedRequest, ComputeResult } from "../protocol";

/**
 * SymPy can't be interrupted (no SharedArrayBuffer without cross-origin
 * isolation), so a computation past this is stopped by terminating the
 * worker; the next one restarts Pyodide from the cache.
 */
export const ADVANCED_TIMEOUT_MS = 30_000;
/** Enough for ~11 MB on a slow connection; a stalled load fails instead of spinning. */
export const ADVANCED_LOAD_TIMEOUT_MS = 180_000;

export const advancedClient = createComputeClient<AdvancedRequest, ComputeResult>({
  createWorker: () => {
    const worker = new Worker(new URL("./advanced.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.postMessage({ type: "init", base: PYODIDE_BASE });
    return worker;
  },
  timeoutMs: ADVANCED_TIMEOUT_MS,
  loadTimeoutMs: ADVANCED_LOAD_TIMEOUT_MS,
  key: (request) => JSON.stringify([request.op, request.input.trim(), request.params ?? {}]),
  name: "advanced math engine",
});
