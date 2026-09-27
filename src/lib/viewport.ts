/**
 * Pan and zoom for a rendered diagram, driven through its SVG viewBox.
 *
 * Every diagram stage shares this one controller, so a mouse, a trackpad, a
 * pen and a finger all behave the same way whichever mode is showing:
 *
 *  - Drag with the primary (or middle) button pans. Nothing moves until the
 *    pointer has travelled a few pixels, and the click that ends a real drag is
 *    swallowed, so clicking a node still opens its colour picker or inspector.
 *  - Pinch on a trackpad arrives as a wheel event with `ctrlKey` set. That, and
 *    Ctrl/⌘ + wheel on a mouse, zooms about the pointer. Safari's own gesture
 *    events and a two-finger touch pinch do the same.
 *  - Two-finger scroll pans the diagram only once it is zoomed past the fitted
 *    view. At the fitted view a plain wheel belongs to the page, so a reader
 *    scrolling through a document is never caught by a diagram in the way.
 *  - The keyboard gets + / − / 0, and the arrow keys once zoomed.
 *
 * It also arbitrates with the explainer's automatic camera. The camera calls
 * `follow()` every frame. As soon as the reader pans or zooms by hand, their
 * framing wins and the camera's writes are held until `reset()` hands control
 * back. The camera never fights the reader for the view.
 *
 * Writing the viewBox rather than a CSS transform keeps text crisp at any zoom
 * and costs one attribute write per frame, with nothing re-rendered.
 */

export interface ViewFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportState {
  /** Magnification relative to the fitted view; 1 is the whole diagram. */
  zoom: number;
  /** True while the reader's own framing is overriding the camera. */
  manual: boolean;
}

export interface ViewportOptions {
  minZoom?: number;
  maxZoom?: number;
  /** Fired after the reader changes the view, or it is reset. Not per frame. */
  onChange?: (state: ViewportState) => void;
  /**
   * Whether a plain wheel pans once zoomed in. Stages scrolled by the page
   * (a very tall diagram) turn this off so the page keeps its own scroll.
   */
  wheelPan?: boolean;
}

/** Pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 4;
/** Share of the view one arrow-key press moves. */
const KEY_PAN = 0.1;
const KEY_ZOOM = 1.25;
/** Controls inside the stage handle their own pointer input. */
const INTERACTIVE = "button, a, input, select, textarea, [role='button'], [data-no-pan]";
/** Double-clicking these zooms nothing: they have their own click action. */
const NODE_TARGET = ".node, [data-colorable], .actor, .ma-node";

/** A wheel delta in CSS pixels, whatever unit the device reported it in. */
export function wheelPixels(event: WheelEvent, pageHeight = 800): { dx: number; dy: number } {
  // deltaMode 1 is lines and 2 is pages; 0, the common case, is already pixels.
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1;
  let dx = event.deltaX * unit;
  let dy = event.deltaY * unit;
  // A plain mouse wheel with Shift held means "sideways" on every platform
  // except macOS, which already swaps the axes itself.
  if (event.shiftKey && dx === 0) {
    dx = dy;
    dy = 0;
  }
  return { dx, dy };
}

/**
 * The zoom factor a wheel event asks for.
 *
 * A trackpad pinch reports small, frequent deltas; a mouse wheel reports one
 * big notch. Scaling them differently is what makes a pinch track the fingers
 * and a notch feel like one deliberate step.
 */
export function wheelZoomFactor(event: WheelEvent): number {
  const { dy } = wheelPixels(event);
  const pinch = event.deltaMode === 0 && Math.abs(dy) < 50;
  const factor = Math.exp(-dy * (pinch ? 0.012 : 0.0022));
  return Math.min(1.6, Math.max(1 / 1.6, factor));
}

