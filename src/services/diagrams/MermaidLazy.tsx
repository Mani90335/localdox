import { Suspense, lazy, useEffect, useRef, useState } from "react";

/**
 * Mermaid, loaded only when a document actually contains a diagram.
 *
 * The library and its dependency tree (cytoscape, dagre, d3, plus a chunk per
 * diagram type) come to roughly 1.5 MB. Importing `./Mermaid` directly put all
 * of that in the reader's first download, for a feature most documents never
 * use. Behind this boundary it costs nothing until a ```mermaid fence renders.
 */
const Mermaid = lazy(() => import("./Mermaid").then((m) => ({ default: m.Mermaid })));

/** Holds the diagram's rough footprint so the surrounding text doesn't jump. */
function DiagramPlaceholder({ targetRef }: { targetRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={targetRef}
      className="my-6 flex min-h-40 items-center justify-center rounded-xl border border-border bg-muted/30 text-sm text-muted-foreground"
      role="status"
      aria-label="Loading diagram"
    >
      Loading diagram…
    </div>
  );
}

export function MermaidBlock({ code, name }: { code: string; name?: string }) {
  const targetRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setNearViewport(true);
        observer.disconnect();
      },
      // Start loading shortly before the reader reaches the diagram without
      // paying Mermaid's parse/layout cost for the rest of a long document.
      { rootMargin: "800px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  if (!nearViewport) return <DiagramPlaceholder targetRef={targetRef} />;

  return (
    <Suspense fallback={<DiagramPlaceholder />}>
      <Mermaid code={code} name={name} />
    </Suspense>
  );
}
