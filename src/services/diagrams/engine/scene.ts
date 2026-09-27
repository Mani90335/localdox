/**
 * A laid-out diagram as flat typed arrays, ready for the GPU.
 *
 * Everything the renderer and the timeline touch per frame lives in typed
 * arrays indexed by node or edge number, never in objects or maps: at 10,000
 * nodes and 12,000 edges a frame has to be a handful of linear passes over
 * contiguous memory. The string ids Mermaid uses survive only in `graph`,
 * which the explainer's planner and camera read once, up front.
 *
 * Pure: text measurement and the layout engine are passed in, so this builds
 * the same scene in the browser and in the tests.
 */
import type { GraphShape } from "../explainer/graph.ts";
import type { DiagramKind, FlowModel, NodeShape, EdgeStroke, TableSpec } from "./flowchart.ts";
import { emitMarker, markerInset, trimPolyline } from "./markers.ts";
import type { LayoutEngine, LayoutShape } from "./layout.ts";

/** Label type size, in diagram units; the SVG path's is 16. */
export const FONT_SIZE = 14;
export const LINE_HEIGHT = Math.round(FONT_SIZE * 1.3);
const PAD_X = 15;
/**
 * The proportions a large layout is folded toward (width / height). Roughly a
 * stage or a screen: a 10,000-node tree would otherwise be ~300:1, a line.
 */
export const TARGET_ASPECT = 1.8;
/** How far along an edge its step-number badge sits (matches the SVG player). */
export const BADGE_AT = 0.7;
const PAD_Y = 12;

export const SHAPE_CODE: Record<NodeShape, number> = {
  rect: 0,
  round: 1,
  stadium: 2,
  ellipse: 3,
  diamond: 4,
  hexagon: 5,
  start: 6,
  end: 7,
  bar: 8,
};

/** Rows of a table node: a little taller than a text line, like Mermaid's. */
export const ROW_HEIGHT = LINE_HEIGHT + 6;
const TABLE_PAD_X = 10;
const COLUMN_GAP = 14;

/** Where a table node's parts sit, relative to its top-left corner. */
export interface TableLayout extends TableSpec {
  headerHeight: number;
  /** Left edge of each column. */
  columns: number[];
  /** Top of each section. */
  sectionTops: number[];
}

export const STROKE_CODE: Record<EdgeStroke, number> = {
  normal: 0,
  thick: 1,
  dotted: 2,
  invisible: 3,
};

/** Width of a line of label text, in diagram units at `FONT_SIZE`. */
export type Measure = (text: string) => number;

export interface Scene {
  width: number;
  height: number;
  nodeCount: number;
  edgeCount: number;

  nodeX: Float32Array;
  nodeY: Float32Array;
  nodeW: Float32Array;
  nodeH: Float32Array;
  nodeShape: Uint8Array;
  nodeLines: string[][];
  nodeFill: (string | undefined)[];
  nodeStroke: (string | undefined)[];
  nodeColor: (string | undefined)[];

  edgeSource: Uint32Array;
  edgeTarget: Uint32Array;
  edgeStroke: Uint8Array;
  /**
   * Edge-end markers as geometry, drawn once an edge is complete: segments
   * (x0, y0, x1, y1, edge) and filled triangles (x0, y0, x1, y1, x2, y2, edge).
   */
  markerSegments: Float32Array;
  markerTriangles: Float32Array;
  /** Table nodes (ER entities, classes); undefined for ordinary boxes. */
  nodeTable: (TableLayout | undefined)[];
  kind: DiagramKind;
  edgeLines: string[][];
  labelX: Float32Array;
  labelY: Float32Array;
  labelW: Float32Array;
  labelH: Float32Array;

  /** Edge `e`'s smoothed points are `[pointOffsets[e], pointOffsets[e + 1])`. */
  pointOffsets: Uint32Array;
  /** Interleaved x, y. */
  points: Float32Array;
  /** Distance along the edge at each point. */
  pointDistance: Float32Array;
  edgeLength: Float32Array;
  /** Where each edge's step-number badge sits: 70% of the way along it. */
  badgeX: Float32Array;
  badgeY: Float32Array;

  /** The same diagram as the explainer's planner and camera see it. */
  graph: GraphShape;
  /** Mermaid id → node index, and the graph's edge id → edge index. */
  nodeIndex: Map<string, number>;
  edgeIndex: Map<string, number>;
  /** How long the layout itself took, for diagnostics. */
  layoutMs: number;
}

