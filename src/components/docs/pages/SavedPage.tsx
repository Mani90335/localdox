import { useMemo, useState } from "react";
import { Highlighter, Star, X } from "lucide-react";
import { HL_COLORS, type Highlight } from "@/lib/markdown/dom-highlighter";
import type { SavedEntry, SavedItem } from "@/lib/workspace/saved-items";

/**
 * Everything the reader has kept, as one continuous document.
 *
 * Not a list of saved things — a page you *read*. The passages run together as
 * prose in the same column the reader was in when they marked them, each one
 * still wearing its highlight colour, under a heading per source document. A
 * list of cards makes you scan; this makes you read, which is the point of
 * having kept the passages in the first place.
 *
 * Clicking any passage goes back to it in its own document.
 */
export function SavedPage({
  saved,
  highlights,
  fileName,
  onOpenSaved,
  onRemoveSaved,
  onOpenHighlight,
  onRemoveHighlight,
}: {
  saved: SavedEntry[];
  highlights: Highlight[];
  /** Resolve a highlight's file id to its name, for the section headings. */
  fileName: (fileId: string) => string | null;
  onOpenSaved: (item: SavedItem) => void;
  onRemoveSaved: (id: string) => void;
  onOpenHighlight: (hl: Highlight) => void;
  onRemoveHighlight: (id: string) => void;
}) {
  // Empty means "every colour", not "none": an untouched filter hides nothing.
  const [colors, setColors] = useState<Set<string>>(() => new Set());

  const usedColors = useMemo(() => {
    const seen = new Set<string>();
    for (const hl of highlights) seen.add(hl.color);
    // Palette order, so the swatches don't rearrange as more get marked.
    return HL_COLORS.filter((c) => seen.has(c));
  }, [highlights]);

  const visible = useMemo(
    () => highlights.filter((hl) => colors.size === 0 || colors.has(hl.color)),
    [highlights, colors],
  );

  /** One section per source document, in the order the passages were kept. */
  const sections = useMemo(() => {
    const byFile = new Map<
      string,
      { name: string; highlights: Highlight[]; saved: SavedEntry[] }
    >();
    const bucket = (fileId: string, name: string) => {
      let entry = byFile.get(fileId);
      if (!entry) {
        entry = { name, highlights: [], saved: [] };
        byFile.set(fileId, entry);
      }
      return entry;
    };
    for (const hl of visible) {
      const name = fileName(hl.fileId);
      if (name) bucket(hl.fileId, name).highlights.push(hl);
    }
    for (const item of saved) bucket(item.fileId, item.fileName).saved.push(item);
    return [...byFile.entries()].map(([fileId, entry]) => ({ fileId, ...entry }));
  }, [visible, saved, fileName]);

  const nothing = visible.length === 0 && saved.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-4xl gap-8 px-6 py-10 md:px-10 md:py-16">
      <article className="docs-prose mx-auto min-w-0 flex-1">
        <h1>Saved</h1>
        <p className="text-muted-foreground">
          Everything you have highlighted and starred, in one place. Click any passage to open it
          where it came from.
        </p>

        {/* Colour filter. Quiet, above the reading, and gone entirely when
            there is nothing marked in more than one colour. */}
        {usedColors.length > 1 && (
          <div className="not-prose my-6 flex flex-wrap items-center gap-2 border-y border-border py-3">
            <span className="text-xs text-muted-foreground">Colour</span>
            {usedColors.map((color) => {
              const on = colors.has(color);
              const count = highlights.filter((hl) => hl.color === color).length;
              return (
                <button
                  key={color}
                  onClick={() =>
                    setColors((previous) => {
                      const next = new Set(previous);
                      if (next.has(color)) next.delete(color);
                      else next.add(color);
                      return next;
                    })
                  }
                  aria-pressed={on}
                  title={`${count} highlight${count === 1 ? "" : "s"}`}
                  className={`flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors ${
                    on ? "border-primary/60 bg-accent" : "border-border hover:bg-accent/60"
                  }`}
                >
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                </button>
              );
            })}
            {colors.size > 0 && (
              <button
                onClick={() => setColors(new Set())}
                className="ml-1 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
        )}

        {nothing ? (
          <p className="not-prose flex items-center gap-2 py-16 text-sm text-muted-foreground">
            <Highlighter className="h-4 w-4 shrink-0" />
            {colors.size > 0
              ? "Nothing in this colour."
              : "Nothing saved yet. Highlight a passage while reading and it will appear here."}
          </p>
        ) : (
          sections.map((section) => (
            <section key={section.fileId}>
              <h2>{section.name.replace(/\.[^.]+$/, "")}</h2>

              {/* Starred sections read as a line of links under the heading —
                  they point at a place in the document rather than carrying
                  text of their own, so they are not prose to be read here. */}
              {section.saved.length > 0 && (
                <p className="not-prose mb-4 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {section.saved.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => onOpenSaved(item)}
                      onAuxClick={(e) => {
                        if (e.button === 1) onRemoveSaved(item.id);
                      }}
                      className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                      title="Open this section"
                    >
                      <Star className="h-3 w-3 shrink-0 fill-gold text-gold" aria-hidden />
                      {item.title}
                    </button>
                  ))}
                </p>
              )}

              {section.highlights.map((hl) => (
                <p key={hl.id}>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenHighlight(hl)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") onOpenHighlight(hl);
                    }}
                    onAuxClick={(e) => {
                      // Middle-click removes, so the reading surface needs no
                      // delete button sitting beside every passage.
                      if (e.button === 1) onRemoveHighlight(hl.id);
                    }}
                    className="cursor-pointer [box-decoration-break:clone]"
                    style={{ backgroundColor: hl.color, color: "#0a0a0a", padding: "1px 3px" }}
                    title="Open where this came from"
                  >
                    {hl.text}
                  </span>
                  {hl.label && (
                    <span className="ml-2 align-middle text-sm text-muted-foreground">
                      — {hl.label}
                    </span>
                  )}
                </p>
              ))}
            </section>
          ))
        )}
      </article>
    </div>
  );
}
