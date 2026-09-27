import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

/** Shared shell for the sidebar's popover menus. */
export const MENU_WIDTH = 224; // w-56
export const MENU_GAP = 6;
export const VIEWPORT_MARGIN = 8;

/**
 * True when a click landed outside both the menu root and its panel. `MenuPanel`
 * portals the panel outside the menu root, so it is no longer a DOM descendant —
 * a plain `root.contains(target)` test would read every click on a menu item as
 * a click outside and close the menu before the item could fire.
 */
export function isOutsideMenu(target: Node | null, root: HTMLElement | null) {
  if (!root || !target) return false;
  if (root.contains(target)) return false;
  return !(target instanceof Element && target.closest("[data-sidebar-menu-panel]"));
}

export function MenuItem({
  icon: Icon,
  label,
  onClick,
  destructive,
  disabled,
  trailing,
  iconClassName,
}: {
  icon: LucideIcon;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Rendered at the end of the row — a chevron for a submenu, say. */
  trailing?: React.ReactNode;
  iconClassName?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent ${
        destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-accent"
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${iconClassName ?? ""}`} strokeWidth={1.5} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

/** Divider between groups of menu items. */
export function MenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}

/**
 * A nested list that opens *beside* its parent menu rather than inside it.
 *
 * The folder list and the export actions used to unfold in place, pushing the
 * rest of the menu down and making a long list of folders scroll inside a panel
 * that was already a popover. A second panel alongside the first is how a menu
 * of menus behaves everywhere else, and it leaves the parent's own rows where
 * the reader left them.
 *
 * Positioned against the parent row: opening to the right, flipping to the left
 * when that would run off-screen, and pulled up when it would overhang the
 * bottom.
 */
export function MenuFlyout({
  anchor,
  children,
}: {
  anchor: HTMLElement | null;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      if (!anchor) return;
      const box = anchor.getBoundingClientRect();
      let left = box.right + MENU_GAP;
      if (left + MENU_WIDTH > window.innerWidth - VIEWPORT_MARGIN) {
        left = box.left - MENU_WIDTH - MENU_GAP;
      }
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

      const height = panelRef.current?.offsetHeight ?? 0;
      let top = box.top;
      if (height && top + height > window.innerHeight - VIEWPORT_MARGIN) {
        top = Math.max(VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN - height);
      }
      setPos({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, children]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      // Same tag as MenuPanel: the click-away handler treats a click in here as
      // inside the menu, not outside it.
      data-sidebar-menu-panel
      className="fixed z-(--z-menu) max-h-[min(60vh,22rem)] w-56 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl"
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    // Keep modal-owned menus inside its focus and pointer-event boundary.
    anchor?.closest('[role="dialog"]') ?? document.body,
  );
}

/**
 * Menus fly out to the *side* of their trigger rather than dropping below it:
 * dropped inside the sidebar column a panel covers the rows underneath, hiding
 * the very list the reader is working in. Opening beside the trigger puts the
 * panel over the content area and leaves the file list readable.
 *
 * It has to be portaled with fixed coordinates to do that. The file list is a
 * `overflow-y-auto` scroller, and a scroll container clips on *both* axes — an
 * absolutely positioned panel would be cut off at the sidebar's edge, which is
 * the very problem this is solving. Measuring the trigger and rendering to
 * the containing dialog (or <body>) escapes the clip while preserving modal
 * focus containment; the trade-off is that the panel must be repositioned
 * on scroll and resize rather than riding along with its anchor.
 */
export function MenuPanel({
  align = "right",
  children,
}: {
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      // The anchor sits inside the menu root, so its parent chain reaches the
      // trigger's positioned wrapper — the box the panel aligns against.
      const anchor = anchorRef.current?.parentElement;
      if (!anchor) return;
      const box = anchor.getBoundingClientRect();

      // Open toward `align`, flipping to the other side only when that would
      // run past the viewport edge.
      let left = align === "right" ? box.right + MENU_GAP : box.left - MENU_WIDTH - MENU_GAP;
      if (left + MENU_WIDTH > window.innerWidth - VIEWPORT_MARGIN)
        left = box.left - MENU_WIDTH - MENU_GAP;
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

      // Top-aligned with the trigger, pulled up if the panel would overhang the
      // bottom of the screen.
      const height = panelRef.current?.offsetHeight ?? 0;
      let top = box.top;
      if (height && top + height > window.innerHeight - VIEWPORT_MARGIN)
        top = Math.max(VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN - height);

      setPos({ top, left });
    };
    place();
    // `true` catches scrolling in the sidebar's own scroller, not just the page.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [align, children]);

  return (
    <>
      {/* Zero-size marker left in the menu root so the portaled panel can measure it. */}
      <span ref={anchorRef} className="hidden" aria-hidden />
      {typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            // Tagged so each menu's click-away handler can tell a click on its
            // own portaled panel from a genuine click outside the menu.
            data-sidebar-menu-panel
            className="fixed z-(--z-menu) w-56 rounded-xl border border-border bg-popover p-1.5 shadow-xl"
            style={{
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              // Measured before it is placed; hidden for that first frame so it
              // never flashes in the corner.
              visibility: pos ? "visible" : "hidden",
            }}
          >
            {children}
          </div>,
          anchorRef.current?.closest('[role="dialog"]') ?? document.body,
        )}
    </>
  );
}
