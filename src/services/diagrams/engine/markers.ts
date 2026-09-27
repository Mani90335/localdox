/**
 * Edge-end markers as plain geometry: line segments and filled triangles.
 *
 * Every marker Mermaid draws — flowchart arrows, class-diagram triangles and
 * diamonds, ER crow's feet — is a handful of strokes and fills a few units
 * across. Emitting them as geometry lets the renderer draw all of them for all
 * edges in two instanced calls, instead of one SVG <marker> per edge.
 *
 * Sizes are in diagram units, matching Mermaid's markers at 1×.
 */
import type { Marker } from "./flowchart.ts";

export interface MarkerSink {
  segment(x0: number, y0: number, x1: number, y1: number): void;
  triangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): void;
}

/**
 * How much of the line a marker sits on, so the stroke can stop at the
 * marker instead of running through a hollow triangle or diamond.
 */
export function markerInset(marker: Marker): number {
  switch (marker) {
    case "triangleOpen":
      return 12;
    case "diamond":
    case "diamondOpen":
      return 16;
    case "circleOpen":
      return 11;
    default:
      return 0;
  }
}

/**
 * Emit a marker whose tip touches the node at (tx, ty).
 *
 * (dx, dy) is the unit direction the edge travels as it arrives, so the
 * marker extends back along the edge from the tip.
 */
export function emitMarker(
  marker: Marker,
  tx: number,
  ty: number,
  dx: number,
  dy: number,
  out: MarkerSink,
): void {
  if (marker === "none") return;
  // Along the edge, away from the node; and across it.
  const bx = -dx;
  const by = -dy;
  const nx = -dy;
  const ny = dx;
  const px = (a: number, b: number) => tx + bx * a + nx * b;
  const py = (a: number, b: number) => ty + by * a + ny * b;
  const seg = (a0: number, b0: number, a1: number, b1: number) =>
    out.segment(px(a0, b0), py(a0, b0), px(a1, b1), py(a1, b1));
  const tri = (a0: number, b0: number, a1: number, b1: number, a2: number, b2: number) =>
    out.triangle(px(a0, b0), py(a0, b0), px(a1, b1), py(a1, b1), px(a2, b2), py(a2, b2));
  const ring = (a: number, radius: number, sides = 10) => {
    for (let i = 0; i < sides; i++) {
      const t0 = (i / sides) * Math.PI * 2;
      const t1 = ((i + 1) / sides) * Math.PI * 2;
      seg(
        a + Math.cos(t0) * radius,
        Math.sin(t0) * radius,
        a + Math.cos(t1) * radius,
        Math.sin(t1) * radius,
      );
    }
  };
  const disc = (a: number, radius: number, sides = 8) => {
    for (let i = 0; i < sides; i++) {
      const t0 = (i / sides) * Math.PI * 2;
      const t1 = ((i + 1) / sides) * Math.PI * 2;
      tri(
        a,
        0,
        a + Math.cos(t0) * radius,
        Math.sin(t0) * radius,
        a + Math.cos(t1) * radius,
        Math.sin(t1) * radius,
      );
    }
  };
  const bar = (a: number) => seg(a, -6, a, 6);
  const crowsFoot = () => {
    seg(0, -6, 12, 0);
    seg(0, 0, 12, 0);
    seg(0, 6, 12, 0);
  };

  switch (marker) {
    case "arrow":
      tri(0, 0, 8, 4, 8, -4);
      break;
    case "arrowOpen":
      seg(0, 0, 9, 4.5);
      seg(0, 0, 9, -4.5);
      break;
    case "cross":
      seg(2, -4, 10, 4);
      seg(2, 4, 10, -4);
      break;
    case "circle":
      disc(5, 4);
      break;
    case "circleOpen":
      ring(6, 5);
      break;
    case "triangleOpen":
      seg(0, 0, 12, 6);
      seg(12, 6, 12, -6);
      seg(12, -6, 0, 0);
      break;
    case "diamond":
      tri(0, 0, 8, 5, 16, 0);
      tri(0, 0, 16, 0, 8, -5);
      break;
    case "diamondOpen":
      seg(0, 0, 8, 5);
      seg(8, 5, 16, 0);
      seg(16, 0, 8, -5);
      seg(8, -5, 0, 0);
      break;
    case "one":
      bar(8);
      bar(14);
      break;
    case "zeroOne":
      bar(8);
      ring(18, 4, 8);
      break;
    case "oneMany":
      crowsFoot();
      bar(16);
      break;
    case "zeroMany":
      crowsFoot();
      ring(20, 4, 8);
      break;
  }
}

/** Remove `length` from the end (or start) of a flat [x, y, …] polyline. */
export function trimPolyline(points: number[], length: number, fromStart: boolean): number[] {
  if (length <= 0 || points.length < 4) return points;
  const pts = fromStart ? reversePairs(points) : points.slice();
  let remaining = length;
  while (pts.length >= 4) {
    const n = pts.length;
    const ax = pts[n - 4];
    const ay = pts[n - 3];
    const bx = pts[n - 2];
    const by = pts[n - 1];
    const segment = Math.hypot(bx - ax, by - ay);
    if (segment > remaining) {
      const t = (segment - remaining) / segment;
      pts[n - 2] = ax + (bx - ax) * t;
      pts[n - 1] = ay + (by - ay) * t;
      break;
    }
    // Never trim an edge away entirely.
    if (n === 4) break;
    remaining -= segment;
    pts.length = n - 2;
  }
  return fromStart ? reversePairs(pts) : pts;
}

function reversePairs(points: number[]): number[] {
  const out: number[] = [];
  for (let i = points.length - 2; i >= 0; i -= 2) out.push(points[i], points[i + 1]);
  return out;
}
