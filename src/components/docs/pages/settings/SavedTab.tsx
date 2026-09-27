import { ArrowRight, Star, Trash2 } from "lucide-react";
import { Section, Group, Row, Empty, IconButton } from "./primitives";
import { savedTypeLabel, type SavedEntry, type SavedItem } from "@/lib/workspace/saved-items";
import type { Highlight } from "@/lib/markdown/dom-highlighter";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { BIN_RETENTION_MS } from "@/lib/workspace/persistence";

/** Shared "Clear all" affordance for the list sections. */
function ClearAll({ onClick, confirm }: { onClick: () => void; confirm: string }) {
  return (
    <button
      onClick={() => {
        if (window.confirm(confirm)) onClick();
      }}
      className="coarse:inline-flex coarse:min-h-11 coarse:items-center shrink-0 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
    >
      Clear all
    </button>
  );
}

export function SavedSettings({
  saved,
  onOpen,
  onRemove,
  onClearAll,
}: {
  saved: SavedEntry[];
  onOpen: (item: SavedItem) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
}) {
  return (
    <Section
      title="Saved"
      action={
        saved.length > 0 && <ClearAll onClick={onClearAll} confirm="Clear all saved items?" />
      }
    >
      <Group>
        {saved.length === 0 ? (
          <Empty>Nothing saved yet.</Empty>
        ) : (
          saved.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 pr-2 transition-colors hover:bg-accent/40"
            >
              <button
                onClick={() => onOpen(item)}
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                title={item.text || item.title}
              >
                <Star className="h-4 w-4 shrink-0 fill-gold text-gold" />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {savedTypeLabel(item)} · {item.fileName}
                    {item.orphaned ? " · no longer in the document" : ""}
                  </span>
                </span>
              </button>
              <IconButton onClick={() => onRemove(item.id)} label="Remove saved item" danger>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </div>
          ))
        )}
      </Group>
    </Section>
  );
}

export function HighlightSettings({
  highlights,
  files,
  onRemove,
  onClearAll,
  onNavigate,
}: {
  highlights: Highlight[];
  files: MdFile[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onNavigate: (fileId: string, subtopicId?: string) => void;
}) {
  return (
    <Section
      title="Highlights"
      action={
        highlights.length > 0 && <ClearAll onClick={onClearAll} confirm="Clear all highlights?" />
      }
    >
      <Group>
        {highlights.length === 0 ? (
          <Empty>No highlights yet.</Empty>
        ) : (
          highlights.map((h) => {
            const file = files.find((f) => f.id === h.fileId);
            return (
              <div
                key={h.id}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
              >
                {/* The colour dot is the only chrome the highlight needs. */}
                <span
                  className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: h.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{h.text}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {file?.name.replace(/\.(md|markdown|mdx|mmd|mermaid|txt)$/i, "") ||
                      "Unknown file"}
                    {h.label ? ` · ${h.label}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    onClick={() => onNavigate(h.fileId, h.subtopicId)}
                    label="Go to highlight"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </IconButton>
                  <IconButton onClick={() => onRemove(h.id)} label="Remove highlight" danger>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
            );
          })
        )}
      </Group>
    </Section>
  );
}

/**
 * The Bin: everything the reader has removed, and how long it has left.
 *
 * This replaced a separate Archive panel and an irreversible Delete. A binned
 * document is recoverable for thirty days and says so per row, so "remove" no
 * longer means two different things depending on which menu item was used.
 */
export function BinSettings({
  files,
  onRestore,
  onDeleteForever,
  onEmptyBin,
}: {
  files: MdFile[];
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
  onEmptyBin: () => void;
}) {
  const binned = files
    .filter((f) => typeof f.deletedAt === "number")
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));

  const daysLeft = (deletedAt: number) =>
    Math.max(0, Math.ceil((deletedAt + BIN_RETENTION_MS - Date.now()) / (24 * 60 * 60 * 1000)));

  return (
    <Section
      title="Bin"
      description="Removed files stay here for 30 days, then delete themselves. Restore one at any time before that."
      action={
        binned.length > 0 && (
          <ClearAll
            onClick={onEmptyBin}
            confirm={`Permanently delete ${binned.length} file${binned.length === 1 ? "" : "s"} in the Bin?`}
          />
        )
      }
    >
      <Group>
        {binned.length === 0 ? (
          <Empty>The Bin is empty.</Empty>
        ) : (
          binned.map((file) => {
            const left = daysLeft(file.deletedAt as number);
            return (
              <Row
                key={file.id}
                label={file.name}
                hint={
                  left === 0 ? "Deletes on next open" : `${left} day${left === 1 ? "" : "s"} left`
                }
                control={
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onRestore(file.id)}
                      className="coarse:min-h-11 coarse:px-3 rounded-md px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Permanently delete "${file.name}"?`)) {
                          onDeleteForever(file.id);
                        }
                      }}
                      className="coarse:min-h-11 coarse:px-3 rounded-md px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </div>
                }
              />
            );
          })
        )}
      </Group>
    </Section>
  );
}
