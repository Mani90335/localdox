import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Home, Minus, Plus, X } from "lucide-react";
import { initialOpenDepth, openToDepth, type MindMapNode, type MindMapTree } from "./mindmap";
import { isZoomWheel, wheelPixels, wheelZoomFactor } from "@/lib/viewport";

// A tidy tree with enough air to scan a branch without merging it visually
// into its neighbours. Structure is carried by alignment, never physics.
const ROOT_HEIGHT = 40,
  BRANCH_HEIGHT = 34,
  LEAF_HEIGHT = 28,
  ROW_GAP = 15,
  LEVEL_GAP = 60;
const CONTROL_WIDTH = 22,
  CHAR_WIDTH = 6.6,
  NODE_PADDING = 26,
  MIN_NODE_WIDTH = 62,
  MAX_NODE_WIDTH = 212;
const MIN_ZOOM = 0.35,
  MAX_ZOOM = 2.5,
  VIEW_PADDING = 56;
// How a label is drawn, and so how it is measured: one source for both, so a
// box is sized for exactly the text it holds. Sizes are rem, like the type scale.
const LABEL_FONT = {
  root: { size: 0.875, weight: 600 },
  branch: { size: 0.75, weight: 500 },
  leaf: { size: 0.6875, weight: 500 },
} as const;
type LabelKind = keyof typeof LABEL_FONT;
/** Rendered width of a label in px. */
type Measure = (text: string, kind: LabelKind) => number;
// Before the map is mounted there is no font to measure (and no DOM on the
// server): a per-character guess stands in for that one frame.
const estimate: Measure = (text) => text.length * CHAR_WIDTH;
interface Placed {
  node: MindMapNode;
  /** The label as drawn: ellipsized when it is wider than a node may grow. */
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}
interface Edge {
  id: string;
  from: Placed;
  to: Placed;
}
interface Layout {
  nodes: Placed[];
  edges: Edge[];
  width: number;
  height: number;
}

function labelKind(depth: number, hasChildren: boolean): LabelKind {
  return depth === 0 ? "root" : hasChildren ? "branch" : "leaf";
}
/**
 * The label and box width for a node. The box hugs the measured text up to
 * MAX_NODE_WIDTH; past that the label is cut to the widest prefix that fits
 * with an ellipsis, so text never runs out of its box whatever the font.
 */
function fitNode(node: MindMapNode, depth: number, hasChildren: boolean, measure: Measure) {
  const kind = labelKind(depth, hasChildren),
    chrome = NODE_PADDING + (hasChildren ? CONTROL_WIDTH : 0),
    room = MAX_NODE_WIDTH - chrome;
  let label = node.label,
    text = measure(label, kind);
  if (text > room) {
    // Binary search for the longest prefix that still fits with its ellipsis.
    let low = 0,
      high = label.length;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (measure(`${label.slice(0, mid).trimEnd()}…`, kind) <= room) low = mid;
      else high = mid - 1;
    }
    label = `${label.slice(0, low).trimEnd()}…`;
    text = measure(label, kind);
  }
  return { label, width: Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, text + chrome)) };
}
function nodeHeight(depth: number, hasChildren: boolean) {
  return depth === 0 ? ROOT_HEIGHT : hasChildren ? BRANCH_HEIGHT : LEAF_HEIGHT;
}
/**
 * Measures labels with a canvas in the font the map inherits: the reader picks
 * the document font, so a per-character guess overflowed wide fonts and left
 * narrow ones swimming in their boxes. Results are cached per label.
 */
function textMeasurer(element: Element): Measure {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return estimate;
  const family = getComputedStyle(element).fontFamily,
    rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
    cache = new Map<string, number>();
  return (text, kind) => {
    const key = `${kind}:${text}`;
    let width = cache.get(key);
    if (width === undefined) {
      const { size, weight } = LABEL_FONT[kind];
      context.font = `${weight} ${size * rem}px ${family}`;
      width = context.measureText(text).width;
      cache.set(key, width);
    }
    return width;
  };
}

