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

/**
 * Flash a passage once, so that arriving somewhere is visible and not merely
 * true. Shared by the saved-item jump and the search jump.
 *
 * A text range gets a one-shot custom highlight, which can span elements; a
 * heading or an image, which arrive without a range, get the equivalent
 * class-based pulse.
 */
export function flashPassage(range: Range | null, target: HTMLElement | null) {
  const registry = highlightRegistry();
  const HighlightCtor = (globalThis as { Highlight?: new (...ranges: Range[]) => object })
    .Highlight;
  let clear: (() => void) | undefined;
  if (range && registry && HighlightCtor) {
    registry.set("dc-saved-flash", new HighlightCtor(range));
    clear = () => void registry.delete("dc-saved-flash");
  } else if (target) {
    target.classList.add("docs-saved-flash");
    clear = () => target.classList.remove("docs-saved-flash");
  }
  if (clear) setTimeout(clear, FLASH_MS);
}
