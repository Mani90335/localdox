// Draws a board on a 2D canvas, and exports it as PNG or SVG.
//
// Each element's outline is built once as SVG path data and turned into a
// Path2D. The cache is keyed by *geometry* (a shape's size, a line's points
// array), not by element object, so dragging a hundred shapes rebuilds no
// paths at all — moving only changes the transform they are drawn with. The
// same path data is what SVG export writes, so the two can never disagree.
//
// Per frame the renderer skips everything outside the viewport, which keeps a
// large board as cheap to pan as a small one.

import { getStroke } from "perfect-freehand";
import { elementBounds, elementCenter, linearPath, unionBounds, type Box } from "./geometry";
import {
  displayColor,
  fontStack,
  isLinear,
  KNOWN_TYPES,
  type BoardElement,
  type BoardFiles,
  type Point,
} from "./model";
import { indexById, labelOf } from "./scene-ops";
import { fontString, labelArea, layoutText } from "./text";

export interface Viewport {
  /** World coordinate at the canvas's top-left corner. */
  x: number;
  y: number;
  zoom: number;
}

export interface RenderEnv {
  dark: boolean;
  /** Surface colour, painted behind labels on connectors. */
  background: string;
  getImage(fileId: string): CanvasImageSource | null;
  /** Not drawn at all, e.g. the text currently open in the editor. */
  hidden?: ReadonlySet<string>;
  /** Drawn ghosted, e.g. strokes under the eraser. */
  faded?: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Path data
// ---------------------------------------------------------------------------

const n = (v: number) => Math.round(v * 100) / 100;

export function cornerRadius(el: BoardElement) {
  if (!el.roundness) return 0;
  // Proportional for small shapes, capped for large ones: a soft corner that
  // reads as "rounded rectangle", never as a pill or a speech bubble.
  return Math.min(12, Math.min(el.width, el.height) * 0.15);
}

function rectPath(w: number, h: number, r: number) {
  if (!r) return `M0 0H${n(w)}V${n(h)}H0Z`;
  return (
    `M${n(r)} 0H${n(w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(w)} ${n(r)}V${n(h - r)}` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(w - r)} ${n(h)}H${n(r)}A${n(r)} ${n(r)} 0 0 1 0 ${n(h - r)}` +
    `V${n(r)}A${n(r)} ${n(r)} 0 0 1 ${n(r)} 0Z`
  );
}

function ellipsePath(w: number, h: number) {
  const rx = n(w / 2);
  const ry = n(h / 2);
  return `M0 ${ry}A${rx} ${ry} 0 1 0 ${n(w)} ${ry}A${rx} ${ry} 0 1 0 0 ${ry}Z`;
}

function diamondPath(w: number, h: number, rounded: boolean) {
  const pts: Point[] = [
    [w / 2, 0],
    [w, h / 2],
    [w / 2, h],
    [0, h / 2],
  ];
  if (!rounded) return `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}Z`;
  const r = Math.min(w, h) * 0.12;
  const parts: string[] = [];
  for (let i = 0; i < 4; i++) {
    const prev = pts[(i + 3) % 4];
    const cur = pts[i];
    const next = pts[(i + 1) % 4];
    const toward = (a: Point, b: Point): Point => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [a[0] + ((b[0] - a[0]) * r) / len, a[1] + ((b[1] - a[1]) * r) / len];
    };
    const a = toward(cur, prev);
    const b = toward(cur, next);
    parts.push(
      `${i ? "L" : "M"}${n(a[0])} ${n(a[1])}Q${n(cur[0])} ${n(cur[1])} ${n(b[0])} ${n(b[1])}`,
    );
  }
  return parts.join("") + "Z";
}

function polylinePath(points: Point[]) {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${n(x)} ${n(y)}`).join("");
}

export function arrowheadSize(el: BoardElement) {
  return 10 + el.strokeWidth * 3;
}