function layoutShape(shape: NodeShape): LayoutShape {
  if (shape === "ellipse" || shape === "start" || shape === "end") return "ellipse";
  if (shape === "diamond") return "diamond";
  return "rect";
}

/** Box size for a label, mirroring how Mermaid grows each shape around text. */
export function nodeSize(shape: NodeShape, textWidth: number, lineCount: number): [number, number] {
  const textHeight = lineCount * LINE_HEIGHT;
  const width = Math.max(textWidth + PAD_X * 2, 48);
  const height = textHeight + PAD_Y * 2;
  switch (shape) {
    case "start":
      return [14, 14];
    case "end":
      return [18, 18];
    case "bar":
      return [70, 8];
    case "stadium":
    case "hexagon":
      return [width + textHeight, height];
    case "ellipse": {
      const d = Math.max(textWidth, textHeight) + PAD_Y * 2;
      return [d, d];
    }
    case "diamond": {
      const d = lineCount === 0 ? 26 : textWidth + textHeight + PAD_Y * 2;
      return [d, d];
    }
    default:
      return [width, height];
  }
}

/**
 * Size a table node and place its parts.
 *
 * ER rows are cells (type, name, keys, comment) laid out in columns as wide as
 * their widest cell, skipping columns no row uses; class rows are one cell.
 * Every section gets at least a sliver of height, since an empty compartment
 * is still drawn (a class with no members shows an empty members box).
 */
export function tableLayout(
  spec: TableSpec,
  widthOf: (lines: string[]) => number,
): { layout: TableLayout; width: number; height: number } {
  const columnCount = Math.max(0, ...spec.sections.flatMap((rows) => rows.map((r) => r.length)));
  const columnWidth = new Array<number>(columnCount).fill(0);
  for (const rows of spec.sections) {
    for (const row of rows) {
      row.forEach((cell, c) => {
        if (cell) columnWidth[c] = Math.max(columnWidth[c], widthOf([cell]));
      });
    }
  }
  const columns: number[] = [];
  let x = TABLE_PAD_X;
  for (let c = 0; c < columnCount; c++) {
    columns.push(x);
    if (columnWidth[c] > 0) x += columnWidth[c] + COLUMN_GAP;
  }
  const rowsWidth = x - COLUMN_GAP + TABLE_PAD_X;
  const headerHeight = spec.header.length * LINE_HEIGHT + PAD_Y;
  const width = Math.max(widthOf(spec.header) + PAD_X * 2, rowsWidth, 80);
  const sectionTops: number[] = [];
  let y = headerHeight;
  for (const rows of spec.sections) {
    sectionTops.push(y);
    y += Math.max(8, rows.length * ROW_HEIGHT + 6);
  }
  return {
    layout: { ...spec, headerHeight, columns, sectionTops },
    width,
    height: Math.max(y, headerHeight + 8),
  };
}

/**
 * Smooth a polyline the way Mermaid draws edges (d3's `curveBasis`), sampled
 * to straight segments. Two-point edges — most of them — stay a single segment.
 */
export function basisCurve(points: number[], samples = 6): number[] {
  const n = points.length / 2;
  if (n <= 2) return points.slice();
  const out: number[] = [points[0], points[1]];
  let x0 = points[0];
  let y0 = points[1];
  let x1 = points[2];
  let y1 = points[3];
  let lastX = x0;
  let lastY = y0;
  const bezier = (c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number) => {
    const sx = lastX;
    const sy = lastY;
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const u = 1 - t;
      out.push(
        u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
        u * u * u * sy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
      );
    }
    lastX = ex;
    lastY = ey;
  };
  // d3: the first interior point opens with a line to (5·p0 + p1) / 6.
  lastX = (5 * x0 + x1) / 6;
  lastY = (5 * y0 + y1) / 6;
  out.push(lastX, lastY);
  for (let i = 2; i < n; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    bezier(
      (2 * x0 + x1) / 3,
      (2 * y0 + y1) / 3,
      (x0 + 2 * x1) / 3,
      (y0 + 2 * y1) / 3,
      (x0 + 4 * x1 + x) / 6,
      (y0 + 4 * y1 + y) / 6,
    );
    x0 = x1;
    y0 = y1;
    x1 = x;
    y1 = y;
  }
  // Line end: one more segment toward the last point, then onto it.
  bezier(
    (2 * x0 + x1) / 3,
    (2 * y0 + y1) / 3,
    (x0 + 2 * x1) / 3,
    (y0 + 2 * y1) / 3,
    (x0 + 5 * x1) / 6,
    (y0 + 5 * y1) / 6,
  );
  out.push(x1, y1);
  return out;
}

