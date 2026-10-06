import { useEffect, useRef, type RefObject } from "react";
import { wheelPixels } from "@/lib/viewport";

interface WorkspaceLite {
  id: string;
  name: string;
}

interface WorkspaceStripProps {
  workspaces: WorkspaceLite[];
  currentId: string | null;
  onSelect: (id: string) => void;
  className?: string;
  /**
   * "sm" = bare 28px avatars with no visible label, for the sidebar footer's
   * single row. The name stays as the button's accessible label and tooltip.
   */
  size?: "md" | "sm";
}

/**
 * Horizontally scrollable row of workspace avatars — tap one and it switches
 * immediately, no menu to open first. Modelled on Arc's Spaces bar (instant
 * circular switching) crossed with Airbnb's horizontally scrolling category
 * strip (label under the icon, current one picked out).
 */
export function WorkspaceStrip({
  workspaces,
  currentId,
  onSelect,
  className = "",
  size = "md",
}: WorkspaceStripProps) {
  const sm = size === "sm";
  const rowRef = useRef<HTMLDivElement>(null);
  useMouseScroll(rowRef);
  return (
    // Snapping is for a finger's swipe. Under a mouse wheel or drag it tugs the
    // row back to the nearest avatar mid-gesture, so it is touch-only.
    <div
      ref={rowRef}
      className={`flex select-none ${sm ? "gap-1" : "gap-3"} overflow-x-auto px-0.5 py-1.5 [scrollbar-width:none] coarse:snap-x [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {workspaces.map((ws) => {
        const isCurrent = ws.id === currentId;
        return (
          <button
            key={ws.id}
            type="button"
            onClick={() => onSelect(ws.id)}
            title={ws.name}
            aria-label={ws.name}
            aria-current={isCurrent ? "page" : undefined}
            // Scaling from the bottom edge keeps the top of the avatar fixed on
            // hover, so it never grows up into whatever sits just above the row.
            className={`flex shrink-0 origin-bottom snap-start flex-col items-center gap-1.5 rounded-lg px-0.5 transition-transform duration-150 ease-out hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ${
              sm ? "coarse:p-2" : ""
            }`}
          >
            {/* ring-inset instead of an offset ring: every avatar keeps the
                same h-11 footprint whether or not it's active, so the strip
                stays uniform instead of the current one looking larger. */}
            <span
              className={`flex items-center justify-center rounded-full bg-muted font-semibold uppercase transition-colors ${
                sm ? "h-7 w-7 text-2xs" : "h-11 w-11 text-sm"
              } ${
                isCurrent
                  ? "text-foreground ring-2 ring-inset ring-primary/60"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {initials(ws.name)}
            </span>
            <span
              className={
                sm
                  ? "sr-only"
                  : `max-w-14 truncate text-2xs ${
                      isCurrent ? "font-medium text-foreground" : "text-muted-foreground"
                    }`
              }
            >
              {ws.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// How far the pointer travels before a press on an avatar becomes a drag.
const DRAG_SLOP = 5;

/**
 * Lets a mouse scroll a sideways row that has no scrollbar. A trackpad or a
 * finger can already swipe it, but a mouse wheel only turns vertically and
 * there is nothing to grab, so the row just looked cut off. Here the wheel is
 * turned sideways and the row can be dragged like a touch list. A drag
 * swallows the click that ends it, so letting go over an avatar doesn't
 * switch workspace.
 */
function useMouseScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const row = ref.current;
    if (!row) return;
    const overflow = () => row.scrollWidth - row.clientWidth;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return; // pinch-zoom
      const { dx, dy } = wheelPixels(event);
      // A sideways gesture (trackpad, Shift+wheel) already scrolls natively.
      if (Math.abs(dx) >= Math.abs(dy) || overflow() <= 0) return;
      // At either end, let the wheel through to whatever scrolls around the row.
      if (dy < 0 ? row.scrollLeft <= 0 : row.scrollLeft >= overflow() - 1) return;
      event.preventDefault();
      row.scrollLeft += dy;
    };

    let drag: { x: number; left: number; pointer: number; moved: boolean } | null = null,
      swallowClick = false;
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || overflow() <= 0) return;
      drag = { x: event.clientX, left: row.scrollLeft, pointer: event.pointerId, moved: false };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      const dx = event.clientX - drag.x;
      if (!drag.moved) {
        if (Math.abs(dx) < DRAG_SLOP) return;
        drag.moved = true;
        row.setPointerCapture(event.pointerId);
        row.style.cursor = "grabbing";
      }
      row.scrollLeft = drag.left - dx;
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      if (drag.moved) {
        row.style.cursor = "";
        // The click (if any) follows in this same task; clear the flag after it
        // so a drag released outside the row can't eat the next real click.
        swallowClick = true;
        setTimeout(() => (swallowClick = false));
      }
      drag = null;
    };
    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    row.addEventListener("wheel", onWheel, { passive: false });
    row.addEventListener("pointerdown", onPointerDown);
    row.addEventListener("pointermove", onPointerMove);
    row.addEventListener("pointerup", onPointerEnd);
    row.addEventListener("pointercancel", onPointerEnd);
    row.addEventListener("click", onClick, true);
    return () => {
      row.removeEventListener("wheel", onWheel);
      row.removeEventListener("pointerdown", onPointerDown);
      row.removeEventListener("pointermove", onPointerMove);
      row.removeEventListener("pointerup", onPointerEnd);
      row.removeEventListener("pointercancel", onPointerEnd);
      row.removeEventListener("click", onClick, true);
    };
  }, [ref]);
}

/**
 * Monogram for the workspace avatar: the first letter of each of the first two
 * words, so "My workspace" reads as MW and a single-word name keeps one letter.
 */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("");
}
