import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { describeRenderError } from "./render-error";
import { renderMermaid } from "./mermaid-render-cache";
import { useSvgViewport } from "./use-svg-viewport";
import { useDiagramInteraction } from "./interaction/use-diagram-interaction";
import { DiagramNodeColorPopover } from "./DiagramNodeColorPopover";
import { DiagramTopBar, SelectionActionTray } from "./DiagramInteractionBar";
import {
  COLORABLE_NODES,
  applyOne,
  applyOverrides,
  diagramKey,
  loadOverrides,
  nodeKey,
  saveOverride,
  type NodeOverrides,
} from "./diagram-node-colors";
import {
  isRenderedDiagramTooLarge,
  optimizeSvgForImageRendering,
  readSvgViewBox,
} from "./mermaid-performance";
import { clampStageRatio, isTallStage, stageBoxStyle, type DiagramSize } from "./stage-ratio";
import { TRAY_GUTTER, ZOOM_LIMIT, widthCap } from "./mermaid-diagram-helpers";
import { ZoomControls } from "./ZoomControls";
import { PerformanceDiagramImage } from "./PerformanceDiagramImage";
import { StageSpinner } from "./StageStatus";

/**
 * Mark every node a reader can recolour.
 *
 * The attribute is what `diagram-colors.css` hangs the hover affordance on, and
 * the tooltip is the only discovery this feature gets — nothing about a
 * rendered box says "clickable" on its own.
 */
function markColorableNodes(svg: SVGSVGElement): void {
  for (const node of svg.querySelectorAll<SVGElement>(COLORABLE_NODES)) {
    node.setAttribute("data-colorable", "");
    // The tooltip goes on the *shape*, never on the node group.
    //
    // An SVG <title> is real text content: appended to the group, it joined the
    // node's own label, so `node.textContent` came back as "Ordinary stepClick
    // to change…". That is not cosmetic — semantics.ts classifies a node by
    // matching keywords against exactly that string, and the colour picker
    // shows it back to the reader as the node's name.
    const shape = node.querySelector("rect, polygon, circle, ellipse, path");
    if (shape && !shape.querySelector("title")) {
      const tip = document.createElementNS("http://www.w3.org/2000/svg", "title");
      tip.textContent = "Click to change this block's colour";
      shape.appendChild(tip);
    }
  }
}

/**
 * Plain Mermaid, no motion.
 *
 * Worth having as its own mode rather than "explainer, paused": some diagrams
 * (a pie chart, a gantt, an ER diagram) aren't a walk through anything, and a
 * reader skimming a long document may simply not want things moving. It shares
 * the sizing behaviour of the animated stages so switching modes doesn't make
 * the surrounding text jump.
 */
