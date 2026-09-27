import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, FolderOpen } from "lucide-react";
import { WorkspaceStrip, initials } from "./WorkspaceStrip";

interface WorkspaceLite {
  id: string;
  name: string;
}

interface Props {
  workspaces: WorkspaceLite[];
  currentId: string | null;
  onSwitch: (id: string) => void;
  /**
   * "pill" = compact header trigger; "icon" = the monogram alone, for the
   * collapsed rail where there is no room for a label but the switcher still
   * has to be reachable. The expanded sidebar doesn't use this component — its
   * strip is always visible, never behind a click, so it renders WorkspaceStrip
   * directly.
   */
  variant?: "pill" | "icon";
}

export function WorkspaceMenu({ workspaces, currentId, onSwitch, variant = "pill" }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const icon = variant === "icon";

  // The menu is portaled to <body> so it escapes every header/content stacking
  // context and can never be painted under a document panel. Because it lives
  // outside the normal flow, we position it manually from the trigger's rect
  // and keep it pinned as the page scrolls or resizes.
  const MENU_MAX_W = 320;
  const GAP = 6;
  const EDGE = 8;
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();

      // Never wider than the viewport allows. A fixed 320 overflowed the right
      // edge on narrow screens.
      const width = Math.min(MENU_MAX_W, window.innerWidth - EDGE * 2);
      const desired = icon ? r.left : r.right - width; // rail left-aligns, pill right-aligns
      const left = Math.min(Math.max(EDGE, desired), window.innerWidth - width - EDGE);

      // A single row of avatars is a fixed, small height, so — unlike a list
      // that could grow without bound — the only real question is which side
      // of the trigger has room for it at all.
      const PANEL_H = 96;
      const above = r.top - GAP - EDGE;
      const below = window.innerHeight - r.bottom - GAP - EDGE;
      const useAbove = icon ? above >= PANEL_H || above >= below : below < PANEL_H && above > below;

      if (useAbove) {
        setPos({ bottom: window.innerHeight - r.top + GAP, left, width });
      } else {
        setPos({ top: r.bottom + GAP, left, width });
      }
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    // Mobile browsers resize the visual viewport (URL bar, keyboard) without
    // firing a window resize, which left the menu detached from its trigger.
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open, icon]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = workspaces.find((w) => w.id === currentId);

  return (
    <div ref={rootRef} className="relative">
      {icon ? (
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Workspaces"
          title={current?.name ?? "Workspace"}
        >
          {initials(current?.name ?? "Localdox")}
        </button>
      ) : (
        <button
          onClick={() => setOpen((o) => !o)}
          className="inline-flex h-8 max-w-xs items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Workspaces"
        >
          <FolderOpen className="h-4 w-4 shrink-0" />
          <span className="truncate">{current?.name ?? "Workspace"}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </button>
      )}

      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width }}
            className="z-(--z-dropdown) rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-2xl"
          >
            <WorkspaceStrip
              workspaces={workspaces}
              currentId={currentId}
              onSelect={(id) => {
                onSwitch(id);
                setOpen(false);
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
