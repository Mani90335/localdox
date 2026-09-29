// The reader's compiler for interactive examples, loaded on demand. The
// worker URL lives here rather than in InteractiveBlock so the worker (and
// Babel inside it) stays an optional download: the offline shell precaches
// workers named by shell chunks.
import { createCompiler } from "./compiler-client";

export const compiler = createCompiler({
  createWorker: () =>
    new Worker(new URL("./compiler.worker.ts", import.meta.url), { type: "module" }),
});
