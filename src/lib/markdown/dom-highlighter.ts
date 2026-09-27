export interface Highlight {
  id: string;
  fileId: string;
  text: string;
  color: string;
  /** Optional note the reader attaches to a highlight. */
  label?: string;
  /** Which subtopic/page the highlight lives on (offsets are relative to it). */
  subtopicId?: string;
  /** Character offsets within the page's rendered content. */
  start?: number;
  end?: number;
  /**
   * Rendered text immediately before/after the highlight. Offsets alone are a
   * lie the moment the document is edited — everything after an insertion
   * shifts. The quote plus its surroundings identifies the same passage no
   * matter how much text moved, so highlights re-anchor themselves instead of
   * sliding onto whatever now sits at the old offsets.
   */
  prefix?: string;
  suffix?: string;
  /** Set when the highlighted text no longer exists in the document at all. */
  orphaned?: boolean;
}

/** Palette + the CSS ::highlight() group name each color maps to. */
export const HL_COLORS = ["#fde047", "#86efac", "#93c5fd", "#f9a8d4", "#fdba74", "#d8b4fe"];
export const hlGroup = (color: string) => `dc-hl-${Math.max(0, HL_COLORS.indexOf(color))}`;

/** Non-overlapping match ranges within a single text string. */
export interface DecorRange {
  start: number;
  end: number;
  kind: "highlight" | "query";
  highlight?: Highlight;
}

/**
 * Find highlight + search-query matches inside one text string, resolved to a
 * non-overlapping, left-to-right list. Highlights win ties over the query.
 *
 * This replaces the old DOM-mutation highlighter: matches are rendered as part
 * of the React tree instead, so they survive re-renders (the previous approach
 * was silently wiped whenever React reconciled the article).
 */
export function findDecorations(
  text: string,
  highlights: Highlight[],
  query: string | null,
): DecorRange[] {
  const lower = text.toLowerCase();
  const ranges: DecorRange[] = [];

  for (const hl of highlights) {
    const needle = hl.text.trim().toLowerCase();
    if (!needle) continue;
    let i = lower.indexOf(needle);
    while (i !== -1) {
      ranges.push({ start: i, end: i + needle.length, kind: "highlight", highlight: hl });
      i = lower.indexOf(needle, i + needle.length);
    }
  }

  const q = query?.trim().toLowerCase();
  if (q) {
    let i = lower.indexOf(q);
    while (i !== -1) {
      ranges.push({ start: i, end: i + q.length, kind: "query" });
      i = lower.indexOf(q, i + q.length);
    }
  }

  // Left-to-right, highlights before query at the same offset; then drop any
  // range that overlaps one already chosen.
  ranges.sort((a, b) => a.start - b.start || (a.kind === "highlight" ? -1 : 1));
  const chosen: DecorRange[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start >= cursor) {
      chosen.push(r);
      cursor = r.end;
    }
  }
  return chosen;
}
