import { useEffect, useRef, useState } from "react";
import type { PDFPageProxy, RenderTask } from "pdfjs-dist";

const THUMB_WIDTH = 120;

/**
 * The sidebar's page-thumbnail list. Each thumbnail renders itself only once
 * scrolled near the visible area (`IntersectionObserver`), so opening the
 * sidebar on a 400-page book doesn't render 400 canvases up front.
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
  return (
    <ul className="flex flex-col gap-2 p-3">
      {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => (
        <li key={pageNumber}>
          <PdfThumbnail
            pageNumber={pageNumber}
            active={currentPages.includes(pageNumber)}
            getPage={getPage}
            onSelect={onSelect}
          />
        </li>
      ))}
    </ul>
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
