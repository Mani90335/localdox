import { sameData } from "../../lib/workspace/binary.ts";
import type { FileData } from "../../lib/workspace/binary.ts";
export const CONVERTER_VERSION = "0.2.4";
export const MAX_CONVERSION_INPUT = 30 * 1024 * 1024;
export const MAX_CONVERSION_OUTPUT = 5 * 1024 * 1024;
export const CONVERSION_TIMEOUT_MS = 60_000;

export interface Derivation {
  sourceFileId?: string;
  sourceName: string;
  inputHash: string;
  converter: "anydoc";
  converterVersion: string;
  convertedAt: number;
}

export interface ConversionSource {
  id: string;
  name: string;
  content: string;
  data?: FileData;
  deletedAt?: number | null;
  folderId?: string | null;
  derivedFrom?: Derivation;
}

export interface ConversionResult {
  markdown: string;
  inputHash: string;
}

export interface ConversionFailure {
  code: string;
  pages?: number[];
}

const EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "docm",
  "ppt",
  "pps",
  "pot",
  "pptx",
  "pptm",
  "ppsx",
  "ppsm",
  "xls",
  "xlsx",
  "xlsm",
  "xlsb",
  "odt",
  "ods",
  "odp",
  "rtf",
  "epub",
  "csv",
]);

export function canConvertToMarkdown(file: ConversionSource): boolean {
  return (
    !file.deletedAt &&
    !file.derivedFrom &&
    EXTENSIONS.has(file.name.split(".").pop()?.toLowerCase() ?? "")
  );
}

export function sameSource(a: ConversionSource | undefined, b: ConversionSource): boolean {
  return (
    !!a &&
    !a.deletedAt &&
    a.id === b.id &&
    a.content === b.content &&
    sameData(a.data, b.data) &&
    a.name === b.name
  );
}

export function markdownCopyName(name: string, taken: Iterable<string>): string {
  const names = new Set(Array.from(taken, (value) => value.toLocaleLowerCase()));
  const stem = name.replace(/\.[^.]+$/, "") || "document";
  let candidate = `${stem}.md`;
  for (let n = 2; names.has(candidate.toLocaleLowerCase()); n++) candidate = `${stem} (${n}).md`;
  return candidate;
}

/** Independent of sidebar ordering: newest conversion wins, even after filing. */
export function latestMarkdownCopies<T extends ConversionSource>(files: T[]): Map<string, T> {
  const copies = new Map<string, T>();
  for (const file of files) {
    const sourceId = file.derivedFrom?.sourceFileId;
    if (!sourceId || file.deletedAt) continue;
    const previous = copies.get(sourceId);
    if (!previous || file.derivedFrom!.convertedAt >= previous.derivedFrom!.convertedAt)
      copies.set(sourceId, file);
  }
  return copies;
}

/** Imported provenance is untrusted; only retain the fields we understand. */
export function parseDerivation(value: unknown): Derivation | undefined {
  if (!value || typeof value !== "object") return;
  const d = value as Partial<Derivation>;
  if (
    d.converter !== "anydoc" ||
    typeof d.sourceName !== "string" ||
    typeof d.inputHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(d.inputHash) ||
    typeof d.converterVersion !== "string" ||
    typeof d.convertedAt !== "number" ||
    !Number.isFinite(d.convertedAt)
  )
    return;
  return {
    sourceFileId: typeof d.sourceFileId === "string" ? d.sourceFileId : undefined,
    sourceName: d.sourceName,
    inputHash: d.inputHash,
    converter: "anydoc",
    converterVersion: d.converterVersion,
    convertedAt: d.convertedAt,
  };
}

/** Never let an imported source id accidentally bind to an unrelated local file. */
export function remapDerivation(
  value: Derivation | undefined,
  ids: Map<string, string>,
): Derivation | undefined {
  return value
    ? { ...value, sourceFileId: value.sourceFileId ? ids.get(value.sourceFileId) : undefined }
    : undefined;
}

export function describeConversionError(error: ConversionFailure): string {
  switch (error.code) {
    case "needsOcr":
      return `This PDF needs OCR${error.pages?.length ? ` on page${error.pages.length === 1 ? "" : "s"} ${error.pages.slice(0, 20).join(", ")}${error.pages.length > 20 ? ", …" : ""}` : ""}. Local conversion cannot read scanned pages. No file was uploaded.`;
    case "encrypted":
      return "This document is password-protected. Import an unlocked copy to convert it.";
    case "unsupported":
      return "This document format could not be converted to Markdown.";
    case "malformed":
    case "missingPart":
      return "This document is damaged or incomplete. Try importing another copy.";
    case "resourceLimit":
      return "This document exceeded local conversion limits. Try a smaller document.";
    case "outputLimit":
      return "The Markdown result exceeds the 5 MiB conversion limit. Try a smaller document.";
    case "timeout":
      return "Conversion took too long and was stopped. Try a smaller document.";
    case "empty":
      return "No readable Markdown was found in this document.";
    case "startup":
      return "The local converter could not load. Check your connection and try again.";
    default:
      return "This document could not be converted. The original is unchanged.";
  }
}