/** Stroked and filled parts of a connector's two ends. */
function arrowheads(el: BoardElement, path: Point[]) {
  let stroke = "";
  let fill = "";
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  const size = Math.min(arrowheadSize(el), length * 0.4);
  const head = (kind: BoardElement["endArrowhead"], tip: Point, from: Point) => {
    if (!kind || size < 1) return;
    const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
    const at = (a: number, len: number): Point => [
      tip[0] - Math.cos(a) * len,
      tip[1] - Math.sin(a) * len,
    ];
    if (kind === "arrow") {
      const a = at(angle - 0.45, size);
      const b = at(angle + 0.45, size);
      stroke += `M${n(a[0])} ${n(a[1])}L${n(tip[0])} ${n(tip[1])}L${n(b[0])} ${n(b[1])}`;
    } else if (kind === "triangle") {
      const a = at(angle - 0.42, size);
      const b = at(angle + 0.42, size);
      fill += `M${n(tip[0])} ${n(tip[1])}L${n(a[0])} ${n(a[1])}L${n(b[0])} ${n(b[1])}Z`;
    } else if (kind === "dot") {
      const r = Math.max(size / 3.2, 2);
      const c = at(angle, r);
      fill += `M${n(c[0] - r)} ${n(c[1])}A${n(r)} ${n(r)} 0 1 0 ${n(c[0] + r)} ${n(c[1])}A${n(r)} ${n(r)} 0 1 0 ${n(c[0] - r)} ${n(c[1])}Z`;
    } else if (kind === "bar") {
      const a: Point = [
        tip[0] + Math.cos(angle + Math.PI / 2) * size * 0.5,
        tip[1] + Math.sin(angle + Math.PI / 2) * size * 0.5,
      ];
      const b: Point = [
        tip[0] - Math.cos(angle + Math.PI / 2) * size * 0.5,
        tip[1] - Math.sin(angle + Math.PI / 2) * size * 0.5,
      ];
      stroke += `M${n(a[0])} ${n(a[1])}L${n(b[0])} ${n(b[1])}`;
    }
  };
  const distinct = (from: number, step: number) => {
    const tip = path[from];
    for (let i = from + step; i >= 0 && i < path.length; i += step) {
      if (Math.hypot(path[i][0] - tip[0], path[i][1] - tip[1]) > 0.5) return path[i];
    }
    return null;
  };
  const last = path.length - 1;
  const beforeEnd = distinct(last, -1);
  if (beforeEnd) head(el.endArrowhead ?? null, path[last], beforeEnd);
  const afterStart = distinct(0, 1);
  if (afterStart) head(el.startArrowhead ?? null, path[0], afterStart);
  return { stroke, fill };
}

/** Rounded quadratic outline through perfect-freehand's polygon. */
function strokeOutlinePath(outline: number[][]) {
  if (outline.length < 2) return "";
  const parts = [`M${n(outline[0][0])} ${n(outline[0][1])}Q`];
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    parts.push(`${n(x0)} ${n(y0)} ${n((x0 + x1) / 2)} ${n((y0 + y1) / 2)} `);
  }
  parts.push("Z");
  return parts.join("");
}

export const isMarker = (el: BoardElement) =>
  !!el.customData &&
  typeof el.customData === "object" &&
  (el.customData as { marker?: boolean }).marker === true;

export function freedrawSize(el: BoardElement) {
  return isMarker(el) ? el.strokeWidth * 3.6 + 4 : el.strokeWidth * 2.2 + 1.2;
}

function freedrawPath(el: BoardElement) {
  const points = el.points ?? [[0, 0]];
  const pressures = el.pressures ?? [];
  const marker = isMarker(el);
  const input = points.map(([x, y], i) => [x, y, pressures[i] ?? 0.5]);
  const outline = getStroke(input, {
    size: freedrawSize(el),
    thinning: marker ? 0 : 0.55,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: !marker && el.simulatePressure !== false,
    last: true,
    start: { cap: true },
    end: { cap: true },
  });
  return strokeOutlinePath(outline);
}

export interface ElementPaths {
  /** Outline, in element-local coordinates. */
  d: string;
  path: Path2D | null;
  heads?: { stroke: string; fill: string; strokePath: Path2D | null; fillPath: Path2D | null };
}

const hasPath2D = typeof Path2D !== "undefined";
const toPath = (d: string) => (hasPath2D && d ? new Path2D(d) : null);

const shapeCache = new Map<string, ElementPaths>();
const pointCache = new WeakMap<object, Map<string, ElementPaths>>();

