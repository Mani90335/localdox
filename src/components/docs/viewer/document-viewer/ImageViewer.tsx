import { useBinaryUrl } from "@/hooks/use-binary-url";
import { useEffect, useRef, useState } from "react";
import { Maximize, Minimize, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { ESCAPE_DEPTH, useNavEscape } from "@/hooks/use-nav-history";
import { IconBtn } from "../viewer-controls";
import { ErrorState, ViewerFrame } from "./shared";
import type { Props } from "./shared";

export function ImageViewer({
  file,
  isBookmarked,
  onToggleBookmark,
  prevFile,
  nextFile,
  onNavFile,
  onOpenPalette,
}: Props) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  // Back steps out of fullscreen first, leaving the reader on the image rather
  // than on whatever they were looking at before it.
  useNavEscape(isFullscreen, () => void document.exitFullscreen?.(), ESCAPE_DEPTH.mode);

  // Use a mounted Blob URL; fall back to inline text (data:/http) so legacy
  // saves and linked images still render. SVG, GIF, WebP, AVIF, etc. all ride
  // the browser's native <img> decoder — no format-specific handling needed.
  const src =
    useBinaryUrl(file.data) ||
    (/^(data:|https?:)/.test(file.content.trim()) ? file.content.trim() : "");

  const reset = () => {
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  };
  useEffect(reset, [file.id]);

  const clampZoom = (value: number) => Math.min(8, Math.max(0.1, value));
  const zoomBy = (factor: number) =>
    setZoom((z) => {
      const next = clampZoom(z * factor);
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });

  // Zooming is the +/− buttons' job only. Pinch (ctrl/meta+wheel on trackpads,
  // gesture* in Safari) is swallowed rather than acted on: left alone it becomes
  // a browser page zoom that persists after leaving the viewer. Native
  // non-passive listeners — React's onWheel is passive, so preventDefault there
  // is a no-op.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    const swallow = (event: Event) => event.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", swallow);
    el.addEventListener("gesturechange", swallow);
    el.addEventListener("gestureend", swallow);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", swallow);
      el.removeEventListener("gesturechange", swallow);
      el.removeEventListener("gestureend", swallow);
    };
  }, [src, broken]);
  const onPointerDown = (event: React.PointerEvent) => {
    if (zoom <= 1) return;
    (event.target as Element).setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({ x: drag.ox + (event.clientX - drag.x), y: drag.oy + (event.clientY - drag.y) });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div ref={containerRef} className="bg-background">
      <ViewerFrame
        file={file}
        isBookmarked={isBookmarked}
        onToggleBookmark={onToggleBookmark}
        prevFile={prevFile}
        nextFile={nextFile}
        onNavFile={onNavFile}
        onOpenPalette={onOpenPalette}
        action={
          <div className="flex items-center gap-1">
            <IconBtn label="Zoom out" onClick={() => zoomBy(1 / 1.25)} disabled={!src || broken}>
              <ZoomOut className="h-4 w-4" />
            </IconBtn>
            <button
              onClick={reset}
              disabled={!src || broken}
              title="Reset zoom"
              className="min-w-12 rounded-md px-1 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              {Math.round(zoom * 100)}%
            </button>
            <IconBtn label="Zoom in" onClick={() => zoomBy(1.25)} disabled={!src || broken}>
              <ZoomIn className="h-4 w-4" />
            </IconBtn>
            <IconBtn
              label="Rotate"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              disabled={!src || broken}
            >
              <RotateCw className="h-4 w-4" />
            </IconBtn>
            <IconBtn
              label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              onClick={toggleFullscreen}
              disabled={!src || broken}
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </IconBtn>
          </div>
        }
      >
        {!src ? (
          <ErrorState message="This image is missing its data. Remove it and upload the file again." />
        ) : broken ? (
          <ErrorState message="This image could not be decoded by the browser." />
        ) : (
          <div
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="image-canvas flex min-h-[calc(100dvh-7.5rem)] items-center justify-center overflow-hidden p-4 md:p-8"
            style={{
              cursor: zoom > 1 ? (dragRef.current ? "grabbing" : "grab") : "default",
              // Blocks touch pinch-zoom, which would zoom the page not the image.
              touchAction: "none",
            }}
          >
            <img
              src={src}
              alt={file.name}
              draggable={false}
              onLoad={(e) =>
                setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
              }
              onError={() => setBroken(true)}
              className="max-h-full max-w-full select-none rounded-md shadow-lg"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                transition: dragRef.current ? "none" : "transform 0.12s ease-out",
              }}
            />
          </div>
        )}
        {natural && src && !broken && (
          <div className="pointer-events-none fixed bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-background/90 px-3 py-1 text-xs font-medium tabular-nums text-muted-foreground backdrop-blur">
            {natural.w} × {natural.h}
          </div>
        )}
      </ViewerFrame>
    </div>
  );
}