function layout(root: MindMapNode, open: Set<string>, measureText: Measure): Layout {
  const nodes: Placed[] = [],
    edges: Edge[] = [],
    columns: number[] = [],
    fitted = new Map<string, { label: string; width: number }>();
  const fitOf = (node: MindMapNode, depth: number, hasChildren: boolean) => {
    let fit = fitted.get(node.id);
    if (!fit) fitted.set(node.id, (fit = fitNode(node, depth, hasChildren, measureText)));
    return fit;
  };
  let cursorY = 0;
  const measure = (node: MindMapNode, depth: number) => {
    const hasChildren = Boolean(node.children?.length);
    columns[depth] = Math.max(columns[depth] ?? 0, fitOf(node, depth, hasChildren).width);
    if (open.has(node.id)) node.children?.forEach((child) => measure(child, depth + 1));
  };
  measure(root, 0);
  const offsets: number[] = [];
  let running = 0;
  columns.forEach((column, depth) => {
    offsets[depth] = running;
    running += column + LEVEL_GAP;
  });
  const place = (node: MindMapNode, depth: number): Placed => {
    const hasChildren = Boolean(node.children?.length),
      expanded = hasChildren && open.has(node.id),
      height = nodeHeight(depth, hasChildren);
    const { label, width } = fitOf(node, depth, hasChildren);
    const placed: Placed = {
      node,
      label,
      x: offsets[depth],
      y: cursorY,
      width,
      height,
      depth,
      hasChildren,
      expanded,
    };
    if (!expanded) {
      cursorY += height + ROW_GAP;
      nodes.push(placed);
      return placed;
    }
    const children = node.children!.map((child) => place(child, depth + 1));
    placed.y =
      (children[0].y +
        children[0].height / 2 +
        (children.at(-1)!.y + children.at(-1)!.height / 2)) /
        2 -
      height / 2;
    nodes.push(placed);
    children.forEach((child) =>
      edges.push({ id: `${node.id}->${child.node.id}`, from: placed, to: child }),
    );
    return placed;
  };
  place(root, 0);
  return {
    nodes,
    edges,
    width: nodes.reduce((max, node) => Math.max(max, node.x + node.width), 0),
    height: nodes.reduce((max, node) => Math.max(max, node.y + node.height), 0),
  };
}
function edgePath({ from, to }: Edge) {
  const x1 = from.x + from.width,
    y1 = from.y + from.height / 2,
    x2 = to.x,
    y2 = to.y + to.height / 2;
  return `M ${x1} ${y1} H ${x1 + Math.max(12, (x2 - x1) * 0.48)} V ${y2} H ${x2}`;
}

