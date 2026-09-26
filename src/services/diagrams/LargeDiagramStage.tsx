import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { loadScene, diagramTheme } from "./engine/engine";
import { DiagramRenderer } from "./engine/renderer";
import { attachMinimap, type Minimap } from "./engine/minimap";
import { homeFrame } from "./explainer/camera";
import { zoomCeiling } from "./engine/zoom";
import { ZoomControls } from "./Mermaid";
import { describeRenderError } from "./render-error";
import { useSvgViewport } from "./use-svg-viewport";
import { TALL_STAGE_RATIO, clampStageRatio, stageBoxStyle, stageWidthCap } from "./stage-ratio";

const TRAY_GUTTER = 56;

/**
 * Raw mode for a large flowchart, drawn by the GPU engine.
 *
 * The SVG path lays a 5,000-node flowchart out in ~40s and then shows it as a
 * flattened image; this lays it out in milliseconds (Rust/WASM) and keeps it a
 * live, zoomable drawing at 60fps (WebGL). See lib/diagram-engine.
 *
 * The stage is never "tall" (page-scrolled at natural size) the way an SVG
 * one can be: a 10,000-node diagram's natural height can be hundreds of
 * thousands of pixels, so it is framed and explored by zoom and pan instead.
 */
export function LargeDiagramStage({
  code,
  dark,
  fill,
  onError,
  onRatio,
}: {
  code: string;
  dark: boolean;
  fill?: boolean;
  onError: (message: string | null) => void;
  onRatio?: (ratio: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [ratio, setRatio] = useState<number | null>(null);
  const { state: view, attach, detach, zoomIn, zoomOut, reset } = useSvgViewport();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let renderer: DiagramRenderer | null = null;
    let minimap: Minimap | null = null;
    setLoading(true);
    onError(null);

    void (async () => {
      try {
        const [scene, theme] = await Promise.all([loadScene(code), diagramTheme(dark)]);
        if (disposed) return;
        renderer = new DiagramRenderer(host, scene, theme, { lineArt: false });
        renderer.showAll();
        const measured = clampStageRatio(Math.min(scene.height / scene.width, TALL_STAGE_RATIO));
        setRatio(measured);
        onRatio?.(measured);
        const viewport = attach(host, renderer.target, {
          maxZoom: zoomCeiling(scene.width, scene.height),
        });
        viewport.setBase(homeFrame(scene.graph));
        minimap = attachMinimap(
          renderer,
          scene,
          theme,
          viewport,
          Math.max(500, (host.clientWidth || 800) / 0.85),
        );
        setLoading(false);
      } catch (error) {
        if (disposed) return;
        setLoading(false);
        onError(describeRenderError(error));
      }
    })();

    return () => {
      disposed = true;
      detach();
      minimap?.destroy();
      renderer?.destroy();
    };
  }, [code, dark, attach, detach, onError, onRatio]);

  useEffect(() => reset(), [fill, reset]);

  const cap = ratio ? stageWidthCap(ratio) : undefined;
  return (
    <div
      className="group/stage relative h-full w-full"
      style={fill || !cap ? undefined : { maxWidth: `calc(${cap})`, marginInline: "auto" }}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 p-3 ${
          fill ? "" : "opacity-90"
        }`}
      >
        <ZoomControls
          zoom={view.zoom}
          manual={view.manual}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onReset={reset}
        />
      </div>
      {loading && (
        <div className="absolute inset-0 z-1 flex items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Laying out large diagram…
        </div>
      )}
      <div
        ref={hostRef}
        tabIndex={0}
        aria-label="Large Mermaid diagram. Drag to pan; pinch or Ctrl/⌘ + scroll to zoom; + − 0 on the keyboard."
        className={`overflow-hidden rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
          fill ? "h-full min-h-0 w-full" : "w-full box-content"
        }`}
        style={fill ? undefined : stageBoxStyle(ratio ?? 0.42, TRAY_GUTTER)}
      />
    </div>
  );
}
