import type { Components } from "react-markdown";
import { MATH_COMPONENTS } from "@/services/math/components";
import {
  MarkdownBlockquote,
  MarkdownDiv,
  MarkdownH1,
  MarkdownH2,
  MarkdownH3,
  MarkdownH4,
  MarkdownH5,
  MarkdownH6,
  MarkdownImage,
  MarkdownLi,
  MarkdownLink,
  MarkdownParagraph,
  MarkdownPre,
  MarkdownTable,
  MarkdownTd,
  MarkdownTh,
} from "./markdown-renderers";

/**
 * The viewer's react-markdown renderers. A module constant: its identity must
 * never change, or every element remounts (see `MarkdownRenderContextValue`).
 *
 * Folded sections aren't handled here either. They used to be, by tracking
 * the headings during render, which tied every block to the fold state; folds
 * are now applied to the rendered blocks directly (see `section-folds.ts`).
 *
 * Math: `remark-math-nodes` turns `$…$` and `$$…$$` into `<docs-math>` and
 * `<docs-eq-ref>` elements carrying the LaTeX; these entries typeset them. A
 * display equation is a block child like any other, so it folds with its
 * section. They read numbering and preferences from `MathProvider`.
 */
export const markdownComponents = {
  ...MATH_COMPONENTS,
  h1: MarkdownH1,
  h2: MarkdownH2,
  h3: MarkdownH3,
  h4: MarkdownH4,
  h5: MarkdownH5,
  h6: MarkdownH6,
  p: MarkdownParagraph,
  blockquote: MarkdownBlockquote,
  pre: MarkdownPre,
  div: MarkdownDiv,
  img: MarkdownImage,
  a: MarkdownLink,
  li: MarkdownLi,
  table: MarkdownTable,
  td: MarkdownTd,
  th: MarkdownTh,
  // react-markdown's `Components` type lists HTML element names only; the two
  // math element names are custom.
} as Components;
