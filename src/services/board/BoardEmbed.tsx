// A board embedded in a document, by reference.
//
// `![[Sketch.excalidraw]]` (or `![[Other Workspace/Sketch.excalidraw]]`) puts
// the *live* scene of another workspace file into the prose — not an exported
// image. The file stays the single copy: edit the board in its own tab and
// every document embedding it shows the new drawing on next render.
//
// Read-only on purpose, exactly like an embedded Mermaid diagram. An editable
// canvas inside a paragraph would be a second, competing place to change a
// document that is already open elsewhere, and the save would have to travel
// back through a file the reader never opened. Editing happens where the board
// lives; here it is a figure.

import { Suspense, lazy, useEffect, useMemo, useRef, useState, type FC } from "react";

/**
 * Declared locally rather than imported from `./Board`.
 *
 * Same constraint `BoardLazy` documents: even a type-only import puts the
 * module back in the server graph and breaks the prerender, because the bundler
 * follows the specifier that TypeScript erases.
 */
type BoardViewProps = {
  scene: string;
  /** Excalidraw is keyed on this so two embeds of two boards never share state. */
  sceneKey: string;
};

const BoardView = lazy(async () => {
  const stub: FC<BoardViewProps> = () => null;
  if (import.meta.env.SSR) return { default: stub };
  const m = await import("./BoardViewer");
  return { default: m.BoardViewer };
});

/** Holds the board's footprint so the surrounding text doesn't jump. */
function BoardPlaceholder({ targetRef }: { targetRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={targetRef}
      className="docs-board-embed flex items-center justify-center bg-muted/30 text-sm text-muted-foreground"
      role="status"
      aria-label="Loading board"
    >
      Loading board…
    </div>
  );
}

export function BoardEmbed({ content, name }: { content: string; name?: string }) {
  const targetRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  // Excalidraw and its canvas renderer are far heavier than a diagram, so an
  // embed below the fold costs nothing until the reader approaches it — the
  // same rule `MermaidBlock` follows, for the same reason.
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
      { rootMargin: "800px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  // An unreadable scene is reported rather than swallowed: a blank canvas here
  // would look like an empty board, which is a different and misleading fact.
  const valid = useMemo(() => {
    if (!content.trim()) return false;
    try {
      JSON.parse(content);
      return true;
    } catch {
      return false;
    }
  }, [content]);

  if (!valid) {
    return (
      <div className="artifact-error">
        <strong>{name ?? "This board"}</strong> isn’t a readable Excalidraw scene.
      </div>
    );
  }

  if (!nearViewport) return <BoardPlaceholder targetRef={targetRef} />;

  return (
    <figure className="docs-board-embed-figure">
      <Suspense fallback={<BoardPlaceholder />}>
        <BoardView scene={content} sceneKey={name ?? "board"} />
      </Suspense>
      {name && <figcaption className="docs-board-embed-caption">{name}</figcaption>}
    </figure>
  );
}
