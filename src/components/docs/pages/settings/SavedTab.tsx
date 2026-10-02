import { Section, Group, Row, Empty } from "./primitives";
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
