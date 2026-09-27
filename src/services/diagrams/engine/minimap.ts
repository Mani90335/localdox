/**
 * An overview of a large diagram in the stage's corner.
 *
 * Zoomed in on a 10,000-node map, the view shows a dozen boxes and no hint of
 * where they sit in the whole. The minimap is the whole, always: every node as
 * a dot (lit once drawn, faint before), and a box marking what the stage shows.
 * Clicking or dragging on it moves the view there.
 *
 * The dots are drawn to an offscreen canvas at most a few times a second —
 * they only change as the explainer reveals nodes — and each frame just copies
 * that and draws the view box, so following the camera costs next to nothing.
 */
import type { SvgViewport } from "@/lib/viewport";
import type { DiagramRenderer, DiagramTheme, RenderedView } from "./renderer";
import type { Scene } from "./scene";

const WIDTH = 168;
const MIN_HEIGHT = 44;
const MAX_HEIGHT = 124;
const PAD = 5;
/** Dots redraw at most this often while the explainer is revealing nodes. */
const DOTS_EVERY_MS = 150;

export class Minimap {
  readonly element: HTMLCanvasElement;
  private readonly dots: HTMLCanvasElement;
  private readonly scene: Scene;
  private readonly renderer: DiagramRenderer;
  private readonly theme: DiagramTheme;
  private readonly onJump: (x: number, y: number) => void;
  private readonly width: number;
  private readonly height: number;
  private readonly scale: number;
  private readonly offsetX: number;
  private readonly offsetY: number;
  private lastDots = -Infinity;
  private trailing = 0;
  private view: RenderedView | null = null;
  private dragging = false;

