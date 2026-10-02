// The board editor: scene state, input handling and rendering, outside React.
//
// Pointer moves arrive up to 240 times a second on a pen, and nothing about a
// drag needs React. So the editor owns the scene and the two canvases directly
// and tells React only about the things its chrome shows: the tool, the
// selection, the style, history and zoom. A stroke being drawn re-renders zero
// components.
//
// Two stacked canvases split the work: the *scene* canvas holds committed
// elements and is redrawn only when they change or the view moves; the
// *overlay* holds what changes every frame — hover, selection handles, the
// marquee, snapping guides, and the stroke or shape still being drawn.

import {
  boxContains,
  boxesIntersect,
  distance,
  elementBounds,
  elementCenter,
  hitTest,
  localPointsBox,
  rotatePoint,
  unionBounds,
  withWorldPoints,
  worldPoints,
  type Box,
} from "./geometry";
import { ImageStore, type PreparedImage } from "./images";
import {
  DEFAULT_STYLE,
  FILL_SWATCHES,
  FONT_SIZES,
  HIGHLIGHT_SWATCHES,
  isLinear,
  isShape,
  mutate,
  newElement,
  type BoardElement,
  type BoardFiles,
  type Point,
  type Scene,
  type StyleDefaults,
} from "./model";
import {
  drawElement,
  drawElements,
  drawGrid,
  sceneIndex,
  type RenderEnv,
  type Viewport,
} from "./render";
import {
  bindConnectorEnd,
  cloneElements,
  deleteElements,
  ensureLabel,
  expandToGroups,
  findBindTarget,
  groupElements,
  indexById,
  labelOf,
  reorder,
  replaceElements,
  routeConnector,
  settle,
  ungroupElements,
  type ZOrder,
} from "./scene-ops";
import { layoutText } from "./text";

export type Tool =
  | "select"
  | "hand"
  | "pen"
  | "marker"
  | "eraser"
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "arrow"
  | "line"
  | "text"
  | "sticky";

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "rotate";

export interface BoardTheme {
  dark: boolean;
  background: string;
  grid: string;
  accent: string;
  handleFill: string;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
const HANDLE_SIZE = 8;
const ROTATE_OFFSET = 22;
const SNAP_DISTANCE = 6;
const STICKY_SIZE = 200;
const CLIPBOARD_TYPE = "localdox/board-clipboard";

type Gesture =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "marquee"; start: Point; current: Point; base: Set<string> }
  | {
      kind: "move";
      start: Point;
      origin: Map<string, BoardElement>;
      moved: boolean;
      duplicated: boolean;
      snapX: number[];
      snapY: number[];
    }
  | {
      kind: "resize";
      handle: Handle;
      origin: Map<string, BoardElement>;
      box: Box;
      single: BoardElement | null;
    }
  | { kind: "rotate"; center: Point; startAngle: number; origin: Map<string, BoardElement> }
  | { kind: "create"; element: BoardElement; start: Point; startTarget?: string }
  | { kind: "draw"; element: BoardElement }
  | { kind: "erase"; last: Point; trail: Point[]; hits: Set<string> }
  | { kind: "point"; id: string; index: number; origin: BoardElement }
  | { kind: "pinch"; distance: number; mid: Point; viewport: Viewport };

export interface MarkerStyle {
  color: string;
  width: number;
}

type Channel = "ui" | "view" | "change";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const sameArray = (a: BoardElement[], b: BoardElement[]) =>
  a === b || (a.length === b.length && a.every((el, i) => el === b[i]));

const HANDLE_CURSORS = ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"];
const HANDLE_ANGLES: Record<Exclude<Handle, "rotate">, number> = {
  n: 0,
  ne: 1,
  e: 2,
  se: 3,
  s: 0,
  sw: 1,
  w: 2,
  nw: 3,
};

