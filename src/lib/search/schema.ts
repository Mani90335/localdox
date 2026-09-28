// Shapes shared between the main thread, the worker and the index. Kept
// dependency-free so the worker protocol and the engine can never drift apart
// from what a caller expects.

export interface SearchFile {
  id: string;
  name: string;
  content: string;
}

export interface SearchHit {
  workspaceId: string;
  fileId: string;
  fileName: string;
  headingId?: string;
  headingText?: string;
  /** The matched line, shortened around the match (or the file name, for a
   *  filename match). */
  snippet: string;
  /** Where this hit's match sits within `snippet`. */
  matchStart: number;
  matchLength: number;
  /** The matched line's visible text in full, untruncated — lets the viewer
   *  scroll to the passage itself rather than to the heading above it. "" for
   *  a filename match. */
  line: string;
  /** 0-based source line of the match; -1 for a filename match. */
  lineIndex: number;
  /**
   * Which occurrence of the query within `line` this hit is (0-based).
   *
   * A line is one row in the index, but the query can appear in it more than
   * once — "the cat sat near the cat flap" has two "cat"s. Each occurrence
   * gets its own hit so the sidebar lists (and can jump to) every one of
   * them, the way a real find-in-files does.
   */
  occurrence: number;
  score: number;
}

/** A search hit the reader opened, held until the viewer has landed on it. */
export interface PendingSearch {
  /** The hit's line, as `SearchHit.line`. */
  text: string;
  query: string;
  /** Which occurrence of `query` within `text` to land on, when it repeats. */
  occurrence: number;
  /** The hit's source line, as `SearchHit.lineIndex`. */
  lineIndex: number;
}

export interface SearchResults {
  /** At most SEARCH_RESULT_LIMIT hits, best files first. */
  hits: SearchHit[];
  /** Every match, including those past the limit. */
  total: number;
}

export const SEARCH_RESULT_LIMIT = 2000;
