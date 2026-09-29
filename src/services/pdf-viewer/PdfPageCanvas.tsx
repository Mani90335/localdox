import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PDFPageProxy, PageViewport, RenderTask } from "pdfjs-dist";
import type { PdfSearchMatch } from "./types";
import { createHighlightPainter } from "@/lib/markdown/highlight-registry";
import type { PdfRotation } from "./use-pdf-reader-state";
import {
  detailCovers,
  detectPdfDeviceClass,
  getLivePdfPages,
  pageBudgetPixels,
  planDetailArea,
  planPageRaster,
  registerLivePdfPage,
  subscribeLivePdfPages,
  type DetailPlan,
  type PageArea,
} from "./pdf-raster-budget";

type PdfjsModule = typeof import("pdfjs-dist");
type TextLayerInstance = InstanceType<PdfjsModule["TextLayer"]>;
type PdfTextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

/**
 * After a zoom, how long the page shows its old pixels stretched to the new
 * size before re-rasterizing. Rapid zoom steps then cost one render, not one
 * per step.
 */
const RERASTER_DELAY_MS = 150;
/** Scroll/resize settle time before the detail canvas follows the view. */
const DETAIL_DELAY_MS = 100;

interface CommittedRaster {
  page: PDFPageProxy;
  viewport: PageViewport;
  detailPixels: number;
}

function isCancellation(err: unknown) {
  return (err as { name?: string } | undefined)?.name === "RenderingCancelledException";
}

/** Frees a canvas's backing store now rather than whenever GC gets to it (Safari especially). */
function releaseCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
}

function createLayerCanvas(className: string) {
  const canvas = document.createElement("canvas");
  canvas.className = className;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.position = "absolute";
  return canvas;
}

function useLivePdfPageCount() {
  useEffect(() => registerLivePdfPage(), []);
  return useSyncExternalStore(subscribeLivePdfPages, getLivePdfPages, () => 1);
}

/**
 * One rendered page: canvases for the pixels, plus a real pdf.js text layer
 * (invisible, selectable spans positioned over them) for copy/search.
 *
 * Pixels are budgeted (see `pdf-raster-budget.ts`). A page that fits is one
 * canvas at device resolution. A page that doesn't (high zoom on a dense
 * screen) gets a lower-resolution full-page base canvas plus a detail canvas
 * at device resolution over just the part in view, re-rendered as the view
 * scrolls. New pixels are always drawn into a fresh canvas and swapped in
 * when complete; until then the previous canvas is stretched to the new size,
 * which is the zoom preview.
 *
 * Every render task is cancelled when superseded — required by pdf.js (a
 * canvas mid-render cannot be handed to a second `render()` call) and
 * reliably hit by fast page-flipping or React 19's double-invoked dev effects
 * alike.
 */
