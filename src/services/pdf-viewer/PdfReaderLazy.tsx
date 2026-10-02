import { Suspense, lazy, useEffect, useState, type FC } from "react";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import type { PdfReaderState } from "./use-pdf-reader-state";

export interface PdfBookProps {
  file: MdFile;
  reader: PdfReaderState;
}

/**
 * pdf.js, loaded only when a PDF is actually opened — and only in a browser.
 *
 * Mirrors `src/services/board/BoardLazy.tsx` exactly, for the same two
 * reasons: `./PdfReader` pulls in pdf.js's canvas/worker/text-layer machinery
 * (no reader should pay for that just to open a markdown file), and
 * `GlobalWorkerOptions.workerSrc` plus a `Worker` construction must never run
 * during SSR/prerender. `PdfReader.tsx` itself further defers the actual
 * `import("pdfjs-dist")` to an effect — this lazy boundary alone is not
 * enough, since a static top-level `import("pdfjs-dist")` *inside*
 * `./PdfReader` would still make pdf.js a static edge in that module's own
 * graph once loaded. Belt and suspenders.
 */
const PdfReader = lazy(async () => {
  // Typed from the local `PdfBookProps` so both branches share one signature —
  // otherwise TypeScript narrows the union to the stub and rejects the props.
  const stub: FC<PdfBookProps> = () => null;
  if (import.meta.env.SSR) return { default: stub };

  const m = await import("./PdfReader");
  return { default: m.PdfReader };
});

/** Holds the page's footprint so the frame doesn't collapse while pdf.js loads. */
function PdfBookPlaceholder() {
  return (
    <div
      className="flex h-[calc(100dvh-var(--app-chrome-h)-3.5rem)] w-full items-center justify-center bg-muted/20"
      role="status"
      aria-label="Loading PDF"
    >
      <div className="h-[70%] w-[54%] max-w-md animate-pulse rounded-sm bg-background shadow-lg" />
    </div>
  );
}

export function PdfBook(props: PdfBookProps) {
  // Effects do not run during SSR or prerender, so this stays false there and
  // the lazy factory is never invoked on the server.
  const [inBrowser, setInBrowser] = useState(false);
  useEffect(() => setInBrowser(true), []);

  if (!inBrowser) return <PdfBookPlaceholder />;

  return (
    <Suspense fallback={<PdfBookPlaceholder />}>
      <PdfReader {...props} />
    </Suspense>
  );
}