export function elementPaths(el: BoardElement): ElementPaths | null {
  if (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond") {
    const key = `${el.type}|${n(el.width)}|${n(el.height)}|${el.roundness ? 1 : 0}`;
    let cached = shapeCache.get(key);
    if (!cached) {
      const d =
        el.type === "rectangle"
          ? rectPath(el.width, el.height, cornerRadius(el))
          : el.type === "ellipse"
            ? ellipsePath(el.width, el.height)
            : diamondPath(el.width, el.height, !!el.roundness);
      cached = { d, path: toPath(d) };
      if (shapeCache.size > 4000) shapeCache.clear();
      shapeCache.set(key, cached);
    }
    return cached;
  }
  if ((isLinear(el) || el.type === "freedraw") && el.points) {
    let byStyle = pointCache.get(el.points);
    if (!byStyle) pointCache.set(el.points, (byStyle = new Map()));
    const key = isLinear(el)
      ? `${el.strokeWidth}|${el.roundness ? 1 : 0}|${el.startArrowhead}|${el.endArrowhead}`
      : `${el.strokeWidth}|${isMarker(el)}|${el.simulatePressure}|${el.pressures?.length ?? 0}`;
    let cached = byStyle.get(key);
    if (!cached) {
      if (isLinear(el)) {
        const path = linearPath(el);
        const d = polylinePath(path);
        const heads = arrowheads(el, path);
        cached = {
          d,
          path: toPath(d),
          heads: { ...heads, strokePath: toPath(heads.stroke), fillPath: toPath(heads.fill) },
        };
      } else {
        const d = freedrawPath(el);
        cached = { d, path: toPath(d) };
      }
      byStyle.set(key, cached);
    }
    return cached;
  }
  return null;
}

export function dashFor(el: BoardElement, scale = 1): number[] {
  const w = el.strokeWidth;
  if (el.strokeStyle === "dashed") return [w * 4 * scale, (w * 3 + 4) * scale];
  if (el.strokeStyle === "dotted") return [0.01, (w * 2.4 + 3) * scale];
  return [];
}

// ---------------------------------------------------------------------------
// Canvas drawing
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

/** Transform from element-local to world: translate, then rotate about the centre. */
function applyElementTransform(ctx: Ctx, el: BoardElement) {
  ctx.translate(el.x, el.y);
  if (el.angle) {
    const [cx, cy] = elementCenter(el);
    const lx = cx - el.x;
    const ly = cy - el.y;
    ctx.translate(lx, ly);
    ctx.rotate(el.angle);
    ctx.translate(-lx, -ly);
  }
}

function drawTextLines(
  ctx: Ctx,
  text: BoardElement,
  lines: string[],
  lineHeightPx: number,
  left: number,
  top: number,
  width: number,
  color: string,
  halo?: string,
) {
  ctx.font = fontString(text.fontSize ?? 20, text.fontFamily);
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  const align = text.textAlign ?? "left";
  ctx.textAlign = align;
  const x = align === "center" ? left + width / 2 : align === "right" ? left + width : left;
  if (halo) {
    ctx.strokeStyle = halo;
    ctx.lineWidth = haloWidth(text);
    ctx.lineJoin = "round";
    ctx.setLineDash([]);
  }
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    const y = top + lineHeightPx * (i + 0.5);
    if (halo) ctx.strokeText(lines[i], x, y);
    ctx.fillText(lines[i], x, y);
  }
}

/** Width of the surface-coloured halo that keeps a label readable over a photo. */
const haloWidth = (text: BoardElement) => Math.max(3, (text.fontSize ?? 20) * 0.22);

/**
 * Free text lying over a photo. Such text gets a halo in the surface colour —
 * the way labels on a map stay readable over any terrain.
 */
function overPhoto(el: BoardElement, photos: Box[]) {
  if (!photos.length) return false;
  const b = elementBounds(el);
  return photos.some(
    (p) => b.maxX > p.minX && b.minX < p.maxX && b.maxY > p.minY && b.minY < p.maxY,
  );
}

const photoCache = new WeakMap<BoardElement[], Box[]>();
function photoBoxes(elements: BoardElement[]) {
  let boxes = photoCache.get(elements);
  if (!boxes) {
    boxes = elements.filter((el) => el.type === "image").map(elementBounds);
    photoCache.set(elements, boxes);
  }
  return boxes;
}

