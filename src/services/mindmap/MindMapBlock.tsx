import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Expand, Minimize2 } from "lucide-react";
import { buildMindMap, type MindMapNode } from "./mindmap";

/**
 * A ```mindmap fence in a markdown document, rendered the way ```mermaid is.
 *
 * The layout engine and renderer stay behind a lazy boundary: a document that
 * never draws a map never downloads them. Parsing and normalising is cheap and
 * synchronous, so it happens here — that is also what decides whether the fence
 * can be drawn at all.
 */
const MindMapView = lazy(() =>
  import("./MindMapView").then((module) => ({ default: module.MindMapView })),
);

// Behind the same boundary as the map itself: a document that never draws one
// never downloads either, and by the time a node can be selected the module is
// already loaded.
const Inspector = lazy(() =>
  import("./MindMapView").then((module) => ({ default: module.Inspector })),
);

/** Holds the map's rough footprint so surrounding text doesn't jump. */
function MapPlaceholder() {
  return (
    <div
      className="my-6 flex min-h-64 items-center justify-center rounded-xl border border-border bg-muted/30 text-sm text-muted-foreground"
      role="status"
      aria-label="Loading mind map"
    >
      Loading mind map…
    </div>
  );
}

/**
 * A fence that isn't usable JSON is shown as plain code rather than replaced by
 * an error: the author can still read what they wrote, and a malformed diagram
 * never costs them the content.
 */
function RawFence({ code, reason }: { code: string; reason: string }) {
  return (
    <div className="my-6 overflow-hidden rounded-xl border border-border">
      <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        {reason}
      </div>
      <pre className="overflow-auto bg-media-backdrop p-4 text-sm leading-6 text-media-backdrop-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function MindMapBlock({ code, title }: { code: string; title?: string }) {
  const tree = useMemo(() => buildMindMap(code, title?.trim() || "root"), [code, title]);

  if (!tree) {
    const invalid = (() => {
      try {
        JSON.parse(code);
        return false;
      } catch {
        return true;
      }
    })();
    return (
      <RawFence
        code={code}
        reason={
          invalid
            ? "This mind map block is not valid JSON."
            : "This JSON has no nested structure to draw as a mind map."
        }
      />
    );
  }

  return <MindMapFigure tree={tree} />;
}

/**
 * The map plus the control that takes it full screen.
 *
 * Fullscreen is the element's own, not an overlay div: a mind map embedded in a
 * document gets a few hundred pixels of a text column, which is the one place
 * it is least readable. The real Fullscreen API hands the map the whole display
 * and keeps it the same live component — so the open branches, the selection
 * and the inspector all survive going in and coming back out.
 */
function MindMapFigure({ tree }: { tree: NonNullable<ReturnType<typeof buildMindMap>> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  // The details panel for the selected node, lifted out of the map.
  //
  // Inside the embed it sat on top of the drawing, and the embed is only a few
  // hundred pixels tall — opening a node covered the thing the reader had just
  // clicked. Hoisted here it sits at the figure's top right, beside the map
  // rather than over it. In full screen there is room for it in place, so it
  // goes back to being the map's own panel.
  const [inspected, setInspected] = useState<MindMapNode | null>(null);

  // Driven by the event, not by the click: Escape and the browser's own exit
  // leave fullscreen without going through the button, and the state has to
  // follow the document either way.
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === hostRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggle = () => {
    const el = hostRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => setFull(false));
  };

  return (
    <div
      ref={hostRef}
      className={`overflow-hidden bg-background ${
        full ? "flex h-screen w-screen flex-col" : "my-6 rounded-xl border border-border"
      }`}
    >
      <div className="flex items-center justify-end border-b border-border/70 bg-background/40 px-2 py-1.5">
        <button
          onClick={toggle}
          title={full ? "Exit full screen" : "Full screen"}
          aria-label={full ? "Exit full screen" : "Full screen"}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className={`relative ${full ? "min-h-0 flex-1" : ""}`}>
        <Suspense fallback={<MapPlaceholder />}>
          {/* Bounded height: inside a document the map is a figure, not a page,
              and it must not grow past the text it belongs to. Full screen is
              the exception, and there it fills what it is given. */}
          <MindMapView
            tree={tree}
            embedded={!full}
            fill={full}
            onInspect={full ? undefined : setInspected}
          />
        </Suspense>
        {!full && inspected && (
          <div className="pointer-events-none absolute inset-0 z-10">
            <div className="pointer-events-auto">
              {/* Its own boundary: this sits outside the map's Suspense, and a
                  lazy component with nothing to catch it throws on first use. */}
              <Suspense fallback={null}>
                <Inspector node={inspected} onClose={() => setInspected(null)} />
              </Suspense>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
