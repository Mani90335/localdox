// Shapes shared between the main thread, the worker and the Orama schema
// itself. Kept dependency-free (no `@orama/orama` import) so the worker
// protocol and the engine can never drift apart from what a caller expects.

export interface SearchFile {
  id: string;
  name: string;
  content: string;
}

/** The Orama document schema — one row per matchable line, plus one
 *  synthetic row per file for filename matches (`lineIndex: -1`). */
export const rowSchema = {
  workspaceId: "enum",
  fileId: "enum",
  fileName: "string",
  text: "string",
  headingText: "string",
  /**
   * Equal to `text` only when this row *is* a heading line, else "".
   * Giving heading lines their own searchable property is how a heading
   * match outranks a body match via Orama's own per-property `boost`,
   * instead of a hand-rolled score table.
   */
  headingOwnText: "string",
  headingId: "string",
  lineIndex: "number",
  isHeading: "boolean",
} as const;

export interface SearchRowDoc {
  workspaceId: string;
  fileId: string;
  fileName: string;
  text: string;
  headingText: string;
  headingOwnText: string;
  headingId: string;
  lineIndex: number;
  isHeading: boolean;
}

export interface SearchHit {
  workspaceId: string;
  fileId: string;
  fileName: string;
  headingId?: string;
  headingText?: string;
  snippet: string;
  /** The matched line in full, untruncated — lets the viewer scroll to the
   *  passage itself rather than to the heading that happens to precede it. */
  line: string;
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

export const SEARCH_RESULT_LIMIT = 200;
