import { useEffect, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import type { PdfReaderState } from "./use-pdf-reader-state";
import type { PdfSearchMatch } from "./types";
import { PdfPageCanvas } from "./PdfPageCanvas";

type PdfjsModule = typeof import("pdfjs-dist");
type PdfTextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

/** Gutter between the two pages of a spread, and breathing room around the book. */
const GAP = 32;
const PADDING = 24;

/**
 * The book itself: computes which 1-2 pages are on screen, fits them to the
 * available space, and wires up keyboard, wheel-zoom and swipe page-turning.
 * Paginated only — there is no continuous-scroll fallback, by design; this is
 * meant to read like a book, not an infinite feed.
 */
export function PdfPageArea({
  reader,
  pdfjs,
  getPage,
  getTextContent,
  matchesByPage,
  activeMatch,
}: {
  reader: PdfReaderState;
  pdfjs: PdfjsModule;
  getPage: (pageNumber: number) => Promise<PDFPageProxy>;
  getTextContent: (pageNumber: number) => Promise<PdfTextContent>;
  matchesByPage: Map<number, PdfSearchMatch[]>;
  activeMatch: PdfSearchMatch | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [baseSizes, setBaseSizes] = useState<Map<number, { w: number; h: number }>>(new Map());

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const visiblePages = reader.visiblePages;
  const visibleKey = visiblePages.join(",");
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      visiblePages.map(async (pageNumber) => {
        const page = await getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1, rotation: reader.rotation });
        return [pageNumber, { w: viewport.width, h: viewport.height }] as const;
      }),
    ).then((entries) => {
      if (!cancelled) setBaseSizes(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
    // `visibleKey` is the real dependency; `visiblePages` is a fresh array
    // every render even when its contents haven't changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, reader.rotation, getPage]);

  const fitScale = computeFitScale(
    visiblePages.map((n) => baseSizes.get(n)),
    containerSize,
  );
  const scale = fitScale ? fitScale * reader.zoom : null;

  // Arrow/Page keys flip pages; Home/End jump to the ends; +/- zoom. Ignored
  // while typing anywhere (the page jump box, search, etc.).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      switch (event.key) {
        case "ArrowRight":
        case "PageDown":
          event.preventDefault();
          reader.goNext();
          break;
        case "ArrowLeft":
        case "PageUp":
          event.preventDefault();
          reader.goPrev();
          break;
        case "Home":
          event.preventDefault();
          reader.goToPage(1);
          break;
        case "End":
          if (reader.numPages) {
            event.preventDefault();
            reader.goToPage(reader.numPages);
          }
          break;
        case "+":
        case "=":
          reader.zoomIn();
          break;
        case "-":
          reader.zoomOut();
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reader]);

  // Ctrl/Cmd + wheel (trackpad pinch on most browsers) zooms the page instead
  // of the browser tab, matching `ImageViewer`'s existing pinch handling.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (event.deltaY < 0) reader.zoomIn();
      else reader.zoomOut();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [reader]);

  // Horizontal swipe turns the page; a mostly-vertical drag is a scroll and is
  // left alone.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const end = event.changedTouches[0];
    if (!start || !end) return;
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) reader.goNext();
    else reader.goPrev();
  };

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="pdf-page-area relative flex min-h-[calc(100dvh-7.5rem)] flex-1 items-center justify-center gap-8 overflow-auto p-6"
    >
      {!scale ? (
        <div className="h-[70vh] w-[54vh] max-w-md animate-pulse rounded-sm bg-muted/40" />
      ) : (
        visiblePages.map((pageNumber) => (
          <PdfPageCanvas
            key={pageNumber}
            pageNumber={pageNumber}
            scale={scale}
            rotation={reader.rotation}
            pdfjs={pdfjs}
            getPage={getPage}
            getTextContent={getTextContent}
            matches={matchesByPage.get(pageNumber) ?? []}
            activeMatch={activeMatch?.pageNumber === pageNumber ? activeMatch : null}
          />
        ))
      )}
    </div>
  );
}

function computeFitScale(
  sizes: Array<{ w: number; h: number } | undefined>,
  container: { w: number; h: number },
): number | null {
  if (!container.w || !container.h || sizes.length === 0 || sizes.some((s) => !s)) return null;
  const known = sizes as Array<{ w: number; h: number }>;
  const gapTotal = known.length > 1 ? GAP * (known.length - 1) : 0;
  const totalWidth = known.reduce((sum, s) => sum + s.w, 0) + gapTotal;
  const maxHeight = Math.max(...known.map((s) => s.h));
  const availableWidth = Math.max(container.w - PADDING * 2, 1);
  const availableHeight = Math.max(container.h - PADDING * 2, 1);
  return Math.min(availableWidth / totalWidth, availableHeight / maxHeight);
}