function prefersReducedMotion() {
  return (
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export class BoardEditor {
  elements: BoardElement[];
  files: BoardFiles;
  readonly scene: Omit<Scene, "elements" | "files">;
  readonly readOnly: boolean;

  selected: ReadonlySet<string> = new Set();
  tool: Tool = "select";
  style: StyleDefaults = { ...DEFAULT_STYLE };
  marker: MarkerStyle = { color: HIGHLIGHT_SWATCHES[0].light, width: 4 };
  viewport: Viewport = { x: 0, y: 0, zoom: 1 };
  editingId: string | null = null;
  showGrid = true;

  /** Called when the person asks to add an image (I, or the toolbar). */
  onRequestImage: (() => void) | null = null;
  /** Polite announcements for the live region (selection, deletions…). */
  onAnnounce: ((message: string) => void) | null = null;
  /** `?` pressed. */
  onRequestShortcuts: (() => void) | null = null;

  private committed: BoardElement[];
  private past: BoardElement[][] = [];
  private future: BoardElement[][] = [];
  private gesture: Gesture | null = null;
  private gestureBase: BoardElement[] | null = null;
  private pointers = new Map<number, Point>();
  private spaceHeld = false;
  private hoverId: string | null = null;
  private bindPreview: string | null = null;
  private guides: { x: number[]; y: number[] } = { x: [], y: [] };
  private lastPointerWorld: Point | null = null;
  private lastTap = { time: 0, x: 0, y: 0 };
  private clipboard: string | null = null;

  private root: HTMLElement | null = null;
  private sceneCanvas: HTMLCanvasElement | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private frame = 0;
  private sceneDirty = true;
  private overlayDirty = true;
  private animation = 0;
  private theme: BoardTheme = {
    dark: false,
    background: "#ffffff",
    grid: "#d9dce3",
    accent: "#5b5bd6",
    handleFill: "#ffffff",
  };
  readonly images: ImageStore;

  private listeners: Record<Channel, Set<() => void>> = {
    ui: new Set(),
    view: new Set(),
    change: new Set(),
  };
  uiVersion = 0;
  viewVersion = 0;

  constructor(scene: Scene, { readOnly = false } = {}) {
    const { elements, files, ...rest } = scene;
    this.elements = elements;
    this.committed = elements;
    this.files = files;
    this.scene = rest;
    this.readOnly = readOnly;
    if (readOnly) this.tool = "hand";
    this.images = new ImageStore(() => this.invalidate(true));
    this.images.sync(files);
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  subscribe(channel: Channel, listener: () => void) {
    this.listeners[channel].add(listener);
    return () => {
      this.listeners[channel].delete(listener);
    };
  }

  private emit(channel: Channel) {
    if (channel === "ui") this.uiVersion++;
    if (channel === "view") this.viewVersion++;
    for (const listener of this.listeners[channel]) listener();
  }

  // -------------------------------------------------------------------------
  // Mounting and rendering
  // -------------------------------------------------------------------------

  attach(root: HTMLElement, sceneCanvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement) {
    this.root = root;
    this.sceneCanvas = sceneCanvas;
    this.overlayCanvas = overlayCanvas;
    this.updateCursor();
  }

  detach() {
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.animation);
    this.frame = 0;
    this.root = this.sceneCanvas = this.overlayCanvas = null;
  }

  resize(width: number, height: number, dpr: number) {
    if (!this.sceneCanvas || !this.overlayCanvas) return;
    const first = this.width === 0;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    for (const canvas of [this.sceneCanvas, this.overlayCanvas]) {
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    }
    if (first && this.viewport.zoom === 1 && this.viewport.x === 0 && this.viewport.y === 0) {
      this.zoomToFit({ animate: false });
    }
    this.invalidate(true);
  }

  setTheme(theme: BoardTheme) {
    this.theme = theme;
    this.invalidate(true);
  }

  setViewport(viewport: Viewport) {
    this.viewport = { ...viewport, zoom: clamp(viewport.zoom, MIN_ZOOM, MAX_ZOOM) };
    this.invalidate(true);
    this.emit("view");
  }

  /** Re-render on the next frame. `scene` also redraws committed elements. */
  invalidate(scene = false) {
    if (scene) this.sceneDirty = true;
    this.overlayDirty = true;
    if (this.frame || !this.sceneCanvas) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private env(): RenderEnv {
    return {
      dark: this.theme.dark,
      background: this.theme.background,
      getImage: this.images.get,
      hidden: this.editingId ? new Set([this.editingId]) : undefined,
      faded: this.gesture?.kind === "erase" ? this.gesture.hits : undefined,
    };
  }

  private visibleBox(): Box {
    const { x, y, zoom } = this.viewport;
    return { minX: x, minY: y, maxX: x + this.width / zoom, maxY: y + this.height / zoom };
  }

  private render() {
    const { dpr, viewport } = this;
    if (this.sceneDirty && this.sceneCanvas) {
      this.sceneDirty = false;
      const ctx = this.sceneCanvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.sceneCanvas.width, this.sceneCanvas.height);
        if (this.showGrid) drawGrid(ctx, viewport, this.width, this.height, dpr, this.theme.grid);
        const z = viewport.zoom * dpr;
        ctx.setTransform(z, 0, 0, z, -viewport.x * z, -viewport.y * z);
        drawElements(ctx, this.elements, this.env(), this.visibleBox());
      }
    }
    if (this.overlayDirty && this.overlayCanvas) {
      this.overlayDirty = false;
      const ctx = this.overlayCanvas.getContext("2d");
      if (ctx) this.renderOverlay(ctx);
    }
  }

  private toScreen([x, y]: Point): Point {
    return [(x - this.viewport.x) * this.viewport.zoom, (y - this.viewport.y) * this.viewport.zoom];
  }

  toWorld(sx: number, sy: number): Point {
    return [sx / this.viewport.zoom + this.viewport.x, sy / this.viewport.zoom + this.viewport.y];
  }

  private renderOverlay(ctx: CanvasRenderingContext2D) {
    const { dpr, viewport, theme } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const z = viewport.zoom * dpr;
    const g = this.gesture;

    // In-progress elements are drawn here, not in the scene, so drawing a
    // stroke never repaints the rest of the board.
    if (g?.kind === "create" || g?.kind === "draw") {
      ctx.setTransform(z, 0, 0, z, -viewport.x * z, -viewport.y * z);
      drawElement(ctx, g.element, this.env());
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = theme.accent;

    const map = sceneIndex(this.elements);
    const outline = (el: BoardElement, width = 1.5) => {
      ctx.save();
      ctx.lineWidth = width;
      const target = el.containerId ? (map.get(el.containerId) ?? el) : el;
      this.strokeElementOutline(ctx, target);
      ctx.restore();
    };

    if (this.hoverId && !this.selected.has(this.hoverId) && !g && this.tool === "select") {
      const hovered = map.get(this.hoverId);
      if (hovered) {
        ctx.globalAlpha = 0.55;
        outline(hovered);
        ctx.globalAlpha = 1;
      }
    }

    if (this.bindPreview) {
      const target = map.get(this.bindPreview);
      if (target) {
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.setLineDash([]);
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.35;
        this.strokeElementOutline(ctx, target, 4);
        ctx.restore();
      }
    }

    const selected = this.selectedElements();
    const hideHandles =
      g?.kind === "move" ||
      g?.kind === "marquee" ||
      !!this.editingId ||
      this.readOnly ||
      this.selectionLocked;
    if (selected.length) {
      if (selected.length === 1 && isLinear(selected[0])) {
        const el = selected[0];
        outline(el, 1);
        if (!hideHandles) this.drawPointHandles(ctx, el);
      } else {
        if (selected.length > 1) {
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 1;
          for (const el of selected) this.strokeElementOutline(ctx, el);
          ctx.restore();
        }
        const frame = this.selectionFrame();
        if (frame) {
          ctx.beginPath();
          frame.corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.closePath();
          ctx.stroke();
          if (!hideHandles) {
            for (const [handle, [x, y]] of frame.handles) {
              if (handle === "rotate") {
                ctx.beginPath();
                ctx.arc(x, y, HANDLE_SIZE / 2 + 0.5, 0, Math.PI * 2);
                ctx.fillStyle = theme.handleFill;
                ctx.fill();
                ctx.stroke();
              } else {
                this.drawSquareHandle(ctx, x, y, frame.angle);
              }
            }
          }
        }
      }
    }

    if (g?.kind === "marquee") {
      const [ax, ay] = this.toScreen(g.start);
      const [bx, by] = this.toScreen(g.current);
      ctx.fillStyle = theme.accent;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    }

    if (this.guides.x.length || this.guides.y.length) {
      ctx.save();
      ctx.strokeStyle = theme.dark ? "#ff7ab8" : "#e5368f";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      for (const gx of this.guides.x) {
        const [sx] = this.toScreen([gx, 0]);
        ctx.beginPath();
        ctx.moveTo(Math.round(sx) + 0.5, 0);
        ctx.lineTo(Math.round(sx) + 0.5, this.height);
        ctx.stroke();
      }
      for (const gy of this.guides.y) {
        const [, sy] = this.toScreen([0, gy]);
        ctx.beginPath();
        ctx.moveTo(0, Math.round(sy) + 0.5);
        ctx.lineTo(this.width, Math.round(sy) + 0.5);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (g?.kind === "erase" && g.trail.length > 1) {
      ctx.save();
      ctx.strokeStyle = theme.dark ? "rgba(255,255,255,0.35)" : "rgba(15,23,42,0.22)";
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      g.trail.forEach((p, i) => {
        const [x, y] = this.toScreen(p);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.restore();
    }
  }

  private strokeElementOutline(ctx: CanvasRenderingContext2D, el: BoardElement, grow = 0) {
    if (isLinear(el) || el.type === "freedraw") {
      const pts = worldPoints(el).map((p) => this.toScreen(p));
      if (el.type === "freedraw") {
        const b = elementBounds(el);
        const [x0, y0] = this.toScreen([b.minX, b.minY]);
        const [x1, y1] = this.toScreen([b.maxX, b.maxY]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        return;
      }
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      return;
    }
    const center = elementCenter(el);
    const pad = grow / this.viewport.zoom;
    const corners: Point[] = [
      [el.x - pad, el.y - pad],
      [el.x + el.width + pad, el.y - pad],
      [el.x + el.width + pad, el.y + el.height + pad],
      [el.x - pad, el.y + el.height + pad],
    ].map((p) => this.toScreen(rotatePoint(p as Point, center, el.angle)));
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
  }

  private drawSquareHandle(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = this.theme.handleFill;
    ctx.beginPath();
    ctx.roundRect(-HANDLE_SIZE / 2, -HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE, 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawPointHandles(ctx: CanvasRenderingContext2D, el: BoardElement) {
    const pts = worldPoints(el).map((p) => this.toScreen(p));
    ctx.save();
    for (let i = 0; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      if (Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) < 28) continue;
      ctx.beginPath();
      ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = this.theme.handleFill;
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = this.theme.handleFill;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  selectedElements(): BoardElement[] {
    if (!this.selected.size) return [];
    return this.elements.filter((el) => this.selected.has(el.id));
  }

  setSelection(ids: Iterable<string>, { announce = true } = {}) {
    const next = expandToGroups(this.elements, ids);
    const same = next.size === this.selected.size && [...next].every((id) => this.selected.has(id));
    if (same) return;
    this.selected = next;
    this.invalidate();
    this.emit("ui");
    if (announce && next.size) {
      this.onAnnounce?.(
        next.size === 1
          ? `${this.describe(this.selectedElements()[0])} selected`
          : `${next.size} items selected`,
      );
    }
  }

  private describe(el: BoardElement | undefined) {
    if (!el) return "Item";
    const map = sceneIndex(this.elements);
    const label = labelOf(el, map)?.text;
    const names: Record<string, string> = {
      rectangle:
        el.backgroundColor !== "transparent" && el.strokeColor === "transparent"
          ? "Sticky note"
          : "Rectangle",
      ellipse: "Ellipse",
      diamond: "Diamond",
      arrow: "Arrow",
      line: "Line",
      freedraw: "Drawing",
      text: "Text",
      image: "Image",
    };
    const name = names[el.type] ?? "Item";
    const text = el.type === "text" ? el.text : label;
    return text ? `${name} “${text.slice(0, 40)}”` : name;
  }

  /** The selection's frame in screen space: corners, handle positions, rotation. */
  private selectionFrame() {
    const selected = this.selectedElements();
    if (!selected.length) return null;
    let corners: Point[];
    let angle = 0;
    const single = selected.length === 1 ? selected[0] : null;
    if (single && !isLinear(single)) {
      const box = this.frameBox(single);
      const center: Point = [box.x + box.w / 2, box.y + box.h / 2];
      angle = single.angle;
      corners = [
        [box.x, box.y],
        [box.x + box.w, box.y],
        [box.x + box.w, box.y + box.h],
        [box.x, box.y + box.h],
      ].map((p) => this.toScreen(rotatePoint(p as Point, center, angle)));
    } else {
      const b = unionBounds(selected);
      if (!b) return null;
      corners = [
        [b.minX, b.minY],
        [b.maxX, b.minY],
        [b.maxX, b.maxY],
        [b.minX, b.maxY],
      ].map((p) => this.toScreen(p as Point));
    }
    // Pad by a few pixels so the frame never sits on top of the stroke.
    const [c0, c1, c2, c3] = corners;
    const cx = (c0[0] + c2[0]) / 2;
    const cy = (c0[1] + c2[1]) / 2;
    const grow = (p: Point): Point => {
      const dx = p[0] - cx;
      const dy = p[1] - cy;
      const len = Math.hypot(dx, dy) || 1;
      return [p[0] + (dx / len) * 4, p[1] + (dy / len) * 4];
    };
    corners = [grow(c0), grow(c1), grow(c2), grow(c3)];
    const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const [nw, ne, se, sw] = corners;
    const width = distance(nw, ne);
    const height = distance(nw, sw);
    const handles: [Handle, Point][] = [
      ["nw", nw],
      ["ne", ne],
      ["se", se],
      ["sw", sw],
    ];
    const isText = single?.type === "text";
    const multi = !single;
    if (!multi) {
      if (height > 36 && !isText) handles.push(["n", mid(nw, ne)], ["s", mid(sw, se)]);
      if (width > 36) handles.push(["e", mid(ne, se)], ["w", mid(nw, sw)]);
    }
    const top = mid(nw, ne);
    const up: Point = [Math.sin(angle), -Math.cos(angle)];
    handles.push(["rotate", [top[0] + up[0] * ROTATE_OFFSET, top[1] + up[1] * ROTATE_OFFSET]]);
    return { corners, handles, angle };
  }

  /** An element's own unrotated box (for lines and strokes, the box of their points). */
  private frameBox(el: BoardElement) {
    if (el.points && (isLinear(el) || el.type === "freedraw")) {
      const b = localPointsBox(el);
      return { x: el.x + b.minX, y: el.y + b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
    }
    return { x: el.x, y: el.y, w: el.width, h: el.height };
  }

  private handleAt(sx: number, sy: number, touch: boolean): Handle | null {
    if (this.readOnly || this.selectionLocked) return null;
    const frame = this.selectionFrame();
    if (!frame) return null;
    const single = this.selected.size === 1 ? this.selectedElements()[0] : null;
    if (single && isLinear(single)) return null;
    const slop = touch ? 14 : 8;
    for (const [handle, [x, y]] of frame.handles) {
      if (Math.abs(sx - x) <= slop && Math.abs(sy - y) <= slop) return handle;
    }
    return null;
  }

  private pointHandleAt(
    sx: number,
    sy: number,
    touch: boolean,
  ): { index: number; insert: boolean } | null {
    if (this.readOnly || this.selected.size !== 1) return null;
    const el = this.selectedElements()[0];
    if (!el || !isLinear(el)) return null;
    const pts = worldPoints(el).map((p) => this.toScreen(p));
    const slop = touch ? 14 : 8;
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(sx - pts[i][0], sy - pts[i][1]) <= slop) return { index: i, insert: false };
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      if (Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) < 28) continue;
      if (Math.hypot(sx - mx, sy - my) <= slop) return { index: i + 1, insert: true };
    }
    return null;
  }

  /** Topmost element under a world point. A label resolves to its shape. */
  elementAt(p: Point, touch = false, includeLocked = false): BoardElement | null {
    const tolerance = (touch ? 10 : 5) / this.viewport.zoom;
    const map = sceneIndex(this.elements);
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (el.locked && !includeLocked) continue;
      if (el.type === "text" && el.containerId && map.has(el.containerId)) continue;
      if (hitTest(el, p, tolerance, this.selected.has(el.id))) return el;
    }
    // Nothing under the pointer by outline or ink: fall back to the smallest
    // unfilled shape the point is inside. Clicking in the middle of an empty
    // box selects the box, while things drawn inside it still win above.
    let inside: BoardElement | null = null;
    let insideArea = Infinity;
    for (const el of this.elements) {
      if ((el.locked && !includeLocked) || !isShape(el)) continue;
      const area = el.width * el.height;
      if (area < insideArea && hitTest(el, p, 0, true)) {
        inside = el;
        insideArea = area;
      }
    }
    return inside;
  }

  /** True while a drag is changing the scene, when floating chrome steps aside. */
  get interacting() {
    const g = this.gesture;
    if (!g) return false;
    if (g.kind === "move") return g.moved;
    return g.kind !== "pan" && g.kind !== "pinch";
  }

  private wasInteracting = false;
  private syncInteracting() {
    const now = this.interacting;
    if (now !== this.wasInteracting) {
      this.wasInteracting = now;
      this.emit("ui");
    }
  }

  /** The selection's box on screen (unrotated bounds), for chrome that floats beside it. */
  selectionScreenBox() {
    const selected = this.selectedElements();
    if (!selected.length) return null;
    const b = unionBounds(selected);
    if (!b) return null;
    const [left, top] = this.toScreen([b.minX, b.minY]);
    const [right, bottom] = this.toScreen([b.maxX, b.maxY]);
    return { left, top, right, bottom, width: this.width, height: this.height };
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  /** Closes an edit: records it for undo and tells autosave. */
  commit() {
    if (sameArray(this.elements, this.committed)) return;
    this.past.push(this.committed);
    if (this.past.length > 300) this.past.shift();
    this.future = [];
    this.committed = this.elements;
    this.emit("change");
    this.emit("ui");
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  undo() {
    if (this.gesture || this.editingId || !this.past.length) return;
    this.future.push(this.committed);
    this.restore(this.past.pop()!);
    this.onAnnounce?.("Undone");
  }

  redo() {
    if (this.gesture || this.editingId || !this.future.length) return;
    this.past.push(this.committed);
    this.restore(this.future.pop()!);
    this.onAnnounce?.("Redone");
  }

  private restore(elements: BoardElement[]) {
    this.elements = this.committed = elements;
    const ids = new Set(elements.map((el) => el.id));
    this.selected = new Set([...this.selected].filter((id) => ids.has(id)));
    this.invalidate(true);
    this.emit("change");
    this.emit("ui");
  }

  private setElements(next: BoardElement[]) {
    if (next === this.elements) return;
    this.elements = next;
    this.invalidate(true);
  }

  /** Applies a whole-scene edit as one undoable step. */
  apply(edit: (elements: BoardElement[]) => BoardElement[]) {
    if (this.readOnly) return;
    this.setElements(edit(this.elements));
    const ids = new Set(this.elements.map((el) => el.id));
    if ([...this.selected].some((id) => !ids.has(id))) {
      this.selected = new Set([...this.selected].filter((id) => ids.has(id)));
    }
    this.commit();
    this.emit("ui");
  }

  // -------------------------------------------------------------------------
  // Tools and style
  // -------------------------------------------------------------------------

  setTool(tool: Tool) {
    if (this.readOnly && tool !== "hand") return;
    if (this.editingId) this.endTextEdit();
    this.tool = tool;
    if (tool !== "select") this.setSelection([], { announce: false });
    this.hoverId = null;
    this.updateCursor();
    this.invalidate();
    this.emit("ui");
  }

  /**
   * Applies a style change to the selection and makes it the default for
   * what's drawn next — the way a pen remembers its colour.
   */
  setStyle(changes: Partial<StyleDefaults>, { commit = true } = {}) {
    this.style = { ...this.style, ...changes };
    const selected = this.selectedElements();
    if (selected.length) {
      const map = indexById(this.elements);
      const updates = new Map<string, BoardElement>();
      const touch = (el: BoardElement, patch: Partial<BoardElement>) => {
        const current = updates.get(el.id) ?? el;
        const filtered = Object.fromEntries(
          Object.entries(patch).filter(([k, v]) => v !== undefined && current[k] !== v),
        );
        if (Object.keys(filtered).length) updates.set(el.id, mutate(current, filtered));
      };
      for (const el of selected) {
        const label = labelOf(el, map);
        const patch: Partial<BoardElement> = {};
        if (changes.strokeColor !== undefined) {
          // A sticky note's colour is its text's colour; its border stays off.
          const sticky = el.type === "rectangle" && el.strokeColor === "transparent" && !!label;
          if (!sticky) patch.strokeColor = changes.strokeColor;
          if (label) touch(label, { strokeColor: changes.strokeColor });
        }
        if (
          changes.backgroundColor !== undefined &&
          !isLinear(el) &&
          el.type !== "text" &&
          el.type !== "freedraw" &&
          el.type !== "image"
        ) {
          patch.backgroundColor = changes.backgroundColor;
        }
        if (changes.strokeWidth !== undefined && el.type !== "text" && el.type !== "image")
          patch.strokeWidth = changes.strokeWidth;
        if (changes.strokeStyle !== undefined && el.type !== "freedraw" && el.type !== "text")
          patch.strokeStyle = changes.strokeStyle;
        if (changes.roundness !== undefined && (el.type === "rectangle" || el.type === "diamond")) {
          patch.roundness = changes.roundness ? { type: 3 } : null;
        }
        if (changes.roundness !== undefined && isLinear(el))
          patch.roundness = changes.roundness ? { type: 2 } : null;
        if (changes.startArrowhead !== undefined && el.type === "arrow")
          patch.startArrowhead = changes.startArrowhead;
        if (changes.endArrowhead !== undefined && el.type === "arrow")
          patch.endArrowhead = changes.endArrowhead;
        if (changes.opacity !== undefined) patch.opacity = changes.opacity;
        const textTarget = el.type === "text" ? el : label;
        if (textTarget) {
          const textPatch: Partial<BoardElement> = {};
          if (changes.fontSize !== undefined) textPatch.fontSize = changes.fontSize;
          if (changes.fontFamily !== undefined) textPatch.fontFamily = changes.fontFamily;
          if (changes.textAlign !== undefined) textPatch.textAlign = changes.textAlign;
          if (el.type === "text") Object.assign(patch, textPatch);
          else touch(textTarget, textPatch);
        }
        touch(el, patch);
      }
      let next = replaceElements(this.elements, updates);
      // Text that changed size needs its box (and its container) re-laid.
      const resized: string[] = [];
      for (const [id, el] of updates) {
        if (el.type === "text" && !el.containerId) {
          const layout = layoutText(el);
          next = replaceElements(
            next,
            new Map([
              [
                id,
                mutate(
                  el,
                  el.autoResize === false
                    ? { height: layout.height }
                    : { width: layout.width, height: layout.height },
                ),
              ],
            ]),
          );
        }
        resized.push(el.containerId ?? id);
      }
      this.setElements(settle(next, resized));
      // A drag on the colour wheel previews live with `commit: false`, then
      // commits once on release — one undo step, not one per pointer move.
      if (commit) this.commit();
    }
    this.emit("ui");
  }

  setMarker(changes: Partial<MarkerStyle>) {
    this.marker = { ...this.marker, ...changes };
    this.emit("ui");
  }

  setGrid(show: boolean) {
    this.showGrid = show;
    this.invalidate(true);
    this.emit("ui");
  }

  private updateCursor(cursor?: string) {
    if (!this.root) return;
    let value = cursor;
    if (!value) {
      if (this.tool === "hand" || this.spaceHeld)
        value = this.gesture?.kind === "pan" ? "grabbing" : "grab";
      else if (this.tool === "select") value = "default";
      else if (this.tool === "text") value = "text";
      else if (this.tool === "eraser") value = "cell";
      else value = "crosshair";
    }
    if (this.root.style.cursor !== value) this.root.style.cursor = value;
  }

  // -------------------------------------------------------------------------
  // Viewport
  // -------------------------------------------------------------------------

  zoomAt(sx: number, sy: number, zoom: number) {
    const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const [wx, wy] = this.toWorld(sx, sy);
    this.setViewport({ x: wx - sx / next, y: wy - sy / next, zoom: next });
  }

  zoomBy(factor: number) {
    this.animateTo(this.zoomedViewport(this.viewport.zoom * factor));
  }

  private zoomedViewport(zoom: number): Viewport {
    const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const [wx, wy] = this.toWorld(this.width / 2, this.height / 2);
    return { x: wx - this.width / 2 / next, y: wy - this.height / 2 / next, zoom: next };
  }

  resetZoom() {
    this.animateTo(this.zoomedViewport(1));
  }

  /** Frames the whole board (or the selection), never magnifying past 100%. */
  zoomToFit({ selection = false, animate = true } = {}) {
    const source = selection ? this.selectedElements() : this.elements;
    const box = unionBounds(source);
    if (!box || !this.width || !this.height) {
      const target = { x: -this.width / 2, y: -this.height / 2, zoom: 1 };
      if (animate) this.animateTo(target);
      else this.setViewport(target);
      return;
    }
    const pad = Math.min(96, Math.min(this.width, this.height) * 0.12);
    const w = Math.max(box.maxX - box.minX, 1);
    const h = Math.max(box.maxY - box.minY, 1);
    const zoom = clamp(
      Math.min((this.width - pad * 2) / w, (this.height - pad * 2) / h, selection ? 2 : 1),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    const target = {
      x: (box.minX + box.maxX) / 2 - this.width / 2 / zoom,
      y: (box.minY + box.maxY) / 2 - this.height / 2 / zoom,
      zoom,
    };
    if (animate) this.animateTo(target);
    else this.setViewport(target);
  }

  private animateTo(target: Viewport) {
    cancelAnimationFrame(this.animation);
    if (prefersReducedMotion() || typeof requestAnimationFrame === "undefined") {
      this.setViewport(target);
      return;
    }
    const from = { ...this.viewport };
    const start = performance.now();
    const duration = 220;
    // Interpolate the screen-centre point and the log of zoom, so the motion
    // reads as a single smooth push in or out rather than a swoop.
    const centre = (v: Viewport): Point => [
      v.x + this.width / 2 / v.zoom,
      v.y + this.height / 2 / v.zoom,
    ];
    const [fx, fy] = centre(from);
    const [tx, ty] = centre(target);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      const zoom = Math.exp(
        Math.log(from.zoom) + (Math.log(target.zoom) - Math.log(from.zoom)) * e,
      );
      const cx = fx + (tx - fx) * e;
      const cy = fy + (ty - fy) * e;
      this.setViewport({ x: cx - this.width / 2 / zoom, y: cy - this.height / 2 / zoom, zoom });
      if (t < 1) this.animation = requestAnimationFrame(step);
    };
    this.animation = requestAnimationFrame(step);
  }

  wheel(e: WheelEvent, sx: number, sy: number) {
    cancelAnimationFrame(this.animation);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1;
    let dx = e.deltaX * unit;
    let dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel with small deltas; a mouse wheel
      // with ctrl sends ~100 per notch. Clamping evens the two out.
      const factor = Math.exp(-clamp(dy, -40, 40) * 0.0125);
      this.zoomAt(sx, sy, this.viewport.zoom * factor);
      return;
    }
    if (e.shiftKey && !dx) {
      dx = dy;
      dy = 0;
    }
    this.setViewport({
      ...this.viewport,
      x: this.viewport.x + dx / this.viewport.zoom,
      y: this.viewport.y + dy / this.viewport.zoom,
    });
  }

  // -------------------------------------------------------------------------
  // Pointer input
  // -------------------------------------------------------------------------

  private isDoubleTap(sx: number, sy: number) {
    const now = performance.now();
    const double =
      now - this.lastTap.time < 320 && Math.hypot(sx - this.lastTap.x, sy - this.lastTap.y) < 10;
    this.lastTap = double ? { time: 0, x: 0, y: 0 } : { time: now, x: sx, y: sy };
    return double;
  }

  pointerDown(e: PointerEvent, sx: number, sy: number) {
    this.handlePointerDown(e, sx, sy);
    this.syncInteracting();
  }

  private handlePointerDown(e: PointerEvent, sx: number, sy: number) {
    this.pointers.set(e.pointerId, [sx, sy]);
    if (this.editingId) this.endTextEdit();
    cancelAnimationFrame(this.animation);

    // A second finger turns any gesture into pinch-zoom.
    if (this.pointers.size === 2) {
      this.cancelGesture();
      const [a, b] = [...this.pointers.values()];
      this.gesture = {
        kind: "pinch",
        distance: Math.max(distance(a, b), 1),
        mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        viewport: { ...this.viewport },
      };
      return;
    }
    if (this.pointers.size > 2) return;

    const touch = e.pointerType === "touch";
    const world = this.toWorld(sx, sy);
    this.lastPointerWorld = world;
    const double = e.button === 0 && this.isDoubleTap(sx, sy);

    if (
      e.button === 1 ||
      this.tool === "hand" ||
      this.spaceHeld ||
      (this.readOnly && e.button === 0)
    ) {
      this.gesture = { kind: "pan", sx, sy, vx: this.viewport.x, vy: this.viewport.y };
      this.updateCursor("grabbing");
      return;
    }

    if (e.button === 2) {
      // Right-click selects what's under it, so the context menu acts on it —
      // locked things included, since that menu is where they're unlocked.
      const hit = this.elementAt(world, touch, true);
      if (hit && !this.selected.has(hit.id)) this.setSelection([hit.id]);
      if (!hit) this.setSelection([]);
      return;
    }
    if (e.button !== 0) return;

    this.gestureBase = this.elements;

    switch (this.tool) {
      case "select":
        this.selectDown(world, sx, sy, e, touch, double);
        break;
      case "text":
        this.textDown(world);
        break;
      case "sticky":
        this.placeSticky(world);
        break;
      case "pen":
      case "marker":
        this.drawDown(world, e);
        break;
      case "eraser":
        this.gesture = { kind: "erase", last: world, trail: [world], hits: new Set() };
        this.eraseAlong(world, world, touch);
        break;
      default:
        this.createDown(world, touch);
    }
    this.invalidate();
  }

  private selectDown(
    world: Point,
    sx: number,
    sy: number,
    e: PointerEvent,
    touch: boolean,
    double: boolean,
  ) {
    const point = this.pointHandleAt(sx, sy, touch);
    if (point) {
      let el = this.selectedElements()[0];
      // Bake any rotation into the points so they can be edited directly.
      const plain = mutate(el, withWorldPoints(el, worldPoints(el)));
      let elements = replaceElements(this.elements, new Map([[el.id, plain]]));
      el = plain;
      if (point.insert) {
        const pts = [...(el.points ?? [])];
        pts.splice(point.index, 0, [world[0] - el.x, world[1] - el.y]);
        el = mutate(el, { points: pts });
        elements = replaceElements(elements, new Map([[el.id, el]]));
      }
      this.setElements(elements);
      this.gesture = { kind: "point", id: el.id, index: point.index, origin: el };
      return;
    }

    const handle = this.handleAt(sx, sy, touch);
    if (handle) {
      const selected = this.selectedElements();
      const origin = this.withLabels([...selected, ...this.marksOnPhotos()]);
      if (handle === "rotate") {
        const single = selected.length === 1 ? selected[0] : null;
        const center = single ? elementCenter(single) : this.boxCenter(unionBounds(selected)!);
        this.gesture = {
          kind: "rotate",
          center,
          startAngle: Math.atan2(world[1] - center[1], world[0] - center[0]),
          origin,
        };
      } else {
        this.gesture = {
          kind: "resize",
          handle,
          origin,
          box: unionBounds(selected)!,
          single: selected.length === 1 ? selected[0] : null,
        };
      }
      return;
    }

    const hit = this.elementAt(world, touch);
    if (double) {
      this.cancelGesture();
      // Photos and drawings hold no label of their own: a double-click on one
      // starts text right there, on top — how a photo gets annotated.
      if (hit && hit.type !== "image" && hit.type !== "freedraw") this.editTextOf(hit);
      else this.createTextAt(world);
      return;
    }
    if (hit) {
      if (e.shiftKey) {
        const group = expandToGroups(this.elements, [hit.id]);
        const next = new Set(this.selected);
        const has = [...group].every((id) => next.has(id));
        for (const id of group) {
          if (has) next.delete(id);
          else next.add(id);
        }
        this.selected = next;
        this.emit("ui");
        if (has) return;
      } else if (!this.selected.has(hit.id)) {
        this.setSelection([hit.id]);
      }
      this.startMove(world);
      return;
    }
    this.gesture = {
      kind: "marquee",
      start: world,
      current: world,
      base: e.shiftKey ? new Set(this.selected) : new Set(),
    };
    if (!e.shiftKey) this.setSelection([], { announce: false });
  }

  private boxCenter(b: Box): Point {
    return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  }

  /** Originals of the given elements plus their labels, keyed by id. */
  private withLabels(elements: BoardElement[]) {
    const map = sceneIndex(this.elements);
    const origin = new Map<string, BoardElement>();
    for (const el of elements) {
      origin.set(el.id, el);
      const label = labelOf(el, map);
      if (label) origin.set(label.id, label);
    }
    return origin;
  }

  /** True when the selection holds something locked: it can be unlocked, not edited. */
  get selectionLocked() {
    return this.selectedElements().some((el) => el.locked);
  }

  /**
   * Marks drawn on a selected photo — strokes, arrows, text, shapes lying
   * entirely within it and above it — so they travel with the photo when it
   * is moved, resized or turned. Labels stay where they were put.
   */
  private marksOnPhotos(): BoardElement[] {
    const photos = this.selectedElements().filter((el) => el.type === "image");
    if (!photos.length) return [];
    const marks: BoardElement[] = [];
    const taken = new Set(this.selected);
    for (const photo of photos) {
      const start = this.elements.indexOf(photo);
      const b = this.unpaddedBounds(photo);
      const slack = 8 / this.viewport.zoom;
      const area = {
        minX: b.minX - slack,
        minY: b.minY - slack,
        maxX: b.maxX + slack,
        maxY: b.maxY + slack,
      };
      for (let i = start + 1; i < this.elements.length; i++) {
        const el = this.elements[i];
        if (taken.has(el.id) || el.containerId || el.locked || el.type === "image") continue;
        if (!boxContains(area, elementBounds(el))) continue;
        taken.add(el.id);
        marks.push(el);
      }
    }
    return marks;
  }

  /** Locks the selection (or unlocks it, if it's locked). Locked things can't be moved or erased. */
  toggleLock() {
    const selected = this.selectedElements();
    if (!selected.length || this.readOnly) return;
    const lock = !selected.some((el) => el.locked);
    const ids = new Set(selected.map((el) => el.id));
    this.apply((els) => els.map((el) => (ids.has(el.id) ? mutate(el, { locked: lock }) : el)));
    // A locked element steps out of the way: clicks and drags go to what's on it.
    if (lock) this.selected = new Set();
    this.emit("ui");
    this.onAnnounce?.(lock ? "Locked" : "Unlocked");
  }

  private startMove(world: Point) {
    if (this.selectionLocked) return;
    const origin = this.withLabels([...this.selectedElements(), ...this.marksOnPhotos()]);
    // Snap candidates: edges and centres of what's on screen, gathered once.
    const snapX: number[] = [];
    const snapY: number[] = [];
    const visible = this.visibleBox();
    let count = 0;
    for (const el of this.elements) {
      if (origin.has(el.id) || el.containerId || count > 600) continue;
      const b = elementBounds(el);
      if (!boxesIntersect(b, visible)) continue;
      count++;
      const box = isLinear(el) || el.type === "freedraw" ? b : this.unpaddedBounds(el);
      snapX.push(box.minX, (box.minX + box.maxX) / 2, box.maxX);
      snapY.push(box.minY, (box.minY + box.maxY) / 2, box.maxY);
    }
    this.gesture = {
      kind: "move",
      start: world,
      origin,
      moved: false,
      duplicated: false,
      snapX,
      snapY,
    };
  }

  private unpaddedBounds(el: BoardElement): Box {
    const center = elementCenter(el);
    const pts = [
      [el.x, el.y],
      [el.x + el.width, el.y],
      [el.x + el.width, el.y + el.height],
      [el.x, el.y + el.height],
    ].map((p) => rotatePoint(p as Point, center, el.angle));
    return {
      minX: Math.min(...pts.map((p) => p[0])),
      minY: Math.min(...pts.map((p) => p[1])),
      maxX: Math.max(...pts.map((p) => p[0])),
      maxY: Math.max(...pts.map((p) => p[1])),
    };
  }

  private textDown(world: Point) {
    const hit = this.elementAt(world);
    if (
      hit &&
      (hit.type === "text" ||
        hit.type === "rectangle" ||
        hit.type === "ellipse" ||
        hit.type === "diamond" ||
        isLinear(hit))
    ) {
      this.editTextOf(hit);
      return;
    }
    this.createTextAt(world);
  }

  private createTextAt(world: Point) {
    const lineHeight = this.style.fontSize * 1.25;
    const text = newElement(
      "text",
      { x: world[0], y: world[1] - lineHeight / 2, height: lineHeight },
      this.style,
    );
    this.setElements([...this.elements, text]);
    this.selected = new Set([text.id]);
    this.startTextEdit(text.id);
  }

  private placeSticky(world: Point) {
    const fill =
      this.style.backgroundColor !== "transparent"
        ? this.style.backgroundColor
        : FILL_SWATCHES[3].light;
    const sticky = newElement(
      "rectangle",
      {
        x: world[0] - STICKY_SIZE / 2,
        y: world[1] - STICKY_SIZE / 2,
        width: STICKY_SIZE,
        height: STICKY_SIZE,
        backgroundColor: fill,
        strokeColor: "transparent",
        roundness: { type: 3 },
      },
      this.style,
    );
    const placed = [...this.elements, sticky];
    const { elements, textId } = ensureLabel(placed, sticky.id, this.style);
    this.setElements(elements);
    this.selected = new Set([sticky.id]);
    this.tool = "select";
    this.updateCursor();
    this.startTextEdit(textId);
  }

  private drawDown(world: Point, e: PointerEvent) {
    const marker = this.tool === "marker";
    const pen = e.pointerType === "pen";
    const element = newElement(
      "freedraw",
      {
        x: world[0],
        y: world[1],
        points: [[0, 0]],
        pressures: pen ? [e.pressure || 0.5] : [],
        simulatePressure: !pen,
        ...(marker
          ? {
              strokeColor: this.marker.color,
              strokeWidth: this.marker.width,
              opacity: 45,
              customData: { marker: true },
            }
          : { opacity: 100 }),
      },
      this.style,
    );
    this.gesture = { kind: "draw", element };
  }

  private createDown(world: Point, touch: boolean) {
    const type = this.tool as "rectangle" | "ellipse" | "diamond" | "arrow" | "line";
    const element = newElement(type, { x: world[0], y: world[1] }, this.style);
    let startTarget: string | undefined;
    if (type === "arrow" || type === "line") {
      const target = findBindTarget(
        this.elements,
        world,
        (touch ? 10 : 4) / this.viewport.zoom,
        new Set(),
      );
      startTarget = type === "arrow" ? target?.id : undefined;
      element.points = [
        [0, 0],
        [0, 0],
      ];
    }
    this.gesture = { kind: "create", element, start: world, startTarget };
  }

  pointerMove(e: PointerEvent, sx: number, sy: number) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [sx, sy]);
    const world = this.toWorld(sx, sy);
    this.lastPointerWorld = world;
    const g = this.gesture;
    const touch = e.pointerType === "touch";

    if (!g) {
      this.hover(world, sx, sy, touch);
      return;
    }

    switch (g.kind) {
      case "pinch": {
        if (this.pointers.size < 2) return;
        const [a, b] = [...this.pointers.values()];
        const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const zoom = clamp((g.viewport.zoom * distance(a, b)) / g.distance, MIN_ZOOM, MAX_ZOOM);
        // Keep the world point that was under the fingers' midpoint under it.
        const wx = g.mid[0] / g.viewport.zoom + g.viewport.x;
        const wy = g.mid[1] / g.viewport.zoom + g.viewport.y;
        this.setViewport({ x: wx - mid[0] / zoom, y: wy - mid[1] / zoom, zoom });
        return;
      }
      case "pan":
        this.setViewport({
          ...this.viewport,
          x: g.vx - (sx - g.sx) / this.viewport.zoom,
          y: g.vy - (sy - g.sy) / this.viewport.zoom,
        });
        return;
      case "marquee": {
        g.current = world;
        const box: Box = {
          minX: Math.min(g.start[0], world[0]),
          minY: Math.min(g.start[1], world[1]),
          maxX: Math.max(g.start[0], world[0]),
          maxY: Math.max(g.start[1], world[1]),
        };
        const ids = new Set(g.base);
        for (const el of this.elements) {
          if (el.locked || el.containerId) continue;
          if (boxContains(box, elementBounds(el))) ids.add(el.id);
        }
        const next = expandToGroups(this.elements, ids);
        if (next.size !== this.selected.size || [...next].some((id) => !this.selected.has(id))) {
          this.selected = next;
          this.emit("ui");
        }
        this.invalidate();
        return;
      }
      case "move":
        this.moveTo(g, world, e);
        return;
      case "resize":
        this.resizeTo(g, world, e.shiftKey);
        return;
      case "rotate":
        this.rotateTo(g, world, e.shiftKey);
        return;
      case "create":
        this.createTo(g, world, e, touch);
        return;
      case "draw": {
        const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
        const samples = events.length ? events : [e];
        const rect = this.root?.getBoundingClientRect();
        const points = [...(g.element.points ?? [])];
        const pressures = [...(g.element.pressures ?? [])];
        for (const sample of samples) {
          const p = rect
            ? this.toWorld(sample.clientX - rect.left, sample.clientY - rect.top)
            : world;
          const local: Point = [p[0] - g.element.x, p[1] - g.element.y];
          const last = points[points.length - 1];
          if (last && Math.hypot(local[0] - last[0], local[1] - last[1]) < 0.6 / this.viewport.zoom)
            continue;
          points.push(local);
          if (!g.element.simulatePressure) pressures.push(sample.pressure || 0.5);
        }
        g.element = { ...g.element, points, pressures };
        this.invalidate();
        return;
      }
      case "erase":
        this.eraseAlong(g.last, world, touch);
        g.last = world;
        g.trail.push(world);
        if (g.trail.length > 24) g.trail.shift();
        this.invalidate();
        return;
      case "point":
        this.pointTo(g, world, e.shiftKey, touch);
        return;
    }
  }

  private hover(world: Point, sx: number, sy: number, touch: boolean) {
    if (this.tool !== "select" || this.spaceHeld) {
      if (this.hoverId) {
        this.hoverId = null;
        this.invalidate();
      }
      return;
    }
    const handle = this.handleAt(sx, sy, touch);
    const point = !handle && this.pointHandleAt(sx, sy, touch);
    const hit = handle || point ? null : this.elementAt(world, touch);
    if (handle === "rotate") this.updateCursor("grab");
    else if (handle) {
      // Resize cursors turn with the selection, in 45° steps.
      const steps = Math.round(((this.selectionFrame()?.angle ?? 0) / Math.PI) * 4);
      this.updateCursor(HANDLE_CURSORS[(((HANDLE_ANGLES[handle] + steps) % 4) + 4) % 4]);
    } else this.updateCursor(point || hit ? "move" : "default");
    const id = hit?.id ?? null;
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.invalidate();
    }
  }

  private moveTo(g: Extract<Gesture, { kind: "move" }>, world: Point, e: PointerEvent) {
    let dx = world[0] - g.start[0];
    let dy = world[1] - g.start[1];
    if (!g.moved && Math.hypot(dx, dy) * this.viewport.zoom < 3) return;
    if (!g.moved && e.altKey && !g.duplicated) {
      // Option-drag leaves the original behind and drags a copy.
      const clones = cloneElements(this.elements, this.selected, [0, 0]);
      this.elements = [...this.elements, ...clones];
      const top = clones.filter((c) => !c.containerId);
      this.selected = new Set(top.map((c) => c.id));
      g.origin = this.withLabels(top);
      g.duplicated = true;
      this.emit("ui");
    }
    if (!g.moved) {
      g.moved = true;
      this.syncInteracting();
    }
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    this.guides = { x: [], y: [] };
    // Snap the selection's edges and centre to what's around it; ⌘/Ctrl
    // held while dragging turns snapping off.
    if (!(e.metaKey || e.ctrlKey)) {
      const moving = [...g.origin.values()].filter((el) => !el.containerId);
      if (moving.length) {
        const tight = moving
          .map((el) =>
            isLinear(el) || el.type === "freedraw" ? elementBounds(el) : this.unpaddedBounds(el),
          )
          .reduce((a, b) => ({
            minX: Math.min(a.minX, b.minX),
            minY: Math.min(a.minY, b.minY),
            maxX: Math.max(a.maxX, b.maxX),
            maxY: Math.max(a.maxY, b.maxY),
          }));
        const threshold = SNAP_DISTANCE / this.viewport.zoom;
        const snap = (edges: number[], candidates: number[]) => {
          let best: { delta: number; at: number } | null = null;
          for (const edge of edges) {
            for (const c of candidates) {
              const delta = c - edge;
              if (
                Math.abs(delta) <= threshold &&
                (!best || Math.abs(delta) < Math.abs(best.delta))
              ) {
                best = { delta, at: c };
              }
            }
          }
          return best;
        };
        const xs = [tight.minX + dx, (tight.minX + tight.maxX) / 2 + dx, tight.maxX + dx];
        const ys = [tight.minY + dy, (tight.minY + tight.maxY) / 2 + dy, tight.maxY + dy];
        const sx = snap(xs, g.snapX);
        const sy = snap(ys, g.snapY);
        if (sx) {
          dx += sx.delta;
          this.guides.x.push(sx.at);
        }
        if (sy) {
          dy += sy.delta;
          this.guides.y.push(sy.at);
        }
      }
    }
    const updates = new Map<string, BoardElement>();
    for (const [id, el] of g.origin) {
      updates.set(id, { ...el, x: el.x + dx, y: el.y + dy });
    }
    this.setElements(settle(replaceElements(this.elements, updates), updates.keys()));
  }

  private resizeTo(g: Extract<Gesture, { kind: "resize" }>, world: Point, shift: boolean) {
    const handle = g.handle as Exclude<Handle, "rotate">;
    const hx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
    const hy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
    const updates = new Map<string, BoardElement>();

    if (g.single) {
      const el = g.origin.get(g.single.id)!;
      const box = this.frameBox(el);
      const angle = el.angle;
      const center: Point = [box.x + box.w / 2, box.y + box.h / 2];
      const anchor = rotatePoint(
        [center[0] - (hx * box.w) / 2, center[1] - (hy * box.h) / 2],
        center,
        angle,
      );
      const [dx, dy] = (() => {
        const local = rotatePoint(world, anchor, -angle);
        return [local[0] - anchor[0], local[1] - anchor[1]];
      })();
      let nw = hx ? dx * hx : box.w;
      let nh = hy ? dy * hy : box.h;
      const keepAspect =
        (hx && hy && shift !== (el.type === "image" || el.type === "text")) ||
        (el.type === "text" && hx && hy);
      if (keepAspect && box.w && box.h) {
        const scale = Math.max(Math.abs(nw) / box.w, Math.abs(nh) / box.h);
        nw = Math.sign(nw || 1) * box.w * scale;
        nh = Math.sign(nh || 1) * box.h * scale;
      }
      const minSize = 2 / this.viewport.zoom;
      if (Math.abs(nw) < minSize) nw = Math.sign(nw || 1) * minSize;
      if (Math.abs(nh) < minSize) nh = Math.sign(nh || 1) * minSize;
      const offset: Point = [hx ? (hx * nw) / 2 : 0, hy ? (hy * nh) / 2 : 0];
      const rotated = rotatePoint([anchor[0] + offset[0], anchor[1] + offset[1]], anchor, angle);
      const w = Math.abs(nw);
      const h = Math.abs(nh);
      const nx = rotated[0] - w / 2;
      const ny = rotated[1] - h / 2;
      updates.set(
        el.id,
        this.resized(el, box, { x: nx, y: ny, w, h, flipX: nw < 0, flipY: nh < 0, handle }),
      );
      // Marks on a photo scale with it, staying over what they point at.
      if (el.type === "image" && !angle && box.w && box.h) {
        const fx = w / box.w;
        const fy = h / box.h;
        const map = (p: Point): Point => [nx + (p[0] - box.x) * fx, ny + (p[1] - box.y) * fy];
        for (const mark of g.origin.values()) {
          if (mark.id === el.id || (mark.containerId && g.origin.has(mark.containerId))) continue;
          if (isLinear(mark) || mark.type === "freedraw") {
            updates.set(mark.id, mutate(mark, withWorldPoints(mark, worldPoints(mark).map(map))));
            continue;
          }
          const [cx, cy] = map(elementCenter(mark));
          const mw = mark.width * fx;
          const mh = mark.height * fy;
          const patch: Partial<BoardElement> = {
            x: cx - mw / 2,
            y: cy - mh / 2,
            width: mw,
            height: mh,
          };
          if (mark.type === "text")
            patch.fontSize = Math.max(4, (mark.fontSize ?? 20) * ((fx + fy) / 2));
          updates.set(mark.id, mutate(mark, patch));
        }
      }
    } else {
      // Multi-selection scales uniformly from the opposite corner.
      const b = g.box;
      const W = b.maxX - b.minX || 1;
      const H = b.maxY - b.minY || 1;
      const ax = hx > 0 ? b.minX : b.maxX;
      const ay = hy > 0 ? b.minY : b.maxY;
      const scale = Math.max(
        Math.abs(((world[0] - ax) * hx) / W),
        Math.abs(((world[1] - ay) * hy) / H),
        0.02,
      );
      const map = (p: Point): Point => [ax + (p[0] - ax) * scale, ay + (p[1] - ay) * scale];
      for (const el of g.origin.values()) {
        if (el.containerId && g.origin.has(el.containerId)) continue;
        if (isLinear(el) || el.type === "freedraw") {
          const pts = worldPoints(el).map(map);
          updates.set(
            el.id,
            mutate(el, { ...withWorldPoints(el, pts), strokeWidth: el.strokeWidth }),
          );
          continue;
        }
        const [cx, cy] = map(elementCenter(el));
        const w = el.width * scale;
        const h = el.height * scale;
        const patch: Partial<BoardElement> = { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
        if (el.type === "text") patch.fontSize = (el.fontSize ?? 20) * scale;
        updates.set(el.id, mutate(el, patch));
      }
      for (const el of g.origin.values()) {
        if (el.containerId && g.origin.has(el.containerId)) {
          updates.set(el.id, mutate(el, { fontSize: (el.fontSize ?? 20) * scale }));
        }
      }
    }
    this.setElements(settle(replaceElements(this.elements, updates), updates.keys()));
  }

  private resized(
    el: BoardElement,
    box: { x: number; y: number; w: number; h: number },
    next: {
      x: number;
      y: number;
      w: number;
      h: number;
      flipX: boolean;
      flipY: boolean;
      handle: string;
    },
  ): BoardElement {
    if (el.points && (isLinear(el) || el.type === "freedraw")) {
      const local = localPointsBox(el);
      const fx = box.w ? (next.flipX ? -next.w : next.w) / box.w : 1;
      const fy = box.h ? (next.flipY ? -next.h : next.h) / box.h : 1;
      const points = el.points.map(([px, py]) => {
        const x = (px - local.minX) * fx;
        const y = (py - local.minY) * fy;
        return [fx < 0 ? x + next.w : x, fy < 0 ? y + next.h : y] as Point;
      });
      return mutate(el, { x: next.x, y: next.y, points, width: next.w, height: next.h });
    }
    if (el.type === "text") {
      const sideOnly = next.handle === "e" || next.handle === "w";
      if (sideOnly) {
        const wrapped = mutate(el, { x: next.x, width: next.w, autoResize: false });
        const layout = layoutText(wrapped);
        return mutate(wrapped, { height: layout.height });
      }
      const scale = box.h ? next.h / box.h : 1;
      return mutate(el, {
        x: next.x,
        y: next.y,
        width: next.w,
        height: next.h,
        fontSize: Math.max(4, (el.fontSize ?? 20) * scale),
      });
    }
    const patch: Partial<BoardElement> = { x: next.x, y: next.y, width: next.w, height: next.h };
    if (el.type === "image" && (next.flipX || next.flipY)) {
      const [sx, sy] = el.scale ?? [1, 1];
      patch.scale = [next.flipX ? -sx : sx, next.flipY ? -sy : sy];
    }
    return mutate(el, patch);
  }

  private rotateTo(g: Extract<Gesture, { kind: "rotate" }>, world: Point, shift: boolean) {
    let delta = Math.atan2(world[1] - g.center[1], world[0] - g.center[0]) - g.startAngle;
    const updates = new Map<string, BoardElement>();
    const tops = [...g.origin.values()].filter(
      (el) => !(el.containerId && g.origin.has(el.containerId)),
    );
    const single = tops.length === 1 ? tops[0] : null;
    if (shift) {
      const step = Math.PI / 12;
      const base = single ? single.angle : 0;
      delta = Math.round((base + delta) / step) * step - base;
    }
    for (const el of tops) {
      if (single) {
        updates.set(el.id, mutate(el, { angle: normalizeAngle(el.angle + delta) }));
        continue;
      }
      if (isLinear(el)) {
        const pts = worldPoints(el).map((p) => rotatePoint(p, g.center, delta));
        updates.set(el.id, mutate(el, withWorldPoints(el, pts)));
        continue;
      }
      const c = elementCenter(el);
      const [ncx, ncy] = rotatePoint(c, g.center, delta);
      updates.set(
        el.id,
        mutate(el, {
          x: el.x + ncx - c[0],
          y: el.y + ncy - c[1],
          angle: normalizeAngle(el.angle + delta),
        }),
      );
    }
    this.setElements(settle(replaceElements(this.elements, updates), updates.keys()));
  }

  private createTo(
    g: Extract<Gesture, { kind: "create" }>,
    world: Point,
    e: PointerEvent,
    touch: boolean,
  ) {
    const el = g.element;
    if (isLinear(el)) {
      let end = world;
      if (e.shiftKey) end = snapAngle(g.start, world);
      const target =
        el.type === "arrow"
          ? findBindTarget(
              this.elements,
              end,
              (touch ? 10 : 4) / this.viewport.zoom,
              new Set(g.startTarget ? [g.startTarget] : []),
            )
          : undefined;
      this.bindPreview = target?.id ?? null;
      const startEl = g.startTarget ? sceneIndex(this.elements).get(g.startTarget) : undefined;
      let next = mutate(el, withWorldPoints(el, [g.start, end]));
      if (startEl || target) next = routeConnector(next, startEl, target);
      g.element = next;
    } else {
      let [x0, y0] = g.start;
      let w = world[0] - x0;
      let h = world[1] - y0;
      if (e.shiftKey) {
        const side = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * side;
        h = Math.sign(h || 1) * side;
      }
      if (e.altKey) {
        x0 -= w;
        y0 -= h;
        w *= 2;
        h *= 2;
      }
      g.element = {
        ...el,
        x: Math.min(x0, x0 + w),
        y: Math.min(y0, y0 + h),
        width: Math.abs(w),
        height: Math.abs(h),
      };
    }
    this.invalidate();
  }

  private pointTo(
    g: Extract<Gesture, { kind: "point" }>,
    world: Point,
    shift: boolean,
    touch: boolean,
  ) {
    const el = g.origin;
    const pts = worldPoints(el);
    let p = world;
    const neighbour = g.index === 0 ? pts[1] : pts[g.index - 1];
    if (shift && neighbour) p = snapAngle(neighbour, world);
    pts[g.index] = p;
    const isEnd = g.index === 0 || g.index === pts.length - 1;
    let next = mutate(el, withWorldPoints(el, pts));
    if (isEnd && el.type === "arrow") {
      const target = findBindTarget(
        this.elements,
        p,
        (touch ? 10 : 4) / this.viewport.zoom,
        new Set([el.id]),
      );
      this.bindPreview = target?.id ?? null;
    }
    const map = sceneIndex(this.elements);
    const startEl =
      g.index !== 0 && el.startBinding ? map.get(el.startBinding.elementId) : undefined;
    const endEl =
      g.index !== pts.length - 1 && el.endBinding ? map.get(el.endBinding.elementId) : undefined;
    if (startEl || endEl) next = routeConnector(next, startEl, endEl);
    this.setElements(settle(replaceElements(this.elements, new Map([[el.id, next]])), [el.id]));
  }

  private eraseAlong(from: Point, to: Point, touch: boolean) {
    const g = this.gesture;
    if (g?.kind !== "erase") return;
    const tolerance = (touch ? 12 : 8) / this.viewport.zoom;
    const steps = Math.max(1, Math.ceil(distance(from, to) / tolerance));
    const map = sceneIndex(this.elements);
    let changed = false;
    for (const el of this.elements) {
      if (el.locked || g.hits.has(el.id)) continue;
      if (el.type === "text" && el.containerId && map.has(el.containerId)) continue;
      // Rubbing out a mark on a photo must not take the photo with it. A
      // photo is removed deliberately: select it and press Delete.
      if (el.type === "image") continue;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const p: Point = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
        if (hitTest(el, p, tolerance)) {
          g.hits.add(el.id);
          changed = true;
          break;
        }
      }
    }
    if (changed) this.invalidate(true);
  }

  pointerUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === "pinch") {
      if (this.pointers.size < 2) this.gesture = null;
      return;
    }
    this.gesture = null;
    this.guides = { x: [], y: [] };
    const preview = this.bindPreview;
    this.bindPreview = null;

    switch (g.kind) {
      case "pan":
        this.updateCursor();
        break;
      case "marquee":
        if (this.selected.size)
          this.onAnnounce?.(
            `${this.selected.size} item${this.selected.size === 1 ? "" : "s"} selected`,
          );
        break;
      case "move":
        if (g.moved) this.finishMove(g);
        break;
      case "resize":
      case "rotate":
        this.commit();
        break;
      case "create":
        this.finishCreate(g, preview);
        break;
      case "draw":
        this.finishDraw(g);
        break;
      case "erase":
        if (g.hits.size) {
          this.setElements(deleteElements(this.elements, g.hits));
          this.commit();
          this.onAnnounce?.(`${g.hits.size} item${g.hits.size === 1 ? "" : "s"} erased`);
        } else this.invalidate(true);
        break;
      case "point": {
        if (g.index === 0 || g.index === (g.origin.points?.length ?? 0) - 1) {
          if (g.origin.type === "arrow") {
            const end = g.index === 0 ? "start" : "end";
            this.setElements(
              settle(bindConnectorEnd(this.elements, g.id, end, preview), [
                g.id,
                ...(preview ? [preview] : []),
              ]),
            );
          }
        }
        this.commit();
        break;
      }
    }
    this.gestureBase = null;
    this.invalidate();
    this.syncInteracting();
  }

  pointerCancel(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.gesture?.kind === "pinch" && this.pointers.size >= 2) return;
    this.cancelGesture();
  }

  /** Abandons the gesture in progress and puts the scene back as it was. */
  cancelGesture() {
    const g = this.gesture;
    this.gesture = null;
    this.bindPreview = null;
    this.guides = { x: [], y: [] };
    if (g && this.gestureBase && g.kind !== "pan" && g.kind !== "pinch")
      this.setElements(this.gestureBase);
    this.gestureBase = null;
    this.updateCursor();
    this.invalidate(true);
    this.syncInteracting();
  }

  private finishMove(g: Extract<Gesture, { kind: "move" }>) {
    // A connector dragged on its own lets go of shapes that stayed behind.
    let elements = this.elements;
    for (const id of g.origin.keys()) {
      const el = sceneIndex(elements).get(id);
      if (!el || !isLinear(el)) continue;
      if (el.startBinding && !g.origin.has(el.startBinding.elementId))
        elements = bindConnectorEnd(elements, id, "start", null);
      if (el.endBinding && !g.origin.has(el.endBinding.elementId))
        elements = bindConnectorEnd(elements, id, "end", null);
    }
    this.setElements(elements);
    this.commit();
  }

  private finishCreate(g: Extract<Gesture, { kind: "create" }>, target: string | null) {
    let el = g.element;
    const zoom = this.viewport.zoom;
    if (isLinear(el)) {
      const pts = worldPoints(el);
      if (distance(pts[0], pts[pts.length - 1]) * zoom < 6) {
        // A click, not a drag: lay down a connector of a useful length.
        el = mutate(el, withWorldPoints(el, [g.start, [g.start[0] + 160, g.start[1]]]));
        target = null;
      }
    } else if (el.width * zoom < 6 && el.height * zoom < 6) {
      const size =
        el.type === "rectangle" ? [160, 100] : el.type === "ellipse" ? [140, 100] : [140, 120];
      el = {
        ...el,
        x: g.start[0] - size[0] / 2,
        y: g.start[1] - size[1] / 2,
        width: size[0],
        height: size[1],
      };
    }
    let elements = [...this.elements, el];
    if (el.type === "arrow") {
      if (g.startTarget) elements = bindConnectorEnd(elements, el.id, "start", g.startTarget);
      if (target) elements = bindConnectorEnd(elements, el.id, "end", target);
      elements = settle(elements, [
        el.id,
        ...(g.startTarget ? [g.startTarget] : []),
        ...(target ? [target] : []),
      ]);
    }
    this.setElements(elements);
    this.selected = new Set([el.id]);
    this.tool = "select";
    this.updateCursor();
    this.commit();
    this.onAnnounce?.(`${this.describe(el)} added`);
  }

  private finishDraw(g: Extract<Gesture, { kind: "draw" }>) {
    let el = g.element;
    const points = el.points ?? [[0, 0]];
    if (points.length === 1) {
      // A tap with the pen leaves a dot.
      el = {
        ...el,
        points: [
          [0, 0],
          [0.5, 0.5],
        ],
      };
    }
    const box = localPointsBox(el);
    el = { ...el, width: box.maxX - box.minX, height: box.maxY - box.minY };
    this.setElements([...this.elements, el]);
    this.commit();
  }

  // -------------------------------------------------------------------------
  // Text editing
  // -------------------------------------------------------------------------

  /** Opens the text of `el` (its label, for shapes and connectors) for editing. */
  editTextOf(el: BoardElement) {
    if (this.readOnly) return;
    if (el.type === "text") {
      this.selected = new Set([el.id]);
      this.startTextEdit(el.id);
      return;
    }
    if (el.type === "image" || el.type === "freedraw") return;
    const { elements, textId } = ensureLabel(this.elements, el.id, this.style);
    if (!textId) return;
    this.setElements(elements);
    this.selected = new Set([el.id]);
    this.startTextEdit(textId);
  }

  private startTextEdit(id: string) {
    this.editingId = id;
    this.gesture = null;
    this.invalidate(true);
    this.emit("ui");
  }

  /** Live text while typing; laid out but not yet an undo step. */
  updateText(value: string) {
    const id = this.editingId;
    if (!id) return;
    const map = sceneIndex(this.elements);
    const el = map.get(id);
    if (!el) return;
    let next = mutate(el, { text: value, originalText: value });
    if (!el.containerId) {
      const layout = layoutText(next);
      next = mutate(
        next,
        el.autoResize === false
          ? { height: layout.height }
          : { width: layout.width, height: layout.height },
      );
    }
    this.setElements(
      settle(replaceElements(this.elements, new Map([[id, next]])), [el.containerId ?? id]),
    );
    this.emit("view");
  }

  endTextEdit() {
    const id = this.editingId;
    if (!id) return;
    this.editingId = null;
    const el = sceneIndex(this.elements).get(id);
    if (el && !el.text?.trim()) {
      // Nothing typed: the empty text (or empty label) simply doesn't exist.
      this.setElements(deleteElements(this.elements, [id]));
      if (!el.containerId) this.selected = new Set();
    }
    // Like shapes, a piece of text is one act: hand back the Select tool.
    if (this.tool === "text") {
      this.tool = "select";
      this.updateCursor();
    }
    this.invalidate(true);
    this.commit();
    this.emit("ui");
  }

  /** Where the text editor should sit on screen, and how it should look. */
  textEditorGeometry() {
    const id = this.editingId;
    if (!id) return null;
    const map = sceneIndex(this.elements);
    const el = map.get(id);
    if (!el) return null;
    const container = el.containerId ? map.get(el.containerId) : undefined;
    const layout = layoutText(el, container);
    const zoom = this.viewport.zoom;
    let x = el.x;
    const y = el.y;
    let width = Math.max(layout.width, el.fontSize ?? 20);
    let angle = el.angle;
    if (container && !isLinear(container)) {
      x = el.x;
      width = el.width;
      angle = container.angle;
    } else if (container) {
      width = Math.max(layout.width, 40);
      x = el.x + layout.width / 2 - width / 2;
    }
    const [sx, sy] = this.toScreen([x, y]);
    return {
      id,
      text: el.text ?? "",
      left: sx,
      top: sy,
      width: width * zoom,
      height: layout.height * zoom,
      fontSize: (el.fontSize ?? 20) * zoom,
      lineHeight: el.lineHeight ?? 1.25,
      fontFamily: el.fontFamily,
      align: container ? (el.textAlign ?? "center") : (el.textAlign ?? "left"),
      angle,
      strokeColor: el.strokeColor,
      wraps: !!container && !isLinear(container),
    };
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  deleteSelection() {
    if (!this.selected.size || this.readOnly) return;
    const count = this.selected.size;
    this.apply((els) => deleteElements(els, this.selected));
    this.selected = new Set();
    this.emit("ui");
    this.onAnnounce?.(`${count} item${count === 1 ? "" : "s"} deleted`);
  }

  duplicateSelection() {
    if (!this.selected.size || this.readOnly) return;
    const clones = cloneElements(this.elements, this.selected, [16, 16]);
    this.apply((els) => [...els, ...clones]);
    this.setSelection(clones.filter((c) => !c.containerId).map((c) => c.id));
  }

  selectAll() {
    if (this.readOnly) return;
    if (this.tool !== "select") this.setTool("select");
    this.setSelection(
      this.elements.filter((el) => !el.containerId && !el.locked).map((el) => el.id),
    );
  }

  reorderSelection(direction: ZOrder) {
    if (!this.selected.size) return;
    this.apply((els) => reorder(els, new Set(this.selected), direction));
  }

  group() {
    if (this.selected.size < 2) return;
    this.apply((els) => groupElements(els, new Set(this.selected)));
    this.onAnnounce?.("Grouped");
  }

  ungroup() {
    this.apply((els) => ungroupElements(els, new Set(this.selected)));
    this.onAnnounce?.("Ungrouped");
  }

  nudge(dx: number, dy: number) {
    if (!this.selected.size) return;
    const origin = this.withLabels(this.selectedElements());
    const updates = new Map<string, BoardElement>();
    for (const [id, el] of origin) updates.set(id, mutate(el, { x: el.x + dx, y: el.y + dy }));
    this.apply((els) => settle(replaceElements(els, updates), updates.keys()));
  }

  /** The selection as clipboard text, references and images included. */
  copySelection(): string | null {
    const selected = this.selectedElements();
    if (!selected.length) return null;
    const origin = this.withLabels(selected);
    const elements = this.elements.filter((el) => origin.has(el.id));
    const files: BoardFiles = {};
    for (const el of elements)
      if (el.fileId && this.files[el.fileId]) files[el.fileId] = this.files[el.fileId];
    this.clipboard = JSON.stringify({ type: CLIPBOARD_TYPE, elements, files });
    return this.clipboard;
  }

  cutSelection() {
    const text = this.copySelection();
    this.deleteSelection();
    return text;
  }

  /** Pastes board clipboard JSON, or plain text as a text element. Returns false if nothing usable. */
  pasteText(text: string): boolean {
    if (this.readOnly) return false;
    const source = text || this.clipboard || "";
    let parsed: { type?: string; elements?: BoardElement[]; files?: BoardFiles } | null = null;
    try {
      parsed = JSON.parse(source);
    } catch {
      parsed = null;
    }
    if (
      parsed &&
      (parsed.type === CLIPBOARD_TYPE || parsed.type === "excalidraw/clipboard") &&
      Array.isArray(parsed.elements)
    ) {
      const incoming = parsed.elements.filter(
        (el) => el && typeof el.id === "string" && !el.isDeleted,
      );
      if (!incoming.length) return false;
      const box = unionBounds(incoming)!;
      const target = this.pasteTarget();
      const offset: Point = [
        target[0] - (box.minX + box.maxX) / 2,
        target[1] - (box.minY + box.maxY) / 2,
      ];
      const clones = cloneElements(
        incoming,
        incoming.map((el) => el.id),
        offset,
      );
      const files = parsed.files ?? {};
      for (const el of clones) {
        if (el.fileId && files[el.fileId])
          this.files = { ...this.files, [el.fileId]: files[el.fileId] };
      }
      this.images.sync(this.files);
      if (this.tool !== "select") this.setTool("select");
      this.apply((els) => [...els, ...clones]);
      this.setSelection(clones.filter((c) => !c.containerId).map((c) => c.id));
      return true;
    }
    if (!text.trim()) return false;
    const [x, y] = this.pasteTarget();
    const el = newElement("text", { x, y }, this.style);
    const content = text.slice(0, 20_000);
    const layout = layoutText({ ...el, text: content });
    const placed = mutate(el, {
      text: content,
      originalText: content,
      x: x - layout.width / 2,
      y: y - layout.height / 2,
      width: layout.width,
      height: layout.height,
    });
    if (this.tool !== "select") this.setTool("select");
    this.apply((els) => [...els, placed]);
    this.setSelection([placed.id]);
    return true;
  }

  private pasteTarget(): Point {
    const p = this.lastPointerWorld;
    const visible = this.visibleBox();
    if (
      p &&
      p[0] >= visible.minX &&
      p[0] <= visible.maxX &&
      p[1] >= visible.minY &&
      p[1] <= visible.maxY
    )
      return p;
    return this.toWorld(this.width / 2, this.height / 2);
  }

  insertImage(prepared: PreparedImage, at?: Point) {
    if (this.readOnly) return;
    this.files = { ...this.files, [prepared.file.id]: prepared.file };
    this.images.sync(this.files);
    const maxW = (this.width * 0.6) / this.viewport.zoom;
    const maxH = (this.height * 0.6) / this.viewport.zoom;
    const scale = Math.min(1, maxW / prepared.width, maxH / prepared.height);
    const w = prepared.width * scale;
    const h = prepared.height * scale;
    const [cx, cy] = at ?? this.pasteTarget();
    const el = newElement("image", {
      x: cx - w / 2,
      y: cy - h / 2,
      width: w,
      height: h,
      fileId: prepared.file.id,
      strokeColor: "transparent",
    });
    if (this.tool !== "select") this.setTool("select");
    this.apply((els) => [...els, el]);
    this.setSelection([el.id]);
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  /** Handles a key; returns true when the board used it. */
  keyDown(e: KeyboardEvent): boolean {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (e.key === " " && !mod) {
      if (!this.spaceHeld) {
        this.spaceHeld = true;
        this.hoverId = null;
        this.updateCursor();
        this.invalidate();
      }
      return true;
    }
    if (e.key === "Escape") {
      if (this.gesture) this.cancelGesture();
      else if (this.selected.size) this.setSelection([]);
      else if (this.tool !== "select" && !this.readOnly) this.setTool("select");
      else return false;
      return true;
    }

    // View commands work everywhere, read-only included.
    if (mod && (key === "=" || key === "+")) return (this.zoomBy(1.25), true);
    if (mod && key === "-") return (this.zoomBy(0.8), true);
    if (mod && key === "0") return (this.resetZoom(), true);
    if (e.shiftKey && e.code === "Digit1") return (this.zoomToFit(), true);
    if (e.shiftKey && e.code === "Digit2")
      return (this.zoomToFit({ selection: this.selected.size > 0 }), true);
    if (e.shiftKey && e.code === "Digit0") return (this.resetZoom(), true);
    if (e.key === "?" || (e.shiftKey && e.code === "Slash")) {
      this.onRequestShortcuts?.();
      return true;
    }
    if (this.readOnly) return false;

    if (mod) {
      if (key === "z" && !e.shiftKey) return (this.undo(), true);
      if ((key === "z" && e.shiftKey) || key === "y") return (this.redo(), true);
      if (key === "a") return (this.selectAll(), true);
      if (key === "d") return (this.duplicateSelection(), true);
      if (key === "g" && e.shiftKey) return (this.ungroup(), true);
      if (key === "l" && e.shiftKey) return (this.toggleLock(), true);
      if (key === "g") return (this.group(), true);
      if (e.code === "BracketRight")
        return (this.reorderSelection(e.shiftKey || e.altKey ? "front" : "forward"), true);
      if (e.code === "BracketLeft")
        return (this.reorderSelection(e.shiftKey || e.altKey ? "back" : "backward"), true);
      return false;
    }
    if (e.altKey) return false;

    if (e.key === "Delete" || e.key === "Backspace") {
      if (!this.selected.size) return false;
      this.deleteSelection();
      return true;
    }
    if (e.key === "Enter" && this.selected.size === 1) {
      const el = this.selectedElements()[0];
      if (el) this.editTextOf(el);
      return true;
    }
    const arrows: Record<string, Point> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    if (arrows[e.key] && this.selected.size) {
      const step = e.shiftKey ? 10 : 1;
      this.nudge(arrows[e.key][0] * step, arrows[e.key][1] * step);
      return true;
    }
    if (e.shiftKey) return false;
    const tools: Record<string, Tool> = {
      v: "select",
      "1": "select",
      h: "hand",
      p: "pen",
      m: "marker",
      e: "eraser",
      r: "rectangle",
      o: "ellipse",
      d: "diamond",
      a: "arrow",
      l: "line",
      t: "text",
      s: "sticky",
    };
    if (tools[key]) {
      this.setTool(tools[key]);
      return true;
    }
    if (key === "i") {
      this.onRequestImage?.();
      return true;
    }
    if (key === "g") {
      this.setGrid(!this.showGrid);
      return true;
    }
    return false;
  }

  keyUp(e: KeyboardEvent) {
    if (e.key === " " && this.spaceHeld) {
      this.spaceHeld = false;
      if (this.gesture?.kind === "pan") return;
      this.updateCursor();
    }
  }

  /** Releases a held Space if focus leaves the board mid-press. */
  blur() {
    if (this.spaceHeld) {
      this.spaceHeld = false;
      this.updateCursor();
    }
  }

  get isEmpty() {
    return this.elements.length === 0;
  }

  toScene(): Scene {
    return { ...this.scene, elements: this.elements, files: this.files };
  }
}

function normalizeAngle(angle: number) {
  const full = Math.PI * 2;
  return ((angle % full) + full) % full;
}

/** Snaps the direction from `origin` to `p` to the nearest 15°. */
function snapAngle(origin: Point, p: Point): Point {
  const dx = p[0] - origin[0];
  const dy = p[1] - origin[1];
  const length = Math.hypot(dx, dy);
  const step = Math.PI / 12;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return [origin[0] + Math.cos(angle) * length, origin[1] + Math.sin(angle) * length];
}
