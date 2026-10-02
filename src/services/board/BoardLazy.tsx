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
  fileName?: string;
  content: string;
  onContentChange?: (content: string) => void;
  onRename?: (name: string) => void;
};

/**
 * The board editor, loaded only when a board is actually opened — and only in
 * a browser.
 *
 * Size is the reason: the editor (canvas engine, tools, menus) has no business
 * in the first download for a reader who only ever opens markdown. The import
 * stays a plain literal so Vite emits a client chunk for it; the SSR branch
 * returns a stub so the server never renders a canvas it can't measure.
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
