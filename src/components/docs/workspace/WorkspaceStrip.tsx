interface WorkspaceLite {
  id: string;
  name: string;
}

interface WorkspaceStripProps {
  workspaces: WorkspaceLite[];
  currentId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}

/**
 * Horizontally scrollable row of workspace avatars — tap one and it switches
 * immediately, no menu to open first. Modelled on Arc's Spaces bar (instant
 * circular switching) crossed with Airbnb's horizontally scrolling category
 * strip (label under the icon, current one picked out).
 */
export function WorkspaceStrip({ workspaces, currentId, onSelect, className = "" }: WorkspaceStripProps) {
  return (
    <div
      className={`flex snap-x gap-3 overflow-x-auto px-0.5 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {workspaces.map((ws) => {
        const isCurrent = ws.id === currentId;
        return (
          <button
            key={ws.id}
            type="button"
            onClick={() => onSelect(ws.id)}
            title={ws.name}
            // Scaling from the bottom edge keeps the top of the avatar fixed on
            // hover, so it never grows up into whatever sits just above the row.
            className="flex shrink-0 origin-bottom snap-start flex-col items-center gap-1.5 rounded-lg px-0.5 transition-transform duration-150 ease-out hover:scale-105 active:scale-95"
          >
            {/* ring-inset instead of an offset ring: every avatar keeps the
                same h-11 footprint whether or not it's active, so the strip
                stays uniform instead of the current one looking larger. */}
            <span
              className={`flex h-11 w-11 items-center justify-center rounded-full bg-muted text-sm font-semibold uppercase transition-colors ${
                isCurrent
                  ? "text-foreground ring-2 ring-inset ring-primary/60"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {initials(ws.name)}
            </span>
            <span
              className={`max-w-14 truncate text-2xs ${
                isCurrent ? "font-medium text-foreground" : "text-muted-foreground"
              }`}
            >
              {ws.name}
            </span>
          </button>
        );
      })}
    </div>
  );
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
