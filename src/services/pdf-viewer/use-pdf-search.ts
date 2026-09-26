import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import type { PdfSearchMatch } from "./types";

type PdfTextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

/** Debounce between the last keystroke and the scan starting. */
const QUERY_DEBOUNCE_MS = 200;

/**
 * Finds every occurrence of `needle` in a page's text, joining all items into
 * one string first so a match spanning two items is still found, then maps
 * each hit's character range back onto the item(s) it overlaps.
 */
function findMatchesOnPage(
  pageNumber: number,
  items: PdfTextContent["items"],
  needle: string,
  nextId: { current: number },
): PdfSearchMatch[] {
  const bounds: Array<{ start: number; end: number }> = [];
  let text = "";
  for (const item of items) {
    const str = (item as { str?: string }).str ?? "";
    bounds.push({ start: text.length, end: text.length + str.length });
    text += str;
  }
  const lower = text.toLowerCase();

  const matches: PdfSearchMatch[] = [];
  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at === -1) break;
    const end = at + needle.length;
    from = end;

    const highlights: PdfSearchMatch["highlights"] = [];
    for (let itemIndex = 0; itemIndex < bounds.length; itemIndex++) {
      const bound = bounds[itemIndex];
      const overlapStart = Math.max(at, bound.start);
      const overlapEnd = Math.min(end, bound.end);
      if (overlapStart < overlapEnd) {
        highlights.push({
          itemIndex,
          charIndex: overlapStart - bound.start,
          length: overlapEnd - overlapStart,
        });
      }
      if (bound.start >= end) break; // bounds are ordered; nothing further can overlap
    }
    if (highlights.length) {
      matches.push({ id: nextId.current++, pageNumber, highlights });
    }
  }
  return matches;
}

export interface PdfSearchApi {
  query: string;
  setQuery: (query: string) => void;
  matches: PdfSearchMatch[];
  activeIndex: number;
  isSearching: boolean;
  next: () => void;
  prev: () => void;
}

/**
 * Incremental, per-page text search.
 *
 * Each page's text is searched as one concatenated string — items joined in
 * order, no separator — the same construction pdf.js's own find controller
 * uses internally. A naive "search within one item's `str`" approach missed
 * most real matches: a word is frequently split across adjacent text-content
 * items (a kerning adjustment, a font-style change mid-word, a PDF generator
 * that emits one item per glyph run), so scanning the joined string and then
 * mapping the match's character range back onto whichever item(s) it touches
 * is what makes search actually find text that's visibly on the page. pdf.js
 * renders one text-layer span per item (see `PdfPageCanvas`), so a match is
 * highlighted by adding a class to every span it overlaps.
 */
export function usePdfSearch({
  active,
  numPages,
  getTextContent,
  goToPage,
}: {
  /** Only scan while the search panel is actually open. */
  active: boolean;
  numPages: number | null;
  getTextContent: (pageNumber: number) => Promise<PdfTextContent>;
  goToPage: (page: number) => void;
}): PdfSearchApi {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [matches, setMatches] = useState<PdfSearchMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), QUERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const jumpedToFirst = useRef(false);
  useEffect(() => {
    jumpedToFirst.current = false;
  }, [debouncedQuery]);

  const nextMatchId = useRef(0);

  useEffect(() => {
    setMatches([]);
    setActiveIndex(0);
    const needle = debouncedQuery.trim().toLowerCase();
    if (!active || !needle || !numPages) {
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    nextMatchId.current = 0;
    setIsSearching(true);
    void (async () => {
      for (let pageNumber = 1; pageNumber <= numPages; pageNumber++) {
        if (cancelled) return;
        try {
          const content = await getTextContent(pageNumber);
          if (cancelled) return;
          const found = findMatchesOnPage(pageNumber, content.items, needle, nextMatchId);
          if (found.length && !cancelled) setMatches((prev) => [...prev, ...found]);
        } catch {
          // A page whose text can't be extracted is skipped, not fatal to the search.
        }
      }
      if (!cancelled) setIsSearching(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [active, debouncedQuery, numPages, getTextContent]);

  // Land on the first hit as soon as any are found, so a common term doesn't
  // require an extra click on "next" to see anything happen.
  useEffect(() => {
    if (jumpedToFirst.current || !matches.length) return;
    jumpedToFirst.current = true;
    setActiveIndex(0);
    goToPage(matches[0].pageNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);

  const next = useCallback(() => {
    if (!matches.length) return;
    const index = (activeIndex + 1) % matches.length;
    setActiveIndex(index);
    goToPage(matches[index].pageNumber);
  }, [matches, activeIndex, goToPage]);

  const prev = useCallback(() => {
    if (!matches.length) return;
    const index = (activeIndex - 1 + matches.length) % matches.length;
    setActiveIndex(index);
    goToPage(matches[index].pageNumber);
  }, [matches, activeIndex, goToPage]);

  return { query, setQuery, matches, activeIndex, isSearching, next, prev };
}
