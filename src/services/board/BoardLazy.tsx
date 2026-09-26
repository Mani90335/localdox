import { Suspense, lazy, useEffect, useState, type FC } from "react";

/**
 * Declared here rather than imported from `./Board`.
 *
 * Even a type-only `typeof import("./Board")` is enough to put the module back
 * in the server graph and break the prerender — TypeScript erases it, but the
 * bundler still follows it. Keeping the shape local is what lets the SSR branch
 * below share a signature with the real component while referencing nothing.
 */
type BoardProps = {
  fileId: string;
  content: string;
  onContentChange?: (content: string) => void;
};

/**
 * Excalidraw, loaded only when a board is actually opened — and only in a
 * browser.
 *
 * Two separate reasons this import is deferred:
 *
 * 1. Size. The package is a whole drawing editor — canvas renderer, shape
 *    library and its own stylesheet. Importing `./Board` directly would put all
 *    of that in the first download for every reader, including the ones who
 *    only ever open a markdown file.
 *
 * 2. It cannot be evaluated on the server. Excalidraw reads `navigator.platform`
 *    and `"netscape" in window` at module top level, with no guard, so merely
 *    importing it throws `window is not defined` during prerender and leaves
 *    `.output/public` with no HTML at all.
 *
 *    The import below stays a plain literal on purpose. Hiding the specifier
 *    from the bundler does keep Excalidraw out of the server graph, but it
 *    blinds the *client* build too: no chunk is emitted, and opening a board in
 *    production 404s while dev still works, because the dev server resolves
 *    modules on demand. `./Board` therefore imports Excalidraw from an effect
 *    instead, which leaves this module safe for the server to evaluate.
 */
const Board = lazy(async () => {
  // Typed from the local `BoardProps` so both branches share one signature —
  // otherwise TypeScript narrows the union to the stub and rejects the props.
  const stub: FC<BoardProps> = () => null;
  if (import.meta.env.SSR) return { default: stub };

  const m = await import("./Board");
  return { default: m.Board };
});

/**
 * Holds the canvas's footprint so the viewer doesn't collapse while loading.
 *
 * Deliberately unframed — no card, no border, app surface. A bordered
 * placeholder would flash the very "pasted-in iframe" look the board itself
 * avoids, for the moment before the canvas takes over.
 */
function BoardPlaceholder() {
  return (
    <div
      className="flex h-full w-full items-center justify-center bg-background text-sm text-muted-foreground"
      role="status"
      aria-label="Loading board"
    >
      Loading board…
    </div>
  );
}

export function BoardCanvas(props: BoardProps) {
  // Effects do not run during SSR or prerender, so this stays false there and
  // the lazy factory is never invoked on the server.
  const [inBrowser, setInBrowser] = useState(false);
  useEffect(() => setInBrowser(true), []);

  if (!inBrowser) return <BoardPlaceholder />;

  return (
    <Suspense fallback={<BoardPlaceholder />}>
      <Board {...props} />
    </Suspense>
  );
}
