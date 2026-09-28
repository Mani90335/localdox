import type { PdfSearchMatch } from "./types";

/** Match UTF-16 offsets directly; marked-content records don't have textDivs. */
export function findMatchesOnPage(
  pageNumber: number,
  items: Array<{ str?: string } | { type: string }>,
  query: string,
  nextId: { current: number },
): PdfSearchMatch[] {
  const needle = query.trim();
  if (!needle) return [];
  const bounds: Array<{ start: number; end: number }> = [];
  const chunks: string[] = [];
  let length = 0;
  for (const item of items) {
    if (!("str" in item) || typeof item.str !== "string") continue;
    bounds.push({ start: length, end: length + item.str.length });
    chunks.push(item.str);
    length += item.str.length;
  }
  const text = chunks.join("");
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const matches: PdfSearchMatch[] = [];
  let firstItem = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const at = match.index;
    const end = at + match[0].length;
    // Matches are ordered: visit each preceding item only once per page.
    while (firstItem < bounds.length && bounds[firstItem].end <= at) firstItem++;
    const highlights: PdfSearchMatch["highlights"] = [];
    for (let itemIndex = firstItem; itemIndex < bounds.length; itemIndex++) {
      const bound = bounds[itemIndex];
      if (bound.start >= end) break;
      const overlapStart = Math.max(at, bound.start);
      const overlapEnd = Math.min(end, bound.end);
      if (overlapStart < overlapEnd)
        highlights.push({
          itemIndex,
          charIndex: overlapStart - bound.start,
          length: overlapEnd - overlapStart,
        });
    }
    if (highlights.length) matches.push({ id: nextId.current++, pageNumber, highlights });
  }
  return matches;
}
