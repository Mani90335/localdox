import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import type { PdfReaderState } from "./use-pdf-reader-state";
import type { PdfSearchMatch } from "./types";
import { PdfPageCanvas } from "./PdfPageCanvas";
import { wheelDeltaPixels, wheelZoomFactor } from "./pdf-zoom";

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

  // The point of the pages at the middle of the view, as a fraction of their
  // size. When the pages change size (zoom), that point goes back to the
  // middle instead of the same scroll offsets landing on different content.
  const contentRef = useRef<HTMLDivElement>(null);
  const viewAnchor = useRef({ x: 0.5, y: 0.5, width: 0, height: 0 });
  const recordAnchor = () => {
    const el = containerRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const view = el.getBoundingClientRect();
    const rect = content.getBoundingClientRect();
    // The pages have resized and the observer below hasn't restored the view
    // yet: the current scroll position is stale (or the browser's clamp), and
    // the stored anchor is the one to keep.
    if (rect.width !== viewAnchor.current.width || rect.height !== viewAnchor.current.height)
      return;
    viewAnchor.current = {
      x: (view.left + view.width / 2 - rect.left) / rect.width,
      y: (view.top + view.height / 2 - rect.top) / rect.height,
      width: rect.width,
      height: rect.height,
    };
  };
  // Pages resize a render after `scale` changes (once the page proxy
  // resolves), so reading the layout now also catches a scroll whose event
  // hasn't been dispatched before the zoom.
  useLayoutEffect(() => {
    if (scale) recordAnchor();
  }, [scale]);
  useEffect(() => {
    const el = containerRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const observer = new ResizeObserver(() => {
      const { x, y } = viewAnchor.current;
      const view = el.getBoundingClientRect();
      const rect = content.getBoundingClientRect();
      el.scrollLeft += rect.left + x * rect.width - (view.left + view.width / 2);
      el.scrollTop += rect.top + y * rect.height - (view.top + view.height / 2);
      viewAnchor.current = { x, y, width: rect.width, height: rect.height };
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Only the focusable page surface owns these shortcuts. Controls, portals,
  // other readers and browser/selection shortcuts keep their own key handling.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target !== event.currentTarget ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (event.shiftKey && event.key !== "+")
    )
      return;
    switch (event.key) {
      case "ArrowRight":
      case "PageDown":
        reader.goNext();
        break;
      case "ArrowLeft":
      case "PageUp":
        reader.goPrev();
        break;
      case "Home":
        reader.goToPage(1);
        break;
      case "End":
        if (reader.numPages) reader.goToPage(reader.numPages);
        break;
      case "+":
      case "=":
        reader.zoomIn();
        break;
      case "-":
        reader.zoomOut();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    // Focus text/canvas clicks without cancelling native text selection. Leave
    // any nested annotation/form controls in charge of their own focus.
    const control = (event.target as Element).closest(
      'a, button, input, textarea, select, summary, [contenteditable], [tabindex], [role]:not([role="presentation"]):not([role="none"])',
    );
    if (!control || control === event.currentTarget) {
      event.currentTarget.focus({ preventScroll: true });
    }
  };

  // Ctrl/Cmd + wheel (trackpad pinch on most browsers) zooms the page instead
  // of the browser tab, matching `ImageViewer`'s existing pinch handling. The
  // zoom follows the size of the gesture (see `pdf-zoom.ts`); a pinch's burst
  // of small events is summed and applied once per frame.
  const zoomBy = reader.zoomBy;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let pending = 0;
    let frame = 0;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      pending += wheelDeltaPixels(event.deltaY, event.deltaMode);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const factor = wheelZoomFactor(pending);
        pending = 0;
        if (factor !== 1) zoomBy(factor);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(frame);
    };
  }, [zoomBy]);

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
      role="region"
      aria-label="PDF pages"
      aria-description="Use Left and Right or Page Up and Page Down to turn pages, Home and End to jump, and plus and minus to zoom."
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onScroll={recordAnchor}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="pdf-page-area relative flex min-h-[calc(100dvh-7.5rem)] flex-1 overflow-auto p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      {/* Centered with auto margins, not justify/align-center: those center an
          overflowing (zoomed) page by pushing its top and left edges out of
          the scrollable area, where no scrolling can reach them. */}
      <div ref={contentRef} className="m-auto flex items-center gap-8">
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