  constructor(
    renderer: DiagramRenderer,
    scene: Scene,
    theme: DiagramTheme,
    onJump: (x: number, y: number) => void,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.theme = theme;
    this.onJump = onJump;
    this.width = WIDTH;
    this.height = Math.round(
      Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, (WIDTH * scene.height) / scene.width)),
    );
    const innerW = this.width - PAD * 2;
    const innerH = this.height - PAD * 2;
    this.scale = Math.min(innerW / scene.width, innerH / scene.height);
    this.offsetX = PAD + (innerW - scene.width * this.scale) / 2;
    this.offsetY = PAD + (innerH - scene.height * this.scale) / 2;

    const dpr = window.devicePixelRatio || 1;
    this.element = document.createElement("canvas");
    this.dots = document.createElement("canvas");
    for (const canvas of [this.element, this.dots]) {
      canvas.width = Math.round(this.width * dpr);
      canvas.height = Math.round(this.height * dpr);
    }
    this.element.dataset.noPan = "";
    this.element.setAttribute(
      "aria-label",
      "Overview of the whole diagram. Click to move the view there.",
    );
    this.element.style.cssText = [
      "position:absolute",
      "top:8px",
      "right:8px",
      `width:${this.width}px`,
      `height:${this.height}px`,
      "border-radius:8px",
      "border:1px solid color-mix(in oklab, var(--border) 80%, transparent)",
      "background:color-mix(in oklab, var(--background) 82%, transparent)",
      "backdrop-filter:blur(6px)",
      "cursor:crosshair",
      "touch-action:none",
      "z-index:2",
    ].join(";");
    this.element.addEventListener("pointerdown", this.onPointerDown);
    this.element.addEventListener("pointermove", this.onPointerMove);
    this.element.addEventListener("pointerup", this.onPointerUp);
    this.element.addEventListener("pointercancel", this.onPointerUp);
    renderer.element.appendChild(this.element);
  }

  /** Mirror a frame the renderer just drew. */
  update(view: RenderedView): void {
    this.view = view;
    // Seeing the whole diagram already, the overview only covers part of it.
    const { visible } = view;
    const whole =
      visible.width >= this.scene.width * 0.9 && visible.height >= this.scene.height * 0.9;
    this.element.style.opacity = whole ? "0" : "1";
    this.element.style.pointerEvents = whole ? "none" : "auto";
    this.element.style.transition = "opacity 200ms ease";
    const now = performance.now();
    if (now - this.lastDots >= DOTS_EVERY_MS) {
      this.drawDots();
      this.lastDots = now;
    } else if (!this.trailing) {
      // The last reveals of a burst still reach the overview.
      this.trailing = window.setTimeout(() => {
        this.trailing = 0;
        this.lastDots = -Infinity;
        if (this.view) this.update(this.view);
      }, DOTS_EVERY_MS);
    }
    const ctx = this.element.getContext("2d");
    if (!ctx) return;
    const dpr = this.element.width / this.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.element.width, this.element.height);
    ctx.drawImage(this.dots, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // The view box, clipped to the diagram, with at least a visible size.
    let x = this.offsetX + visible.x * this.scale;
    let y = this.offsetY + visible.y * this.scale;
    let w = visible.width * this.scale;
    let h = visible.height * this.scale;
    const minSide = 6;
    if (w < minSide) {
      x -= (minSide - w) / 2;
      w = minSide;
    }
    if (h < minSide) {
      y -= (minSide - h) / 2;
      h = minSide;
    }
    ctx.strokeStyle = this.theme.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      Math.max(1, x),
      Math.max(1, y),
      Math.min(this.width - 2, x + w) - Math.max(1, x),
      Math.min(this.height - 2, y + h) - Math.max(1, y),
    );
  }

  destroy(): void {
    window.clearTimeout(this.trailing);
    this.element.remove();
  }

  private drawDots(): void {
    const ctx = this.dots.getContext("2d");
    if (!ctx) return;
    const dpr = this.dots.width / this.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.dots.width, this.dots.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { scene, scale } = this;
    const state = this.renderer.nodeState;
    const size = Math.max(1, Math.min(3, 1 / Math.sqrt(scene.nodeCount / 2500) + 0.6));
    // Two passes, two colours, so fillStyle is set twice rather than per dot.
    ctx.fillStyle = this.theme.line;
    ctx.globalAlpha = 0.28;
    for (let i = 0; i < scene.nodeCount; i++) {
      if (state[i * 4] > 0) continue;
      ctx.fillRect(
        this.offsetX + scene.nodeX[i] * scale - size / 2,
        this.offsetY + scene.nodeY[i] * scale - size / 2,
        size,
        size,
      );
    }
    ctx.fillStyle = this.theme.nodeStroke;
    ctx.globalAlpha = 1;
    for (let i = 0; i < scene.nodeCount; i++) {
      if (state[i * 4] <= 0) continue;
      ctx.fillRect(
        this.offsetX + scene.nodeX[i] * scale - size / 2,
        this.offsetY + scene.nodeY[i] * scale - size / 2,
        size,
        size,
      );
    }
  }

  private jumpTo(event: PointerEvent): void {
    const rect = this.element.getBoundingClientRect();
    const x = (event.clientX - rect.left - this.offsetX) / this.scale;
    const y = (event.clientY - rect.top - this.offsetY) / this.scale;
    this.onJump(
      Math.min(this.scene.width, Math.max(0, x)),
      Math.min(this.scene.height, Math.max(0, y)),
    );
  }

  private onPointerDown = (event: PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    this.dragging = true;
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      /* the pointer may already be gone */
    }
    this.jumpTo(event);
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    event.stopPropagation();
    this.jumpTo(event);
  };

  private onPointerUp = (event: PointerEvent) => {
    this.dragging = false;
    event.stopPropagation();
  };
}

/** Where the view's centre is now, in diagram units, and how many per pixel. */
export function viewCentre(
  view: RenderedView,
  stage: HTMLElement,
): { x: number; y: number; unitsPerPixel: number } {
  const rect = stage.getBoundingClientRect();
  return {
    x: view.visible.x + view.visible.width / 2,
    y: view.visible.y + view.visible.height / 2,
    unitsPerPixel: rect.width ? view.visible.width / rect.width : 1,
  };
}

/**
 * Give a GPU stage its minimap, wired to its viewport.
 *
 * A jump from the fitted view also zooms in to reading size: clicking a spot on
 * the overview means "show me that", and at the fitted view that would move
 * nothing visible.
 */
export function attachMinimap(
  renderer: DiagramRenderer,
  scene: Scene,
  theme: DiagramTheme,
  viewport: SvgViewport,
  readableSpan: number,
): Minimap {
  let last: RenderedView | null = null;
  const minimap = new Minimap(renderer, scene, theme, (x, y) => {
    if (!last) return;
    const centre = viewCentre(last, renderer.element);
    viewport.panBy((x - centre.x) / centre.unitsPerPixel, (y - centre.y) / centre.unitsPerPixel);
    if (viewport.zoom < 2 && last.visible.width > readableSpan) {
      viewport.zoomBy(last.visible.width / readableSpan);
    }
  });
  renderer.onRendered = (view) => {
    last = view;
    minimap.update(view);
  };
  renderer.render();
  return minimap;
}
