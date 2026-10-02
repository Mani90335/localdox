import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, X } from "lucide-react";
import { usePortalContainer } from "@/hooks/use-portal-container";
import { NODE_COLORS } from "./diagram-node-colors";

/**
 * The colour picker for one diagram node.
 *
 * Colour only. The reader clicked a box because its colour is wrong — that is
 * the whole errand — so this offers the palette, a way back to the automatic
 * colour, and nothing else. Renaming, restyling and re-shaping a node all
 * belong to the diagram source, where they can be reviewed and committed.
 *
 * Portaled and positioned against the node's own screen rectangle, because a
 * diagram may be inside a scrolling, zoomed stage whose overflow would clip an
 * absolutely positioned child.
 */
export function DiagramNodeColorPopover({
  anchor,
  current,
  label,
  onPick,
  onClose,
}: {
  /** The node's on-screen rectangle, in viewport coordinates. */
  anchor: DOMRect;
  /** The colour already applied to this node, if the reader set one. */
  current: string | null;
  /** The node's own text, so the reader can confirm what they clicked. */
  label: string;
  onPick: (color: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Inside the diagram when it is in full screen, where <body> is not painted.
  const container = usePortalContainer();
  const [position, setPosition] = useState({ top: 0, left: 0 });

  // Measured before paint: placing it from an effect would show one frame at
  // the wrong corner of the screen first.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const gap = 8;
    // Below the node by default, flipped above when that would run off screen.
    const below = anchor.bottom + gap;
    const top =
      below + height > window.innerHeight ? Math.max(gap, anchor.top - height - gap) : below;
    const left = Math.min(
      Math.max(gap, anchor.left + anchor.width / 2 - width / 2),
      window.innerWidth - width - gap,
    );
    setPosition({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <>
      {/* Catches the click that dismisses the picker. Transparent rather than
          dimmed: this is a small correction to one box, not a mode the reader
          needs the rest of the page pulled back for. */}
      <div className="fixed inset-0 z-(--z-menu)" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-label={`Colour for ${label || "node"}`}
        style={{ top: position.top, left: position.left }}
        className="fixed z-(--z-menu) w-max rounded-lg border border-border bg-popover p-2 shadow-lg"
      >
        <div className="mb-2 flex items-center gap-2 px-0.5">
          <span className="max-w-40 truncate text-xs font-medium text-foreground">
            {label || "Node"}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {NODE_COLORS.map((color) => (
            <button
              key={color}
              aria-label={`Colour ${color}`}
              aria-pressed={current === color}
              onClick={() => onPick(color)}
              className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
                current === color
                  ? "ring-2 ring-foreground ring-offset-1 ring-offset-popover"
                  : "border border-border/60"
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>

        {/* Only worth showing once there is something to undo. */}
        {current && (
          <button
            onClick={() => onPick(null)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> Automatic colour
          </button>
        )}
      </div>
    </>,
    container ?? document.body,
  );
}
