// Rendered diagrams, mapped back to the fence they were drawn from.
//
// A Mermaid diagram on the page is an SVG whose text is node labels plus the
// stylesheet Mermaid injects; a mind map is an interactive tree. Neither says
// what the author wrote. Copying a selection that crosses one (see
// selection-markdown.ts) needs the source, so each diagram block registers its
// element here when it mounts.
//
// A WeakMap rather than a `data-` attribute: the source of a large diagram can
// run to megabytes, and putting it in the DOM would hold a second copy in every
// attribute and slow every DOM walk over the page. An unmounted element is
// collected with its entry.

export interface DiagramSource {
  /** The fence language: `mermaid` or `mindmap`. */
  lang: string;
  source: string;
}

const sources = new WeakMap<object, DiagramSource>();

/** A React ref callback's worth: registers (or, given null, does nothing). */
export function registerDiagramSource(element: object | null, lang: string, source: string) {
  if (element) sources.set(element, { lang, source });
}

export function diagramSourceOf(node: object): DiagramSource | undefined {
  return sources.get(node);
}