export function StaticStage({
  code,
  dark,
  colored,
  fill,
  controls,
  onError,
  onRatio,
  performanceMode,
  onPerformanceImage,
  onOversized,
}: {
  code: string;
  dark: boolean;
  /** Colour nodes and edges by meaning; see lib/explainer/semantics.ts. */
  colored?: boolean;
  fill?: boolean;
  controls?: React.ReactNode;
  onError: (message: string | null) => void;
  onRatio?: (ratio: number) => void;
  performanceMode?: boolean;
  onPerformanceImage?: (url: string | null) => void;
  /**
   * Fired when the *rendered* diagram turns out to be too large for live DOM,
   * even though the source scan let it through. The caller uses this to drop
   * the animated modes, exactly as it would for a source-flagged diagram.
   */
  onOversized?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [ratio, setRatio] = useState<number | null>(null);
  const [size, setSize] = useState<DiagramSize | null>(null);
  const { viewportRef, state: view, attach, detach, zoomIn, zoomOut, reset } = useSvgViewport();
  const interaction = useDiagramInteraction(viewportRef);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const imageUrlRef = useRef<string | null>(null);
  /**
   * Whether this render is being shown as a flattened image.
   *
   * Distinct from the `performanceMode` prop: that is the source-scan verdict,
   * known before rendering, while this also covers a diagram that only
   * revealed its size once Mermaid had laid it out.
   */
  const [asImage, setAsImage] = useState(Boolean(performanceMode));

  /**
   * The reader's own colours for this diagram's nodes.
   *
   * Held in a ref as well as state: the render effect re-applies them to each
   * fresh SVG, and reading them from state there would mean listing them as a
   * dependency and re-rendering the whole diagram every time one box changed.
   */
  const diagram = useMemo(() => diagramKey(code), [code]);
  const [overrides, setOverrides] = useState<NodeOverrides>(() => loadOverrides(diagram));
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  // A different diagram has different overrides; the previous one's must not
  // leak onto it.
  useEffect(() => {
    const next = loadOverrides(diagram);
    overridesRef.current = next;
    setOverrides(next);
  }, [diagram]);

  /** The node whose colour is being picked, if any. */
  const [picker, setPicker] = useState<{ node: string; label: string; rect: DOMRect } | null>(null);
  // A re-render moves every node, so a picker still pointing at the old
  // rectangle would float away from its box. The interaction state (search,
  // selection, isolation) points at the same soon-to-be-replaced elements,
  // so it is discarded here too, ahead of the next render's `onRendered`.
  useEffect(() => {
    setPicker(null);
    interaction.discardGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, dark, colored]);

  const pickColor = useCallback(
    (color: string | null) => {
      if (!picker) return;
      const svgEl = hostRef.current?.querySelector("svg");
      if (svgEl) {
        // Repaint immediately rather than waiting on a re-render that is not
        // coming: the SVG is imperative, and nothing else would redraw it.
        applyOne(svgEl as SVGSVGElement, picker.node, color);
        // Clearing an override puts the node back to whatever the semantic
        // palette said, which only a fresh pass can decide.
        if (!color && colored) {
          void import("./explainer/semantics").then(({ applySemantics }) =>
            applySemantics(svgEl as SVGSVGElement),
          );
        }
      }
      setOverrides(saveOverride(diagram, picker.node, color));
      setPicker(null);
    },
    [colored, diagram, picker],
  );

  /** Open the picker on whichever node was clicked — or, in select mode,
   *  toggle that node's selection instead. */
  const onHostClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as Element | null;
      if (interaction.selectMode) {
        const nodeId = target ? interaction.nodeIdFromElement(target) : null;
        if (!nodeId) return;
        event.preventDefault();
        event.stopPropagation();
        interaction.toggleNode(nodeId);
        return;
      }
      const node = target?.closest?.(COLORABLE_NODES);
      if (!node) return;
      event.preventDefault();
      event.stopPropagation();
      setPicker({
        node: nodeKey(node),
        // The node's own label, not its whole text content: the click-to-recolour
        // tooltip is an SVG <title> living on the shape, and `textContent` would
        // hand the reader "Click to change this block's colourOrdinary step".
        label: (node.querySelector(".nodeLabel") ?? node).textContent?.trim() ?? "",
        rect: node.getBoundingClientRect(),
      });
    },
    [interaction],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!performanceMode && !host) return;
    let disposed = false;
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = null;
      setImageUrl(null);
      onPerformanceImage?.(null);
    }
    setLoading(true);
    onError(null);
    const run = async () => {
      try {
        const { svg } = await renderMermaid(code, dark, Boolean(performanceMode));
        if (disposed) return;
        // Stage two of the size gate. The source scan catches the obvious
        // monsters, but a short, dense diagram — forty ER entities of thirty
        // attributes — only reveals its true size once laid out. Measuring the
        // result and downgrading here is what makes the guarantee hold for the
        // diagrams the pre-scan cannot see.
        const oversized = performanceMode || isRenderedDiagramTooLarge(svg);
        if (oversized) {
          setAsImage(true);
          // Tell the parent only when the source scan had cleared it; a
          // source-flagged diagram has already disabled those modes.
          if (!performanceMode) onOversized?.();
          const view = readSvgViewBox(svg);
          if (view) {
            const measured = clampStageRatio(view.height / view.width);
            setRatio(measured);
            setSize(view);
            onRatio?.(measured);
          }
          const url = URL.createObjectURL(
            new Blob([optimizeSvgForImageRendering(svg)], { type: "image/svg+xml" }),
          );
          if (disposed) {
            URL.revokeObjectURL(url);
            return;
          }
          imageUrlRef.current = url;
          setImageUrl(url);
          onPerformanceImage?.(url);
          setLoading(false);
          return;
        }

        host!.innerHTML = svg;
        const svgEl = host!.querySelector("svg");
        if (svgEl) {
          // Mermaid pins max-width to the intrinsic width, which stops the
          // diagram growing to fill the stage the way the animated modes do.
          svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
          if (colored) {
            const { applySemantics } = await import("./explainer/semantics");
            if (disposed) return;
            applySemantics(svgEl as SVGSVGElement);
          }
          // The reader's own colours go on last, so they beat both the
          // semantic palette and any fill the diagram's author set. The render
          // cache hands back the same SVG string each time, so these have to be
          // re-applied to every fresh copy rather than living in the markup.
          applyOverrides(svgEl as SVGSVGElement, overridesRef.current);
          // Must run before `markColorableNodes`: that appends an SVG <title>
          // whose text would otherwise leak into a node's label and pollute
          // search matching.
          interaction.onRendered(svgEl as SVGSVGElement);
          markColorableNodes(svgEl as SVGSVGElement);
          svgEl.style.maxWidth = "100%";
          svgEl.style.width = "100%";
          svgEl.style.height = "100%";
          const view = svgEl.viewBox.baseVal;
          if (view?.width && view.height) {
            // Clamped for the same reason the animated stages clamp: a tall
            // diagram measured raw builds a box taller than the screen, which
            // maxHeight then crushes into a sliver.
            const measured = clampStageRatio(view.height / view.width);
            setRatio(measured);
            setSize({ width: view.width, height: view.height });
            onRatio?.(measured);
            // A tall diagram is scrolled by the page, so the wheel stays the
            // page's even when zoomed; drag and pinch still work.
            attach(host!, svgEl as SVGSVGElement, {
              minZoom: ZOOM_LIMIT.min,
              maxZoom: ZOOM_LIMIT.max,
              wheelPan: !(!fill && isTallStage(measured)),
            });
          }
        }
        setLoading(false);
      } catch (error) {
        if (disposed) return;
        setLoading(false);
        onError(describeRenderError(error));
      }
    };
    void run();
    return () => {
      disposed = true;
      detach();
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = null;
      onPerformanceImage?.(null);
      if (host) host.innerHTML = "";
    };
    // `fill` is read once, for the wheel rule, and deliberately not a
    // dependency: entering full screen must not re-render the diagram.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, dark, colored, onError, onOversized, onPerformanceImage, onRatio, performanceMode]);

  // A new framing (full screen, or back) starts from the whole diagram.
  useEffect(() => reset(), [fill, reset]);

  if (asImage) {
    return (
      <div className="relative min-h-64 w-full">
        {loading || !imageUrl ? (
          <StageSpinner label="Rendering large diagram…" />
        ) : (
          <PerformanceDiagramImage src={imageUrl} name="Large Mermaid diagram" />
        )}
      </div>
    );
  }

  return (
    <div
      className="group/stage relative h-full w-full"
      style={fill || !ratio ? undefined : { maxWidth: widthCap(ratio), marginInline: "auto" }}
    >
      {/* Pinned rather than hover-gated, unlike the zoom tray below: search
          and select are navigation the reader has to be able to find, and the
          isolation banner is state feedback that must stay visible while it
          applies. */}
      <DiagramTopBar interaction={interaction} />
      {interaction.selectMode && interaction.selectedIds.size > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-start gap-2 p-3">
          <div className="pointer-events-auto">
            <SelectionActionTray interaction={interaction} />
          </div>
        </div>
      )}
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
        {/* Passed already grouped: the caller decides what shares a surface,
            because only it knows which controls belong to the live mode. */}
        {controls}
      </div>
      {loading && (
        <div className="absolute inset-0 z-1 flex items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Rendering diagram…
        </div>
      )}
      {/* Zoom and pan rewrite the SVG's viewBox (lib/viewport.ts), so the
          stage never changes size, the document never reflows, and text stays
          sharp at any magnification. */}
      <div
        ref={hostRef}
        onClick={onHostClick}
        tabIndex={0}
        aria-label="Mermaid diagram. Drag to pan; pinch or Ctrl/⌘ + scroll to zoom; + − 0 on the keyboard."
        data-tall={!fill && ratio && isTallStage(ratio) ? "" : undefined}
        className={`overflow-hidden rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
          fill ? "h-full min-h-0 w-full" : "w-full box-content"
        }${colored ? " diagram-colored" : ""}`}
        style={fill ? undefined : stageBoxStyle(ratio ?? 0.42, TRAY_GUTTER, size ?? undefined)}
      />
      {picker && (
        <DiagramNodeColorPopover
          anchor={picker.rect}
          label={picker.label}
          current={overrides[picker.node] ?? null}
          onPick={pickColor}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
