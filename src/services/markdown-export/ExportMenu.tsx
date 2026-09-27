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

import { useContext, useState } from "react";
import { ConversionContext } from "@/services/doc-conversion/ConversionContext";
import { canConvertToMarkdown, latestMarkdownCopies } from "@/services/doc-conversion/types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Download, FileText, FileType, Globe, Loader2, Printer } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import type { MediaContext } from "@/lib/markdown/media-context";
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
  html: "Styled page; local attachments in a ZIP",
  original: "Exactly as uploaded",
};

export function ExportMenu({ file, mediaContext }: { file: MdFile; mediaContext?: MediaContext }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const formats = availableFormats(file);
  const conversion = useContext(ConversionContext);
  const canCreateMarkdown = conversion && canConvertToMarkdown(file);
  const copy = conversion ? latestMarkdownCopies(conversion.files).get(file.id) : undefined;

  const run = async (format: ExportFormat) => {
    setOpen(false);
    setBusy(format);
    try {
      const { exportDocument } = await import("./index");
      const result = await exportDocument(file, format, mediaContext);
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
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy !== null}
          title="Export this document"
          aria-label="Export"
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60 coarse:h-11"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <span>{busy ? "Exporting…" : "Export"}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-(--z-dropdown) w-64">
        {canCreateMarkdown && (
          <>
            <DropdownMenuItem
              disabled={!!conversion.runningId}
              onSelect={() => conversion.onConvert(file.id)}
              className="items-start gap-2.5 py-2"
            >
              <FileText className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="block font-medium">
                  {copy ? "Convert again" : "Convert to Markdown"}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Create a Markdown copy in this workspace
                </span>
                <span className="block text-xs text-muted-foreground">
                  Images stay in the original
                </span>
              </span>
            </DropdownMenuItem>
            {copy && (
              <DropdownMenuItem onSelect={() => conversion.onOpen(copy.id)}>
                <FileText className="mr-2 h-4 w-4" /> Open Markdown copy
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        {formats.map((format) => {
          const Icon = FORMAT_ICON[format];
          return (
            <DropdownMenuItem
              key={format}
              onSelect={() => void run(format)}
              className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{FORMAT_LABEL[format]}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {FORMAT_HINT[format]}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
