import type { ComponentProps } from "react";
import { deferredModule } from "@/lib/app/deferred-module";
import type { MarkdownViewer as Viewer } from "./MarkdownViewer";

/**
 * The Markdown reader, loaded once there is a Markdown document to show.
 *
 * The reader and the parsing pipeline behind it (micromark, mdast, hast,
 * source mapping) used to ride in the app's first download, so an empty
 * workspace paid for a document it didn't have. Now the download starts when a
 * document is about to open: `preloadMarkdownViewer` when files are being
 * added or created, otherwise the first render that needs it. It is precached
 * with the offline shell (see vite.config.ts), so opening a document offline
 * never needs the network.
 */
const viewer = deferredModule(() => import("./MarkdownViewer"));

/** Starts the reader's download without waiting for it. */
export const preloadMarkdownViewer = viewer.preload;

/** Holds the reading column while the reader downloads. Invisible for the first
 *  moments, so a fast (cached) load shows nothing rather than a flash. */
function ReaderPlaceholder({ name }: { name: string }) {
  return (
    <div
      role="status"
      aria-label={`Opening ${name}`}
      className="mx-auto min-h-[60vh] w-full max-w-3xl px-6 pt-16 animate-in fade-in fill-mode-both duration-300 delay-300"
    >
      <div className="h-9 w-2/3 animate-pulse rounded-md bg-muted" />
      <div className="mt-4 h-3 w-40 animate-pulse rounded bg-muted/70" />
      <div className="mt-10 space-y-3">
        <div className="h-3 w-full animate-pulse rounded bg-muted/70" />
        <div className="h-3 w-11/12 animate-pulse rounded bg-muted/70" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-muted/70" />
      </div>
    </div>
  );
}

export function MarkdownViewer(props: ComponentProps<typeof Viewer>) {
  const mod = viewer.useModule();
  if (!mod) return <ReaderPlaceholder name={props.file.name} />;
  return <mod.MarkdownViewer {...props} />;
}