function drawLabel(ctx: Ctx, container: BoardElement, label: BoardElement, env: RenderEnv) {
  if (!label.text || env.hidden?.has(label.id)) return;
  const layout = layoutText(label, container);
  const color = displayColor(label.strokeColor, env.dark);
  ctx.save();
  ctx.globalAlpha = label.opacity / 100;
  if (isLinear(container)) {
    // A connector's label sits on a patch of surface that interrupts the line.
    const pad = 4;
    ctx.fillStyle = env.background;
    ctx.fillRect(label.x - pad, label.y - pad / 2, layout.width + pad * 2, layout.height + pad);
    drawTextLines(
      ctx,
      { ...label, textAlign: "center" },
      layout.lines,
      layout.lineHeightPx,
      label.x,
      label.y,
      layout.width,
      color,
    );
  } else {
    applyElementTransform(ctx, container);
    const area = labelArea(container);
    const free = area.height - layout.height;
    const offset =
      label.verticalAlign === "top" ? 0 : label.verticalAlign === "bottom" ? free : free / 2;
    drawTextLines(
      ctx,
      label,
      layout.lines,
      layout.lineHeightPx,
      area.x,
      area.y + Math.max(offset, 0),
      area.width,
      color,
    );
  }
  ctx.restore();
}

export function drawElement(
  ctx: Ctx,
  el: BoardElement,
  env: RenderEnv,
  map?: Map<string, BoardElement>,
  photos: Box[] = [],
) {
  if (env.hidden?.has(el.id)) return;
  ctx.save();
  ctx.globalAlpha = (el.opacity / 100) * (env.faded?.has(el.id) ? 0.22 : 1);
  applyElementTransform(ctx, el);
  const stroke = displayColor(el.strokeColor, env.dark);
  const fill = displayColor(el.backgroundColor, env.dark);
  const hasStroke = stroke && stroke !== "transparent" && el.strokeWidth > 0;
  const hasFill = fill && fill !== "transparent";

  if (el.type === "text") {
    const layout = layoutText(el);
    drawTextLines(
      ctx,
      el,
      layout.lines,
      layout.lineHeightPx,
      0,
      0,
      Math.max(el.width, layout.width),
      stroke,
      overPhoto(el, photos) ? env.background : undefined,
    );
  } else if (el.type === "image") {
    const image = el.fileId ? env.getImage(el.fileId) : null;
    if (image) {
      const [sx, sy] = el.scale ?? [1, 1];
      if (sx < 0 || sy < 0) {
        ctx.translate(sx < 0 ? el.width : 0, sy < 0 ? el.height : 0);
        ctx.scale(sx < 0 ? -1 : 1, sy < 0 ? -1 : 1);
      }
      ctx.drawImage(image, 0, 0, el.width, el.height);
    } else {
      ctx.fillStyle = env.dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.05)";
      ctx.fillRect(0, 0, el.width, el.height);
    }
  } else if (el.type === "freedraw") {
    const paths = elementPaths(el);
    if (paths?.path) {
      ctx.fillStyle = stroke;
      ctx.fill(paths.path);
    }
  } else if (KNOWN_TYPES.has(el.type)) {
    const paths = elementPaths(el);
    if (paths?.path) {
      if (hasFill && !isLinear(el)) {
        ctx.fillStyle = fill;
        ctx.fill(paths.path);
      }
      if (hasStroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = el.strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.setLineDash(dashFor(el));
        ctx.stroke(paths.path);
        if (paths.heads) {
          ctx.setLineDash([]);
          if (paths.heads.strokePath) ctx.stroke(paths.heads.strokePath);
          if (paths.heads.fillPath) {
            ctx.fillStyle = stroke;
            ctx.fill(paths.heads.fillPath);
          }
        }
      }
    }
  } else if (el.type === "frame" || el.type === "magicframe") {
    // Frames from other tools: kept and shown as a quiet labelled region.
    ctx.strokeStyle = displayColor("#9aa1ad", env.dark);
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(0, 0, el.width, el.height);
    if (typeof el.name === "string" && el.name) {
      ctx.setLineDash([]);
      ctx.font = fontString(13, 2);
      ctx.fillStyle = displayColor("#6b7280", env.dark);
      ctx.textBaseline = "bottom";
      ctx.fillText(el.name, 0, -6);
    }
  } else if (el.width && el.height) {
    // Embeds and anything else we can't draw: an honest placeholder in place.
    ctx.strokeStyle = displayColor("#9aa1ad", env.dark);
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, el.width, el.height);
  }
  ctx.restore();

  if (map && (el.boundElements?.length ?? 0) > 0) {
    const label = labelOf(el, map);
    if (label) drawLabel(ctx, el, label, env);
  }
}

