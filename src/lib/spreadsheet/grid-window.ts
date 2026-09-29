/*
 * Which part of a sheet is on screen. Rows have a fixed height and columns a
 * fixed width, so both windows are arithmetic on the scroll position: the DOM
 * holds what is visible plus a margin, however tall or wide the sheet is.
 */

export const ROW_HEIGHT = 36;
export const OVERSCAN_ROWS = 12;
export const OVERSCAN_COLUMNS = 3;
/** Rows and columns per block fetched from the engine. */
export const ROW_BLOCK = 128;
export const COLUMN_BLOCK = 48;
/** Extra rows fetched past the rendered window, so scrolling rarely waits. */
export const PREFETCH_ROWS = 64;

export type Span = { first: number; last: number };

/** Rows [first, last) to render for a scroll position. */
export function rowWindow(scrollTop: number, height: number, total: number): Span {
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const last = Math.min(total, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN_ROWS);
  return { first: Math.min(first, last), last };
}

/**
 * Column widths that fill the view. A sheet narrower than the view has its
 * columns widened in proportion, the way an auto-sized table would stretch;
 * a wider one keeps its natural widths and scrolls.
 */
export function fitColumns(widths: readonly number[], available: number): number[] {
  const natural = widths.reduce((sum, width) => sum + width, 0);
  if (!widths.length || natural >= available) return [...widths];
  const scale = available / natural;
  const fitted = widths.map((width) => Math.floor(width * scale));
  fitted[fitted.length - 1] += available - fitted.reduce((sum, width) => sum + width, 0);
  return fitted;
}

/** Left edge of every column, plus the total width at the end. */
export function columnOffsets(widths: readonly number[]): number[] {
  const offsets = new Array<number>(widths.length + 1);
  offsets[0] = 0;
  for (let c = 0; c < widths.length; c++) offsets[c + 1] = offsets[c] + widths[c];
  return offsets;
}

/** First index whose value exceeds `x` (offsets are ascending). */
function upperBound(offsets: readonly number[], x: number): number {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (offsets[mid] <= x) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Columns [first, last) to render. `scrollLeft` and `width` are the scroll
 * container's; `pinned` is the sticky row-number column, which covers the
 * left of the view.
 */
export function columnWindow(
  offsets: readonly number[],
  scrollLeft: number,
  width: number,
  pinned: number,
): Span {
  const count = offsets.length - 1;
  if (count <= 0) return { first: 0, last: 0 };
  const left = Math.max(0, scrollLeft);
  const right = left + Math.max(0, width - pinned);
  const first = Math.max(0, upperBound(offsets, left) - 1 - OVERSCAN_COLUMNS);
  const last = Math.min(count, upperBound(offsets, right) + OVERSCAN_COLUMNS);
  return { first: Math.min(first, last), last };
}

/** Width of the sticky row-number column for a sheet of this many rows. */
export function rowNumberWidth(rowCount: number): number {
  const digits = String(Math.max(1, rowCount + 1)).length;
  return Math.max(48, Math.ceil(digits * 7.2 + 24));
}

/** Block indices overlapping [first, last). */
export function blocksFor(span: Span, size: number): number[] {
  if (span.last <= span.first) return [];
  const blocks: number[] = [];
  for (let b = Math.floor(span.first / size); b * size < span.last; b++) blocks.push(b);
  return blocks;
}
