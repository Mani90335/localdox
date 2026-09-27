import { memo, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

/** A container node's path, joined with "/" — the identity used by the open set. */
type Path = string;

/** How deep the tree is expanded when a document first opens. */
const DEFAULT_OPEN_DEPTH = 1;

/**
 * Guard against pathological documents: a file with tens of thousands of nodes
 * would mount that many rows at once. Everything past the cap stays collapsed
 * under its parent, which the reader can still open branch by branch.
 */
const MAX_ROWS = 4000;

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === "object";
}

function entriesOf(value: Record<string, unknown> | unknown[]): [string, unknown][] {
  return Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as [string, unknown])
    : Object.entries(value);
}

/** `{3}` / `[12]` — the summary shown on a collapsed branch. */
function summarize(value: Record<string, unknown> | unknown[]): string {
  const count = Array.isArray(value) ? value.length : Object.keys(value).length;
  return Array.isArray(value) ? `[${count}]` : `{${count}}`;
}

/**
 * Every container path in the document, so "Expand all" doesn't have to walk the
 * tree again and the initial open set can be built by depth.
 */
function collectPaths(value: unknown, path: Path, depth: number, out: Map<Path, number>) {
  if (!isContainer(value)) return;
  out.set(path, depth);
  for (const [key, child] of entriesOf(value)) {
    collectPaths(child, `${path}/${key}`, depth + 1, out);
  }
}

function ValueText({ value }: { value: unknown }) {
  if (typeof value === "string")
    return <span style={{ color: "var(--code-string)" }}>&quot;{value}&quot;</span>;
  if (typeof value === "number") return <span style={{ color: "var(--code-number)" }}>{String(value)}</span>;
  if (typeof value === "boolean") return <span className="text-purple-300">{String(value)}</span>;
  if (value === null) return <span style={{ color: "var(--code-punct)" }}>null</span>;
  return <span className="text-foreground">{String(value)}</span>;
}

function Row({
  label,
  value,
  path,
  depth,
  open,
  onToggle,
  query,
  budget,
}: {
  label: string | null;
  value: unknown;
  path: Path;
  depth: number;
  open: Set<Path>;
  onToggle: (path: Path) => void;
  query: string;
  /** Shared, mutable row allowance — see MAX_ROWS. */
  budget: { left: number };
}) {
  const container = isContainer(value);
  const expanded = container && open.has(path);
  const text = `${label ?? ""} ${container ? "" : String(value)}`.toLowerCase();
  const hit = query.length > 0 && text.includes(query);

  const children = expanded ? entriesOf(value as Record<string, unknown>) : [];
  budget.left -= children.length;
  const truncated = budget.left < 0;

  return (
    <div>
      <div
        className={`flex items-start rounded ${hit ? "bg-primary/15" : ""}`}
        style={{ paddingLeft: depth * 14 }}
      >
        {container ? (
          <button
            type="button"
            onClick={() => onToggle(path)}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${label ?? "root"}` : `Expand ${label ?? "root"}`}
            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1 break-words pl-1">
          {label !== null && <span style={{ color: "var(--code-key)" }}>{label}</span>}
          {label !== null && <span style={{ color: "var(--code-punct)" }}>: </span>}
          {container ? (
            <span
              className="cursor-pointer" style={{ color: "var(--code-punct)" }}
              onClick={() => onToggle(path)}
              role="presentation"
            >
              {summarize(value as Record<string, unknown>)}
            </span>
          ) : (
            <ValueText value={value} />
          )}
        </div>
      </div>
      {expanded && !truncated
        ? children.map(([key, child]) => (
            <Row
              key={key}
              label={key}
              value={child}
              path={`${path}/${key}`}
              depth={depth + 1}
              open={open}
              onToggle={onToggle}
              query={query}
              budget={budget}
            />
          ))
        : null}
      {expanded && truncated ? (
        <div className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: (depth + 1) * 14 }}>
          Too many nodes to draw here — collapse another branch to see these.
        </div>
      ) : null}
    </div>
  );
}

/**
 * Collapsible tree over parsed JSON. The parsed value is owned by the caller so
 * that switching between this and the raw editor doesn't re-parse the document.
 */
function JsonTreeImpl({ value, query = "" }: { value: unknown; query?: string }) {
  const paths = useMemo(() => {
    const map = new Map<Path, number>();
    collectPaths(value, "", 0, map);
    return map;
  }, [value]);

  const [open, setOpen] = useState<Set<Path>>(() => {
    const initial = new Set<Path>();
    for (const [path, depth] of paths) if (depth <= DEFAULT_OPEN_DEPTH) initial.add(path);
    return initial;
  });

  const toggle = (path: Path) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const allOpen = open.size === paths.size;

  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-surface-sunken shadow-(--shadow-1)">
      {/* Inside the panel rather than floating above it: these act on the tree
          below, and as a separate row they read as page-level chrome. */}
      <div className="flex items-center justify-end gap-1 border-b border-hairline px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen(new Set(paths.keys()))}
          disabled={allOpen}
          className="rounded px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={() => setOpen(new Set())}
          disabled={open.size === 0}
          className="rounded px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
        >
          Collapse all
        </button>
      </div>
      <div className="overflow-x-auto p-4 font-mono text-sm leading-6 text-foreground">
        <Row
          label={null}
          value={value}
          path=""
          depth={0}
          open={open}
          onToggle={toggle}
          query={query.toLowerCase()}
          budget={{ left: MAX_ROWS }}
        />
      </div>
    </div>
  );
}

export const JsonTree = memo(JsonTreeImpl);
