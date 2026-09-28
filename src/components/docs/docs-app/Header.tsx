import { Menu, Search, Settings } from "lucide-react";

import { WorkspaceMenu } from "../workspace/WorkspaceMenu";
import { WorkspaceSheet } from "../workspace/WorkspaceSheet";

/** The app's top chrome bar: home, search, workspace switcher, settings. */
export function Header({
  onMenu,
  hideMenu,
  hideOnDesktop,
  onOpenPalette,
  hasFiles,
  sidebarCollapsed,
  onToggleSidebar,
  onHome,
  workspaces = [],
  currentWorkspaceId,
  onSwitchWorkspace,
  onOpenSettings,
  saveIndicator,
}: {
  onMenu: (() => void) | null;
  hideMenu?: boolean;
  hideOnDesktop?: boolean;
  onOpenPalette: () => void;
  hasFiles: boolean;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onHome?: () => void;
  workspaces?: { id: string; name: string }[];
  currentWorkspaceId?: string | null;
  onSwitchWorkspace?: (id: string) => void;
  onOpenSettings?: (tab?: "workspace") => void;
  /** The workspace's save state; the header is the only chrome on small screens. */
  saveIndicator?: React.ReactNode;
}) {
  return (
    <header
      className={`app-surface z-(--z-nav) flex h-16 items-center justify-between border-b border-border px-4 md:px-6 relative pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] ${
        hideOnDesktop ? "lg:hidden" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        {!hideMenu && (
          <button
            onClick={() => onMenu?.()}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md transition-transform hover:bg-accent active:scale-90 coarse:h-11 coarse:w-11 lg:hidden"
            aria-label="Menu"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className={`hidden h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-90 ${sidebarCollapsed ? "lg:hidden" : "lg:inline-flex"}`}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Menu className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={onHome}
          className="flex h-10 items-center gap-2 rounded-md px-2 text-muted-foreground transition-colors hover:text-foreground coarse:h-11"
          aria-label="Home"
          title="Home"
        >
          <span className="text-sm font-semibold tracking-tight text-foreground">Localdox</span>
        </button>
      </div>

      {hasFiles && (
        <div className="absolute left-1/2 -translate-x-1/2 hidden lg:flex items-center">
          <button
            onClick={onOpenPalette}
            className="w-80 items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground flex"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search...</span>
            <span className="ml-auto flex items-center gap-1">
              <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-xs">
                ⌘
              </kbd>
              <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-xs">
                K
              </kbd>
            </span>
          </button>
        </div>
      )}

      <div className="flex items-center gap-3">
        {saveIndicator}
        {hasFiles && (
          <button
            onClick={onOpenPalette}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground coarse:h-11 coarse:w-11 lg:hidden"
            aria-label="Search"
          >
            <Search className="h-4 w-4" />
          </button>
        )}

        {/* Workspace control lives in the header to the right of the search
            icon: the avatar strip on desktop/landscape, the same strip inside
            a bottom sheet on mobile/portrait. */}
        {onSwitchWorkspace && (
          <>
            <div className="hidden items-center gap-2 lg:flex">
              <WorkspaceMenu
                workspaces={workspaces}
                currentId={currentWorkspaceId ?? null}
                onSwitch={onSwitchWorkspace}
              />
            </div>
            <div className="flex items-center gap-2 lg:hidden">
              <WorkspaceSheet
                workspaces={workspaces}
                currentId={currentWorkspaceId ?? null}
                onSwitch={onSwitchWorkspace}
              />
            </div>
          </>
        )}
        {onOpenSettings && (
          <button
            onClick={() => onOpenSettings()}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground coarse:h-11 coarse:w-11"
            aria-label="Settings"
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        )}
      </div>
    </header>
  );
}
