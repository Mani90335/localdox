import {
  FileText,
  FileType,
  FileSpreadsheet,
  FileJson,
  FileImage,
  FileVideo,
  FileAudio,
  Workflow,
  Presentation,
  Globe,
  File as FileIcon,
  PenTool,
  Printer,
  Download,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DocumentKind } from "@/lib/markdown/markdown-utils";
import type { ExportFormat } from "@/services/markdown-export";

/** A glyph per export format, so the flyout scans by shape like the file list. */
export const FORMAT_ICON: Record<ExportFormat, LucideIcon> = {
  docx: FileType,
  pdf: Printer,
  markdown: FileText,
  html: Globe,
  original: Download,
};

// Arc-style "favicon" per file type — a small colored glyph that anchors each
// row so the list scans by shape, not just text.
const KIND_ICON: Partial<Record<DocumentKind, LucideIcon>> = {
  markdown: FileText,
  mermaid: Workflow,
  board: PenTool,
  text: FileText,
  docx: FileType,
  pdf: FileType,
  spreadsheet: FileSpreadsheet,
  csv: FileSpreadsheet,
  json: FileJson,
  presentation: Presentation,
  "google-doc": Globe,
  "google-slide": Globe,
  html: Globe,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
};

export function kindIcon(kind: DocumentKind): LucideIcon {
  return KIND_ICON[kind] ?? FileIcon;
}

/*
 * Colour per file type, and the short label the row shows on its right.
 *
 * The glyphs above were already distinct in shape, but every one of them was
 * drawn in the same muted grey at 14px, where the difference between a sheet
 * and a document is a couple of pixels of stroke — the list could only be read
 * by name. Hue is the fastest channel the eye has for this, so each family gets
 * one and the list becomes scannable before a single word is read.
 *
 * The label matters for a second reason: rows drop the file extension, so
 * "metrics" and "config" gave no clue what they were. The label puts the type
 * back, in the column that was otherwise empty for every non-text file.
 */
const KIND_META: Partial<Record<DocumentKind, { tone: string; label: string }>> = {
  markdown: { tone: "text-sky-500 dark:text-sky-400", label: "MD" },
  text: { tone: "text-slate-500 dark:text-slate-400", label: "TXT" },
  mermaid: { tone: "text-cyan-600 dark:text-cyan-400", label: "DIAGRAM" },
  board: { tone: "text-fuchsia-500 dark:text-fuchsia-400", label: "BOARD" },
  docx: { tone: "text-blue-600 dark:text-blue-400", label: "DOCX" },
  pdf: { tone: "text-rose-500 dark:text-rose-400", label: "PDF" },
  spreadsheet: { tone: "text-emerald-600 dark:text-emerald-400", label: "SHEET" },
  csv: { tone: "text-emerald-600 dark:text-emerald-400", label: "CSV" },
  json: { tone: "text-amber-600 dark:text-amber-400", label: "JSON" },
  presentation: { tone: "text-orange-500 dark:text-orange-400", label: "DECK" },
  "google-doc": { tone: "text-blue-600 dark:text-blue-400", label: "DOC" },
  "google-slide": { tone: "text-orange-500 dark:text-orange-400", label: "SLIDES" },
  html: { tone: "text-indigo-500 dark:text-indigo-400", label: "HTML" },
  image: { tone: "text-violet-500 dark:text-violet-400", label: "IMAGE" },
  video: { tone: "text-pink-500 dark:text-pink-400", label: "VIDEO" },
  audio: { tone: "text-teal-500 dark:text-teal-400", label: "AUDIO" },
};

export function kindMeta(kind: DocumentKind) {
  return KIND_META[kind] ?? { tone: "text-muted-foreground", label: "FILE" };
}
