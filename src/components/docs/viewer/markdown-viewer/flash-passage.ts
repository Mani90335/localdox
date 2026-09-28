/** The element a range starts in, which is what actually scrolls. */
export const elementOf = (range: Range | null) =>
  range
    ? ((range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as HTMLElement)
        : range.startContainer.parentElement) ?? null)
    : null;

/** How long a jumped-to passage stays lit. */
const FLASH_MS = 1800;

/**
 * The CSS Custom Highlight API, as much of it as is needed here and only where
 * the browser has it. Typed locally because it is still absent from the DOM
 * lib this project builds against.
 */
type HighlightRegistry = Map<string, object> | undefined;
const highlightRegistry = (): HighlightRegistry =>
  typeof CSS !== "undefined"
    ? (CSS as unknown as { highlights?: Map<string, object> }).highlights
    : undefined;

/** Lets a flash survive its container re-rendering the same text. */
export interface FlashFollow {
  container: HTMLElement;
  /** The passage again, in the container's current DOM; null if it's gone. */
  reanchor: () => Range | null;
}

/**
 * Flash a passage once, so that arriving somewhere is visible and not merely
 * true. Shared by the saved-item jump and the search jump.
 *
 * A text range gets a one-shot custom highlight, which can span elements; a
 * heading or an image, which arrive without a range, get the equivalent
 * class-based pulse.
 */
export function flashPassage(
  range: Range | null,
  target: HTMLElement | null,
  follow?: FlashFollow,
) {
  const registry = highlightRegistry();
  const HighlightCtor = (globalThis as { Highlight?: new (...ranges: Range[]) => object })
    .Highlight;
  let clear: (() => void) | undefined;
  if (range && registry && HighlightCtor) {
    let current = range;
    let highlight = new HighlightCtor(current);
    registry.set("dc-saved-flash", highlight);
    // The page can re-render its markdown just after a jump (a save bumps the
    // workspace revision, and the renderers are rebuilt), which replaces the
    // text nodes the range points into and empties it. Same text, same
    // offsets — so the flash is re-pointed at the new nodes.
    const observer = follow
      ? new MutationObserver(() => {
          if (registry.get("dc-saved-flash") !== highlight || !current.collapsed) return;
          const next = follow.reanchor();
          if (!next) return;
          current = next;
          highlight = new HighlightCtor(next);
          registry.set("dc-saved-flash", highlight);
        })
      : null;
    observer?.observe(follow!.container, { childList: true, subtree: true });
    clear = () => {
      observer?.disconnect();
      // A later jump owns the flash now; leave it lit.
      if (registry.get("dc-saved-flash") === highlight) registry.delete("dc-saved-flash");
    };
  } else if (target) {
    target.classList.add("docs-saved-flash");
    clear = () => target.classList.remove("docs-saved-flash");
  }
  if (clear) setTimeout(clear, FLASH_MS);
}

/** Every ancestor that scrolls vertically, nearest first, ending with the
 *  document. An `overflow: auto` box that isn't height-constrained only takes
 *  part of a scroll; the rest falls to the boxes around it. */
function scrollersOf(node: Node): Element[] {
  const scrollers: Element[] = [];
  for (let el = node.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight)
      scrollers.push(el);
  }
  const root = document.scrollingElement ?? document.documentElement;
  if (!scrollers.includes(root)) scrollers.push(root);
  return scrollers;
}

/** How far `range` sits from the middle of what is actually visible — the
 *  window, clipped by every scrolling box around it. */
function offCentre(range: Range, scrollers: Element[]): { delta: number; visible: boolean } {
  let top = 0;
  let bottom = window.innerHeight;
  for (const scroller of scrollers) {
    if (scroller === document.scrollingElement) continue;
    const box = scroller.getBoundingClientRect();
    top = Math.max(top, box.top);
    bottom = Math.min(bottom, box.bottom);
  }
  const rect = range.getBoundingClientRect();
  return {
    delta: rect.top + rect.height / 2 - (top + bottom) / 2,
    visible: rect.top >= top && rect.bottom <= bottom,
  };
}

/** Scrolls by `delta`, nearest box first, each taking what it can. */
function scrollChainBy(scrollers: Element[], delta: number, behavior: ScrollBehavior) {
  let rest = delta;
  for (const scroller of scrollers) {
    const room =
      rest > 0
        ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
        : -scroller.scrollTop;
    const step = rest > 0 ? Math.min(rest, room) : Math.max(rest, room);
    if (step) scroller.scrollBy({ top: step, behavior });
    rest -= step;
    if (Math.abs(rest) < 1) return;
  }
}

const SETTLE_TICK_MS = 120;
const SETTLE_LIMIT_MS = 4000;
const READER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Scroll a matched word — not the block around it, which in a long paragraph
 * can be taller than the screen — to the middle of the view, and keep it there
 * until the page stops moving.
 *
 * A long document lays out lazily (`content-visibility: auto` sizes every
 * off-screen block by estimate), so the blocks a smooth scroll passes change
 * height underneath it and it comes to rest short of the target. Once the
 * target has stopped moving, any remaining distance is closed with a direct
 * jump. The reader scrolling, typing or clicking ends it at once.
 *
 * `current` returns the passage as it is now, since a re-render can replace the
 * nodes the first range pointed into — and the scrolling boxes around them.
 */
export function scrollToPassage(range: Range, current: () => Range | null) {
  const scrollers = scrollersOf(range.startContainer);
  scrollChainBy(scrollers, offCentre(range, scrollers).delta, "smooth");

  let last = Number.NaN;
  const deadline = performance.now() + SETTLE_LIMIT_MS;
  const stop = () => {
    clearInterval(timer);
    for (const type of READER_INPUT) window.removeEventListener(type, stop, true);
  };
  const timer = setInterval(() => {
    const now = current();
    if (!now || now.collapsed || performance.now() > deadline) return stop();
    const around = scrollersOf(now.startContainer);
    const { delta, visible } = offCentre(now, around);
    if (delta !== last) {
      // Still on its way.
      last = delta;
      return;
    }
    if (visible) return stop();
    scrollChainBy(around, delta, "instant");
    last = Number.NaN;
  }, SETTLE_TICK_MS);
  for (const type of READER_INPUT)
    window.addEventListener(type, stop, { capture: true, passive: true });
}