const mapCache = new WeakMap<BoardElement[], Map<string, BoardElement>>();
export function sceneIndex(elements: BoardElement[]) {
  let map = mapCache.get(elements);
  if (!map) mapCache.set(elements, (map = indexById(elements)));
  return map;
}

/** Draws every element that intersects `visible` (world space). Labels draw with their container. */
export function drawElements(
  ctx: Ctx,
  elements: BoardElement[],
  env: RenderEnv,
  visible: Box | null,
) {
  const map = sceneIndex(elements);
  const photos = photoBoxes(elements);
  for (const el of elements) {
    if (el.type === "text" && el.containerId && map.has(el.containerId)) continue;
    if (visible) {
      const b = elementBounds(el);
      if (
        b.maxX < visible.minX ||
        b.minX > visible.maxX ||
        b.maxY < visible.minY ||
        b.minY > visible.maxY
      ) {
        continue;
      }
    }
    drawElement(ctx, el, env, map, photos);
  }
}

// ---------------------------------------------------------------------------
// Dot grid
// ---------------------------------------------------------------------------

export const GRID_SIZE = 24;
const gridTiles = new Map<string, CanvasPattern | null>();

/** Grid step in world units at `zoom`: doubles until dots are comfortably apart. */
export function gridStep(zoom: number) {
  let step = GRID_SIZE;
  while (step * zoom < 14) step *= 2;
  return step;
}

export function drawGrid(
  ctx: Ctx,
  viewport: Viewport,
  width: number,
  height: number,
  dpr: number,
  color: string,
) {
  const step = gridStep(viewport.zoom);
  const tile = Math.max(4, Math.round(step * viewport.zoom * dpr));
  const key = `${tile}|${color}|${dpr}`;
  let pattern = gridTiles.get(key);
  if (pattern === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = tile;
    canvas.height = tile;
    const tctx = canvas.getContext("2d");
    if (tctx) {
      // Quiet enough to read as paper texture, not as a pattern to look at.
      tctx.globalAlpha = 0.32;
      tctx.fillStyle = color;
      const r = Math.max(1, dpr * 0.85);
      tctx.beginPath();
      tctx.arc(r, r, r, 0, Math.PI * 2);
      tctx.fill();
    }
    pattern = tctx ? ctx.createPattern(canvas, "repeat") : null;
    if (gridTiles.size > 64) gridTiles.clear();
    gridTiles.set(key, pattern);
  }
  if (!pattern) return;
  const ox = ((-viewport.x * viewport.zoom * dpr) % tile) - dpr * 0.85;
  const oy = ((-viewport.y * viewport.zoom * dpr) % tile) - dpr * 0.85;
  pattern.setTransform(new DOMMatrix([1, 0, 0, 1, ox, oy]));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, width * dpr, height * dpr);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const EXPORT_PADDING = 32;

export function exportBounds(elements: BoardElement[]) {
  const box = unionBounds(elements.filter((el) => !el.isDeleted));
  if (!box) return null;
  return {
    minX: box.minX - EXPORT_PADDING,
    minY: box.minY - EXPORT_PADDING,
    maxX: box.maxX + EXPORT_PADDING,
    maxY: box.maxY + EXPORT_PADDING,
  };
}

