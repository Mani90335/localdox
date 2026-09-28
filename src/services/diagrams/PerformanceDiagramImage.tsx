import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { isZoomWheel, wheelZoomFactor } from "@/lib/viewport";
import { Tray, TrayButton } from "./Tray";

/**
 * A large SVG stays outside the live DOM and is decoded as one image. Zooming
 * changes only two box dimensions instead of restyling thousands of SVG nodes.
 */
export function PerformanceDiagramImage({
  src,
  name,
  fill,
}: {
  src: string;
  name: string;
  fill?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const scrollerRef = useRef<HTMLDivElement>(null);
  /**
   * The point to hold still through a zoom: a fraction of the content, and
   * where it sat in the scroller. Without it, zoom grows from the top-left
   * corner and whatever the reader was looking at slides away.
   */
  const anchorRef = useRef<{ fx: number; fy: number; ox: number; oy: number } | null>(null);
  const zoomBy = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const scroller = scrollerRef.current;
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      const ox = clientX === undefined ? rect.width / 2 : clientX - rect.left;
      const oy = clientY === undefined ? rect.height / 2 : clientY - rect.top;
      anchorRef.current = {
        fx: (scroller.scrollLeft + ox) / (scroller.scrollWidth || 1),
        fy: (scroller.scrollTop + oy) / (scroller.scrollHeight || 1),
        ox,
        oy,
      };
    }
    setZoom((value) => Math.min(32, Math.max(1, value * factor)));
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const anchor = anchorRef.current;
    if (!scroller || !anchor) return;
    anchorRef.current = null;
    scroller.scrollLeft = anchor.fx * scroller.scrollWidth - anchor.ox;
    scroller.scrollTop = anchor.fy * scroller.scrollHeight - anchor.oy;
  }, [zoom]);

  // Drag to pan (mouse, pen, touch alike) and pinch / Ctrl-wheel to zoom. The
  // box already scrolls natively, so two-finger trackpad scrolling works as-is.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let drag: { id: number; x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 1) return;
      if (event.pointerType === "touch") return; // native touch scrolling is better
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      scroller.setPointerCapture(event.pointerId);
      scroller.style.cursor = "grabbing";
      event.preventDefault();
    };
    const onMove = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      scroller.scrollLeft -= event.clientX - drag.x;
      scroller.scrollTop -= event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
    };
    const onUp = () => {
      drag = null;
      scroller.style.cursor = "";
    };
    const onWheel = (event: WheelEvent) => {
      if (!isZoomWheel(event)) return;
      event.preventDefault();
      zoomBy(wheelZoomFactor(event), event.clientX, event.clientY);
    };
    let gestureScale = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureScale = 1;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale: number; clientX: number; clientY: number };
      zoomBy(gesture.scale / gestureScale, gesture.clientX, gesture.clientY);
      gestureScale = gesture.scale;
    };
    scroller.addEventListener("pointerdown", onDown);
    scroller.addEventListener("pointermove", onMove);
    scroller.addEventListener("pointerup", onUp);
    scroller.addEventListener("pointercancel", onUp);
    scroller.addEventListener("wheel", onWheel, { passive: false });
    scroller.addEventListener("gesturestart", onGestureStart);
    scroller.addEventListener("gesturechange", onGestureChange);
    return () => {
      scroller.removeEventListener("pointerdown", onDown);
      scroller.removeEventListener("pointermove", onMove);
      scroller.removeEventListener("pointerup", onUp);
      scroller.removeEventListener("pointercancel", onUp);
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("gesturestart", onGestureStart);
      scroller.removeEventListener("gesturechange", onGestureChange);
    };
  }, [zoomBy]);

  return (
    <div
      className={`group/stage relative w-full ${fill ? "h-full" : "h-[min(32rem,70vh)] min-h-64"}`}
    >
      <div ref={scrollerRef} className="h-full w-full cursor-grab overflow-auto overscroll-contain">
        <div
          className="relative min-h-full min-w-full"
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
        >
          <img
            src={src}
            alt={name}
            decoding="async"
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-contain"
          />
        </div>
      </div>
      <div className="absolute bottom-3 right-3 z-10 flex items-center">
        <Tray>
          <TrayButton onClick={() => zoomBy(0.5)} label="Zoom out">
            <Minus className="h-3.5 w-3.5" />
          </TrayButton>
          <TrayButton onClick={() => setZoom(1)} label="Fit diagram">
            <span className="text-3xs font-semibold">{Math.round(zoom * 100)}%</span>
          </TrayButton>
          <TrayButton onClick={() => zoomBy(2)} label="Zoom in">
            <Plus className="h-3.5 w-3.5" />
          </TrayButton>
        </Tray>
      </div>
    </div>
  );
}
