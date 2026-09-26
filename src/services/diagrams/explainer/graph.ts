/**
 * Reads a rendered Mermaid SVG back into a graph we can animate.
 *
 * Mermaid already did the hard part twice over: it laid the diagram out, and it
 * left the topology in the DOM. A flowchart edge is a `path.flowchart-link`
 * carrying `data-id="L_<source>_<target>_<index>"`, so source and target come
 * straight off the element and we never parse the Mermaid text ourselves. That
 * matters: a second parser would be a second dialect to keep in sync with
 * upstream, and it would disagree with the layout the reader is looking at.
 *
 * Everything here is read-only. Nothing in this module mutates the SVG.
 */

import { isSequenceDiagram, readSequence } from "./sequence";

/**
 * Node count past which exact per-node measurement stops being affordable.
 *
 * Each `getBBox` is a layout flush; the explainer only uses the result for
 * camera framing, so an approximation is a fair trade well before the point
 * where the flushes themselves freeze the tab.
 */
const EXACT_MEASURE_BUDGET = 1_200;

/** A node as laid out by Mermaid. */
export interface ExplainerNode {
  /** The mermaid-assigned element id; unique within one render. */
  id: string;
  /** The author's own identifier (`React`), recovered from the element id. */
  key: string;
  /** Visible text, used for step descriptions. */
  label: string;
  el: SVGGElement;
  /** Centre in diagram (viewBox) coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An edge, with the geometry the player needs to draw it. */
export interface ExplainerEdge {
  id: string;
  /** Author-level endpoints, as encoded in `data-id`. */
  sourceKey: string;
  targetKey: string;
  /** Resolved element ids, once endpoints are matched to nodes. */
  source: string;
  target: string;
  path: SVGPathElement;
  /** The label group riding on this edge, when it has one. */
  label: SVGGElement | null;
  /** Path length in user units; drives draw duration. */
  length: number;
  /** The label's text, which may carry an author's step number (`1. Login`). */
  text?: string;
}

/**
 * What planning and camera framing actually need: positions and topology.
 *
 * The SVG explainer's graph (below) carries element handles on top of this; the
 * GPU engine (services/diagrams/engine) builds one straight from its own layout, with
 * no DOM at all. Keeping the planner and the camera on this narrower type is
 * what lets both renderers share one idea of the order and the framing.
 */
export interface GraphShapeNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphShape {
  nodes: Map<string, GraphShapeNode>;
  /** `text` is the edge's label, which may carry an author's step number. */
  edges: { id: string; source: string; target: string; length: number; text?: string }[];
  baseView: { x: number; y: number; width: number; height: number };
  /** A sequence diagram plays in emitted order instead of by traversal. */
  sequence?: boolean;
}

export interface ExplainerGraph extends GraphShape {
  nodes: Map<string, ExplainerNode>;
  edges: ExplainerEdge[];
  /** Subgraph boxes, for camera framing. */
  clusters: { el: SVGGElement; x: number; y: number; width: number; height: number }[];
  svg: SVGSVGElement;
  /** The untouched viewBox: the camera's home framing. */
  baseView: { x: number; y: number; width: number; height: number };
}

/** `translate(12.5, 40)` -> `{x, y}`, accumulated up to the svg root. */
function absoluteTranslate(el: Element): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let current: Element | null = el;
  while (current && current.tagName !== "svg") {
    const transform = current.getAttribute("transform");
    const match = transform?.match(/translate\(\s*([\d.eE+-]+)[,\s]+([\d.eE+-]+)\s*\)/);
    if (match) {
      x += parseFloat(match[1]);
      y += parseFloat(match[2]);
    }
    current = current.parentElement;
  }
  return { x, y };
}

/**
 * Recover the author's node name from a Mermaid element id.
 *
 * Mermaid builds these as `<graphId>-flowchart-<key>-<counter>`. The key itself
 * can contain hyphens, so we strip the known prefix and the trailing counter
 * rather than splitting on "-" and hoping.
 */
