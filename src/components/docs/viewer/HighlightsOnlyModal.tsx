import { Highlighter, Trash2, Tag, Unlink } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { HL_FOREGROUND, type Highlight } from "@/lib/markdown/dom-highlighter";

/**
 * "Show highlights only": pulls every highlight for a single text document out
 * of the prose and lists them in isolation, so the reader can skim just the
 * parts they marked. Reached from the file three-dots menu; only offered for
 * text-based files, the only ones the reader can highlight.
 */
export function HighlightsOnlyModal({
  fileName,
  highlights,
  onClose,
  onJump,
  onRemove,
}: {
  fileName: string;
  highlights: Highlight[];
  onClose: () => void;
  onJump: (hl: Highlight) => void;
  onRemove: (id: string) => void;
}) {
  const title = fileName.replace(/\.[^.]+$/, "");

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      align="top"
      size="xl"
      icon={<Highlighter className="h-4 w-4" />}
      title={title}
      description={`${highlights.length} highlight${highlights.length === 1 ? "" : "s"}`}
      bodyClassName="p-4"
    >
      {highlights.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <Highlighter className="h-6 w-6 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">No highlights in this document yet.</p>
          <p className="text-xs text-muted-foreground/70">
            Select text while reading to highlight it.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {highlights.map((hl) => (
            <li key={hl.id}>
              <div className="group flex items-stretch gap-3 rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40">
                <span
                  className="w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: hl.color }}
                  aria-hidden
                />
                <button
                  onClick={() => onJump(hl)}
                  className="min-w-0 flex-1 text-left"
                  title="Jump to this highlight"
                >
                  <span
                    className="text-sm leading-relaxed text-foreground [box-decoration-break:clone]"
                    style={{ backgroundColor: hl.color, color: HL_FOREGROUND, padding: "1px 2px" }}
                  >
                    {hl.text}
                  </span>
                  {hl.label && (
                    <span className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Tag className="h-3 w-3 shrink-0" />
                      {hl.label}
                    </span>
                  )}
                  {/* The text was edited out of the document. The highlight is
                      kept here — with its note — rather than deleted, so the
                      reader decides what happens to it. */}
                  {hl.orphaned && (
                    <span className="mt-1.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                      <Unlink className="h-3 w-3 shrink-0" />
                      This text is no longer in the document
                    </span>
                  )}
                </button>
                <button
                  onClick={() => onRemove(hl.id)}
                  aria-label="Remove highlight"
                  className="shrink-0 self-start rounded-md p-1.5 text-muted-foreground opacity-100 transition-colors hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