export function buildScene(model: FlowModel, measure: Measure, layout: LayoutEngine): Scene {
  const nodeCount = model.nodes.length;
  const edgeCount = model.edges.length;

  const nodeW = new Float32Array(nodeCount);
  const nodeH = new Float32Array(nodeCount);
  const nodeShape = new Uint8Array(nodeCount);
  // Labels repeat ("Service", "Yes"), and measuring is the one per-node cost
  // that touches the browser's text engine.
  const widths = new Map<string, number>();
  const widthOf = (lines: string[]) => {
    let widest = 0;
    for (const line of lines) {
      let w = widths.get(line);
      if (w === undefined) {
        w = measure(line);
        widths.set(line, w);
      }
      widest = Math.max(widest, w);
    }
    return widest;
  };
  const nodeTable: (TableLayout | undefined)[] = new Array(nodeCount);
  const sideways = model.direction === "LR" || model.direction === "RL";
  model.nodes.forEach((node, i) => {
    nodeShape[i] = SHAPE_CODE[node.shape];
    if (node.table) {
      const table = tableLayout(node.table, widthOf);
      nodeTable[i] = table.layout;
      nodeW[i] = table.width;
      nodeH[i] = table.height;
      return;
    }
    let [w, h] = nodeSize(node.shape, widthOf(node.lines), node.lines.length);
    // A fork or join bar lies across the flow.
    if (node.shape === "bar" && sideways) [w, h] = [h, w];
    nodeW[i] = w;
    nodeH[i] = h;
  });

  const labelW = new Float32Array(edgeCount);
  const labelH = new Float32Array(edgeCount);
  model.edges.forEach((edge, e) => {
    if (!edge.lines.length) return;
    labelW[e] = widthOf(edge.lines) + 8;
    labelH[e] = edge.lines.length * LINE_HEIGHT + 4;
  });

  const started = performance.now();
  const result = layout({
    direction: model.direction,
    aspect: TARGET_ASPECT,
    nodes: model.nodes.map((node, i) => ({
      width: nodeW[i],
      height: nodeH[i],
      shape: layoutShape(node.shape),
    })),
    edges: model.edges.map((edge, e) => ({
      source: edge.source,
      target: edge.target,
      labelWidth: labelW[e],
      labelHeight: labelH[e],
    })),
  });
  const layoutMs = performance.now() - started;

  const nodeX = new Float32Array(nodeCount);
  const nodeY = new Float32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    nodeX[i] = result.nodes[i * 2];
    nodeY[i] = result.nodes[i * 2 + 1];
  }

  const segments: number[] = [];
  const triangles: number[] = [];
  const sink = (edge: number) => ({
    segment: (x0: number, y0: number, x1: number, y1: number) =>
      segments.push(x0, y0, x1, y1, edge),
    triangle: (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) =>
      triangles.push(x0, y0, x1, y1, x2, y2, edge),
  });

  // Smooth every edge, then flatten into one point array with distances.
  const smoothed: number[][] = [];
  let totalPoints = 0;
  for (let e = 0; e < edgeCount; e++) {
    const from = result.edgeOffsets[e];
    const to = result.edgeOffsets[e + 1];
    const raw = Array.from(result.points.subarray(from * 2, to * 2));
    let curve = basisCurve(raw);
    // Markers sit where the edge meets each node, pointing the way the edge
    // travels there; hollow ones then trim the stroke so it stops at them.
    const edge = model.edges[e];
    const n = curve.length;
    if (n >= 4 && edge.stroke !== "invisible") {
      const endDx = curve[n - 2] - curve[n - 4];
      const endDy = curve[n - 1] - curve[n - 3];
      const endLen = Math.hypot(endDx, endDy) || 1;
      emitMarker(
        edge.markerEnd,
        curve[n - 2],
        curve[n - 1],
        endDx / endLen,
        endDy / endLen,
        sink(e),
      );
      const startDx = curve[0] - curve[2];
      const startDy = curve[1] - curve[3];
      const startLen = Math.hypot(startDx, startDy) || 1;
      emitMarker(
        edge.markerStart,
        curve[0],
        curve[1],
        startDx / startLen,
        startDy / startLen,
        sink(e),
      );
      curve = trimPolyline(curve, markerInset(edge.markerEnd), false);
      curve = trimPolyline(curve, markerInset(edge.markerStart), true);
    }
    smoothed.push(curve);
    totalPoints += curve.length / 2;
  }
  const pointOffsets = new Uint32Array(edgeCount + 1);
  const points = new Float32Array(totalPoints * 2);
  const pointDistance = new Float32Array(totalPoints);
  const edgeLength = new Float32Array(edgeCount);
  let cursor = 0;
  for (let e = 0; e < edgeCount; e++) {
    pointOffsets[e] = cursor;
    const curve = smoothed[e];
    let distance = 0;
    for (let i = 0; i < curve.length; i += 2) {
      if (i > 0) distance += Math.hypot(curve[i] - curve[i - 2], curve[i + 1] - curve[i - 1]);
      points[cursor * 2] = curve[i];
      points[cursor * 2 + 1] = curve[i + 1];
      pointDistance[cursor] = distance;
      cursor++;
    }
    edgeLength[e] = distance;
  }
  pointOffsets[edgeCount] = cursor;

  const badgeX = new Float32Array(edgeCount);
  const badgeY = new Float32Array(edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    const at = edgeLength[e] * BADGE_AT;
    let p = pointOffsets[e];
    const last = pointOffsets[e + 1] - 1;
    while (p < last - 1 && pointDistance[p + 1] < at) p++;
    const span = pointDistance[p + 1] - pointDistance[p] || 1;
    const t = Math.min(1, Math.max(0, (at - pointDistance[p]) / span));
    badgeX[e] = points[p * 2] + (points[p * 2 + 2] - points[p * 2]) * t;
    badgeY[e] = points[p * 2 + 1] + (points[p * 2 + 3] - points[p * 2 + 1]) * t;
  }

  const labelX = new Float32Array(edgeCount);
  const labelY = new Float32Array(edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    labelX[e] = result.labels[e * 2];
    labelY[e] = result.labels[e * 2 + 1];
  }

  const edgeSource = new Uint32Array(edgeCount);
  const edgeTarget = new Uint32Array(edgeCount);
  const edgeStroke = new Uint8Array(edgeCount);
  model.edges.forEach((edge, e) => {
    edgeSource[e] = edge.source;
    edgeTarget[e] = edge.target;
    edgeStroke[e] = STROKE_CODE[edge.stroke];
  });

  const nodeIndex = new Map<string, number>();
  const edgeIndex = new Map<string, number>();
  const graphNodes: GraphShape["nodes"] = new Map();
  model.nodes.forEach((node, i) => {
    nodeIndex.set(node.id, i);
    graphNodes.set(node.id, {
      id: node.id,
      label:
        node.lines.join(" ") ||
        (node.shape === "start" ? "Start" : node.shape === "end" ? "End" : node.id),
      x: nodeX[i],
      y: nodeY[i],
      width: nodeW[i],
      height: nodeH[i],
    });
  });
  const graphEdges: GraphShape["edges"] = model.edges.map((edge, e) => {
    const id = `e${e}`;
    edgeIndex.set(id, e);
    return {
      id,
      source: model.nodes[edge.source].id,
      target: model.nodes[edge.target].id,
      length: edgeLength[e],
      text: model.edges[e].lines.join(" ") || undefined,
    };
  });

  return {
    width: result.width,
    height: result.height,
    nodeCount,
    edgeCount,
    nodeX,
    nodeY,
    nodeW,
    nodeH,
    nodeShape,
    nodeLines: model.nodes.map((node) => node.lines),
    nodeFill: model.nodes.map((node) => node.fill),
    nodeStroke: model.nodes.map((node) => node.stroke),
    nodeColor: model.nodes.map((node) => node.color),
    edgeSource,
    edgeTarget,
    edgeStroke,
    markerSegments: new Float32Array(segments),
    markerTriangles: new Float32Array(triangles),
    nodeTable,
    kind: model.kind,
    edgeLines: model.edges.map((edge) => edge.lines),
    labelX,
    labelY,
    labelW,
    labelH,
    pointOffsets,
    points,
    pointDistance,
    edgeLength,
    badgeX,
    badgeY,
    graph: {
      nodes: graphNodes,
      edges: graphEdges,
      baseView: { x: 0, y: 0, width: result.width, height: result.height },
    },
    nodeIndex,
    edgeIndex,
    layoutMs,
  };
}
