import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { IconBtn } from "@/components/docs/viewer/viewer-controls";
import type { PdfReaderState } from "./use-pdf-reader-state";
import type { PdfSearchApi } from "./use-pdf-search";

/** Floats over the top of the page area when search is open. */
export function PdfSearchOverlay({
  reader,
  search,
}: {
  reader: PdfReaderState;
  search: PdfSearchApi;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const count = search.matches.length;
  const status = search.isSearching
    ? count
      ? `${search.activeIndex + 1} / ${count}+`
      : "Searching…"
    : count
      ? `${search.activeIndex + 1} / ${count}`
      : search.query.trim()
        ? "No results"
        : "";

  return (
    <div className="absolute inset-x-0 top-0 z-10 flex justify-center p-3">
      <div className="flex items-center gap-1 rounded-lg border border-border bg-background/95 p-1.5 shadow-lg backdrop-blur">
        <input
          ref={inputRef}
          type="text"
          value={search.query}
          onChange={(e) => search.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) search.prev();
              else search.next();
            } else if (e.key === "Escape") {
              reader.closeSearch();
            }
          }}
          placeholder="Search in document…"
          aria-label="Search in document"
          className="h-8 w-56 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none focus:border-border sm:w-72"
        />
        <span className="min-w-16 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
          {status}
        </span>
        <IconBtn label="Previous match" onClick={search.prev} disabled={!search.matches.length}>
          <ChevronUp className="h-4 w-4" />
        </IconBtn>
        <IconBtn label="Next match" onClick={search.next} disabled={!search.matches.length}>
          <ChevronDown className="h-4 w-4" />
        </IconBtn>
        <IconBtn label="Close search" onClick={reader.closeSearch}>
          <X className="h-4 w-4" />
        </IconBtn>
      </div>
    </div>
  );
}
