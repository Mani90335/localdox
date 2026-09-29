import { useLayoutEffect, type RefObject } from "react";

const HEADING = /^H([1-6])$/;

/**
 * Hide the blocks of every folded section: everything after a folded heading
 * up to the next heading of the same or higher rank.
 *
 * This used to happen during render, by tracking the headings as each block
 * rendered and returning `null` under a folded one. That tied every block to
 * the fold state, so folding one heading re-rendered — in practice remounted —
 * the whole document, and it can't work once the document renders in separate
 * segments. The rendered blocks are the direct children of the container in
 * both cases, so the walk happens there instead, in one cheap pass.
 *
 * Folded blocks stay in the DOM with `hidden`, so text offsets (highlights,
 * saved passages) no longer shift when a section above them is folded.
 */
export function applySectionFolds(container: HTMLElement, collapsed: ReadonlySet<string>) {
  // Headings still open above the current block, outermost first.
  const open: Array<{ rank: number; id: string }> = [];
  for (const child of Array.from(container.children)) {
    const el = child as HTMLElement;
    const match = HEADING.exec(el.tagName);
    if (match) {
      const rank = Number(match[1]);
      while (open.length && open[open.length - 1].rank >= rank) open.pop();
    }
    // A heading asks only about the headings above it, so a folded heading
    // stays visible along with the control that unfolds it.
    const hidden = open.some((entry) => collapsed.has(entry.id));
    if (match) open.push({ rank: Number(match[1]), id: el.id });
    if (el.hidden !== hidden) el.hidden = hidden;
  }
}

/**
 * Keep `collapsed` applied to the blocks rendered in `containerRef`, including
 * blocks that mount later (a long document renders in steps) or re-render.
 * `renderKey` names the element the ref currently holds.
 */
export function useSectionFolds(
  containerRef: RefObject<HTMLElement | null>,
  collapsed: ReadonlySet<string>,
  renderKey: string,
) {
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    applySectionFolds(container, collapsed);
    if (!collapsed.size) return;
    const observer = new MutationObserver(() => applySectionFolds(container, collapsed));
    observer.observe(container, { childList: true });
    return () => observer.disconnect();
  }, [containerRef, collapsed, renderKey]);
}