/** Renders elements to a PNG blob, light surface, at `scale`× for crisp output. */
export async function exportPng(
  elements: BoardElement[],
  getImage: RenderEnv["getImage"],
  { scale = 2, background = "#ffffff" }: { scale?: number; background?: string } = {},
): Promise<Blob | null> {
  const box = exportBounds(elements);
  if (!box) return null;
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  // Browsers refuse canvases past ~16k px a side or ~268M px in area.
  const fit = Math.min(
    scale,
    16000 / width,
    16000 / height,
    Math.sqrt(120_000_000 / (width * height)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * fit);
  canvas.height = Math.ceil(height * fit);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(fit, 0, 0, fit, -box.minX * fit, -box.minY * fit);
  drawElements(ctx, elements, { dark: false, background, getImage }, null);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

const escapeXml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function svgTransform(el: BoardElement) {
  const [cx, cy] = elementCenter(el);
  const rotate = el.angle
    ? ` rotate(${n((el.angle * 180) / Math.PI)} ${n(cx - el.x)} ${n(cy - el.y)})`
    : "";
  return `translate(${n(el.x)} ${n(el.y)})${rotate}`;
}

function svgText(
  text: BoardElement,
  lines: string[],
  lineHeightPx: number,
  left: number,
  top: number,
  width: number,
  halo?: string,
) {
  const align = text.textAlign ?? "left";
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
  const x = align === "center" ? left + width / 2 : align === "right" ? left + width : left;
  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${n(x)}" y="${n(top + lineHeightPx * (i + 0.5))}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  return `<text font-family="${escapeXml(fontStack(text.fontFamily))}" font-size="${text.fontSize ?? 20}" fill="${text.strokeColor}" text-anchor="${anchor}" dominant-baseline="central"${halo ? ` stroke="${halo}" stroke-width="${n(haloWidth(text))}" stroke-linejoin="round" paint-order="stroke"` : ""}${text.opacity < 100 ? ` opacity="${text.opacity / 100}"` : ""}>${tspans}</text>`;
}

/** A standalone SVG of the elements, light surface, images embedded. */
export function exportSvg(
  elements: BoardElement[],
  files: BoardFiles,
  background = "#ffffff",
): string | null {
  const box = exportBounds(elements);
  if (!box) return null;
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const map = indexById(elements);
  const photos = photoBoxes(elements);
  const body: string[] = [];
  for (const el of elements) {
    if (el.type === "text" && el.containerId && map.has(el.containerId)) continue;
    const opacity = el.opacity < 100 ? ` opacity="${el.opacity / 100}"` : "";
    const transform = svgTransform(el);
    if (el.type === "text") {
      const layout = layoutText(el);
      body.push(
        `<g transform="${transform}">${svgText(el, layout.lines, layout.lineHeightPx, 0, 0, Math.max(el.width, layout.width), overPhoto(el, photos) ? background : undefined)}</g>`,
      );
    } else if (el.type === "image") {
      const file = el.fileId ? files[el.fileId] : undefined;
      if (file) {
        body.push(
          `<g transform="${transform}"${opacity}><image href="${escapeXml(file.dataURL)}" width="${n(el.width)}" height="${n(el.height)}" preserveAspectRatio="none"/></g>`,
        );
      }
    } else {
      const paths = elementPaths(el);
      if (!paths?.d) continue;
      if (el.type === "freedraw") {
        body.push(
          `<g transform="${transform}"${opacity}><path d="${paths.d}" fill="${el.strokeColor}"/></g>`,
        );
        continue;
      }
      const dash = dashFor(el);
      const strokeAttrs =
        el.strokeColor !== "transparent" && el.strokeWidth > 0
          ? ` stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${dash.length ? ` stroke-dasharray="${dash.join(" ")}"` : ""}`
          : "";
      const fill =
        !isLinear(el) && el.backgroundColor !== "transparent" ? el.backgroundColor : "none";
      let group = `<path d="${paths.d}" fill="${fill}"${strokeAttrs}/>`;
      if (paths.heads?.stroke)
        group += `<path d="${paths.heads.stroke}" fill="none" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
      if (paths.heads?.fill) group += `<path d="${paths.heads.fill}" fill="${el.strokeColor}"/>`;
      body.push(`<g transform="${transform}"${opacity}>${group}</g>`);
    }
    const label = el.boundElements?.length ? labelOf(el, map) : undefined;
    if (label?.text) {
      const layout = layoutText(label, el);
      if (isLinear(el)) {
        body.push(
          `<rect x="${n(label.x - 4)}" y="${n(label.y - 2)}" width="${n(layout.width + 8)}" height="${n(layout.height + 4)}" fill="${background}"/>` +
            svgText(
              { ...label, textAlign: "center" },
              layout.lines,
              layout.lineHeightPx,
              label.x,
              label.y,
              layout.width,
            ),
        );
      } else {
        const area = labelArea(el);
        const free = area.height - layout.height;
        const offset =
          label.verticalAlign === "top" ? 0 : label.verticalAlign === "bottom" ? free : free / 2;
        body.push(
          `<g transform="${transform}">${svgText(label, layout.lines, layout.lineHeightPx, area.x, area.y + Math.max(offset, 0), area.width)}</g>`,
        );
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(box.minX)} ${n(box.minY)} ${n(width)} ${n(height)}" width="${Math.ceil(width)}" height="${Math.ceil(height)}">` +
    `<rect x="${n(box.minX)}" y="${n(box.minY)}" width="${n(width)}" height="${n(height)}" fill="${background}"/>` +
    body.join("") +
    `</svg>`
  );
}
