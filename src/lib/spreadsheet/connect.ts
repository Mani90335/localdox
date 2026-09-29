// Loaded on demand by the spreadsheet viewer. The worker URL lives here rather
// than in the viewer so the worker (and SheetJS inside it) stays an optional
// download: the offline shell precaches workers named by shell chunks.
import {
  createLocalSpreadsheetClient,
  createWorkerSpreadsheetClient,
  type SpreadsheetClient,
} from "./client.ts";

/**
 * A client for one spreadsheet, backed by its own worker. Where workers can't
 * be created the engine runs on this thread instead. `onFailure` runs if the
 * worker dies later; its requests have then already rejected.
 */
export function connectSpreadsheet(onFailure: (reason: unknown) => void): SpreadsheetClient {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./spreadsheet.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return createLocalSpreadsheetClient(() => import("xlsx"));
  }
  return createWorkerSpreadsheetClient(worker, onFailure);
}
