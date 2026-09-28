import { Upload } from "lucide-react";

/** Full-screen "drop it here" veil, shown while a file is being dragged over the window. */
export function DragDropOverlay({ open }: { open: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-(--z-overlay) flex items-center justify-center bg-background/80 backdrop-blur-sm border-4 border-dashed border-primary transition-all duration-300">
      <div className="rounded-3xl bg-card p-10 shadow-2xl flex flex-col items-center gap-6 animate-in fade-in zoom-in duration-300">
        <Upload className="h-16 w-16 text-primary animate-bounce" />
        <div className="text-center">
          <h2 className="text-3xl font-bold text-foreground">Drop files to upload</h2>
          <p className="mt-2 text-base text-muted-foreground">
            Documents, spreadsheets, PDFs, and presentations are ready to preview.
          </p>
        </div>
      </div>
    </div>
  );
}
