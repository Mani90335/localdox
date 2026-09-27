import { useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut } from "lucide-react";

export function Lightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const zoomIn = () => setZoom((z) => Math.min(8, z * 1.25));
  const zoomOut = () => setZoom((z) => Math.max(0.3, z / 1.25));
  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Keep cmd/ctrl +/-/0 on the image so it never becomes a browser page zoom
      // that outlives the lightbox.
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  // Zooming is the +/− buttons' job only. Pinch (ctrl/meta+wheel on trackpads,
  // gesture* in Safari) is swallowed rather than acted on — left alone it zooms
  // the document behind the overlay and the zoom survives closing it. Native
  // non-passive listeners; React's onWheel is passive.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const swallow = (e: Event) => e.preventDefault();
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
  }, []);

  return (
    <div
      ref={stageRef}
      className="fixed inset-0 z-(--z-overlay) flex items-center justify-center overflow-hidden bg-black/85 p-6 animate-in fade-in-0"
      style={{ touchAction: "none" }}
      onClick={onClose}
    >
      <div
        className="absolute left-4 top-4 flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <IconBtn label="Zoom out" onClick={zoomOut}>
          <ZoomOut className="h-4 w-4" />
        </IconBtn>
        <button
          onClick={reset}
          title="Reset zoom"
          className="min-w-12 rounded-md px-1 text-xs font-medium tabular-nums text-white/80 transition-colors hover:text-white"
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconBtn label="Zoom in" onClick={zoomIn}>
          <ZoomIn className="h-4 w-4" />
        </IconBtn>
      </div>
      <button
        aria-label="Close"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
        onClick={onClose}
      >
        <X className="h-5 w-5" />
      </button>
      <figure
        className="max-h-full max-w-full"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => (dragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y })}
        onMouseMove={(e) => {
          if (!dragRef.current) return;
          setPan({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
        }}
        onMouseUp={() => (dragRef.current = null)}
        onMouseLeave={() => (dragRef.current = null)}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transition: dragRef.current ? "none" : "transform 0.15s ease",
          cursor: zoom > 1 ? (dragRef.current ? "grabbing" : "grab") : "default",
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-[85vh] max-w-full select-none rounded-lg object-contain shadow-2xl"
        />
        {alt && <figcaption className="mt-3 text-center text-sm text-white/80">{alt}</figcaption>}
      </figure>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 active:scale-95"
    >
      {children}
    </button>
  );
}
