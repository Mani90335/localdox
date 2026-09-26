// Mermaid defaults to 50,000 characters and 500 edges, which is too small for
// imported schema diagrams. Keep a generous, finite ceiling so 10k-12k-line
// ERDs work without making malformed input completely unbounded.
export const LARGE_DIAGRAM_MAX_TEXT_SIZE = 10_000_000;
export const LARGE_DIAGRAM_MAX_EDGES = 20_000;

/**
 * Return a fresh object because Mermaid may normalize its configuration.
 *
 * Callers should still avoid rebuilding this on every React render: passing a
 * new object identity into an effect's dependency list is what made the stages
 * re-render the whole diagram on unrelated state changes.
 */
export function largeDiagramMermaidConfig(performanceMode = false) {
  return {
    securityLevel: "loose",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    maxTextSize: LARGE_DIAGRAM_MAX_TEXT_SIZE,
    maxEdges: LARGE_DIAGRAM_MAX_EDGES,
    ...(performanceMode
      ? {
          // HTML labels create a foreignObject and nested HTML subtree for
          // every label. Plain SVG text is substantially cheaper at ERD scale.
          htmlLabels: false,
          markdownAutoWrap: false,
          // Do not build Mermaid's additional error SVG for huge failed input.
          suppressErrorRendering: true,
        }
      : {}),
  } as const;
}
