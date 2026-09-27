/**
 * dagre (Mermaid's layout) against the Rust/WASM layered layout, same graphs.
 *
 * Reports time and a geometric crossing count — segments of different edges
 * that properly intersect in the final drawing — which is the quality measure
 * a reader actually sees, and the same for both engines.
 *
 *   node --experimental-strip-types bench/layout-compare.ts 500 2000 5000
 *   (dagre is skipped past 5,000 nodes unless --dagre is passed; it takes minutes)
 */
import { readFileSync } from "node:fs";
import { graphlib } from "dagre-d3-es";
import { layout as dagreLayout } from "dagre-d3-es/src/dagre/index.js";
import { instantiateLayout } from "../src/services/diagrams/engine/layout.ts";
import { syntheticGraph } from "./generate.ts";

type Segment = [number, number, number, number, number]; // x1 y1 x2 y2 edge

function crossings(segments: Segment[], ends: [number, number][]): number {
  // Uniform grid over segment bounding boxes; each pair tested once.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x1, y1, x2, y2] of segments) {
    minX = Math.min(minX, x1, x2);
    maxX = Math.max(maxX, x1, x2);
    minY = Math.min(minY, y1, y2);
    maxY = Math.max(maxY, y1, y2);
  }
  const cells = Math.max(1, Math.ceil(Math.sqrt(segments.length)));
  const cw = (maxX - minX) / cells || 1;
  const ch = (maxY - minY) / cells || 1;
  const grid = new Map<number, number[]>();
  segments.forEach(([x1, y1, x2, y2], index) => {
    const cx0 = Math.floor((Math.min(x1, x2) - minX) / cw),
      cx1 = Math.floor((Math.max(x1, x2) - minX) / cw);
    const cy0 = Math.floor((Math.min(y1, y2) - minY) / ch),
      cy1 = Math.floor((Math.max(y1, y2) - minY) / ch);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = cy * (cells + 1) + cx;
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        list.push(index);
      }
  });
  const seen = new Set<number>();
  let count = 0;
  const cross = (a: Segment, b: Segment) => {
    const d = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
      (qx - px) * (ry - py) - (qy - py) * (rx - px);
    const d1 = d(a[0], a[1], a[2], a[3], b[0], b[1]);
    const d2 = d(a[0], a[1], a[2], a[3], b[2], b[3]);
    const d3 = d(b[0], b[1], b[2], b[3], a[0], a[1]);
    const d4 = d(b[0], b[1], b[2], b[3], a[2], a[3]);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  for (const list of grid.values()) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = segments[list[i]],
          b = segments[list[j]];
        if (a[4] === b[4]) continue;
        const [as, at] = ends[a[4]],
          [bs, bt] = ends[b[4]];
        // Edges sharing a node meet there by construction; not a crossing.
        if (as === bs || as === bt || at === bs || at === bt) continue;
        const lo = Math.min(list[i], list[j]),
          hi = Math.max(list[i], list[j]);
        const key = lo * segments.length + hi;
        if (seen.has(key)) continue;
        seen.add(key);
        if (cross(a, b)) count++;
      }
  }
  return count;
}

function toSegments(lines: [number, number][][]): Segment[] {
  const out: Segment[] = [];
  lines.forEach((line, edge) => {
    for (let i = 1; i < line.length; i++)
      out.push([line[i - 1][0], line[i - 1][1], line[i][0], line[i][1], edge]);
  });
  return out;
}

const sizes = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--"))
  .map(Number);
const forceDagre = process.argv.includes("--dagre");
const engine = await instantiateLayout(
  readFileSync(new URL("../src/services/diagrams/engine/diagram_layout.wasm", import.meta.url)),
);

for (const n of sizes.length ? sizes : [500, 2000, 5000, 10000]) {
  const graph = syntheticGraph(n);
  const ends = graph.edges;
  const row: Record<string, number | string> = { nodes: n, edges: ends.length };

  let start = performance.now();
  const result = engine({
    nodes: Array.from({ length: n }, () => ({ width: 120, height: 40 })),
    edges: ends.map(([source, target]) => ({ source, target })),
  });
  row.wasmMs = Math.round(performance.now() - start);
  const wasmLines = ends.map((_, e) => {
    const line: [number, number][] = [];
    for (let p = result.edgeOffsets[e]; p < result.edgeOffsets[e + 1]; p++)
      line.push([result.points[p * 2], result.points[p * 2 + 1]]);
    return line;
  });
  row.wasmCrossings = crossings(toSegments(wasmLines), ends);
  row.wasmSize = `${Math.round(result.width)}×${Math.round(result.height)}`;

  if (n <= 5000 || forceDagre) {
    const g = new graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 50 });
    g.setDefaultEdgeLabel(() => ({}));
    for (let i = 0; i < n; i++) g.setNode(`n${i}`, { width: 120, height: 40 });
    ends.forEach(([a, b], k) => g.setEdge(`n${a}`, `n${b}`, {}, `e${k}`));
    start = performance.now();
    dagreLayout(g);
    row.dagreMs = Math.round(performance.now() - start);
    const dagreLines = ends.map(([a, b], k) =>
      (g.edge(`n${a}`, `n${b}`, `e${k}`).points as { x: number; y: number }[]).map(
        (p) => [p.x, p.y] as [number, number],
      ),
    );
    row.dagreCrossings = crossings(toSegments(dagreLines), ends);
    const size = g.graph() as { width: number; height: number };
    row.dagreSize = `${Math.round(size.width)}×${Math.round(size.height)}`;
  }
  console.log(JSON.stringify(row));
}
