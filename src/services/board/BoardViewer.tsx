// The read-only half of the board story: a board embedded in a document.
//
// `Board` is the editor a board file opens in; this is the figure a document
// shows. It shares only the renderer — no editor, no history, no save path —
// so there is no route from an embed back into the file, and the embed's code
// is a fraction of the editor's.

import { useEffect, useMemo, useRef, useState } from "react";
import { unionBounds } from "./geometry";
import { ImageStore } from "./images";
import { parseScene } from "./model";
import { drawElements, type Viewport } from "./render";
import { loadBoardFont } from "./font";
import { clearTextMetrics } from "./text";
import "./board.css";

const PAD = 24;

export function BoardViewer({ scene, sceneKey }: { scene: string; sceneKey: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [moved, setMoved] = useState(false);
  const view = useRef<Viewport | null>(null);
  const redraw = useRef<() => void>(() => {});

  // Re-parsed when the referenced file changes, so a board edited in its own
  // tab updates in every document that embeds it.
  const parsed = useMemo(() => {
    try {
      return parseScene(scene);
    } catch {
      return null;
    }
  }, [scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box || !parsed) return;
    let frame = 0;
    const images = new ImageStore(() => schedule());
    images.sync(parsed.files);
    let width = 0;
    let height = 0;

    const fit = (): Viewport => {
      const bounds = unionBounds(parsed.elements);
      if (!bounds || !width || !height) return { x: -width / 2, y: -height / 2, zoom: 1 };
      const w = Math.max(bounds.maxX - bounds.minX, 1);
      const h = Math.max(bounds.maxY - bounds.minY, 1);
      const zoom = Math.min((width - PAD * 2) / w, (height - PAD * 2) / h, 1.5);
      return {
        x: (bounds.minX + bounds.maxX) / 2 - width / 2 / zoom,
        y: (bounds.minY + bounds.maxY) / 2 - height / 2 / zoom,
        zoom,
      };
    };

    const draw = () => {
      frame = 0;
      const ctx = canvas.getContext("2d");
      if (!ctx || !width) return;
      const v = view.current ?? fit();
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const z = v.zoom * dpr;
      ctx.setTransform(z, 0, 0, z, -v.x * z, -v.y * z);
      const css = getComputedStyle(box);
      drawElements(
        ctx,
        parsed.elements,
        {
          dark: document.documentElement.classList.contains("dark"),
          background: css.backgroundColor || "#ffffff",
          getImage: images.get,
        },
        { minX: v.x, minY: v.y, maxX: v.x + width / v.zoom, maxY: v.y + height / v.zoom },
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    redraw.current = schedule;

    const resize = () => {
      const rect = box.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      schedule();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(box);
    resize();
    const theme = new MutationObserver(schedule);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    void loadBoardFont().then(() => {
      clearTextMetrics();
      schedule();
    });

    // Drag to pan (mouse and pen); pinch or ⌘/Ctrl-scroll to zoom. A plain
    // scroll wheel keeps scrolling the document — the figure never traps it.
    let drag: { x: number; y: number; v: Viewport } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, v: view.current ?? fit() };
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      view.current = {
        ...drag.v,
        x: drag.v.x - (e.clientX - drag.x) / drag.v.zoom,
        y: drag.v.y - (e.clientY - drag.y) / drag.v.zoom,
      };
      setMoved(true);
      schedule();
    };
    const up = () => {
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const v = view.current ?? fit();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const zoom = Math.min(
        8,
        Math.max(0.1, v.zoom * Math.exp(-Math.max(-40, Math.min(40, e.deltaY)) * 0.0125)),
      );
      const wx = sx / v.zoom + v.x;
      const wy = sy / v.zoom + v.y;
      view.current = { x: wx - sx / zoom, y: wy - sy / zoom, zoom };
      setMoved(true);
      schedule();
    };
    const reset = () => {
      view.current = null;
      setMoved(false);
      schedule();
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("dblclick", reset);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      theme.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("dblclick", reset);
    };
  }, [parsed]);

  if (!parsed) return null;
  return (
    <div ref={boxRef} className="board-embed docs-board-embed" role="img" aria-label={sceneKey}>
      <canvas ref={canvasRef} className="board-embed__canvas" />
      {moved && (
        <button
          type="button"
          className="board-embed__reset"
          onClick={() => {
            view.current = null;
            setMoved(false);
            redraw.current();
          }}
        >
          Reset view
        </button>
      )}
    </div>
  );
}