export function MindMapView({
  tree,
  embedded = false,
  fill = false,
  onInspect,
}: {
  tree: MindMapTree;
  /** Rendered inside a document: a figure sized to the text, not a full page. */
  embedded?: boolean;
  /** Fill the parent's height instead of sizing to the viewport (full screen). */
  fill?: boolean;
  /**
   * Hand the selected node to the caller instead of drawing the details panel
   * inside the map. Passed when the map is a figure in a document, where the
   * panel belongs outside the embed rather than on top of it.
   */
  onInspect?: (node: MindMapNode | null) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() =>
    openToDepth(tree.root, initialOpenDepth(tree)),
  );
  const [selected, setSelected] = useState<string | null>(null),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const [frame, setFrame] = useState({ width: 0, height: 0 }),
    [dragging, setDragging] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null),
    dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null),
    // Until the reader moves the view, it stays fitted to the frame. The frame
    // changes size on entering or leaving full screen, and a view fitted once
    // to the inline figure left the map small in the top-left corner there.
    followFrameRef = useRef(true);
  const [measureText, setMeasureText] = useState<Measure>(() => estimate);
  // Before first paint, so the map is never drawn from the estimate; again when
  // a web font finishes loading, since until then the canvas measured a fallback.
  useLayoutEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const update = () => setMeasureText(() => textMeasurer(element));
    update();
    document.fonts?.addEventListener("loadingdone", update);
    return () => document.fonts?.removeEventListener("loadingdone", update);
  }, []);
  const { nodes, edges, width, height } = useMemo(
    () => layout(tree.root, open, measureText),
    [tree.root, open, measureText],
  );
  const selectedNode = useMemo(() => {
    const node = nodes.find(({ node }) => node.id === selected)?.node;
    return node?.metadata?.length ? node : null;
  }, [nodes, selected]);

  // Keep the hoisted panel in step with the selection. The callback is held in
  // a ref so a caller passing an inline arrow doesn't re-fire this every render.
  const onInspectRef = useRef(onInspect);
  onInspectRef.current = onInspect;
  useEffect(() => {
    onInspectRef.current?.(selectedNode);
  }, [selectedNode]);
  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const measure = () => setFrame({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setOpen(openToDepth(tree.root, initialOpenDepth(tree)));
    setSelected(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    followFrameRef.current = true;
  }, [tree]);
  const fit = useCallback(() => {
    if (!frame.width || !frame.height || !width || !height) return;
    const nextZoom = Math.min(
      1.15,
      Math.max(
        MIN_ZOOM,
        Math.min(
          (frame.width - VIEW_PADDING * 2) / width,
          (frame.height - VIEW_PADDING * 2) / height,
        ),
      ),
    );
    setZoom(nextZoom);
    setPan({ x: (frame.width - width * nextZoom) / 2, y: (frame.height - height * nextZoom) / 2 });
    followFrameRef.current = true;
  }, [frame, height, width]);
  // Keyed on the frame alone: opening a branch changes the layout, and that
  // must not re-zoom the map under the reader's click.
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    if (followFrameRef.current && frame.width && frame.height) fitRef.current();
    // Re-measured labels (a font arriving) resize the map: keep it framed.
  }, [frame, measureText]);
  // Entering or leaving full screen is a new framing even after the reader
  // has moved the view: fit again once the new frame has been measured.
  useEffect(() => {
    followFrameRef.current = true;
  }, [fill]);
  const toggle = useCallback(
    (id: string) =>
      setOpen((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  // The latest view, for handlers that fire faster than React re-renders: a
  // pinch delivers several wheel events per frame, and each must build on the
  // one before rather than on a stale render.
  const viewRef = useRef({ zoom, pan });
  viewRef.current = { zoom, pan };
  /** Zoom about a point in client pixels (the pointer), or the frame's centre. */
  const zoomBy = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const element = frameRef.current;
    if (!element) return;
    const { zoom: current, pan: offset } = viewRef.current;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor));
    if (next === current) return;
    const rect = element.getBoundingClientRect();
    const ox = clientX === undefined ? rect.width / 2 : clientX - rect.left;
    const oy = clientY === undefined ? rect.height / 2 : clientY - rect.top;
    const k = next / current;
    const nextPan = { x: ox - (ox - offset.x) * k, y: oy - (oy - offset.y) * k };
    followFrameRef.current = false;
    viewRef.current = { zoom: next, pan: nextPan };
    setZoom(next);
    setPan(nextPan);
  }, []);

  // Trackpad and mouse wheel. Pinch (ctrl-wheel) and Ctrl/⌘ + wheel zoom at
  // the pointer. Two-finger scrolling pans the full-page map; embedded in a
  // document, vertical scrolling is left to the page so reading carries on
  // past the figure, and only sideways scrolling pans it.
  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (isZoomWheel(event)) {
        event.preventDefault();
        zoomBy(wheelZoomFactor(event), event.clientX, event.clientY);
        return;
      }
      const { dx, dy } = wheelPixels(event, element.clientHeight);
      const sideways = Math.abs(dx) > Math.abs(dy);
      if (embedded && !sideways) return;
      event.preventDefault();
      const { zoom: current, pan: offset } = viewRef.current;
      const nextPan = { x: offset.x - dx, y: embedded ? offset.y : offset.y - dy };
      followFrameRef.current = false;
      viewRef.current = { zoom: current, pan: nextPan };
      setPan(nextPan);
    };
    // Safari's trackpad pinch.
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
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("gesturestart", onGestureStart);
    element.addEventListener("gesturechange", onGestureChange);
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("gesturestart", onGestureStart);
      element.removeEventListener("gesturechange", onGestureChange);
    };
  }, [embedded, zoomBy]);

  const onPointerDown = (event: React.PointerEvent) => {
    // Primary or middle button; right-click stays a context menu.
    if (event.button !== 0 && event.button !== 1) return;
    if ((event.target as Element).closest("[data-mindmap-node]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y };
    followFrameRef.current = false;
    setDragging(true);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag) setPan({ x: drag.px + event.clientX - drag.x, y: drag.py + event.clientY - drag.y });
  };
  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };
  const selectedBranch = (edge: Edge) =>
    Boolean(selected && selected.startsWith(`${edge.from.node.id}.`));
  return (
    <div
      className={`relative isolate overflow-hidden bg-background ${embedded ? "border-y border-border/70" : ""} ${fill ? "h-full" : ""}`}
    >
      <div
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`mindmap-canvas w-full overflow-hidden bg-[radial-gradient(circle_at_center,color-mix(in_oklab,var(--primary)_4%,transparent),transparent_58%)] ${
          fill ? "h-full" : embedded ? "h-104" : "h-[calc(100dvh-8rem)] min-h-105"
        }`}
        style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
      >
        <svg
          width="100%"
          height="100%"
          role="tree"
          aria-label="JSON mind map"
          className="select-none"
        >
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            <g fill="none" stroke="var(--border)" strokeWidth={1.2} strokeLinejoin="round">
              {edges.map((edge) => (
                <path
                  key={edge.id}
                  d={edgePath(edge)}
                  stroke={selectedBranch(edge) ? "var(--primary)" : undefined}
                  strokeOpacity={selectedBranch(edge) ? 0.6 : 0.9}
                />
              ))}
            </g>
            {nodes.map((placed) => (
              <MindMapNodeShape
                key={placed.node.id}
                placed={placed}
                selected={selected === placed.node.id}
                onSelect={setSelected}
                onToggle={toggle}
              />
            ))}
          </g>
        </svg>
      </div>
      {/* A node count told the reader nothing they act on. A trimmed map is
          different: it warns that what is drawn is not the whole document. */}
      {tree.truncated && (
        <div className="absolute left-4 top-4 rounded-md border border-border/80 bg-background/90 px-2.5 py-1.5 text-2xs font-medium tracking-wide text-muted-foreground shadow-sm backdrop-blur">
          Trimmed for display
        </div>
      )}
      <div className="absolute bottom-4 right-4 flex overflow-hidden rounded-md border border-border bg-background/95 shadow-sm backdrop-blur">
        <Control label="Zoom in" onClick={() => zoomBy(1.18)}>
          <Plus className="h-3.5 w-3.5" />
        </Control>
        <Control label="Zoom out" onClick={() => zoomBy(1 / 1.18)}>
          <Minus className="h-3.5 w-3.5" />
        </Control>
        <Control label="Fit visible map" onClick={fit}>
          <Home className="h-3.5 w-3.5" />
        </Control>
      </div>
      {/* Embedded in a document the inspector is hoisted out of the figure by
          the caller (see `onInspect`), because the embed is only a few hundred
          pixels tall and a panel inside it covers the map it describes. On the
          full-page map there is room, so it stays where it is drawn. */}
      {selectedNode && !onInspect && (
        <Inspector node={selectedNode} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
function Control({
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
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}
export function Inspector({ node, onClose }: { node: MindMapNode; onClose: () => void }) {
  const metadata = node.metadata ?? [];
  const description = metadata.find(({ label }) => /^(description|summary|details?)$/i.test(label));
  const attributes = metadata.filter((entry) => entry !== description);
  return (
    <aside
      className="absolute left-3 right-3 top-3 max-h-[calc(100%-1.5rem)] overflow-hidden rounded-lg border border-border bg-card/95 shadow-lg backdrop-blur sm:left-auto sm:right-4 sm:top-4 sm:w-80"
      aria-label={`${node.label} details`}
    >
      <div className="flex items-start justify-between gap-2 px-4 pb-3 pt-4">
        <div>
          <p className="text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Selected concept
          </p>
          <h3 className="mt-1 text-base font-semibold text-foreground">{node.label}</h3>
        </div>
        <button
          onClick={onClose}
          className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close details"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="max-h-[min(50dvh,26rem)] overflow-y-auto border-t border-border px-4 py-3">
        {description ? (
          <p className="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-foreground">
            {description.value}
          </p>
        ) : null}
        {attributes.length > 0 && (
          <dl className={description ? "mt-4 space-y-3 border-t border-border pt-3" : "space-y-3"}>
            {attributes.map((entry) => (
              <div key={entry.label}>
                <dt className="text-xs font-medium text-muted-foreground">{entry.label}</dt>
                <dd className="mt-1 whitespace-pre-wrap wrap-break-word text-sm leading-5 text-foreground">
                  {entry.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {!description && attributes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No additional details for this concept.</p>
        ) : null}
      </div>
    </aside>
  );
}
const MindMapNodeShape = memo(function MindMapNodeShape({
  placed,
  selected,
  onSelect,
  onToggle,
}: {
  placed: Placed;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const { node, label, x, y, width, height, depth, hasChildren, expanded } = placed,
    root = depth === 0,
    font = LABEL_FONT[labelKind(depth, hasChildren)];
  const fill = root ? "fill-primary/10" : hasChildren ? "fill-card" : "fill-background",
    stroke = selected
      ? "stroke-primary/70"
      : root
        ? "stroke-primary/45"
        : hasChildren
          ? "stroke-border"
          : "stroke-border/65";
  return (
    <g
      data-mindmap-node
      transform={`translate(${x} ${y})`}
      className="cursor-pointer outline-none"
      style={{ transition: "transform 180ms cubic-bezier(.2,.8,.2,1)" }}
      onClick={() => onSelect(node.id)}
      role="treeitem"
      aria-label={node.label}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={selected}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
    >
      {/* A cut label keeps its full text a hover away. */}
      {label !== node.label && <title>{node.label}</title>}
      <rect
        width={width}
        height={height}
        rx={root ? 5 : 4}
        className={`${fill} ${stroke} transition-colors`}
        strokeWidth={selected ? 1.5 : 1}
      />
      <text
        x={11}
        y={height / 2}
        dominantBaseline="central"
        className={`pointer-events-none ${root || hasChildren ? "fill-foreground" : "fill-muted-foreground"}`}
        style={{ fontSize: `${font.size}rem`, fontWeight: font.weight }}
      >
        {label}
      </text>
      {hasChildren && (
        <g
          transform={`translate(${width - CONTROL_WIDTH} 0)`}
          className="group"
          role="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${node.label}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(node.id);
          }}
        >
          <rect width={CONTROL_WIDTH} height={height} rx={4} className="fill-transparent" />
          {expanded ? (
            <ChevronDown
              x={5}
              y={(height - 12) / 2}
              width={12}
              height={12}
              className="pointer-events-none stroke-muted-foreground transition-colors group-hover:stroke-foreground"
              strokeWidth={1.8}
            />
          ) : (
            <ChevronRight
              x={5}
              y={(height - 12) / 2}
              width={12}
              height={12}
              className="pointer-events-none stroke-muted-foreground transition-colors group-hover:stroke-foreground"
              strokeWidth={1.8}
            />
          )}
        </g>
      )}
    </g>
  );
});