function nodeKeyFromId(id: string): string {
  const withoutCounter = id.replace(/-\d+$/, "");
  const marker = withoutCounter.match(/-(?:flowchart|state|entity|classId|node)-(.+)$/);
  if (marker) return marker[1];
  // Other diagram families don't use a prefix; the id is the key.
  return withoutCounter;
}

/**
 * Split `L_source_target_0` into its endpoints.
 *
 * Node names may themselves contain underscores, which makes this ambiguous in
 * general. We resolve it against the set of names we actually found, trying the
 * longest plausible source first, so `L_my_api_gateway_0` binds to a real
 * `my_api` before it invents one.
 */
/**
 * Every edge shape we know how to draw.
 *
 * Mermaid gives each diagram family its own edge class, but they are all a
 * single `<path>` with a start and an end, which is the only thing the player
 * needs. Sequence, timeline, xychart and journey are deliberately absent: they
 * have no node graph to walk, so the caller falls back rather than inventing an
 * order for something that has none.
 */
const EDGE_SELECTOR = [
  "path.flowchart-link", // flowchart
  "path.transition", // stateDiagram
  "path.relation", // classDiagram
  "path.relationshipLine", // erDiagram
].join(", ");

/**
 * Resolve an edge's endpoints from where it starts and ends.
 *
 * State diagrams number their edges (`edge0`) instead of naming the states they
 * join, so the id tells us nothing. The drawn path does: its first and last
 * points touch the boundary of the two nodes, so the nearest node to each end
 * is the answer. Distance is measured to the node's box rather than its centre,
 * so a wide node is not beaten by a narrow one that happens to sit closer to
 * the middle.
 */
function endpointsByGeometry(
  path: SVGPathElement,
  index: NodeIndex,
  length: number,
): { source: ExplainerNode; target: ExplainerNode } | null {
  if (index.isEmpty) return null;
  let start: DOMPoint;
  let end: DOMPoint;
  try {
    if (!length) return null;
    start = path.getPointAtLength(0);
    end = path.getPointAtLength(length);
  } catch {
    return null;
  }
  const source = index.nearest(start);
  const target = index.nearest(end);
  if (!source || !target || source === target) return null;
  return { source, target };
}

/**
 * A uniform grid over the diagram, for resolving an edge endpoint to a node.
 *
 * The linear version of this scanned every node twice per edge, which is
 * O(edges × nodes) — on a state or ER diagram (where Mermaid does not name
 * endpoints in `data-id`, so *every* edge takes this path) that was the single
 * most expensive thing in the render. Bucketing by cell turns the common case
 * into a look at the endpoint's own cell and its immediate neighbours.
 *
 * The search widens ring by ring and only stops once the nearest candidate is
 * closer than the next ring could possibly be, so the answer is identical to
 * the exhaustive scan — this is a faster way to the same node, not an
 * approximation.
 */
class NodeIndex {
  private readonly cells = new Map<string, ExplainerNode[]>();
  private readonly cellSize: number;
  private readonly nodes: ExplainerNode[];

  constructor(nodes: ExplainerNode[]) {
    this.nodes = nodes;
    // Size cells to the typical node, so a cell holds a handful of entries
    // rather than one each (memory) or all of them (no speedup).
    const median =
      nodes.length === 0
        ? 1
        : Math.max(
            1,
            nodes.reduce((sum, node) => sum + Math.max(node.width, node.height), 0) / nodes.length,
          );
    this.cellSize = median * 2;
    for (const node of nodes) {
      const key = this.key(node.x, node.y);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(node);
      else this.cells.set(key, [node]);
    }
  }

  get isEmpty(): boolean {
    return this.nodes.length === 0;
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }

  private static distance(point: { x: number; y: number }, node: ExplainerNode): number {
    const dx = Math.max(Math.abs(point.x - node.x) - node.width / 2, 0);
    const dy = Math.max(Math.abs(point.y - node.y) - node.height / 2, 0);
    return Math.hypot(dx, dy);
  }

