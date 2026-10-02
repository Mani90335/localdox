import { createContext, type RefObject } from "react";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import type { MediaContext } from "@/lib/markdown/media-context";

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

/**
 * What the markdown renderers need to know about the document on screen.
 *
 * The renderer map used to be rebuilt whenever any of this changed — the file
 * object, the workspace's files, the folded sections. A new map means a new
 * component type for every element, and React responds to a changed type by
 * unmounting and remounting: on a 3,000-section document, opening it (the file
 * object is replaced once it is persisted) or folding one heading threw away
 * and rebuilt ~18,000 DOM nodes, over a second of main-thread work.
 *
 * The map is now a module constant (`markdown-components.ts`), and the few
 * renderers that need this read it here, so a change re-renders them alone.
 */
export interface MarkdownRenderContextValue {
  file: MdFile;
  media: MediaContext;
  /** Converted-document anchor names → the ids they render with. */
  anchorTargets: Record<string, string>;
  onNav: (fileId: string, subtopicId: string | null) => void;
  contentRef: RefObject<HTMLDivElement | null>;
  openLightbox: (image: { src: string; alt?: string }) => void;
}
export const MarkdownRenderContext = createContext<MarkdownRenderContextValue | null>(null);
