import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { useDocumentSearch } from "@/hooks/use-document-search";
import type { SearchHit as Hit } from "@/lib/search/document-search";
import { FileText, Hash, Search, Clock, X } from "lucide-react";
import type { MdFile } from "@/lib/markdown/markdown-utils";

interface Props {
  files: MdFile[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (fileId: string, headingId?: string, query?: string, matchedLine?: string) => void;
}

const RECENT_KEY = "docs-recent-searches";

export function CommandPalette({ files, open, onOpenChange, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    try {
      const r = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      if (Array.isArray(r)) setRecent(r);
    } catch {
      /* Recent searches are optional when browser storage is unavailable. */
    }
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const { hits: results, pending } = useDocumentSearch(files, query, open);

  const grouped = useMemo(() => {
    const g = new Map<string, Hit[]>();
    for (const h of results) {
      if (!g.has(h.fileId)) g.set(h.fileId, []);
      g.get(h.fileId)!.push(h);
    }
    return Array.from(g.entries());
  }, [results]);

  const commit = (hit: Hit) => {
    const q = query.trim();
    if (q) {
      const next = [q, ...recent.filter((r) => r !== q)].slice(0, 6);
      setRecent(next);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* Keep search usable when browser storage is unavailable. */
      }
    }
    // The matched line travels with the jump so the viewer can land on the
    // passage itself rather than on the heading that happens to precede it.
    onSelect(hit.fileId, hit.headingId, q, hit.line);
    onOpenChange(false);
  };

  // Cmd/Ctrl+K lives in `DocsApp` — this component is code-split and only
  // mounted once the palette is open, so a shortcut owned here would not exist
  // until after the first time it was used. Escape stays local: it is only
  // meaningful while the palette is on screen.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  const highlight = (text: string) => {
    if (!query) return text;
    const q = query.trim();
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="rounded bg-primary/20 px-0.5 text-foreground">
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </>
    );
  };

  return (
    <div className="fixed inset-0 z-(--z-overlay) flex items-start justify-center px-4 pt-[10vh]">
      <div
        className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <Command
        label="Search docs"
        className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-popover shadow-2xl animate-in fade-in-0 zoom-in-95 duration-100"
        shouldFilter={false}
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search all documentation..."
            className="flex-1 bg-transparent py-4 text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
          />
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground sm:inline-block">
            ESC
          </kbd>
        </div>
        <Command.List aria-busy={pending} className="max-h-[60vh] overflow-y-auto p-2">
          {!query && recent.length > 0 && (
            <Command.Group heading="Recent searches" className="text-xs text-muted-foreground">
              {recent.map((r) => (
                <Command.Item
                  key={r}
                  value={`recent-${r}`}
                  onSelect={() => setQuery(r)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-accent"
                >
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1">{r}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = recent.filter((x) => x !== r);
                      setRecent(next);
                      try {
                        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
                      } catch {
                        /* The in-memory list still updates. */
                      }
                    }}
                  >
                    <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </button>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {pending && (
            <div role="status" className="py-6 text-center text-sm text-muted-foreground">
              Searching…
            </div>
          )}
          {query && !pending && results.length === 0 && (
            <Command.Empty className="py-12 text-center text-sm text-muted-foreground">
              No results for "{query}"
            </Command.Empty>
          )}
          {grouped.map(([fileId, hits]) => (
            <Command.Group
              key={fileId}
              heading={hits[0].fileName}
              className="**:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:pt-3 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-wider **:[[cmdk-group-heading]]:text-muted-foreground"
            >
              {hits.map((h, i) => (
                <Command.Item
                  key={`${fileId}-${i}`}
                  value={`${fileId}-${i}-${h.snippet}`}
                  onSelect={() => commit(h)}
                  className="group flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent"
                >
                  {h.headingId ? (
                    <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    {h.headingText && (
                      <div className="truncate text-sm font-medium">{highlight(h.headingText)}</div>
                    )}
                    <div
                      className={`truncate text-xs ${h.headingText ? "text-muted-foreground" : "font-medium"}`}
                    >
                      {highlight(h.snippet)}
                    </div>
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
        <div className="flex items-center justify-between border-t border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="rounded border border-border bg-background px-1">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="rounded border border-border bg-background px-1">↵</kbd> open
            </span>
          </div>
          <span>{results.length} results</span>
        </div>
      </Command>
    </div>
  );
}
