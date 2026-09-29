// Pixel budgets for the PDF reader's canvases. Pure math plus one tiny
// module-level counter; no React and no pdf.js, so it is unit-testable and
// safe to import from anywhere.
//
// Without a budget, backing size was `CSS size × devicePixelRatio`, and zoom
// multiplies CSS size: one page at 400% on a DPR 2 screen needed a
// 4435×6272 canvas (about 106 MiB of RGBA). With a budget, a page that would
// exceed it is rasterized at a lower resolution, and a second "detail" canvas
// covers only the part of the page on screen at full device resolution. That
// is the same approach as pdf.js's own viewer (`maxCanvasPixels` plus
// `PDFPageDetailView`).

export type PdfDeviceClass = "desktop" | "phone";

const MiB = 1024 * 1024;
const BYTES_PER_PIXEL = 4;

/** Backing-store budget per visible page, base and detail canvas together. */
export const PAGE_BUDGET_BYTES: Record<PdfDeviceClass, number> = {
  desktop: 32 * MiB,
  phone: 16 * MiB,
};

/** Shared by every visible page in every open reader (spreads, split panes). */
export const TOTAL_BUDGET_BYTES: Record<PdfDeviceClass, number> = {
  desktop: 64 * MiB,
  phone: 32 * MiB,
};

/**
 * Longest canvas side we ask for. Browsers refuse or silently blank canvases
 * past their own limit (Chromium's GPU texture limit is commonly 16384).
 */
export const MAX_CANVAS_SIDE = 16384;

/**
 * Share of a page's budget given to the full-page base canvas when the page
 * doesn't fit at full resolution. The rest goes to the detail canvas.
 */
const BASE_SHARE_WHEN_DETAILED = 0.5;

export function detectPdfDeviceClass(): PdfDeviceClass {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "desktop";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const shortSide = Math.min(window.screen?.width ?? Infinity, window.screen?.height ?? Infinity);
  return coarse && shortSide < 768 ? "phone" : "desktop";
}

/** Pixel budget for one page while `livePages` pages are on screen at once. */
export function pageBudgetPixels(device: PdfDeviceClass, livePages: number): number {
  const share = TOTAL_BUDGET_BYTES[device] / Math.max(1, livePages);
  return Math.floor(Math.min(PAGE_BUDGET_BYTES[device], share) / BYTES_PER_PIXEL);
}

export function pixelsToBytes(pixels: number): number {
  return pixels * BYTES_PER_PIXEL;
}

export interface CanvasSize {
  width: number;
  height: number;
}

/**
 * Integer backing size for a `cssWidth × cssHeight` region drawn at `scale`
 * device pixels per CSS pixel, shrunk (never grown) until it fits both
 * `maxPixels` and the per-side limit. Rounds down so rounding can't push it
 * over budget.
 */
export function fitCanvas(
  cssWidth: number,
  cssHeight: number,
  scale: number,
  maxPixels: number,
): CanvasSize {
  let s = scale;
  const area = cssWidth * cssHeight;
  if (area > 0 && area * s * s > maxPixels) s = Math.sqrt(maxPixels / area);
  s = Math.min(s, MAX_CANVAS_SIDE / Math.max(cssWidth, cssHeight, 1));
  return {
    width: Math.max(1, Math.floor(cssWidth * s)),
    height: Math.max(1, Math.floor(cssHeight * s)),
  };
}

export interface PageRasterPlan {
  /** Backing size of the full-page canvas. */
  base: CanvasSize;
  /** Pixels left for a detail canvas; 0 when the base is already full resolution. */
  detailPixels: number;
}

/**
 * How to rasterize one page. If the whole page fits the budget at device
 * resolution, one canvas does it. Otherwise the base canvas gets a share of
 * the budget (a softer full page, still readable while scrolling) and the
 * rest is reserved for a sharp detail canvas over the visible part.
 */
