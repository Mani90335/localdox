/**
 * How a diagram is presented.
 *
 * `raw` is Mermaid exactly as it renders, with no motion. `stepped` walks the
 * graph one edge at a time, revealing each node as the arrow reaches it — the
 * explainer. `flow` is the continuous animation: packets travelling every edge
 * at once, plus the `flow:` choreography and WebM export that belong to it.
 *
 * Ordered as the reader would escalate: the picture, then the walk through it,
 * then the thing in motion.
 */
export type MermaidMode = "raw" | "stepped" | "flow";

const MODE_ORDER: MermaidMode[] = ["raw", "stepped", "flow"];
const MODE_LABEL: Record<MermaidMode, string> = {
  raw: "Raw",
  stepped: "Stepped",
  flow: "Flow",
};
const MODE_HINT: Record<MermaidMode, string> = {
  raw: "The diagram, no animation",
  stepped: "Walk the graph one step at a time",
  flow: "Continuous flow along every edge",
};

/**
 * The three presentations, as one segmented control.
 *
 * A tablist rather than a cycling button: the modes are siblings, and a reader
 * should be able to see all three and pick one, not discover them by pressing
 * the same key repeatedly. Labels are words because "Raw" and "Stepped" have no
 * icon anyone would read correctly.
 */
export function ModeTabs({
  mode,
  onChange,
  unavailable,
}: {
  mode: MermaidMode;
  onChange: (next: MermaidMode) => void;
  /** Modes this diagram cannot offer, with the reason, shown disabled. */
  unavailable?: Partial<Record<MermaidMode, string>>;
}) {
  const blocked = (option: MermaidMode) => Boolean(unavailable?.[option]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    // Step over anything disabled rather than landing on it, so the arrow keys
    // can only reach a tab that will actually do something.
    let index = MODE_ORDER.indexOf(mode);
    for (let hops = 0; hops < MODE_ORDER.length; hops++) {
      index = (index + delta + MODE_ORDER.length) % MODE_ORDER.length;
      if (!blocked(MODE_ORDER[index])) {
        onChange(MODE_ORDER[index]);
        return;
      }
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Diagram presentation"
      onKeyDown={onKeyDown}
      // `shrink-0`: this sat in a `justify-between` row beside the action tray
      // and, being the flexible one, was the item that gave way when the two no
      // longer fit. Below ~360px it lost about 30px — enough that "Flow" was
      // clipped by the `overflow-hidden` here and could not be tapped at all.
      // The row it lives in wraps now, so neither group has to yield.
      className="pointer-events-auto flex shrink-0 items-center overflow-hidden rounded-lg border border-border/70 bg-background/85 p-0.5 shadow-sm ring-1 ring-black/2 backdrop-blur-md"
    >
      {MODE_ORDER.map((option) => {
        const selected = option === mode;
        const reason = unavailable?.[option];
        return (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={selected}
            // `aria-disabled` rather than `disabled`: the tab stays focusable
            // and keeps its tooltip, so a reader can find out *why* it is off
            // instead of meeting a control that ignores them silently.
            aria-disabled={reason ? true : undefined}
            // Only the active tab is in the tab order; arrow keys move between
            // them, which is how a tablist is meant to behave.
            tabIndex={selected ? 0 : -1}
            title={reason ?? MODE_HINT[option]}
            onClick={() => !reason && onChange(option)}
            className={`inline-flex h-7 items-center rounded-md px-2.5 text-2xs font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring coarse:h-11 coarse:px-3.5 coarse:text-xs ${
              reason
                ? "cursor-not-allowed text-muted-foreground/40"
                : selected
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {MODE_LABEL[option]}
          </button>
        );
      })}
    </div>
  );
}
