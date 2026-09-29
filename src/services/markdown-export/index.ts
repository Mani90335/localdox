import { dataBlob } from "../../lib/workspace/binary.ts";
/**
 * The one door out of the app for a document.
 *
 * Every export surface — the sidebar's row menu, the viewer's header, a
 * multi-select download — calls `exportDocument` and nothing else. The writers
 * behind it are loaded on demand: a reader who never exports never downloads
 * the OOXML builder, and the chunk that holds it is not on the path to the
 * first paint.
 *
 * The original download is kept as a format rather than replaced. Handing back
 * the bytes that came in is the right answer for a binary the app only reads,
 * and for anyone who wants the markdown itself.
 */

import type { MediaContext } from "@/lib/markdown/media-context";
import type { MdFile } from "@/lib/markdown/markdown-utils";

export type ExportFormat = "docx" | "pdf" | "markdown" | "html" | "original";

export interface ExportResult {
  /** What actually happened, for the toast. PDF hands off to a dialog. */
  kind: "downloaded" | "printed";
  filename: string;
}

/** Strip the extension so a new one can be appended without doubling up. */
function baseName(name: string): string {
  return name.replace(/\.[^./\\]+$/, "") || name || "document";
}

/**
 * A file name the operating system will accept.
 *
 * A heading used as a title routinely contains `/` or `:`, which silently
 * truncate or fail the download depending on the platform.
 */