export function planPageRaster(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  budgetPixels: number,
): PageRasterPlan {
  const full = fitCanvas(cssWidth, cssHeight, dpr, Infinity);
  if (full.width * full.height <= budgetPixels) return { base: full, detailPixels: 0 };
  const base = fitCanvas(cssWidth, cssHeight, dpr, budgetPixels * BASE_SHARE_WHEN_DETAILED);
  return { base, detailPixels: Math.max(0, budgetPixels - base.width * base.height) };
}

/** A rectangle in page CSS pixels (the page's current layout size). */
export interface PageArea {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DetailPlan {
  /** Region of the page covered, in page CSS pixels. */
  minX: number;
  minY: number;
  width: number;
  height: number;
  canvas: CanvasSize;
}

/**
 * The detail canvas for a visible region: the region at device resolution,
 * plus as much margin on each side (up to one visible size) as the budget
 * allows, so small scrolls don't need a new render. If even the bare visible
 * region doesn't fit at device resolution (a huge window on a DPR 3 phone),
 * it is covered at the highest resolution that does.
 */
export function planDetailArea(
  page: CanvasSize,
  visible: PageArea,
  dpr: number,
  maxPixels: number,
): DetailPlan | null {
  const minX = Math.max(0, visible.minX);
  const minY = Math.max(0, visible.minY);
  const maxX = Math.min(page.width, visible.maxX);
  const maxY = Math.min(page.height, visible.maxY);
  const vw = maxX - minX;
  const vh = maxY - minY;
  if (vw <= 0 || vh <= 0 || maxPixels <= 0) return null;

  const linearRoom = Math.sqrt(maxPixels / (vw * vh * dpr * dpr));
  const overflow = Math.min(1, Math.max(0, (linearRoom - 1) / 2));
  const x0 = Math.max(0, minX - vw * overflow);
  const y0 = Math.max(0, minY - vh * overflow);
  const x1 = Math.min(page.width, maxX + vw * overflow);
  const y1 = Math.min(page.height, maxY + vh * overflow);
  const width = x1 - x0;
  const height = y1 - y0;
  return { minX: x0, minY: y0, width, height, canvas: fitCanvas(width, height, dpr, maxPixels) };
}

/**
 * Whether an existing detail canvas still serves `visible`: it covers the
 * whole region, and there is still margin on every side where the page
 * continues (so the next small scroll doesn't expose soft pixels).
 */
export function detailCovers(
  detail: Pick<DetailPlan, "minX" | "minY" | "width" | "height">,
  visible: PageArea,
  page: CanvasSize,
): boolean {
  const dx1 = detail.minX + detail.width;
  const dy1 = detail.minY + detail.height;
  const vx0 = Math.max(0, visible.minX);
  const vy0 = Math.max(0, visible.minY);
  const vx1 = Math.min(page.width, visible.maxX);
  const vy1 = Math.min(page.height, visible.maxY);
  const EPS = 0.5;
  if (vx0 < detail.minX - EPS || vy0 < detail.minY - EPS || vx1 > dx1 + EPS || vy1 > dy1 + EPS)
    return false;
  // Re-render once the visible region gets within a quarter of its own size
  // of an edge that isn't the page's edge.
  const mx = (vx1 - vx0) / 4;
  const my = (vy1 - vy0) / 4;
  if (detail.minX > EPS && vx0 - detail.minX < mx) return false;
  if (detail.minY > EPS && vy0 - detail.minY < my) return false;
  if (dx1 < page.width - EPS && dx1 - vx1 < mx) return false;
  if (dy1 < page.height - EPS && dy1 - vy1 < my) return false;
  return true;
}

// Visible pages across every open reader, so a second pane or a spread
// shrinks each page's share of the total budget.
let livePages = 0;
const liveListeners = new Set<() => void>();

export function registerLivePdfPage(): () => void {
  livePages++;
  for (const listener of liveListeners) listener();
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    livePages--;
    for (const listener of liveListeners) listener();
  };
}

export function subscribeLivePdfPages(listener: () => void): () => void {
  liveListeners.add(listener);
  return () => liveListeners.delete(listener);
}

export function getLivePdfPages(): number {
  return livePages;
}
