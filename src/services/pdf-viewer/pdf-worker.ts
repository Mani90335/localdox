// A plain URL asset import — not a `pdfjs-dist` module import — so this stays
// safe at module top even inside the lazy, pdf.js-touching boundary. Same
// pattern as the `?url` wasm import in
// `src/services/diagrams/engine/engine.ts`.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/** Publicly served by `build/vite-pdfjs-assets.ts`. */
export const PDFJS_CMAP_URL = "/pdfjs/cmaps/";
export const PDFJS_STANDARD_FONT_URL = "/pdfjs/standard_fonts/";

let configured = false;

/** Idempotent: `PdfReader` may mount more than once per session. */
export function configurePdfWorker(pdfjs: typeof import("pdfjs-dist")): void {
  if (configured) return;
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  configured = true;
}