/** True for the wheel events that mean "zoom" rather than "scroll". */
export function isZoomWheel(event: WheelEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

function sameFrame(a: ViewFrame | null, b: ViewFrame | null): boolean {
  if (!a || !b) return a === b;
  const epsilon = Math.max(a.width, a.height) * 1e-5;
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
}

/**
 * What the viewport frames: an `<svg>`, or anything that frames itself by a
 * viewBox the same way. The GPU diagram stage (services/diagrams/engine) implements
 * these three members over its canvas, so pan, zoom and the camera hand-off
 * behave identically whichever renderer is drawing.
 */
export interface ViewTarget {
  readonly viewBox: { readonly baseVal: ViewFrame | null };
  setAttribute(name: "viewBox", value: string): void;
  getBoundingClientRect(): DOMRect;
}

interface GestureLikeEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

export class SvgViewport {
  private base: ViewFrame;
  /** What the automatic framing (the explainer camera, or plain "fit") wants. */
  private camera: ViewFrame;
  /** The reader's own framing, when they have taken over. */
  private user: ViewFrame | null = null;
  private applied: ViewFrame | null = null;
  private readonly minZoom: number;
  private readonly maxZoom: number;
  private readonly wheelPan: boolean;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private drag: {
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null = null;
  private pinch: { distance: number; x: number; y: number } | null = null;
  private suppressClick = false;
  private gestureScale = 1;
  private gestureActive = false;
  private destroyed = false;

  private readonly host: HTMLElement;
  private svg: ViewTarget;
  private readonly options: ViewportOptions;

  // Plain fields rather than parameter properties: the unit tests load this
  // module through Node's type stripping, which does not accept them.
  constructor(host: HTMLElement, svg: ViewTarget, options: ViewportOptions = {}) {
    this.host = host;
    this.svg = svg;
    this.options = options;
    this.minZoom = options.minZoom ?? 0.25;
    this.maxZoom = options.maxZoom ?? 8;
    this.wheelPan = options.wheelPan ?? true;
    const view = svg.viewBox.baseVal;
    this.base =
      view && view.width && view.height
        ? { x: view.x, y: view.y, width: view.width, height: view.height }
        : { x: 0, y: 0, width: 100, height: 100 };
    this.camera = this.base;
    this.applied = this.base;

    host.addEventListener("pointerdown", this.onPointerDown);
    host.addEventListener("pointermove", this.onPointerMove);
    host.addEventListener("pointerup", this.onPointerUp);
    host.addEventListener("pointercancel", this.onPointerUp);
    host.addEventListener("lostpointercapture", this.onPointerUp);
    // Capture phase: the click that ends a drag must be stopped before it
    // reaches a node's own click handler further down.
    host.addEventListener("click", this.onClickCapture, true);
    host.addEventListener("dblclick", this.onDoubleClick);
    host.addEventListener("wheel", this.onWheel, { passive: false });
    // Capture as well, so a package handler on an inner element (the flow
    // animator binds + and − to its own stale zoom) never sees keys we used.
    host.addEventListener("keydown", this.onKeyDown, true);
    host.addEventListener("gesturestart", this.onGestureStart as EventListener);
    host.addEventListener("gesturechange", this.onGestureChange as EventListener);
    host.addEventListener("gestureend", this.onGestureEnd as EventListener);
    this.syncAffordance();
  }

  /** Magnification relative to the fitted view. */
  get zoom(): number {
    const current = this.user ?? this.camera;
    return this.base.width / current.width;
  }

  /** True while the reader's framing overrides the camera. */
  get manual(): boolean {
    return this.user !== null;
  }

  /** The framing that counts as "the whole diagram". */
  setBase(frame: ViewFrame, svg?: ViewTarget): void {
    if (svg) this.svg = svg;
    this.base = frame;
    this.camera = frame;
    this.user = null;
    this.apply();
    this.emit();
  }

  /**
   * Framing requested by the automatic camera.
   *
   * Remembered even while the reader is in control, so handing control back
   * lands on wherever the explanation has got to rather than where it was.
   */
  follow(frame: ViewFrame): void {
    this.camera = frame;
    if (!this.user) this.apply();
  }

  /** Zoom about a point in client pixels, or the centre of the stage. */
  zoomBy(factor: number, clientX?: number, clientY?: number): void {
    const current = this.user ?? this.camera;
    const zoom = this.base.width / current.width;
    const target = Math.min(this.maxZoom, Math.max(this.minZoom, zoom * factor));
    const k = target / zoom;
    if (Math.abs(k - 1) < 1e-4) return;
    const anchor =
      clientX === undefined || clientY === undefined
        ? { x: current.x + current.width / 2, y: current.y + current.height / 2 }
        : this.toDiagram(clientX, clientY, current);
    const width = current.width / k;
    const height = current.height / k;
    this.setUser({
      x: anchor.x - (anchor.x - current.x) / k,
      y: anchor.y - (anchor.y - current.y) / k,
      width,
      height,
    });
  }

  /** Zoom to an absolute level, about the centre. */
  zoomTo(level: number): void {
    if (Math.abs(level - 1) < 1e-4 && !this.user) return;
    if (Math.abs(level - 1) < 1e-4) {
      this.reset();
      return;
    }
    this.zoomBy(level / this.zoom);
  }

  /** Move the view by a distance in screen pixels. Returns whether it moved. */
  panBy(dxPixels: number, dyPixels: number): boolean {
    const current = this.user ?? this.camera;
    const scale = this.unitsPerPixel(current);
    const next = {
      ...current,
      x: current.x + dxPixels * scale,
      y: current.y + dyPixels * scale,
    };
    const clamped = this.clamp(next);
    if (sameFrame(clamped, current)) return false;
    this.setUser(clamped);
    return true;
  }

  /** Drop the reader's framing and return to the camera (or the fitted view). */
  reset(): void {
    this.user = null;
    this.apply();
    this.emit();
  }

  /**
   * Jump the reader's own framing to an exact frame — a search result, say.
   *
   * Unlike `setBase`, this does not redefine what "fit" means: it is a manual
   * move like `zoomBy`/`panBy`, just to a frame the caller already knows
   * rather than a factor or a delta.
   */
  frameTo(frame: ViewFrame): void {
    this.setUser(frame);
  }

  destroy(): void {
    this.destroyed = true;
    const { host } = this;
    host.removeEventListener("pointerdown", this.onPointerDown);
    host.removeEventListener("pointermove", this.onPointerMove);
    host.removeEventListener("pointerup", this.onPointerUp);
    host.removeEventListener("pointercancel", this.onPointerUp);
    host.removeEventListener("lostpointercapture", this.onPointerUp);
    host.removeEventListener("click", this.onClickCapture, true);
    host.removeEventListener("dblclick", this.onDoubleClick);
    host.removeEventListener("wheel", this.onWheel);
    host.removeEventListener("keydown", this.onKeyDown, true);
    host.removeEventListener("gesturestart", this.onGestureStart as EventListener);
    host.removeEventListener("gesturechange", this.onGestureChange as EventListener);
    host.removeEventListener("gestureend", this.onGestureEnd as EventListener);
    host.style.cursor = "";
    host.style.touchAction = "";
    host.style.userSelect = "";
    delete host.dataset.panning;
  }

  // -- internals -------------------------------------------------------------

  private setUser(frame: ViewFrame): void {
    this.user = this.clamp(frame);
    this.apply();
    this.emit();
  }

  private apply(): void {
    if (this.destroyed) return;
    const frame = this.user ?? this.camera;
    if (sameFrame(this.applied, frame)) return;
    this.svg.setAttribute("viewBox", `${frame.x} ${frame.y} ${frame.width} ${frame.height}`);
    this.applied = frame;
  }

  private emit(): void {
    this.syncAffordance();
    this.options.onChange?.({ zoom: this.zoom, manual: this.manual });
  }

  /**
   * Cursor and touch behaviour follow the zoom.
   *
   * At the fitted view a finger drag scrolls the page vertically, because on a
   * phone the diagram is usually something you are scrolling *past*; the
   * horizontal drag and the pinch still reach us. Zoomed in, every gesture
   * belongs to the diagram.
   */
  private syncAffordance(): void {
    const zoomed = this.zoom > 1.001;
    this.host.style.touchAction = zoomed ? "none" : "pan-y";
    if (!this.drag?.moved) this.host.style.cursor = "grab";
  }

  /**
   * Keep some of the diagram in view.
   *
   * The centre of the view may travel anywhere over the diagram but not past
   * it, so no drag can lose the picture entirely off one edge.
   */
  private clamp(frame: ViewFrame): ViewFrame {
    const { base } = this;
    const cx = frame.x + frame.width / 2;
    const cy = frame.y + frame.height / 2;
    const clampedX = Math.min(base.x + base.width, Math.max(base.x, cx));
    const clampedY = Math.min(base.y + base.height, Math.max(base.y, cy));
    return {
      x: clampedX - frame.width / 2,
      y: clampedY - frame.height / 2,
      width: frame.width,
      height: frame.height,
    };
  }

  /** Diagram units per screen pixel, allowing for `meet` letterboxing. */
  private unitsPerPixel(frame: ViewFrame): number {
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return 1;
    return Math.max(frame.width / rect.width, frame.height / rect.height);
  }

  private toDiagram(clientX: number, clientY: number, frame: ViewFrame): { x: number; y: number } {
    const rect = this.svg.getBoundingClientRect();
    const scale = this.unitsPerPixel(frame);
    // `xMidYMid meet` centres the picture in whichever axis has room to spare.
    const offsetX = (rect.width - frame.width / scale) / 2;
    const offsetY = (rect.height - frame.height / scale) / 2;
    return {
      x: frame.x + (clientX - rect.left - offsetX) * scale,
      y: frame.y + (clientY - rect.top - offsetY) * scale,
    };
  }

  private onPointerDown = (event: PointerEvent): void => {
    // Primary button pans; so does the middle button, which is what a lot of
    // mouse users reach for on a canvas. Right-click stays a context menu.
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as Element | null;
    if (target?.closest?.(INTERACTIVE)) return;
    if (event.button === 1) event.preventDefault(); // no autoscroll puck
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2) return;
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  };

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()];
    this.pinch = {
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
    // A pinch supersedes the one-finger drag it started as.
    if (this.drag) this.drag.moved = true;
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const x = (a.x + b.x) / 2;
      const y = (a.y + b.y) / 2;
      this.panBy(this.pinch.x - x, this.pinch.y - y);
      this.zoomBy(distance / this.pinch.distance, x, y);
      this.pinch = { distance, x, y };
      return;
    }

    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) {
        return;
      }
      drag.moved = true;
      // Captured only now, not on press: capturing on press retargets the
      // click to the host, and a plain click on a node would stop working.
      try {
        this.host.setPointerCapture(event.pointerId);
      } catch {
        /* the pointer may already be gone */
      }
      this.host.dataset.panning = "";
      this.host.style.cursor = "grabbing";
      this.host.style.userSelect = "none";
      window.getSelection()?.removeAllRanges();
    }
    this.panBy(drag.x - event.clientX, drag.y - event.clientY);
    drag.x = event.clientX;
    drag.y = event.clientY;
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const drag = this.drag;
    if (drag && (drag.id === event.pointerId || this.pointers.size === 0)) {
      if (drag.moved) {
        // The click fires straight after pointerup; eat exactly that one.
        this.suppressClick = true;
        setTimeout(() => (this.suppressClick = false), 0);
      }
      this.drag = null;
      delete this.host.dataset.panning;
      this.host.style.userSelect = "";
      this.syncAffordance();
    }
  };

  private onClickCapture = (event: MouseEvent): void => {
    if (!this.suppressClick) return;
    this.suppressClick = false;
    event.stopPropagation();
    event.preventDefault();
  };

  private onDoubleClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    if (target?.closest?.(INTERACTIVE) || target?.closest?.(NODE_TARGET)) return;
    event.preventDefault();
    if (event.shiftKey || event.altKey) this.zoomBy(1 / 2, event.clientX, event.clientY);
    else if (this.zoom >= this.maxZoom * 0.99) this.reset();
    else this.zoomBy(2, event.clientX, event.clientY);
  };

  private onWheel = (event: WheelEvent): void => {
    if (isZoomWheel(event)) {
      event.preventDefault();
      // Safari can report one pinch as both a gesture and ctrl-wheels; the
      // gesture already applied it.
      if (this.gestureActive) return;
      this.zoomBy(wheelZoomFactor(event), event.clientX, event.clientY);
      return;
    }
    // At the fitted view (or on a page-scrolled stage) the wheel is the page's.
    if (!this.wheelPan || this.zoom <= 1.001) return;
    const { dx, dy } = wheelPixels(event, this.host.clientHeight);
    // Only claim the event if the diagram actually moved; pinned against an
    // edge, the scroll carries on to the page instead of dying here.
    if (this.panBy(dx, dy)) event.preventDefault();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as Element | null;
    if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let handled = true;
    switch (event.key) {
      case "+":
      case "=":
        this.zoomBy(KEY_ZOOM);
        break;
      case "-":
      case "_":
        this.zoomBy(1 / KEY_ZOOM);
        break;
      case "0":
        this.reset();
        break;
      default:
        handled = false;
    }
    // Arrows pan only once zoomed; at the fitted view they are left for the
    // page (or the explainer's own step keys).
    if (!handled && this.zoom > 1.001) {
      const rect = this.host.getBoundingClientRect();
      const stepX = rect.width * KEY_PAN;
      const stepY = rect.height * KEY_PAN;
      handled = true;
      if (event.key === "ArrowLeft") this.panBy(-stepX, 0);
      else if (event.key === "ArrowRight") this.panBy(stepX, 0);
      else if (event.key === "ArrowUp") this.panBy(0, -stepY);
      else if (event.key === "ArrowDown") this.panBy(0, stepY);
      else handled = false;
    }
    if (!handled) return;
    event.preventDefault();
    // Immediate: when the key targets the host itself, a package listener on
    // the same element would otherwise still run after this one.
    event.stopImmediatePropagation();
  };

  // Safari reports a trackpad pinch as proprietary gesture events (as well as,
  // in newer versions, ctrl-wheel). Handling both is harmless: whichever fires
  // is prevented, so the page itself never zooms.
  private onGestureStart = (event: GestureLikeEvent): void => {
    event.preventDefault();
    this.gestureScale = 1;
    this.gestureActive = true;
  };

  private onGestureChange = (event: GestureLikeEvent): void => {
    event.preventDefault();
    const factor = event.scale / this.gestureScale;
    this.gestureScale = event.scale;
    this.zoomBy(factor, event.clientX, event.clientY);
  };

  private onGestureEnd = (event: GestureLikeEvent): void => {
    event.preventDefault();
    this.gestureScale = 1;
    this.gestureActive = false;
  };
}
