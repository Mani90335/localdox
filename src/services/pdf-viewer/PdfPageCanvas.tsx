import { useEffect, useRef, useState } from "react";
import type { PDFPageProxy, RenderTask } from "pdfjs-dist";
import type { PdfSearchMatch } from "./types";
import type { PdfRotation } from "./use-pdf-reader-state";

type PdfjsModule = typeof import("pdfjs-dist");
type TextLayerInstance = InstanceType<PdfjsModule["TextLayer"]>;
type PdfTextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

/**
 * One rendered page: a canvas for the pixels, plus a real pdf.js text layer
 * (invisible, selectable spans positioned over the canvas) for copy/search.
 *
 * Cancels its previous render/text-layer task before starting a new one —
 * required by pdf.js (a canvas mid-render cannot be handed to a second
 * `render()` call) and reliably hit by fast page-flipping or React 19's
 * double-invoked dev effects alike.
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerElRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<TextLayerInstance | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [textLayerVersion, setTextLayerVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    renderTaskRef.current?.cancel();
    textLayerRef.current?.cancel();
    textLayerRef.current = null;

    void (async () => {
      try {
        const page = await getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale, rotation });
        setSize({ w: viewport.width, h: viewport.height });

        const canvas = canvasRef.current;
        if (!canvas) return;
        // Backing store rendered at device pixels, CSS-sized at layout pixels —
        // otherwise retina screens get a blurry, upscaled page.
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.ceil(viewport.width * dpr);
        canvas.height = Math.ceil(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const task = page.render({
          canvas,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        renderTaskRef.current = task;
        await task.promise;
        if (cancelled) return;

        const textLayerEl = textLayerElRef.current;
        if (!textLayerEl) return;
        textLayerEl.replaceChildren();
        // `TextLayer`'s CSS (`pdf_viewer.css`) sizes each span's font through
        // `calc(var(--total-scale-factor) * var(--font-height))`. pdf.js's own
        // reference viewer sets this on its page container; using the bare
        // `TextLayer` primitive here means that's this component's job.
        textLayerEl.style.setProperty("--total-scale-factor", String(scale));
        const textContent = await getTextContent(pageNumber);
        if (cancelled) return;
        const layer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayerEl,
          viewport,
        });
        textLayerRef.current = layer;
        await layer.render();
        if (cancelled) return;
        setTextLayerVersion((v) => v + 1);
      } catch (err) {
        if (cancelled) return;
        // Cancelling a render/text-layer task rejects its promise with this —
        // expected every time a page is superseded before it finishes, not a
        // real failure.
        if ((err as { name?: string } | undefined)?.name === "RenderingCancelledException") return;
        setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      textLayerRef.current?.cancel();
    };
  }, [pageNumber, scale, rotation, getPage, getTextContent, pdfjs]);

  // Re-applied whenever the search state or the text layer itself changes,
  // without re-rendering the layer — this is cheap DOM class toggling over
  // spans pdf.js already positioned correctly.
  useEffect(() => {
    const layer = textLayerRef.current;
    if (!layer) return;
    const divs = layer.textDivs;
    for (const div of divs) div.classList.remove("pdf-search-hit", "pdf-search-hit-active");
    for (const match of matches) {
      const isActive = match === activeMatch;
      for (const highlight of match.highlights) {
        divs[highlight.itemIndex]?.classList.add(
          isActive ? "pdf-search-hit-active" : "pdf-search-hit",
        );
      }
      if (isActive) {
        divs[match.highlights[0]?.itemIndex]?.scrollIntoView({
          block: "center",
          inline: "center",
        });
      }
    }
  }, [matches, activeMatch, textLayerVersion]);

  return (
    <div
      className="pdf-page-canvas relative shrink-0 overflow-hidden rounded-sm bg-white shadow-lg"
      style={size ? { width: size.w, height: size.h } : { width: 1, height: 1 }}
    >
      {failed ? (
        <div className="flex h-full min-h-40 w-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
          Page {pageNumber} could not be rendered.
        </div>
      ) : (
        <>
          <canvas ref={canvasRef} />
          <div ref={textLayerElRef} className="textLayer" />
        </>
      )}
    </div>
  );
}
