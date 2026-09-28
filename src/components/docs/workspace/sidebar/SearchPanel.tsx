import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Globe, Loader2, Search, X } from "lucide-react";
import type { SearchHit } from "@/lib/search/schema";

export interface SearchPanelState {
  query: string;
  onQueryChange: (query: string) => void;
  crossWorkspace: boolean;
  onCrossWorkspaceChange: (value: boolean) => void;
  hits: SearchHit[];
  /** Every match, which can exceed `hits` when results were capped. */
  total: number;
  pending: boolean;
  loadingWorkspaces: string[];
  /** The current workspace hasn't been indexed yet, so "no results" would
   *  be premature. */
  indexing: boolean;
  error: "search" | "index" | null;
  onRetry: () => void;
  onSelectHit: (hit: SearchHit) => void;
  workspaceName: (id: string) => string;
  onClose: () => void;
}

interface FileGroup {
  fileId: string;
  fileName: string;
  workspaceId: string;
  hits: SearchHit[];
}

interface WorkspaceGroup {
  workspaceId: string;
  files: FileGroup[];
}

/** Hits arrive already ordered — workspaces as searched, best files first,
 *  each file's hits in document order — so grouping keeps that order. */
function groupHits(hits: SearchHit[], crossWorkspace: boolean): WorkspaceGroup[] {
  const byWorkspace = new Map<string, Map<string, FileGroup>>();
  for (const hit of hits) {
    const workspaceKey = crossWorkspace ? hit.workspaceId : "";
    let files = byWorkspace.get(workspaceKey);
    if (!files) {
      files = new Map();
      byWorkspace.set(workspaceKey, files);
    }
    let group = files.get(hit.fileId);
    if (!group) {
      group = {
        fileId: hit.fileId,
        fileName: hit.fileName,
        workspaceId: hit.workspaceId,
        hits: [],
      };
      files.set(hit.fileId, group);
    }
    group.hits.push(hit);
  }
  return [...byWorkspace].map(([workspaceId, files]) => ({
    workspaceId,
    files: [...files.values()],
  }));
}

/** Marks this hit's own occurrence — not merely the first one in the
 *  snippet, which for a line with the word twice is a different hit. */
function highlight(hit: SearchHit) {
  const { snippet, matchStart: at, matchLength: length } = hit;
  return (
    <>
      {snippet.slice(0, at)}
      <mark className="rounded bg-primary/20 px-0.5 text-foreground">
        {snippet.slice(at, at + length)}
      </mark>
      {snippet.slice(at + length)}
    </>
  );
}

function FileResultGroup({
  group,
  onSelectHit,
}: {
  group: FileGroup;
  onSelectHit: (hit: SearchHit) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="mb-1">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-left text-xs font-medium text-foreground hover:bg-accent"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${collapsed ? "" : "rotate-90"}`}
        />
        <span className="min-w-0 flex-1 truncate">{group.fileName}</span>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {group.hits.length}
        </span>
      </button>
      {!collapsed && (
        <div className="ml-4 border-l border-border pl-2">
          {group.hits.map((hit, i) => (
            <button
              key={`${group.fileId}-${hit.lineIndex}-${i}`}
              onClick={() => onSelectHit(hit)}
              className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              title={hit.line || hit.fileName}
            >
              {highlight(hit)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SearchPanel({
  query,
  onQueryChange,
  crossWorkspace,
  onCrossWorkspaceChange,
  hits,
  total,
  pending,
  loadingWorkspaces,
  indexing,
  error,
  onRetry,
  onSelectHit,
  workspaceName,
  onClose,
}: SearchPanelState) {
  const groups = useMemo(() => groupHits(hits, crossWorkspace), [hits, crossWorkspace]);
  const totalMatches = hits.length;
  const fileCount = useMemo(
    () => new Set(hits.map((hit) => `${hit.workspaceId}\u0000${hit.fileId}`)).size,
    [hits],
  );

  // Every dismissable surface in this app owns its own Escape handler (see
  // SettingsPage, the old CommandPalette, the sidebar's own menus) rather than
  // routing the key through the nav-history escape stack, which is reserved
  // for the browser back gesture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 px-3 pb-1 pt-3">
        <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Search
        </span>
        <button
          onClick={onClose}
          aria-label="Close search"
          title="Close search"
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            name="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search all documents..."
            autoFocus
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <label className="mt-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            name="cross-workspace"
            checked={crossWorkspace}
            onChange={(e) => onCrossWorkspaceChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-primary"
          />
          <Globe className="h-3.5 w-3.5" />
          <span>Search all workspaces</span>
        </label>
        {loadingWorkspaces.length > 0 && (
          <div className="mt-1 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>
              Indexing {loadingWorkspaces.length} other workspace
              {loadingWorkspaces.length > 1 ? "s" : ""}…
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {pending && (
          <div role="status" className="py-6 text-center text-sm text-muted-foreground">
            Searching…
          </div>
        )}
        {!pending && error && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
          >
            <p className="text-foreground">
              {error === "search"
                ? "Search couldn’t run."
                : "Some documents couldn’t be indexed, so results may be incomplete."}
            </p>
            <button
              onClick={onRetry}
              className="coarse:min-h-11 mt-1 rounded-md text-sm font-medium text-primary hover:underline"
            >
              Try again
            </button>
          </div>
        )}
        {!pending && error !== "search" && query.trim() && totalMatches === 0 && indexing && (
          <div role="status" className="py-12 text-center text-sm text-muted-foreground">
            Indexing documents…
          </div>
        )}
        {!pending && error !== "search" && query.trim() && totalMatches === 0 && !indexing && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No results for "{query}"
          </div>
        )}
        {!pending &&
          groups.map((workspaceGroup) => (
            <div key={workspaceGroup.workspaceId || "current"} className="mb-2">
              {crossWorkspace && (
                <div className="px-1 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {workspaceName(workspaceGroup.workspaceId)}
                </div>
              )}
              {workspaceGroup.files.map((group) => (
                <FileResultGroup key={group.fileId} group={group} onSelectHit={onSelectHit} />
              ))}
            </div>
          ))}
      </div>

      {totalMatches > 0 && (
        <div className="border-t border-sidebar-border px-3 py-2 text-xs text-muted-foreground">
          {total > totalMatches
            ? `Showing the first ${totalMatches.toLocaleString()} of ${total.toLocaleString()} results — refine the search to see the rest`
            : `${total.toLocaleString()} result${total > 1 ? "s" : ""} in ${fileCount} file${fileCount > 1 ? "s" : ""}`}
        </div>
      )}
    </div>
  );
}
