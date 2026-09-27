import { ChevronLeft, ChevronRight } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useHideOnScroll } from "@/hooks/use-hide-on-scroll";

/**
 * The one header every viewer shares. Layout is fixed for all file types:
 *   <navAction>   ...spacer...   <actions>
 *
 * Two things change per file type:
 *  - `navAction`: the section dropdown for markdown, nothing for most others.
 *  - `actions`: the right-side controls (zoom, fullscreen, the mind map, …).
 *
 * History back/forward and search both used to live here. Back and forward act
 * on the workspace rather than the open document, so they moved to the sidebar
 * with the rest of the app chrome; search went to the sidebar's brand row. What
 * is left is about the document on screen and nothing else.
 */

export function ViewerHeader({
  navAction,
  actions,
}: {
  navAction?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  // Phones give up a seventh of the screen to this bar. It slides away while
  // the reader is heading down the document and comes straight back on the
  // first upward scroll, so the controls are always one gesture away without
  // being permanently in the way. Desktop has the room; it keeps the header
  // pinned.
  const isMobile = useIsMobile();
  const headerRef = useHideOnScroll<HTMLDivElement>(isMobile);

  // A file type that offers neither a section picker nor any per-view control
  // has nothing to put in this bar, and an empty one still cost its full 3.5rem
  // — on a 320x640 phone that was a fifth of the screen spent on two chrome
  // bars, the lower of which was blank. Callers pass `undefined` rather than an
  // empty fragment when they have nothing, so this stays a simple check.
  if (!navAction && !actions) return null;

  return (
    <div
      ref={headerRef}
      className="app-surface sticky top-0 z-(--z-sticky) flex h-14 shrink-0 items-center gap-2 border-b border-border/50 px-4 transition-transform duration-300 ease-out will-change-transform md:px-7"
    >
      {/* Start: what you are reading — the section picker. Search used to sit
          at the end of this bar; it lives in the sidebar's brand row now (⌘K
          still works), leaving the header to the open document alone. */}
      {navAction && <div className="flex min-w-0 shrink items-center">{navAction}</div>}
      <div className="flex-1" />
      {actions && <div className="z-10 flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

/**
 * Sequential stepping through whatever the current view is a sequence of — the
 * sections of a document, or the files of the workspace.
 *
 * This is what the header's chevrons used to do. It sits under the content
 * instead, where "next" reads as "next part of what I am reading" rather than
 * competing with back/forward for the same gesture. Callers that have nothing
 * to step through render nothing.
 */
export interface ViewerNav {
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  prevLabel?: string;
  nextLabel?: string;
}

/**
 * Forward is the move the reader almost always wants, so it gets the card:
 * a full-width target that names where it goes. Going back is the rarer,
 * corrective move, so it sits below as a quiet line of text. The two used to be
 * equal-weight buttons side by side, which gave a step backwards the same
 * prominence as continuing.
 */
export function ViewerPager({
  nav,
  className,
  nextEyebrow,
  nextMeta,
}: {
  nav: ViewerNav;
  className?: string;
  /** Small label over the next title, e.g. "Next 2/5". */
  nextEyebrow?: string;
  /** Optional line under the next title, e.g. an estimated reading time. */
  nextMeta?: string;
}) {
  if (nav.prevDisabled && nav.nextDisabled) return null;
  return (
    <nav
      aria-label="Document navigation"
      className={`mx-auto flex w-full max-w-xl flex-col items-center gap-6 px-4 py-10 md:px-7 ${className ?? ""}`}
    >
      {!nav.nextDisabled ? (
        <button
          type="button"
          onClick={nav.onNext}
          className="group flex w-full min-w-0 items-center justify-between gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-6 text-left shadow-sm transition-all hover:border-primary/50 hover:shadow-md"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold uppercase tracking-wider text-primary/80">
              {nextEyebrow ?? "Next"}
            </span>
            <span className="mt-1.5 block truncate text-lg font-semibold text-foreground transition-colors group-hover:text-primary">
              {nav.nextLabel ?? "Next"}
            </span>
            {nextMeta && (
              <span className="mt-1 block text-xs font-medium text-muted-foreground">
                {nextMeta}
              </span>
            )}
          </span>
          <ChevronRight className="h-6 w-6 shrink-0 text-primary/70 transition-transform group-hover:translate-x-1 group-hover:text-primary" />
        </button>
      ) : (
        <div className="flex w-full items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          You've reached the end.
        </div>
      )}

      {!nav.prevDisabled && (
        <button
          type="button"
          onClick={nav.onPrev}
          className="group flex max-w-full items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4 shrink-0 transition-transform group-hover:-translate-x-1" />
          <span className="truncate">{nav.prevLabel ?? "Previous"}</span>
        </button>
      )}
    </nav>
  );
}
