// Pure geometry over board elements: bounds, hit testing, rotation and the
// maths that keeps a connector attached to the shapes at its ends.
//
// Every element rotates about the centre of its own box. Hit tests therefore
// un-rotate the pointer into the element's frame and test against the plain,
// axis-aligned shape — one code path for rotated and unrotated elements.

import { isLinear, type BoardElement, type Point } from "./model.ts";

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function rotatePoint([x, y]: Point, [cx, cy]: Point, angle: number): Point {
  if (!angle) return [x, y];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function pointsBox(points: Point[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------------------
// Linear paths
// ---------------------------------------------------------------------------

const curveCache = new WeakMap<Point[], Point[]>();

/**
 * The polyline actually drawn for a line or arrow, in element-local
 * coordinates. A rounded connector with bends is a Catmull-Rom curve through
 * its points, sampled finely enough that hit testing against the samples is
 * indistinguishable from testing the curve.
 */
export function linearPath(el: BoardElement): Point[] {
  const points = el.points ?? [[0, 0]];
  if (!el.roundness || points.length < 3) return points;
  let cached = curveCache.get(points);
  if (cached) return cached;
  cached = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const steps = 14;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      cached.push([
        0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  curveCache.set(points, cached);
  return cached;
}

/** The box a line, arrow or stroke occupies, relative to its own x/y. */
export function localPointsBox(el: BoardElement): Box {
  return pointsBox(isLinear(el) ? linearPath(el) : (el.points ?? [[0, 0]]));
}

export function elementCenter(el: BoardElement): Point {
  if (el.points && (isLinear(el) || el.type === "freedraw")) {
    const box = localPointsBox(el);
    return [el.x + (box.minX + box.maxX) / 2, el.y + (box.minY + box.maxY) / 2];
  }
  return [el.x + el.width / 2, el.y + el.height / 2];
}

/** Points of a line/arrow/stroke in world space, with any rotation applied. */
export function worldPoints(el: BoardElement, points = el.points ?? [[0, 0]]): Point[] {
  const center = elementCenter(el);
  return points.map(([px, py]) => rotatePoint([el.x + px, el.y + py], center, el.angle));
}

/** Rebuilds a line/arrow from world points: origin at the first point, unrotated. */
export function withWorldPoints(el: BoardElement, world: Point[]): Partial<BoardElement> {
  const [ox, oy] = world[0];
  const points = world.map(([x, y]) => [x - ox, y - oy] as Point);
  const box = pointsBox(points);
  return {
    x: ox,
    y: oy,
    angle: 0,
    points,
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
  };
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

const boundsCache = new WeakMap<BoardElement, Box>();

/** World-space axis-aligned bounds, padded for stroke width and arrowheads. */
export function elementBounds(el: BoardElement): Box {
  let cached = boundsCache.get(el);
  if (cached) return cached;
  const pad =
    el.type === "freedraw"
      ? el.strokeWidth * 3 + 2
      : isLinear(el)
        ? el.strokeWidth / 2 + (el.startArrowhead || el.endArrowhead ? 12 + el.strokeWidth * 3 : 2)
        : el.strokeWidth / 2 + 1;
  let corners: Point[];
  if (el.points && (isLinear(el) || el.type === "freedraw")) {
    corners = worldPoints(el, isLinear(el) ? linearPath(el) : el.points);
  } else {
    const center = elementCenter(el);
    corners = [
      [el.x, el.y],
      [el.x + el.width, el.y],
      [el.x + el.width, el.y + el.height],
      [el.x, el.y + el.height],
    ].map((p) => rotatePoint(p as Point, center, el.angle));
  }
  const box = pointsBox(corners);
  cached = {
    minX: box.minX - pad,
    minY: box.minY - pad,
    maxX: box.maxX + pad,
    maxY: box.maxY + pad,
  };
  boundsCache.set(el, cached);
  return cached;
}

export function unionBounds(elements: Iterable<BoardElement>): Box | null {
  let out: Box | null = null;
  for (const el of elements) {
    const b = elementBounds(el);
    if (!out) out = { ...b };
    else {
      out.minX = Math.min(out.minX, b.minX);
      out.minY = Math.min(out.minY, b.minY);
      out.maxX = Math.max(out.maxX, b.maxX);
      out.maxY = Math.max(out.maxY, b.maxY);
    }
  }
  return out;
}

export const boxesIntersect = (a: Box, b: Box) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

export const boxContains = (outer: Box, inner: Box) =>
  inner.minX >= outer.minX &&
  inner.maxX <= outer.maxX &&
  inner.minY >= outer.minY &&
  inner.maxY <= outer.maxY;

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

function polylineDistance(p: Point, points: Point[]) {
  if (points.length === 1) return distance(p, points[0]);
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = distanceToSegment(p, points[i], points[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Whether world point `p` touches `el`. `tolerance` is in world units (the
 * caller divides a screen-space slop by the zoom). An unfilled shape is hit
 * only near its outline — so a frame drawn around other things doesn't swallow
 * every click inside it — unless `solid` asks for its whole area.
 */
/**
 * Whether `p` lies within `band` of the edge of `el`'s box, on either side.
 * Used where only the rim of an element should respond — a photo is a surface
 * to draw on, so only its edge is a place to attach a connector.
 */
export function nearBoxEdge(el: BoardElement, p: Point, band: number): boolean {
  const local = rotatePoint(p, elementCenter(el), -el.angle);
  const lx = local[0] - el.x;
  const ly = local[1] - el.y;
  if (lx < -band || ly < -band || lx > el.width + band || ly > el.height + band) return false;
  const inside = lx >= 0 && ly >= 0 && lx <= el.width && ly <= el.height;
  if (!inside) return true;
  return Math.min(lx, ly, el.width - lx, el.height - ly) <= band;
}

export function hitTest(el: BoardElement, p: Point, tolerance: number, solid = false): boolean {
  const b = elementBounds(el);
  if (p[0] < b.minX - tolerance || p[0] > b.maxX + tolerance) return false;
  if (p[1] < b.minY - tolerance || p[1] > b.maxY + tolerance) return false;

  const local = rotatePoint(p, elementCenter(el), -el.angle);
  const lx = local[0] - el.x;
  const ly = local[1] - el.y;
  const half = el.strokeWidth / 2;

  if (el.type === "freedraw") {
    return polylineDistance([lx, ly], el.points ?? [[0, 0]]) <= tolerance + el.strokeWidth * 2;
  }
  if (isLinear(el)) {
    return polylineDistance([lx, ly], linearPath(el)) <= tolerance + half + 2;
  }

  const w = el.width;
  const h = el.height;
  const filled =
    solid ||
    el.type === "text" ||
    el.type === "image" ||
    (el.backgroundColor !== "transparent" && el.backgroundColor !== "") ||
    !!el.boundElements?.some((b) => b.type === "text");

  if (el.type === "ellipse") {
    const a = w / 2;
    const bb = h / 2;
    if (!a || !bb) return false;
    const nx = (lx - a) / a;
    const ny = (ly - bb) / bb;
    const r = Math.sqrt(nx * nx + ny * ny);
    if (filled && r <= 1) return true;
    return Math.abs(r - 1) * Math.min(a, bb) <= tolerance + half;
  }
  if (el.type === "diamond") {
    const a = w / 2;
    const bb = h / 2;
    if (!a || !bb) return false;
    const inside = Math.abs(lx - a) / a + Math.abs(ly - bb) / bb <= 1;
    if (filled && inside) return true;
    const top: Point = [a, 0];
    const right: Point = [w, bb];
    const bottom: Point = [a, h];
    const left: Point = [0, bb];
    return polylineDistance([lx, ly], [top, right, bottom, left, top]) <= tolerance + half;
  }
  // Rectangles, text, images, and anything we preserve but don't draw specially.
  const inside = lx >= -tolerance && lx <= w + tolerance && ly >= -tolerance && ly <= h + tolerance;
  if (!inside) return false;
  if (filled || el.type !== "rectangle") return true;
  const edge = Math.min(lx, ly, w - lx, h - ly);
  return Math.abs(edge) <= tolerance + half;
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

/** Gap left between an arrow tip and the shape it points at. */
export const BINDING_GAP = 6;

/**
 * Where a ray from `el`'s centre towards `toward` leaves the shape's outline,
 * pushed out by `gap`. This is the attachment point of a connector, and why a
 * connector stays aimed at a shape's centre wherever the two are dragged.
 */
export function outlinePoint(el: BoardElement, toward: Point, gap = BINDING_GAP): Point {
  const center = elementCenter(el);
  const local = rotatePoint(toward, center, -el.angle);
  const dx = local[0] - center[0];
  const dy = local[1] - center[1];
  const len = Math.hypot(dx, dy);
  if (!len) return center;
  const a = Math.max(el.width / 2, 1);
  const b = Math.max(el.height / 2, 1);
  let t: number;
  if (el.type === "ellipse") t = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));
  else if (el.type === "diamond") t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  else t = Math.min(dx ? a / Math.abs(dx) : Infinity, dy ? b / Math.abs(dy) : Infinity);
  const ux = dx / len;
  const uy = dy / len;
  const edge: Point = [center[0] + dx * t + ux * gap, center[1] + dy * t + uy * gap];
  return rotatePoint(edge, center, el.angle);
}
