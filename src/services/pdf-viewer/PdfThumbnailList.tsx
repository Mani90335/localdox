import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PDFPageProxy, RenderTask } from "pdfjs-dist";
import { windowRange } from "./pdf-outline";

const THUMB_WIDTH = 120;
/** The list's padding and the gap between thumbnails, in px (Tailwind p-3 / gap-2). */
const PADDING = 12;
const GAP = 8;
/** Thumbnails mounted beyond each edge of the view. */
const OVERSCAN = 3;
/** Row pitch until the first thumbnail is measured. */
const ESTIMATED_PITCH = 260;

/**
 * The sidebar's page-thumbnail list, windowed: only the thumbnails near the
 * view are mounted (every slot has the same 3:4 box, so each row's position
 * is exact), and each renders its canvas only once scrolled near the visible
 * area (`IntersectionObserver`). A 1,000-page book used to mount 1,000
 * buttons. A focused thumbnail stays mounted while it has focus, and the
 * list scrolls to the current page as it changes.
 */
export function PdfThumbnailList({
  numPages,
  currentPages,
  getPage,
  onSelect,
}: {
  numPages: number;
  currentPages: number[];
  getPage: (pageNumber: number) => Promise<PDFPageProxy>;
  onSelect: (pageNumber: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [pitch, setPitch] = useState(ESTIMATED_PITCH);
  const [range, setRange] = useState({ first: 0, last: -1 });

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next = windowRange(
      numPages,
      Math.max(0, el.scrollTop - PADDING),
      el.clientHeight,
      pitch,
      OVERSCAN,
    );
    setRange((prev) => (prev.first === next.first && prev.last === next.last ? prev : next));
  }, [numPages, pitch]);

  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      measure();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  // Keep whichever thumbnail has focus mounted, even scrolled out of view.
  const [focused, setFocused] = useState<number | null>(null);
  const indices = useMemo(() => {
    const list: number[] = [];
    for (let i = range.first; i <= Math.min(range.last, numPages - 1); i++) list.push(i);
    if (focused !== null && focused < numPages && !list.includes(focused)) {
      list.push(focused);
      list.sort((a, b) => a - b);
    }
    return list;
  }, [range, focused, numPages]);

  // The pitch follows the sidebar's width (a 3:4 box per thumbnail): read
  // from a mounted thumbnail as they mount or the width changes.
  useLayoutEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>("li");
    if (row && row.offsetHeight > 0 && row.offsetHeight + GAP !== pitch)
      setPitch(row.offsetHeight + GAP);
  }, [pitch, indices, width]);

  // Bring the current page into view when it changes (and on opening).
  const current = currentPages[0] ?? null;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || current === null || current > numPages) return;
    const top = PADDING + (current - 1) * pitch;
    const bottom = top + pitch - GAP;
    if (top < el.scrollTop) el.scrollTop = top - PADDING;
    else if (bottom > el.scrollTop + el.clientHeight)
      el.scrollTop = bottom + PADDING - el.clientHeight;
    measure();
  }, [current, numPages, pitch, measure]);

  return (
    <div ref={scrollRef} onScroll={measure} className="min-h-0 flex-1 overflow-y-auto">
      <ul
        ref={listRef}
        aria-label="Pages"
        className="relative"
        style={{ height: numPages > 0 ? PADDING * 2 + numPages * pitch - GAP : 0 }}
      >
        {indices.map((index) => {
          const pageNumber = index + 1;
          return (
            <li
              key={pageNumber}
              aria-posinset={pageNumber}
              aria-setsize={numPages}
              onFocus={() => setFocused(index)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setFocused((f) => (f === index ? null : f));
              }}
              className="absolute"
              style={{ top: PADDING + index * pitch, left: PADDING, right: PADDING }}
            >
              <PdfThumbnail
                pageNumber={pageNumber}
                active={currentPages.includes(pageNumber)}
                getPage={getPage}
                onSelect={onSelect}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PdfThumbnail({
  pageNumber,
  active,
  getPage,
  onSelect,
}: {
  pageNumber: number;
  active: boolean;
  getPage: (pageNumber: number) => Promise<PDFPageProxy>;
  onSelect: (pageNumber: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return;
    // The sidebar's own scroll container, not the page viewport — a thumbnail
    // scrolled out of the sidebar is still "in the viewport" as far as the
    // browser window is concerned.
    const root = el.closest(".overflow-y-auto");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { root, rootMargin: "200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Free the thumbnail's backing store as soon as it leaves the list.
  useEffect(() => {
    const canvas = canvasRef.current;
    return () => {
      if (!canvas) return;
      canvas.width = 0;
      canvas.height = 0;
    };
  }, []);

  useEffect(() => {
    if (!visible || rendered) return;
    let cancelled = false;
    void (async () => {
      try {
        const page = await getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const task = page.render({ canvas, viewport });
        renderTaskRef.current = task;
        await task.promise;
        if (!cancelled) setRendered(true);
      } catch (err) {
        if ((err as { name?: string } | undefined)?.name === "RenderingCancelledException") return;
        // A thumbnail that fails to render just stays a blank card — not
        // worth an error state for a page still readable via the book itself.
      }
    })();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [visible, rendered, pageNumber, getPage]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => onSelect(pageNumber)}
      aria-current={active}
      className={`flex w-full flex-col items-center gap-1 rounded-md p-1.5 transition-colors ${
        active ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-accent"
      }`}
    >
      <span className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-sm border border-border bg-white shadow-sm">
        <canvas ref={canvasRef} className="max-h-full max-w-full" />
      </span>
      <span className="text-2xs font-medium text-muted-foreground">{pageNumber}</span>
    </button>
  );
}
