import { createContext, useContext } from "react";

/**
 * Lets a block that already owns a row of overlay controls render its own save
 * affordance inside that row.
 *
 * The markdown viewer's default is a star floating in the block's corner, which
 * works for a table or a code fence. On a diagram it did not: the star was a
 * separate surface sitting beside the diagram's control tray, and because it was
 * a sibling of the stage rather than part of it, hovering the star took the
 * pointer off the stage and faded the rest of the controls away.
 *
 * Publishing the action instead of the button lets the diagram place it as one
 * more segment of its tray, so it looks and behaves like every button next to
 * it. Lives in its own module so `Mermaid` can consume it without importing the
 * markdown viewer that provides it.
 */
export interface SaveAction {
  saved: boolean;
  /**
   * Toggle the saved state. The event is optional: a button hands one over so
   * the click can be stopped from reaching the block underneath, but a menu
   * item has none to give.
   */
  toggle: (event?: React.MouseEvent) => void;
  /** Accessible name; reflects whether the block is currently saved. */
  label: string;
  /** Tooltip text. */
  title: string;
}

export const SaveActionContext = createContext<SaveAction | null>(null);

/** The ambient save action, or null when the block renders its own star. */
export function useSaveAction() {
  return useContext(SaveActionContext);
}
