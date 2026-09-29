import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { MermaidAnimator as MermaidAnimatorInstance } from "mermaid-animator";
import { largeDiagramMermaidConfig } from "./mermaid-config";
import { withMermaid } from "./mermaid-runtime";
import { useSvgViewport } from "./use-svg-viewport";
import { useStageVisibility } from "./use-stage-visibility";
import { MAX_STAGE_RATIO, MIN_STAGE_RATIO } from "./stage-ratio";
import { TRAY_GUTTER, ZOOM_LIMIT, quoteErEntities, widthCap } from "./mermaid-diagram-helpers";
import { ZoomControls } from "./ZoomControls";

// The animator stretches its SVG to the full box and lets preserveAspectRatio
// letterbox the remainder, so a wide diagram in a tall frame is read as a band
// of art floating in dead space. Measuring the rendered viewBox lets the inline
// stage take the diagram's own proportions instead, within bounds that keep a
// very wide or very tall graph from collapsing or running off the screen.
//
// The floor is low deliberately: a left-to-right flow of four or five nodes is
// genuinely around 0.3, and clamping it to something squarer reintroduces the
// exact dead band this measurement exists to remove.
// The ratio band every stage sizes itself by lives in its own module, so all
// three stages share one definition. See stage-ratio.ts for why it is clamped.