  nearest(point: { x: number; y: number }): ExplainerNode | null {
    if (this.isEmpty) return null;
    const originX = Math.floor(point.x / this.cellSize);
    const originY = Math.floor(point.y / this.cellSize);

    let best: ExplainerNode | null = null;
    let bestDistance = Infinity;

    // Widen the ring until the closest possible node in the next ring is
    // further than what we already have. A node's own extent can straddle
    // cells, so the guard uses the ring's inner edge, not its centre.
    for (let ring = 0; ring < MAX_INDEX_RINGS; ring++) {
      if (best && (ring - 1) * this.cellSize > bestDistance) break;
      let examined = false;
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          // Only the ring's perimeter is new; the interior was covered already.
          if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
          const bucket = this.cells.get(`${originX + dx},${originY + dy}`);
          if (!bucket) continue;
          examined = true;
          for (const node of bucket) {
            const distance = NodeIndex.distance(point, node);
            if (distance < bestDistance) {
              bestDistance = distance;
              best = node;
            }
          }
        }
      }
      // An empty neighbourhood far from everything: fall back rather than
      // spiralling out over a sparse grid forever.
      if (!examined && ring > SPARSE_RING_GIVEUP && !best) break;
    }

    // A diagram laid out so sparsely that the rings found nothing still has to
    // answer. This runs at most once per endpoint, not once per node.
    if (!best) {
      for (const node of this.nodes) {
        const distance = NodeIndex.distance(point, node);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = node;
        }
      }
    }
    return best;
  }
}

/** Rings to widen before giving up on the grid and scanning directly. */
const MAX_INDEX_RINGS = 32;
const SPARSE_RING_GIVEUP = 4;

function splitEdgeId(dataId: string, keys: Set<string>): { source: string; target: string } | null {
  const body = dataId.replace(/^L_/, "").replace(/_\d+$/, "");
  const parts = body.split("_");
  for (let cut = parts.length - 1; cut >= 1; cut--) {
    const source = parts.slice(0, cut).join("_");
    const target = parts.slice(cut).join("_");
    if (keys.has(source) && keys.has(target)) return { source, target };
  }
  return null;
}

/**
 * Build the animatable graph from a freshly rendered SVG.
 *
 * Returns `null` when the diagram has no edges we can sequence — a pie chart, a
 * mindmap, a gantt. Those still render perfectly well statically; they just
 * aren't a walk through a system, so the caller falls back rather than
 * inventing an order for something that has none.
 */
