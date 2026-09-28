/** CSS groups are document-wide; each viewer removes only its own ranges. */
type HighlightSet = Set<Range> & { priority: number };
type HighlightWindow = Window & { Highlight?: new () => HighlightSet };
const registry = () =>
  typeof CSS === "undefined"
    ? undefined
    : (CSS as unknown as { highlights?: Map<string, HighlightSet> }).highlights;

export function createHighlightPainter() {
  const css = registry();
  const Ctor =
    typeof window === "undefined" ? undefined : (window as unknown as HighlightWindow).Highlight;
  const owned = new Map<string, { group: HighlightSet; ranges: Range[] }>();
  const clear = () => {
    for (const [name, { group, ranges }] of owned) {
      for (const range of ranges) group.delete(range);
      if (!group.size && css?.get(name) === group) css.delete(name);
    }
    owned.clear();
  };
  return {
    supported: !!css && !!Ctor,
    clear,
    paint(groups: Record<string, Range[]>) {
      clear();
      if (!css || !Ctor) return;
      for (const [name, ranges] of Object.entries(groups)) {
        if (!ranges.length) continue;
        const group = css.get(name) ?? new Ctor();
        group.priority = name === "dc-query" ? 0 : name === "pdf-search-hit-active" ? 2 : 1;
        for (const range of ranges) group.add(range);
        css.set(name, group);
        owned.set(name, { group, ranges });
      }
    },
  };
}
