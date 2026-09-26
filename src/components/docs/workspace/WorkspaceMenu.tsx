import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, PlusCircle, Check, FolderOpen, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface WorkspaceLite {
  id: string;
  name: string;
}

interface Props {
  workspaces: WorkspaceLite[];
  currentId: string | null;
  onNew: (name: string) => void;
  onDelete: (id: string) => void;
  /**
   * "pill" = compact header trigger; "sidebar" = full-width name;
   * "icon" = the monogram alone, for the collapsed rail where there is no room
   * for a label but the same menu still has to be reachable.
   */
  variant?: "pill" | "sidebar" | "icon";
  /** Callback to open settings (typically rendered in sidebar). An optional tab
   *  id lands the dialog straight on that section. */
  onSettings?: (tab?: "workspace") => void;
}

export function WorkspaceMenu({
  workspaces,
  currentId,
  onNew,
  onDelete,
  onSettings,
  variant = "pill",
}: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const sidebar = variant === "sidebar";
  const icon = variant === "icon";
  // Both rail variants anchor the same way: the trigger sits at the bottom of a
  // left-hand rail, so the menu opens upward and left-aligned.
  const leftAnchored = sidebar || icon;

  // The menu is portaled to <body> so it escapes every header/content stacking
  // context and can never be painted under a document panel. Because it lives
  // outside the normal flow, we position it manually from the trigger's rect
  // and keep it pinned as the page scrolls or resizes.
  const MENU_MAX_W = 280;
  const GAP = 6;
  const EDGE = 8;
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();

      // Never wider than the viewport allows. A fixed 280 overflowed the right
      // edge on narrow screens, which is what made the sidebar menu look broken
      // on small windows and phones.
      //
      // In the expanded sidebar the panel is also held clear of the rail's own
      // right edge: matched to the trigger's width it ended up exactly flush
      // with the sidebar border, so the two lines merged into one. The trigger
      // spans the rail, so its width is the rail's usable width.
      const width = Math.min(
        MENU_MAX_W,
        window.innerWidth - EDGE * 2,
        sidebar ? Math.max(200, r.width - EDGE) : Infinity,
      );
      const desired = leftAnchored ? r.left : r.right - width; // rail left-aligns, pill right-aligns
      const left = Math.min(Math.max(EDGE, desired), window.innerWidth - width - EDGE);

      // Space on each side of the trigger, and the side we would rather use:
      // upwards in the sidebar (its trigger sits at the bottom of the rail),
      // downwards for the header pill.
      const above = r.top - GAP - EDGE;
      const below = window.innerHeight - r.bottom - GAP - EDGE;
      const MIN_H = 180;

      // Flip to the other side when the preferred one cannot show a usable
      // menu. Clamping the height alone was not enough: a short window still
      // anchored the sidebar menu upwards from a trigger near the bottom, which
      // put the whole panel above the top edge of the screen.
      const preferAbove = leftAnchored;
      const useAbove = preferAbove
        ? above >= MIN_H || above >= below
        : !(below >= MIN_H || below >= above);

      if (useAbove) {
        setPos({
          bottom: window.innerHeight - r.top + GAP,
          left,
          width,
          maxHeight: Math.max(120, above),
        });
      } else {
        setPos({
          top: r.bottom + GAP,
          left,
          width,
          maxHeight: Math.max(120, below),
        });
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
  }, [open, leftAnchored, sidebar]);

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

  // Reset the inline create field whenever the menu closes.
  useEffect(() => {
    if (!open) {
      setCreating(false);
      setNewName("");
    }
  }, [open]);

  const current = workspaces.find((w) => w.id === currentId);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onNew(name);
    setCreating(false);
    setNewName("");
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative ${sidebar ? "min-w-0 flex-1 z-(--z-dropdown)" : ""}`}>
      {sidebar ? (
        // The account-row shape from the reference: a round monogram, the
        // workspace name with a quiet second line, and the whole row as the
        // trigger.
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-sidebar-accent"
          title="Workspaces"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase text-muted-foreground">
            {initials(current?.name ?? "Localdox")}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-sidebar-foreground">
              {current?.name ?? "Localdox"}
            </span>
            <span className="block truncate text-xs text-muted-foreground">Workspace</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground opacity-70" />
        </button>
      ) : icon ? (
        // Collapsed rail: the monogram alone, opening the same menu the
        // expanded sidebar's row does.
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
            style={{
              position: "fixed",
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
            className="z-(--z-dropdown) flex flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
          >
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {/* Header: the workspace you are in, echoing the trigger. */}
              {current && (
                <div className="flex items-center gap-3 px-2 py-2">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase text-muted-foreground">
                    {initials(current.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {current.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">Workspace</span>
                  </span>
                  <Check className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              )}

              {/* Switching lives in Settings, not here. The menu listed every
                  workspace inline, which grew without bound and buried the
                  actions below it; one row into the workspace settings keeps
                  this menu a fixed height however many workspaces exist. */}
              {onSettings && (
                <>
                  <div className="my-1.5 h-px bg-border" />
                  <MenuRow
                    icon={FolderOpen}
                    label="All workspaces"
                    onClick={() => {
                      onSettings("workspace");
                      setOpen(false);
                    }}
                  />
                </>
              )}

              <div className="my-1.5 h-px bg-border" />

              {/* Import, export and share moved into workspace settings: they
                  are things you do once in a while to a workspace, and having
                  them here made a menu you open constantly three rows longer. */}
              <div className="flex flex-col">
                {!creating && (
                  <MenuRow
                    icon={PlusCircle}
                    label="New workspace"
                    onClick={() => {
                      setCreating(true);
                      setNewName("");
                    }}
                  />
                )}
                {onSettings && (
                  <MenuRow
                    icon={Settings}
                    label="Settings"
                    onClick={() => {
                      onSettings();
                      setOpen(false);
                    }}
                  />
                )}
              </div>
            </div>

            {creating && (
              <div className="border-t border-border p-2">
                <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Workspace name..."
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate();
                      if (e.key === "Escape") {
                        setCreating(false);
                        setNewName("");
                      }
                    }}
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <button
                    onClick={handleCreate}
                    disabled={!newName.trim()}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** One line of the menu: icon, label, full-width hit area. */
function MenuRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

/**
 * Monogram for the workspace avatar: the first letter of each of the first two
 * words, so "My workspace" reads as MW and a single-word name keeps one letter.
 */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("");
}
