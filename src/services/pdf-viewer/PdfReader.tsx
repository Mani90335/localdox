import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { dataUrlToArrayBuffer } from "@/lib/markdown/document-utils";
import type { PdfBookProps } from "./PdfReaderLazy";
import { configurePdfWorker, PDFJS_CMAP_URL, PDFJS_STANDARD_FONT_URL } from "./pdf-worker";
import { BoundedPromiseCache } from "@/lib/bounded-promise-cache";
import { PdfPageArea } from "./PdfPageArea";
import { PdfSidebar } from "./PdfSidebar";
import { PdfSearchOverlay } from "./PdfSearchOverlay";
import { usePdfSearch } from "./use-pdf-search";
import { buildOutline, PdfOutlineResolver } from "./pdf-outline";
import type { PdfSearchMatch } from "./types";
import "./pdf-viewer.css";

type PdfjsModule = typeof import("pdfjs-dist");
type PdfTextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

/**
 * Page proxies kept warm. pdf.js keeps every proxy itself; what grows is each
 * rendered page's operator list and decoded resources, which `cleanup()`
 * frees (it declines while a render is still running).
 */
const PAGE_CACHE_ENTRIES = 12;
/**
 * Text content is only cached here (pdf.js doesn't), for the text layer and
 * repeated searches. Bounded by text items, not pages: one page can hold a
 * few items or tens of thousands. A search over a longer document re-extracts
 * the pages that didn't fit.
 */
const TEXT_CACHE_ENTRIES = 2000;
const TEXT_CACHE_MAX_ITEMS = 200_000;

function createPageCache() {
  return new BoundedPromiseCache<number, PDFPageProxy>({
    maxEntries: PAGE_CACHE_ENTRIES,
    onEvict: (page) => {
      try {
        page.cleanup();
      } catch {
        // Already destroyed with its document.
      }
    },
  });
}

function createTextCache() {
  return new BoundedPromiseCache<number, PdfTextContent>({
    maxEntries: TEXT_CACHE_ENTRIES,
    maxWeight: TEXT_CACHE_MAX_ITEMS,
    weigh: (content) => content.items.length,
  });
}

/** pdf.js itself, loaded once in the browser and configured to point its worker/cmaps/fonts at their published URLs. */
function usePdfjsModule() {
  const [pdfjs, setPdfjs] = useState<PdfjsModule | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [mod] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/web/pdf_viewer.css"),
      ]);
      if (cancelled) return;
      configurePdfWorker(mod);
      setPdfjs(mod);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return pdfjs;
}

/**
 * Loads the document and its outline (unresolved; see `pdf-outline.ts`),
 * and keeps bounded caches of page proxies + text content for the rest of
 * the reader.
 */
function usePdfDocument(
  file: PdfBookProps["file"],
  pdfjs: PdfjsModule | null,
  reader: PdfBookProps["reader"],
) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageCache] = useState(createPageCache);
  const [textCache] = useState(createTextCache);

  const setNumPagesRef = useRef(reader.setNumPages);
  const setOutlineRef = useRef(reader.setOutline);
  const setLoadErrorRef = useRef(reader.setLoadError);
  setNumPagesRef.current = reader.setNumPages;
  setOutlineRef.current = reader.setOutline;
  setLoadErrorRef.current = reader.setLoadError;

  useEffect(() => {
    if (!pdfjs) return;
    let alive = true;
    setPdfDocument(null);
    pageCache.clear();
    textCache.clear();
    setLoadErrorRef.current(null);

    const arrayBuffer = dataUrlToArrayBuffer(file.data);
    if (!arrayBuffer) {
      setLoadErrorRef.current(
        "This PDF is missing its file data. Remove it and upload the file again.",
      );
      return;
    }

    const loadingTask = pdfjs.getDocument({
      data: arrayBuffer,
      cMapUrl: PDFJS_CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: PDFJS_STANDARD_FONT_URL,
    });

    void (async () => {
      let doc: PDFDocumentProxy;
      try {
        doc = await loadingTask.promise;
        if (!alive) return;
        setPdfDocument(doc);
        setNumPagesRef.current(doc.numPages);
      } catch (err) {
        if (!alive) return;
        if (err instanceof pdfjs.PasswordException) {
          setLoadErrorRef.current("This PDF is password-protected and can't be opened here.");
        } else if (err instanceof pdfjs.InvalidPDFException) {
          setLoadErrorRef.current("This file isn't a valid PDF.");
        } else {
          setLoadErrorRef.current("This PDF could not be read in the browser.");
        }
        return;
      }
      try {
        const rawOutline = await doc.getOutline();
        if (alive) setOutlineRef.current(rawOutline ? buildOutline(rawOutline) : []);
      } catch {
        // A broken outline only costs the Contents tab; the pages still read.
        if (alive) setOutlineRef.current([]);
      }
    })();

    return () => {
      alive = false;
      void loadingTask.destroy();
    };
  }, [pdfjs, file.data, pageCache, textCache]);

  const getPage = useCallback(
    (pageNumber: number): Promise<PDFPageProxy> => {
      if (!pdfDocument) return Promise.reject(new Error("No PDF document loaded"));
      return pageCache.get(pageNumber, (n) => pdfDocument.getPage(n));
    },
    [pdfDocument, pageCache],
  );

  const getTextContent = useCallback(
    (pageNumber: number): Promise<PdfTextContent> => {
      return textCache.get(pageNumber, (n) => getPage(n).then((page) => page.getTextContent()));
    },
    [getPage, textCache],
  );

  // One per document, so its cache never answers for another file.
  const outlineResolver = useMemo(
    () => (pdfDocument ? new PdfOutlineResolver(pdfDocument) : null),
    [pdfDocument],
  );
  useEffect(() => () => outlineResolver?.dispose(), [outlineResolver]);

  return { pdfDocument, getPage, getTextContent, outlineResolver };
}

function PdfMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] w-full items-center justify-center p-6">
      <p className="max-w-sm text-center text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export function PdfReader({ file, reader }: PdfBookProps) {
  const pdfjs = usePdfjsModule();
  const { pdfDocument, getPage, getTextContent, outlineResolver } = usePdfDocument(
    file,
    pdfjs,
    reader,
  );
  const search = usePdfSearch({
    active: reader.searchOpen,
    numPages: reader.numPages,
    getTextContent,
    goToPage: reader.goToPage,
  });

  const matchesByPage = useMemo(() => {
    const map = new Map<number, PdfSearchMatch[]>();
    for (const match of search.matches) {
      const list = map.get(match.pageNumber);
      if (list) list.push(match);
      else map.set(match.pageNumber, [match]);
    }
    return map;
  }, [search.matches]);
  const activeMatch = search.matches[search.activeIndex] ?? null;

  if (reader.loadError) return <PdfMessage>{reader.loadError}</PdfMessage>;
  if (!pdfjs || !pdfDocument) {
    return (
      <div className="flex h-[calc(100dvh-7.5rem)] w-full items-center justify-center bg-muted/20">
        <div className="h-[70%] w-[54%] max-w-md animate-pulse rounded-sm bg-background shadow-lg" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] w-full overflow-hidden">
      {reader.sidebarOpen && outlineResolver && (
        <PdfSidebar reader={reader} getPage={getPage} outlineResolver={outlineResolver} />
      )}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <PdfPageArea
          reader={reader}
          pdfjs={pdfjs}
          getPage={getPage}
          getTextContent={getTextContent}
          matchesByPage={matchesByPage}
          activeMatch={activeMatch}
        />
        {reader.searchOpen && <PdfSearchOverlay reader={reader} search={search} />}
      </div>
    </div>
  );
}
