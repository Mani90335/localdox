// Local shapes for pdf.js concepts, used everywhere the PDF reader's state
// travels *outside* the lazy-loaded, pdf.js-touching module. Never import a
// `pdfjs-dist` type here — `PdfReader.tsx` maps the real API into these at
// the boundary, so nothing statically imported by `DocumentViewer.tsx` (and
// therefore reachable during SSR/prerender) ever names the package.

/**
 * An outline entry's destination as pdf.js reports it: a named destination,
 * an explicit destination array (its first element is the target page's
 * reference or index), or nothing. Resolved to a page only when needed; see
 * `pdf-outline.ts`.
 */
export type PdfOutlineDest = string | readonly unknown[] | null;

export interface PdfOutlineNode {
  /** Index path from the root, e.g. `"2.0.5"`. */
  id: string;
  title: string;
  dest: PdfOutlineDest;
  /** The PDF marks this entry collapsed by default. */
  closed: boolean;
  items: PdfOutlineNode[];
}

/** The slice of one text-content item's `str` a match overlaps. */
export interface PdfSearchHighlight {
  itemIndex: number;
  charIndex: number;
  length: number;
}

/**
 * One logical search hit. Built by searching a page's *concatenated* text
 * (all its items joined, the same way pdf.js's own find controller does it),
 * so a match spanning two adjacent text-content items — common; a kerning
 * adjustment or a font-style change mid-word is enough to split one — is
 * still found. `highlights` has one entry per item the match touches; a
 * single-item match has exactly one.
 */
export interface PdfSearchMatch {
  id: number;
  pageNumber: number;
  highlights: PdfSearchHighlight[];
}
