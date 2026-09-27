/**
 * Book-style pagination math for the PDF reader's spread mode.
 *
 * A real bound book puts its first page alone (the cover, or the first
 * recto), then pairs verso/recto pages together: (2,3), (4,5), (6,7), …
 * Pairing naively from the start — (1,2), (3,4), … — would put page 1 on the
 * *right* half of a spread next to page 2, which reads wrong to anyone who
 * has ever held a book. `currentPage` always stores the spread's *primary*
 * (left, or lone) page number; every other page/rendering module derives
 * what's actually on screen by calling `getVisiblePages`, so the pairing rule
 * exists in exactly one place.
 *
 * No React, no pdf.js — pure functions, trivially unit-tested.
 */

export type PdfLayoutMode = "single" | "spread";

function clampPage(page: number, numPages: number): number {
  return Math.min(Math.max(page, 1), Math.max(numPages, 1));
}

/** The 1 or 2 page numbers actually rendered for `current` in this mode. */
export function getVisiblePages(current: number, mode: PdfLayoutMode, numPages: number): number[] {
  const page = clampPage(current, numPages);
  if (mode === "single") return [page];
  if (page === 1) return [1]; // cover, alone
  const left = page % 2 === 0 ? page : page - 1; // snap to the even member of the pair
  const right = left + 1;
  return right <= numPages ? [left, right] : [left]; // trailing page with no partner
}

/** The next spread/page's primary page number, or `current` if already at the end. */
export function nextPageIndex(current: number, mode: PdfLayoutMode, numPages: number): number {
  if (mode === "single") return clampPage(current + 1, numPages);
  const visible = getVisiblePages(current, mode, numPages);
  const last = visible[visible.length - 1] ?? current;
  return clampPage(last + 1, numPages);
}

/** The previous spread/page's primary page number, or `current` if already at the start. */
export function prevPageIndex(current: number, mode: PdfLayoutMode, numPages: number): number {
  if (mode === "single") return clampPage(current - 1, numPages);
  const [first = current] = getVisiblePages(current, mode, numPages);
  if (first <= 1) return 1;
  // The pair before (2,3) is the cover alone; every other pair steps back by two.
  return first === 2 ? 1 : first - 2;
}