export function PdfPageCanvas({
  pageNumber,
  scale,
  rotation,
  pdfjs,
  getPage,
  getTextContent,
  matches,
  activeMatch,
}: {
  pageNumber: number;
  scale: number;
  rotation: PdfRotation;
  pdfjs: PdfjsModule;
  getPage: (pageNumber: number) => Promise<PDFPageProxy>;
  getTextContent: (pageNumber: number) => Promise<PdfTextContent>;
  matches: PdfSearchMatch[];
  activeMatch: PdfSearchMatch | null;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const textLayerElRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<TextLayerInstance | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseRotationRef = useRef<PdfRotation | null>(null);
  const detailCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detailAreaRef = useRef<DetailPlan | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [textLayerVersion, setTextLayerVersion] = useState(0);
  const [raster, setRaster] = useState<CommittedRaster | null>(null);
  const [device] = useState(detectPdfDeviceClass);
  const livePages = useLivePdfPageCount();
  const budgetPixels = pageBudgetPixels(device, livePages);

  // Release the committed canvases when the page leaves the screen.
  useEffect(
    () => () => {
      releaseCanvas(baseCanvasRef.current);
      releaseCanvas(detailCanvasRef.current);
      baseCanvasRef.current = null;
      detailCanvasRef.current = null;
      detailAreaRef.current = null;
    },
    [],
  );

  // Base canvas + text layer.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let task: RenderTask | null = null;
    let layer: TextLayerInstance | null = null;
    let pending: HTMLCanvasElement | null = null;
    setFailed(false);

    void (async () => {
      try {
        const page = await getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale, rotation });
        // Layout size and text-layer scale change now; the existing pixels
        // stretch to match until the new raster lands.
        setSize({ w: viewport.width, h: viewport.height });
        textLayerElRef.current?.style.setProperty("--total-scale-factor", String(scale));

        const dpr = window.devicePixelRatio || 1;
        const plan = planPageRaster(viewport.width, viewport.height, dpr, budgetPixels);
        const committed = baseCanvasRef.current;
        if (
          committed &&
          baseRotationRef.current === rotation &&
          pageRef.current?.getAttribute("data-rendered-scale") === String(scale) &&
          committed.width === plan.base.width &&
          committed.height === plan.base.height
        ) {
          // Only the budget moved (a page joined or left the screen) and
          // these pixels still fit it; the detail share may still change.
          setRaster((prev) =>
            prev && prev.detailPixels !== plan.detailPixels
              ? { ...prev, detailPixels: plan.detailPixels }
              : prev,
          );
          return;
        }

        const rotated = baseRotationRef.current !== null && baseRotationRef.current !== rotation;
        if (rotated) {
          // Stretched pixels from the other orientation would be wrong, not just soft.
          if (baseCanvasRef.current) baseCanvasRef.current.style.visibility = "hidden";
          releaseCanvas(detailCanvasRef.current);
          detailCanvasRef.current = null;
          detailAreaRef.current = null;
        }
        if (baseCanvasRef.current && !rotated) {
          await new Promise<void>((resolve) => {
            timer = setTimeout(resolve, RERASTER_DELAY_MS);
          });
          if (cancelled) return;
        }

        const host = canvasHostRef.current;
        if (!host) return;
        const canvas = createLayerCanvas("pdf-base-canvas");
        pending = canvas;
        canvas.width = plan.base.width;
        canvas.height = plan.base.height;
        Object.assign(canvas.style, { left: "0", top: "0", width: "100%", height: "100%" });
        const sx = plan.base.width / viewport.width;
        const sy = plan.base.height / viewport.height;
        task = page.render({
          canvas,
          viewport,
          transform: sx !== 1 || sy !== 1 ? [sx, 0, 0, sy, 0, 0] : undefined,
        });
        await task.promise;
        if (cancelled) return;

        // Behind any detail canvas, which stays aligned (it is positioned in
        // percentages) until the detail effect replaces it.
        host.prepend(canvas);
        pending = null;
        releaseCanvas(baseCanvasRef.current);
        baseCanvasRef.current = canvas;
        baseRotationRef.current = rotation;
        pageRef.current?.setAttribute("data-rendered-scale", String(scale));
        setRaster({ page, viewport, detailPixels: plan.detailPixels });

        const textLayerEl = textLayerElRef.current;
        if (!textLayerEl) return;
        // `TextLayer`'s CSS (`pdf_viewer.css`) sizes each span's font through
        // `calc(var(--total-scale-factor) * var(--font-height))`. pdf.js's own
        // reference viewer sets this on its page container; using the bare
        // `TextLayer` primitive here means that's this component's job.
        textLayerEl.style.setProperty("--total-scale-factor", String(scale));
        const textContent = await getTextContent(pageNumber);
        if (cancelled) return;
        textLayerRef.current?.cancel();
        textLayerEl.replaceChildren();
        layer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayerEl,
          viewport,
        });
        textLayerRef.current = layer;
        await layer.render();
        if (cancelled) return;
        layer = null;
        setTextLayerVersion((v) => v + 1);
      } catch (err) {
        if (cancelled) return;
        // Cancelling a render/text-layer task rejects its promise with this —
        // expected every time a page is superseded before it finishes, not a
        // real failure.
        if (isCancellation(err)) return;
        setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
      layer?.cancel();
      releaseCanvas(pending);
    };
  }, [pageNumber, scale, rotation, getPage, getTextContent, pdfjs, budgetPixels]);

  // Detail canvas: sharp pixels for the visible part of a page whose base
  // canvas is below device resolution.
  useEffect(() => {
    const pageEl = pageRef.current;
    const host = canvasHostRef.current;
    if (!raster || !pageEl || !host) return;
    if (raster.detailPixels <= 0) {
      releaseCanvas(detailCanvasRef.current);
      detailCanvasRef.current = null;
      detailAreaRef.current = null;
      return;
    }

    const { page, viewport, detailPixels } = raster;
    const pageSize = { width: viewport.width, height: viewport.height };
    const scrollRoot = pageEl.closest<HTMLElement>(".pdf-page-area");
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let task: RenderTask | null = null;
    let pending: HTMLCanvasElement | null = null;

    const visibleArea = (): PageArea | null => {
      const pageRect = pageEl.getBoundingClientRect();
      // Mid-zoom the layout already has the next size; that raster brings its own detail.
      if (Math.abs(pageRect.width - viewport.width) > 1) return null;
      const rootRect = scrollRoot?.getBoundingClientRect();
      const left = Math.max(rootRect?.left ?? 0, 0);
      const top = Math.max(rootRect?.top ?? 0, 0);
      const right = Math.min(rootRect?.right ?? Infinity, window.innerWidth);
      const bottom = Math.min(rootRect?.bottom ?? Infinity, window.innerHeight);
      return {
        minX: left - pageRect.left,
        minY: top - pageRect.top,
        maxX: right - pageRect.left,
        maxY: bottom - pageRect.top,
      };
    };

    const update = async () => {
      const visible = visibleArea();
      if (!visible) return;
      const current = detailAreaRef.current;
      if (current && detailCanvasRef.current && detailCovers(current, visible, pageSize)) return;
      const dpr = window.devicePixelRatio || 1;
      const area = planDetailArea(pageSize, visible, dpr, detailPixels);
      if (!area) return;

      task?.cancel();
      releaseCanvas(pending);
      const canvas = createLayerCanvas("pdf-detail-canvas");
      pending = canvas;
      canvas.width = area.canvas.width;
      canvas.height = area.canvas.height;
      Object.assign(canvas.style, {
        left: `${(area.minX * 100) / pageSize.width}%`,
        top: `${(area.minY * 100) / pageSize.height}%`,
        width: `${(area.width * 100) / pageSize.width}%`,
        height: `${(area.height * 100) / pageSize.height}%`,
      });
      const sx = area.canvas.width / area.width;
      const sy = area.canvas.height / area.height;
      const renderTask = page.render({
        canvas,
        viewport,
        transform: [sx, 0, 0, sy, -area.minX * sx, -area.minY * sy],
      });
      task = renderTask;
      try {
        await renderTask.promise;
      } catch {
        // Cancelled, or failed: the base canvas still shows the page.
        if (pending === canvas) releaseCanvas(canvas);
        return;
      }
      if (cancelled || pending !== canvas) return;
      pending = null;
      host.append(canvas);
      releaseCanvas(detailCanvasRef.current);
      detailCanvasRef.current = canvas;
      detailAreaRef.current = area;
      pageEl.setAttribute("data-detail-scale", String(viewport.scale));
    };

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void update(), DETAIL_DELAY_MS);
    };
    // A new raster (zoom, budget) needs new detail pixels even if the old
    // area still covers the view.
    detailAreaRef.current = null;
    void update();
    const scrollTarget: HTMLElement | Window = scrollRoot ?? window;
    scrollTarget.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
      releaseCanvas(pending);
      scrollTarget.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [raster]);

  // Exact ranges distinguish multiple hits within the same PDF text span.
  useEffect(() => {
    const layer = textLayerRef.current;
    if (!layer) return;
    const painter = createHighlightPainter();
    const groups: Record<string, Range[]> = { "pdf-search-hit": [], "pdf-search-hit-active": [] };
    for (const match of matches) {
      const isActive = match === activeMatch;
      for (const hit of match.highlights) {
        const node = layer.textDivs[hit.itemIndex]?.firstChild;
        if (
          !node ||
          node.nodeType !== Node.TEXT_NODE ||
          hit.charIndex + hit.length > (node.textContent?.length ?? 0)
        )
          continue;
        const range = document.createRange();
        range.setStart(node, hit.charIndex);
        range.setEnd(node, hit.charIndex + hit.length);
        groups[isActive ? "pdf-search-hit-active" : "pdf-search-hit"].push(range);
      }
      if (isActive)
        layer.textDivs[match.highlights[0]?.itemIndex]?.scrollIntoView({
          block: "center",
          inline: "center",
        });
    }
    painter.paint(groups);
    return painter.clear;
  }, [matches, activeMatch, textLayerVersion]);

  return (
    <div
      ref={pageRef}
      className="pdf-page-canvas relative shrink-0 overflow-hidden rounded-sm bg-white shadow-lg"
      style={size ? { width: size.w, height: size.h } : { width: 1, height: 1 }}
    >
      {failed ? (
        <div className="flex h-full min-h-40 w-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
          Page {pageNumber} could not be rendered.
        </div>
      ) : (
        <>
          <div ref={canvasHostRef} className="absolute inset-0" />
          <div ref={textLayerElRef} className="textLayer" />
        </>
      )}
    </div>
  );
}
