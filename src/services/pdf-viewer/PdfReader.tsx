import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { dataUrlToArrayBuffer } from "@/lib/markdown/document-utils";
import type { PdfBookProps } from "./PdfReaderLazy";
import { configurePdfWorker, PDFJS_CMAP_URL, PDFJS_STANDARD_FONT_URL } from "./pdf-worker";
import { PdfPageArea } from "./PdfPageArea";
import { PdfSidebar } from "./PdfSidebar";
import { PdfSearchOverlay } from "./PdfSearchOverlay";
import { usePdfSearch } from "./use-pdf-search";
import type { PdfOutlineNode, PdfSearchMatch } from "./types";
import "./pdf-viewer.css";

type PdfjsModule = typeof import("pdfjs-dist");
type PdfTextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;
type RawOutline = NonNullable<Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>>;

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

async function resolveOutline(doc: PDFDocumentProxy, items: RawOutline): Promise<PdfOutlineNode[]> {
  return Promise.all(
    items.map(async (item) => ({
      title: item.title,
      pageNumber: await resolveDestPage(doc, item.dest),
      items: item.items?.length ? await resolveOutline(doc, item.items) : [],
    })),
  );
}

async function resolveDestPage(
  doc: PDFDocumentProxy,
  dest: RawOutline[number]["dest"],
): Promise<number | null> {
  if (!dest) return null;
  try {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    const ref = explicit?.[0];
    if (!ref) return null;
    return (await doc.getPageIndex(ref)) + 1;
  } catch {
    // A destination that doesn't resolve (a malformed PDF, a ref to a page
    // that isn't there) just becomes an inert outline entry, not an error.
    return null;
  }
}

/** Loads the document, resolves its outline, and caches per-page proxies + text content for the rest of the reader. */
function usePdfDocument(
  file: PdfBookProps["file"],
  pdfjs: PdfjsModule | null,
  reader: PdfBookProps["reader"],
) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const pageCache = useRef(new Map<number, Promise<PDFPageProxy>>());
  const textCache = useRef(new Map<number, Promise<PdfTextContent>>());

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
    pageCache.current.clear();
    textCache.current.clear();
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
      try {
        const doc = await loadingTask.promise;
        if (!alive) return;
        setPdfDocument(doc);
        setNumPagesRef.current(doc.numPages);
        const rawOutline = await doc.getOutline();
        if (!alive) return;
        setOutlineRef.current(rawOutline ? await resolveOutline(doc, rawOutline) : []);
      } catch (err) {
        if (!alive) return;
        if (err instanceof pdfjs.PasswordException) {
          setLoadErrorRef.current("This PDF is password-protected and can't be opened here.");
        } else if (err instanceof pdfjs.InvalidPDFException) {
          setLoadErrorRef.current("This file isn't a valid PDF.");
        } else {
          setLoadErrorRef.current("This PDF could not be read in the browser.");
        }
      }
    })();

    return () => {
      alive = false;
      void loadingTask.destroy();
    };
  }, [pdfjs, file.data]);

  const getPage = useCallback(
    (pageNumber: number): Promise<PDFPageProxy> => {
      if (!pdfDocument) return Promise.reject(new Error("No PDF document loaded"));
      let cached = pageCache.current.get(pageNumber);
      if (!cached) {
        cached = pdfDocument.getPage(pageNumber);
        pageCache.current.set(pageNumber, cached);
      }
      return cached;
    },
    [pdfDocument],
  );

  const getTextContent = useCallback(
    (pageNumber: number): Promise<PdfTextContent> => {
      let cached = textCache.current.get(pageNumber);
      if (!cached) {
        cached = getPage(pageNumber).then((page) => page.getTextContent());
        textCache.current.set(pageNumber, cached);
      }
      return cached;
    },
    [getPage],
  );

  return { pdfDocument, getPage, getTextContent };
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
  const { pdfDocument, getPage, getTextContent } = usePdfDocument(file, pdfjs, reader);
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
      {reader.sidebarOpen && <PdfSidebar reader={reader} getPage={getPage} />}
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
