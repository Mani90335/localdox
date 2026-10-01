// The Compute tab's engine client, loaded on demand. The worker URL lives here
// rather than in the panel so the worker (and the engine inside it) stays an
// optional download: the offline shell precaches workers named by shell
// chunks, and caches this one on first use.
import { createComputeClient } from "./compute-client";

export const computeClient = createComputeClient({
  createWorker: () =>
    new Worker(new URL("./compute.worker.ts", import.meta.url), { type: "module" }),
});
