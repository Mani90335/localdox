/**
 * The export control in the viewer header.
 *
 * The sidebar's row menu can already export a document, but it is the wrong
 * place to reach for while reading one: it means finding the row you are
 * already looking at, in a panel that is collapsed on a phone. This is the same
 * action where the document is.
 *
 * It owns its own busy state rather than taking one from the viewer. A Word or
 * PDF export renders every diagram first, which is seconds on a long document,
 * and the button has to stay disabled for exactly that long — a second click
 * during the wait would start a second render of the same diagrams.
 */

import { useEffect, useRef, useState } from "react";
import { Download, FileText, FileType, Globe, Loader2, Printer } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { availableFormats, FORMAT_LABEL, type ExportFormat } from "./index";

const FORMAT_ICON: Record<ExportFormat, LucideIcon> = {
  docx: FileType,
  pdf: Printer,
  markdown: FileText,
  html: Globe,
  original: Download,
};

/** What each row promises, so the choice does not need to be learned by trying. */
const FORMAT_HINT: Record<ExportFormat, string> = {
  docx: "Diagrams as images, headings as Word styles",
  pdf: "Print dialog — choose Save as PDF",
  markdown: "The source text",
  html: "One self-contained page",
  original: "Exactly as uploaded",
};

export function ExportMenu({ file }: { file: MdFile }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const formats = availableFormats(file);

  const run = async (format: ExportFormat) => {
    setOpen(false);
    setBusy(format);
    try {
      const { exportDocument } = await import("./index");
      const result = await exportDocument(file, format);
      toast.success(
        result.kind === "printed" ? "Ready to save as PDF" : `Downloaded ${result.filename}`,
        {
          description:
            result.kind === "printed"
              ? 'Choose "Save as PDF" as the destination in the print dialog.'
              : undefined,
        },
      );
    } catch (error) {
      toast.error("Export failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        disabled={busy !== null}
        title="Export this document"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60 coarse:h-11 coarse:w-11"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-(--z-dropdown) mt-1 w-64 rounded-lg border border-border bg-popover p-1 shadow-xl"
        >
          {formats.map((format) => {
            const Icon = FORMAT_ICON[format];
            return (
              <button
                key={format}
                role="menuitem"
                onClick={() => void run(format)}
                className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{FORMAT_LABEL[format]}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {FORMAT_HINT[format]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
