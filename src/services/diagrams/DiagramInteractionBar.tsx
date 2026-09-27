/**
 * Search, select-mode, and isolation controls for the Raw Mermaid stage.
 *
 * Split from `Mermaid.tsx` because this is a self-contained reader feature on
 * top of the stage, not part of its render pipeline. `DiagramTopBar` is
 * pinned (not hover-gated) because it is navigation and state feedback, the
 * same reasoning `Mermaid.tsx`'s own header uses for staying visible.
 * `SelectionActionTray` lives inside the stage's existing hover tray, next to
 * `ZoomControls`, since it only matters once the reader is mid-selection.
 */

import {
  ChevronDown,
  ChevronUp,
  EyeOff,
  Focus,
  MousePointerClick,
  RotateCcw,
  Search,
  Waypoints,
  X,
} from "lucide-react";
import { useState } from "react";
import { Tray, TrayButton } from "./Mermaid";
import type { DiagramInteractionApi } from "./interaction/types";

type Interaction = DiagramInteractionApi;

export function DiagramTopBar({ interaction }: { interaction: Interaction }) {
  const [searchOpen, setSearchOpen] = useState(false);
  if (!interaction.graphReady) return null;
  const { search, selectMode, setSelectMode, isolation, resetIsolation } = interaction;

  const closeSearch = () => {
    search.clear();
    setSearchOpen(false);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-2 p-3">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2">
        <Tray>
          {searchOpen ? (
            <div className="flex items-center gap-1 pl-2 pr-1">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={search.query}
                onChange={(event) => search.setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (event.shiftKey) search.prev();
                    else search.next();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    closeSearch();
                  }
                }}
                placeholder="Search diagram…"
                className="h-8 w-32 bg-transparent text-sm outline-none placeholder:text-muted-foreground sm:w-48"
              />
              {search.matchCount > 0 && (
                <span className="whitespace-nowrap px-1 text-[10px] tabular-nums text-muted-foreground">
                  {search.index + 1} / {search.matchCount}
                </span>
              )}
              <TrayButton onClick={search.prev} label="Previous match">
                <ChevronUp className="h-3.5 w-3.5" />
              </TrayButton>
              <TrayButton onClick={search.next} label="Next match">
                <ChevronDown className="h-3.5 w-3.5" />
              </TrayButton>
              <TrayButton onClick={closeSearch} label="Close search">
                <X className="h-3.5 w-3.5" />
              </TrayButton>
            </div>
          ) : (
            <TrayButton onClick={() => setSearchOpen(true)} label="Search diagram">
              <Search className="h-3.5 w-3.5" />
            </TrayButton>
          )}
        </Tray>
        <Tray>
          <TrayButton
            onClick={() => setSelectMode(!selectMode)}
            label="Select nodes"
            active={selectMode}
            title={selectMode ? "Selecting — click nodes to add or remove them" : "Select nodes"}
          >
            <MousePointerClick className="h-3.5 w-3.5" />
          </TrayButton>
        </Tray>
      </div>
      {isolation && (
        <div className="pointer-events-auto">
          <Tray>
            <span className="whitespace-nowrap px-3 text-[11px] font-medium text-muted-foreground">
              Showing {isolation.count} of {isolation.total} nodes
            </span>
            <TrayButton
              onClick={resetIsolation}
              label="Reset to full diagram"
              title="Show every node again"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </TrayButton>
          </Tray>
        </div>
      )}
    </div>
  );
}

export function SelectionActionTray({ interaction }: { interaction: Interaction }) {
  if (!interaction.selectMode || interaction.selectedIds.size === 0) return null;
  return (
    <Tray>
      <TrayButton
        onClick={interaction.isolateConnected}
        label="Isolate connected nodes"
        title="Show the selected node(s) plus everything directly connected to them"
      >
        <Waypoints className="h-3.5 w-3.5" />
      </TrayButton>
      <TrayButton
        onClick={interaction.isolateSelected}
        label="Isolate selected nodes"
        title="Show only the selected nodes"
      >
        <Focus className="h-3.5 w-3.5" />
      </TrayButton>
      <TrayButton
        onClick={interaction.removeSelected}
        label="Remove selected nodes"
        title="Hide the selected nodes, keep the rest"
      >
        <EyeOff className="h-3.5 w-3.5" />
      </TrayButton>
      <TrayButton
        onClick={() => interaction.setSelectMode(false)}
        label="Clear selection"
        title="Clear the current selection"
      >
        <X className="h-3.5 w-3.5" />
      </TrayButton>
    </Tray>
  );
}
