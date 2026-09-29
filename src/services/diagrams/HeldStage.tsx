import { Button } from "@/components/ui/button";
import type { DiagramPreflight } from "./preflight";

/**
 * A diagram that is too costly to draw without asking (preflight.ts).
 *
 * The reader still gets the content, as source they can read, select and copy,
 * and a way to draw it once they accept the wait. Nothing about Mermaid has
 * been imported or run at this point.
 */
export function HeldStage({
  source,
  preflight,
  fill,
  onDraw,
}: {
  source: string;
  preflight: DiagramPreflight;
  fill?: boolean;
  onDraw: () => void;
}) {
  return (
    <div className={`flex flex-col gap-3 p-4 ${fill ? "h-full min-h-0" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-sm font-medium text-foreground">Diagram not drawn yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {preflight.reason} The source is shown instead.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="coarse:h-11" onClick={onDraw}>
          Draw anyway
        </Button>
      </div>
      {/* A region rather than a <pre>: the reading column styles every pre
          as a full-bleed code block, which pushed this one past the card's
          edges. Focusable so a keyboard can scroll it; capped so a long
          source doesn't push the rest of the document a screen further. */}
      <div
        role="region"
        tabIndex={0}
        aria-label="Diagram source"
        className={`overflow-auto whitespace-pre rounded-lg border border-border/70 bg-background/60 p-3 font-mono text-xs leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          fill ? "min-h-0 flex-1" : "max-h-80"
        }`}
      >
        {source}
      </div>
    </div>
  );
}