export function AnimatorStage({
  code,
  dark,
  fill,
  controls,
  onError,
  onRatio,
}: {
  code: string;
  dark: boolean;
  fill?: boolean;
  controls?: React.ReactNode;
  onError: (message: string | null) => void;
  /** Reports the diagram's measured aspect ratio so the frame can match it. */
  onRatio?: (ratio: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animatorRef = useRef<MermaidAnimatorInstance | null>(null);
  const renderChainRef = useRef<Promise<void>>(Promise.resolve());
  const renderGenerationRef = useRef(0);
  const ownerGenerationRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [ratio, setRatio] = useState<number | null>(null);
  const { state: view, attach, detach, zoomIn, zoomOut, reset } = useSvgViewport();
  // Flow repaints every frame for as long as it is mounted. Off screen or in a
  // background tab it holds still, and resumes from the same moment.
  const visibleRef = useStageVisibility(containerRef, (visible) => {
    if (visible) animatorRef.current?.resume();
    else animatorRef.current?.pause();
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const generation = ++renderGenerationRef.current;
    let disposed = false;
    setLoading(true);
    onError(null);
    const create = async () => {
      const options = {
        theme: dark ? "dark" : "light",
        // Pan and zoom are ours (lib/viewport.ts), shared with the other two
        // stages. The package's handler captured the pointer on press, which
        // retargeted clicks and fought the inspector, and its wheel zoom
        // hijacked the page scroll.
        pan: false,
        zoom: false,
        inspect: true,
        minZoom: ZOOM_LIMIT.min,
        maxZoom: ZOOM_LIMIT.max,
        mermaid: largeDiagramMermaidConfig(),
      } as const;
      try {
        const { MermaidAnimator } = await import("mermaid-animator");
        if (disposed || generation !== renderGenerationRef.current) return;
        // mermaid-animator initializes the shared Mermaid itself, so its
        // render runs as a queued job (mermaid-runtime.ts): its settings can't
        // leak into another diagram's render, nor theirs into this one. A stage
        // unmounted while waiting in the queue skips the work.
        const animator = await withMermaid<MermaidAnimatorInstance | null>(
          async () => {
            if (disposed || generation !== renderGenerationRef.current) return null;
            try {
              return await MermaidAnimator.create(container, code, options);
            } catch (error) {
              const alternative = /^\s*(?:---[\s\S]*?---\s*)?erDiagram\b/.test(code)
                ? quoteErEntities(code)
                : code;
              if (alternative === code) throw error;
              return await MermaidAnimator.create(container, alternative, options);
            }
          },
          { label: "animate" },
        );
        if (!animator) return;
        if (disposed || generation !== renderGenerationRef.current) {
          animator.destroy();
          return;
        }
        animatorRef.current = animator;
        ownerGenerationRef.current = generation;
        if (!visibleRef.current) animator.pause();
        // The untouched viewBox is the diagram's natural frame: it is both the
        // aspect ratio the inline stage should take and the zoom baseline.
        const svg = container.querySelector("svg");
        const view = svg?.viewBox.baseVal;
        if (svg && view?.width && view.height) {
          svg.dataset.maBaseView = `${view.x} ${view.y} ${view.width} ${view.height}`;
          attach(container, svg, { minZoom: ZOOM_LIMIT.min, maxZoom: ZOOM_LIMIT.max });
          const measured = Math.min(
            MAX_STAGE_RATIO,
            Math.max(MIN_STAGE_RATIO, view.height / view.width),
          );
          setRatio(measured);
          onRatio?.(measured);
        }
        setLoading(false);
      } catch (error) {
        if (!disposed) {
          setLoading(false);
          onError(error instanceof Error ? error.message : "Failed to render diagram");
        }
      }
    };
    // React Strict Mode mounts effects twice in development. MermaidAnimator
    // mutates and clears its container, so two overlapping create() calls can
    // let the stale instance erase the live one. Serialize renders per stage;
    // a superseded generation is cleaned up before the next one starts.
    renderChainRef.current = renderChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (!disposed) await create();
      });
    return () => {
      disposed = true;
      if (ownerGenerationRef.current === generation) {
        detach();
        animatorRef.current?.destroy();
        animatorRef.current = null;
        ownerGenerationRef.current = 0;
      }
    };
    // `fill` is deliberately absent: it changes how the diagram is *framed*,
    // not what it contains, and listing it here made opening fullscreen
    // destroy the animator and lay the whole diagram out again — twice per
    // toggle, since closing did it too. Framing is applied by the effect below
    // instead, against the instance that is already running.
  }, [code, dark, onError, onRatio, attach, detach, visibleRef]);

  // Re-frame when the stage changes shape (entering or leaving full screen).
  // Cheap: it writes a viewBox, where a re-create would re-run Mermaid's layout.
  useEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(reset);
    return () => cancelAnimationFrame(frame);
  }, [fill, loading, reset]);

  return (
    <div
      className="group/stage relative h-full w-full"
      // A tall diagram is capped to a screenful and so ends up narrower than the
      // column. The wrapper narrows with it, so the control row stays anchored
      // to the picture's own corner rather than floating out in the margin.
      style={fill || !ratio ? undefined : { maxWidth: widthCap(ratio), marginInline: "auto" }}
    >
      {/* Flow runs continuously and frames itself; zoom is the only thing left
          worth reaching for, so it is all this tray carries. */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 p-3 ${
          fill
            ? ""
            : "opacity-0 transition-opacity duration-150 group-hover/stage:opacity-100 group-focus-within/stage:opacity-100 [@media(hover:none)]:opacity-100"
        }`}
      >
        <ZoomControls
          zoom={view.zoom}
          manual={view.manual}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onReset={reset}
        />
        {controls}
      </div>
      {loading && (
        <div className="absolute inset-0 z-1 flex items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Rendering animation…
        </div>
      )}
      <div
        ref={containerRef}
        tabIndex={0}
        aria-label="Animated Mermaid diagram. Drag to pan; pinch or Ctrl/⌘ + scroll to zoom; + − 0 on the keyboard."
        // Keep the package class in React's declared className. The animator
        // also adds it imperatively, but a later loading-state render would
        // otherwise make React restore only the utility classes.
        className={fill ? "ma-container h-full min-h-0 w-full" : "ma-container w-full box-content"}
        // Inline: hold the diagram's own proportions so there is no letterboxed
        // dead band above and below it, with the control row's gutter added as
        // padding rather than taken out of the picture (hence `box-content`, so
        // the ratio still describes the diagram alone). Before the first
        // measurement a neutral ratio reserves roughly the right room, so the
        // surrounding text does not jump when the diagram appears.
        style={
          fill
            ? undefined
            : {
                aspectRatio: `1 / ${ratio ?? 0.42}`,
                paddingBottom: TRAY_GUTTER,
                // A tall diagram would otherwise grow past a screenful. The
                // wrapper caps the width in the same proportion, so this height
                // cap is only a backstop and never letterboxes the picture.
                maxHeight: "min(32rem, 70vh)",
                minHeight: "9rem",
              }
        }
      />
    </div>
  );
}