export function readGraph(svg: SVGSVGElement): ExplainerGraph | null {
  // A sequence diagram has no node graph at all — participants and messages
  // instead — so it gets its own reader rather than being forced through the
  // node/edge selectors below.
  if (isSequenceDiagram(svg)) return readSequence(svg);

  const view = svg.viewBox.baseVal;
  const baseView = { x: view.x, y: view.y, width: view.width, height: view.height };

  const nodes = new Map<string, ExplainerNode>();
  const byKey = new Map<string, ExplainerNode>();
  const nodeElements = svg.querySelectorAll<SVGGElement>("g.node");
  // `getBBox` forces a synchronous layout. One call is trivial; one per node
  // over a few thousand nodes is seconds of blocking work before the explainer
  // has drawn anything. Past the budget the boxes are approximated from the
  // element's own geometry attributes instead, which costs no layout — the
  // camera loses a little padding accuracy and nothing else.
  const measureExactly = nodeElements.length <= EXACT_MEASURE_BUDGET;
  for (const el of nodeElements) {
    const position = absoluteTranslate(el);
    let width = 0;
    let height = 0;
    if (measureExactly) {
      try {
        const box = el.getBBox();
        width = box.width;
        height = box.height;
      } catch {
        // getBBox throws on a detached or display:none subtree. A zero box only
        // costs the camera some padding, so it is not worth failing the render.
      }
    } else {
      const shape = el.querySelector("rect, circle, ellipse, polygon, path");
      const attr = (name: string) => parseFloat(shape?.getAttribute(name) ?? "") || 0;
      // A circle and an ellipse carry radii rather than a width and a height,
      // so reading `width` off them would silently yield a zero box and lose
      // the camera its padding on exactly the diagrams that use them.
      const radiusX = attr("rx") || attr("r");
      const radiusY = attr("ry") || attr("r");
      width = attr("width") || radiusX * 2;
      height = attr("height") || radiusY * 2;
    }
    const node: ExplainerNode = {
      id: el.id,
      key: nodeKeyFromId(el.id),
      label: el.textContent?.trim() ?? "",
      el,
      x: position.x,
      y: position.y,
      width,
      height,
    };
    nodes.set(node.id, node);
    // First writer wins: with duplicate labels the earlier node keeps the key,
    // which matches the order Mermaid numbers them in.
    if (!byKey.has(node.key)) byKey.set(node.key, node);
  }

  const keys = new Set(byKey.keys());
  const paths = [...svg.querySelectorAll<SVGPathElement>(EDGE_SELECTOR)];
  // Mermaid emits one `g.edgeLabel` per edge, in path order, whether or not the
  // edge is labelled. Index-pairing is therefore exact, and cheaper (and more
  // stable) than matching a label box against a path midpoint.
  const labelGroups = [...svg.querySelectorAll<SVGGElement>("g.edgeLabels > g.edgeLabel")];

  const edges: ExplainerEdge[] = [];
  const nodeList = [...nodes.values()];
  // Built once, not once per edge. Only needed when an edge fails to name its
  // endpoints, so it is created lazily — a flowchart never pays for it.
  let geometryIndex: NodeIndex | null = null;
  paths.forEach((path, index) => {
    const dataId = path.getAttribute("data-id") ?? path.id;
    // Flowchart, class and ER diagrams name their endpoints in the edge id.
    // State diagrams do not (`edge0`, `edge1`, …), so fall back to geometry:
    // an edge's first and last point sit on the boundary of the nodes it
    // joins, which resolves them exactly.
    const named = splitEdgeId(dataId, keys);
    let source = named ? byKey.get(named.source) : undefined;
    let target = named ? byKey.get(named.target) : undefined;
    // `getTotalLength` forces a layout flush, so it is read once and shared
    // between endpoint resolution and the stored duration rather than being
    // called twice per edge as it was before.
    let length = 0;
    try {
      length = path.getTotalLength();
    } catch {
      // getBBox/getTotalLength throw on a detached or display:none subtree. A
      // zero-length edge just draws at the floor duration instead of being
      // scaled by its length.
    }
    if (!source || !target) {
      geometryIndex ??= new NodeIndex(nodeList);
      const ends = endpointsByGeometry(path, geometryIndex, length);
      source = source ?? ends?.source;
      target = target ?? ends?.target;
    }
    if (!source || !target || source === target) return;
    edges.push({
      id: path.id || dataId,
      sourceKey: source.key,
      targetKey: target.key,
      source: source.id,
      target: target.id,
      path,
      label: labelGroups[index] ?? null,
      text: labelGroups[index]?.textContent?.trim() || undefined,
      length,
    });
  });

  if (edges.length === 0) return null;

  const clusters = [...svg.querySelectorAll<SVGGElement>("g.cluster")].map((el) => {
    const rect = el.querySelector("rect");
    return {
      el,
      x: parseFloat(rect?.getAttribute("x") ?? "0"),
      y: parseFloat(rect?.getAttribute("y") ?? "0"),
      width: parseFloat(rect?.getAttribute("width") ?? "0"),
      height: parseFloat(rect?.getAttribute("height") ?? "0"),
    };
  });

  return { nodes, edges, clusters, svg, baseView };
}
