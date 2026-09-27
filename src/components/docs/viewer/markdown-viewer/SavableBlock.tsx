import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { SavedContext } from "./contexts";
import { SaveActionContext } from "../../editor/save-action";
import { contextAround, nodeOffsets } from "@/lib/markdown/text-offsets";
import { savedExcerpt, type SavedBlockType } from "@/lib/workspace/saved-items";

/**
 * Wraps a block (table, code fence, quote, image) with a hover star that saves
 * it. The block's own rendered text is the quote the saved item re-anchors by,
 * so a saved table is still findable after the document around it is edited.
 *
 * A block that already owns a row of overlay controls — a diagram — can render
 * the save action itself instead, as one more segment in that row. It reads the
 * action from {@link SaveActionContext}; see `renderOwnSaveAction`.
 */
export function SavableBlock({
  blockType,
  as: Wrapper = "div",
  className = "",
  identity,
  renderOwnSaveAction,
  children,
}: {
  blockType: SavedBlockType;
  as?: "div" | "span";
  className?: string;
  /** Stands in for the text of blocks that have none — an image's src. */
  identity?: string;
  /**
   * Suppress the floating star and publish the save action on context instead,
   * for a block that places it among its own controls.
   */
  renderOwnSaveAction?: boolean;
  children: ReactNode;
}) {
  const ctx = useContext(SavedContext);
  const ref = useRef<HTMLDivElement & HTMLSpanElement>(null);
  const [text, setText] = useState("");

  // Re-read the block's own text when the document changes. This used to run
  // with no dependency array at all, so every render of the page walked the
  // subtree of every table, code fence, quote and image on it — O(document) of
  // DOM traversal per render, plus a second render pass to settle. Keying it to
  // the rendered source keeps the star pointing at the right text (the whole
  // point of the original comment) at a fraction of the cost.
  useEffect(() => {
    const next = ref.current?.textContent?.trim() ?? "";
    setText((prev) => (prev === next ? prev : next));
  }, [ctx?.revision]);

  if (!ctx?.enabled) return <>{children}</>;

  // `identity` wins over the rendered text where it is given. A block whose DOM
  // text is not its content — a diagram, whose textContent is the stylesheet
  // Mermaid injects, complete with a per-render generated id — would otherwise
  // be saved under a key that changes on every render and never matches itself
  // again, so the star could never show as saved and never toggle back off.
  const probe = identity || text || "";
  const existing = ctx.isSaved({ kind: "block", text: probe });

  const toggle = (e?: React.MouseEvent) => {
    // Invoked from a menu item as well as a button, and a menu item has no
    // event to give — the guards are what let one handler serve both.
    e?.preventDefault();
    e?.stopPropagation();
    if (existing) {
      ctx.remove(existing.id);
      return;
    }
    const container = ctx.containerRef.current;
    const el = ref.current;
    const offsets = container && el ? nodeOffsets(container, el) : null;
    const quote = identity || offsets?.text.trim() || probe;
    ctx.toggle({
      kind: "block",
      blockType,
      title: savedExcerpt(quote || identity || blockType, 90),
      text: quote || undefined,
      blockSrc: blockType === "image" ? identity : undefined,
      subtopicId: ctx.subtopicId,
      ...(offsets && container
        ? {
            start: offsets.start,
            end: offsets.end,
            ...contextAround(container, offsets.start, offsets.end),
          }
        : null),
    });
  };

  if (renderOwnSaveAction) {
    return (
      <Wrapper ref={ref} className={`docs-savable ${className}`.trim()}>
        <SaveActionContext.Provider
          value={{
            saved: Boolean(existing),
            toggle,
            label: existing ? `Remove saved ${blockType}` : `Save ${blockType}`,
            title: existing ? "Saved — click to remove" : `Save this ${blockType}`,
          }}
        >
          {children}
        </SaveActionContext.Provider>
      </Wrapper>
    );
  }

  // No floating star. A star pinned to the corner of every table, quote, image
  // and code fence turned the document into a field of controls competing with
  // the prose — and it only ever offered to save whole blocks, never the
  // paragraph or the half-table the reader actually cared about. Saving now
  // lives on the selection popover, which can save any range at all, so the
  // block wrapper keeps its identity and offsets and draws nothing.
  return (
    <Wrapper ref={ref} className={`docs-savable ${className}`.trim()}>
      {children}
    </Wrapper>
  );
}
