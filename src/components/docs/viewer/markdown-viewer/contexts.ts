import { createContext } from "react";
import type { SavedDraft, SavedItem } from "@/lib/workspace/saved-items";

/**
 * Star affordances live deep inside the rendered markdown (a heading, a table,
 * a code block), far from the state that knows what is starred. They read it
 * through this context rather than through props so that saving something
 * re-renders the stars alone — passing `saved` into the `components` memo would
 * rebuild every renderer and re-render the whole document on each star.
 */
export interface SavedContextValue {
  /** The element offsets are measured against (the rendered page). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Page the reader is on; undefined in single-page mode (whole-doc offsets). */
  subtopicId?: string;
  isSaved: (probe: {
    kind: SavedItem["kind"];
    headingId?: string;
    text?: string;
  }) => SavedItem | undefined;
  toggle: (draft: SavedDraft) => void;
  remove: (id: string) => void;
  enabled: boolean;
  /**
   * Changes when the rendered markdown does. `SavableBlock` reads its own
   * `textContent` to know what it would save, and that read walks the block's
   * whole subtree — it must happen when the document changes, not on every
   * render of every block.
   */
  revision: string;
}

export const SavedContext = createContext<SavedContextValue | null>(null);

/**
 * Which sections the reader has wrapped up, shared between a heading and the
 * content beneath it.
 *
 * Collapsing is a property of the rendered document rather than of any one
 * element: the heading owns the control, but what it hides is its *siblings*,
 * up to the next heading of the same or higher rank. Both sides read this.
 */
export interface CollapseContextValue {
  isCollapsed: (headingId: string) => boolean;
  toggle: (headingId: string) => void;
}
export const CollapseContext = createContext<CollapseContextValue | null>(null);