function safeName(name: string): string {
  return (
    name
      // Escapes, not literal control characters: `eslint --fix` has
      // rewritten a class like this into raw bytes before now.
      // eslint-disable-next-line no-control-regex -- stripping control characters is the point
      .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "document"
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  // Revoking immediately cancels the download in Firefox, which reads the blob
  // after the click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Is this document something the converters can read?
 *
 * The DOCX and PDF writers parse markdown. A spreadsheet or a PDF the reader
 * uploaded has no markdown to parse, so those formats are not offered for it
 * and `exportDocument` refuses rather than producing an empty document.
 */
export function canConvert(file: Pick<MdFile, "kind" | "content" | "data">): boolean {
  if (file.data && !file.content?.trim()) return false;
  return file.kind === "markdown" || file.kind === "text" || file.kind === "mermaid" || !file.kind;
}

/** Formats offered for a given document, in menu order. */
export function availableFormats(file: Pick<MdFile, "kind" | "content" | "data">): ExportFormat[] {
  if (!canConvert(file)) return ["original"];
  return ["docx", "pdf", "markdown", "html", "original"];
}

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  docx: "Word (.docx)",
  pdf: "PDF",
  markdown: "Markdown (.md)",
  html: "Web page (.html)",
  original: "Original file",
};

/**
 * Formats a whole selection can be exported as.
 *
 * The intersection, not the union: offering Word for a selection where half
 * the files are spreadsheets means half the export silently fails, and the
 * reader finds out afterwards by counting the downloads. A mixed selection
 * therefore collapses to `original` — the one thing every file can always do —
 * which is what turns the menu back into a plain "Download".
 */
export function sharedFormats(
  files: readonly Pick<MdFile, "kind" | "content" | "data">[],
): ExportFormat[] {
  if (!files.length) return [];
  if (!files.every(canConvert)) return ["original"];
  // A format that cannot batch is left out of the menu rather than offered and
  // then refused — an item that only ever produces an error message is worse
  // than no item, because the reader has to click it to find that out.
  return availableFormats(files[0]).filter(isBatchable);
}

/**
 * PDF is per-document by nature.
 *
 * It hands off to the browser's print dialog, which is modal: a batch of five
 * would queue five dialogs, each waiting on the last, and the reader would have
 * to name every file by hand. Everything else drops a file and batches fine.
 */
export function isBatchable(format: ExportFormat): boolean {
  return format !== "pdf";
}

export interface BatchExportResult {
  ok: number;
  /** Documents that could not be written, with the reason. */
  failed: { name: string; reason: string }[];
}

/**
 * Export several documents, one file each.
 *
 * Sequential rather than parallel: each conversion renders every diagram it
 * contains through Mermaid, which measures text against the live document and
 * contends with itself when run concurrently. Browsers also throttle a burst of
 * simultaneous downloads, so serialising is what actually delivers all of them.
 *
 * One failure does not stop the rest — the reader gets the documents that
 * converted and a count of the ones that did not, rather than a partial batch
 * with no explanation.
 */
export async function exportDocuments(
  files: readonly MdFile[],
  format: ExportFormat,
  onProgress?: (done: number, total: number) => void,
  context?: MediaContext,
): Promise<BatchExportResult> {
  const result: BatchExportResult = { ok: 0, failed: [] };
  for (const [index, file] of files.entries()) {
    try {
      await exportDocument(file, format, context);
      result.ok++;
    } catch (error) {
      result.failed.push({
        name: file.name,
        reason: error instanceof Error ? error.message : "Export failed.",
      });
    }
    onProgress?.(index + 1, files.length);
  }
  return result;
}

/**
 * A mermaid document is a diagram, not prose.
 *
 * Wrapping the source in a fence before it reaches the parser is what makes a
 * `.mmd` file export as the picture it is rather than as a page of source — and
 * it means one code path handles both, instead of the writers each learning
 * about a second kind of input.
 */
function toMarkdownSource(file: Pick<MdFile, "kind" | "content">): string {
  if (file.kind === "mermaid") return `\`\`\`mermaid\n${file.content.trim()}\n\`\`\`\n`;
  return file.content;
}

export async function exportDocument(
  file: MdFile,
  format: ExportFormat,
  context: MediaContext = {},
): Promise<ExportResult> {
  const base = safeName(baseName(file.name));

  if (format === "original") {
    const filename = safeName(file.name);
    if (file.data) {
      triggerDownload(dataBlob(file.data)!, filename);
      return { kind: "downloaded", filename };
    }
    triggerDownload(
      new Blob([file.content], { type: file.mimeType || "text/markdown;charset=utf-8" }),
      filename,
    );
    return { kind: "downloaded", filename };
  }

  if (!canConvert(file)) {
    throw new Error(`${file.name} has no text to convert; download the original instead.`);
  }

  const source = toMarkdownSource(file);

  if (format === "markdown") {
    const filename = `${base}.md`;
    triggerDownload(new Blob([source], { type: "text/markdown;charset=utf-8" }), filename);
    return { kind: "downloaded", filename };
  }

  if (format === "html" && file.kind !== "mermaid") {
    const { buildMarkdownHTML } = await import("./media-bundle");
    const result = await buildMarkdownHTML(file, context);
    triggerDownload(result.blob, result.name);
    return { kind: "downloaded", filename: result.name };
  }

  const { inferTitle } = await import("./docx");
  const title = inferTitle(source, base);

  if (format === "docx") {
    const { markdownToDocx } = await import("./docx");
    const blob = await markdownToDocx(source, { title });
    const filename = `${base}.docx`;
    triggerDownload(blob, filename);
    return { kind: "downloaded", filename };
  }

  if (format === "html") {
    // The same standalone document the PDF path prints — diagrams inlined as
    // SVG, styles embedded, nothing fetched at open time. It is the honest
    // answer to "a file I can send someone".
    const { markdownToPrintableHtml } = await import("./pdf");
    const html = await markdownToPrintableHtml(source, { title });
    const filename = `${base}.html`;
    triggerDownload(new Blob([html], { type: "text/html;charset=utf-8" }), filename);
    return { kind: "downloaded", filename };
  }

  const { printMarkdownAsPdf } = await import("./pdf");
  await printMarkdownAsPdf(source, { title });
  return { kind: "printed", filename: `${base}.pdf` };
}
