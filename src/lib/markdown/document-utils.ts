import type { DocumentKind, MdFile } from "./markdown-utils";

const kindByExtension: Record<string, DocumentKind> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  mmd: "mermaid",
  mermaid: "mermaid",
  excalidraw: "board",
  txt: "text",
  docx: "docx",
  pdf: "pdf",
  xlsx: "spreadsheet",
  xls: "spreadsheet",
  csv: "csv",
  json: "json",
  ppt: "presentation",
  pptx: "presentation",
  gdoc: "google-doc",
  gsheets: "spreadsheet",
  gsheet: "spreadsheet",
  gslides: "google-slide",
  url: "text",
  html: "html",
  htm: "html",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  svg: "image",
  avif: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  m4a: "audio",
};

// Keep the picker open to every file type. The viewer routes known formats to
// rich previews and preserves unknown binary uploads for future support.
export const SUPPORTED_ACCEPT = "*/*";

export function fileExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function getDocumentKind(name: string, mimeType = ""): DocumentKind {
  const extension = fileExtension(name);
  if (kindByExtension[extension]) return kindByExtension[extension];
  if (mimeType.includes("pdf")) return "pdf";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "spreadsheet";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "presentation";
  if (mimeType.includes("wordprocessing") || mimeType.includes("word")) return "docx";
  if (mimeType.includes("json")) return "json";
  if (mimeType.startsWith("text/")) return "text";
  return "unknown";
}

export function isTextKind(kind: DocumentKind) {
  return [
    "markdown",
    "mermaid",
    "text",
    "csv",
    "json",
    "google-doc",
    "google-slide",
    "html",
  ].includes(kind);
}

/**
 * Kinds the app can actually open an editor for.
 *
 * Narrower than `isTextKind`, which also covers text the reader can only read:
 * a CSV is shown as a sheet and a Google link is a pointer at a document that
 * lives elsewhere, so neither has a source editor to enter. A board is absent
 * for the opposite reason — its editor is its canvas, not a text field.
 *
 * One list, because it was two: the sidebar's "Edit" item used to name the
 * editable kinds inline, and HTML — which has both a source view and, now, an
 * editor behind it — was left off that list and out of reach.
 */
export function isEditableKind(kind: DocumentKind) {
  return ["markdown", "mermaid", "text", "json", "html"].includes(kind);
}

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

/**
 * Kinds whose bytes are stored as text in `content` rather than as a data URL
 * in `data`.
 *
 * An `.excalidraw` board is JSON, so it is stored as text — but it is not
 * an `isTextKind`, because that flag also decides who may edit a document, and
 * a board's editor is its canvas, never the markdown editor.
 *
 * Both the read and the data-URL branch below must agree on this, or a board
 * gets stored twice: once as text and again as base64. That matters here, where
 * the workspace enforces a hard storage cap against each file's `size`.
 */
function isTextSourced(kind: DocumentKind) {
  return isTextKind(kind) || kind === "board";
}

export async function importDocumentFile(file: File): Promise<MdFile> {
  let kind = getDocumentKind(file.name, file.type);
  const content = isTextSourced(kind) ? await file.text() : "";
  const linkedGoogleFile = googleUrl(content);
  if (linkedGoogleFile && kind === "text") {
    kind = linkedGoogleFile.includes("/presentation/") ? "google-slide" : "google-doc";
  }
  const data = isTextSourced(kind) ? undefined : await dataUrl(file);
  const id = `${file.name}-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    name: file.name,
    content,
    data,
    mimeType: file.type,
    size: file.size,
    addedAt: Date.now(),
    kind,
    // Structure is derived on demand by `fileSubtopics`. Parsing it during an
    // upload delayed every file in the batch behind a scan of its own text.
  };
}

export function dataUrlToArrayBuffer(data?: string): ArrayBuffer | null {
  if (!data) return null;
  const encoded = data.slice(data.indexOf(",") + 1);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  // Decoded in 32KB blocks. A plain per-byte loop over a 20MB workbook is
  // 20M bounds-checked writes on the main thread; chunking lets the JIT keep
  // the inner loop in a register and cuts the wall time by roughly half.
  const BLOCK = 0x8000;
  for (let offset = 0; offset < binary.length; offset += BLOCK) {
    const end = Math.min(offset + BLOCK, binary.length);
    for (let i = offset; i < end; i++) bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function dataUrlToBlob(data?: string, fallbackType = "application/octet-stream") {
  const buffer = dataUrlToArrayBuffer(data);
  if (!buffer) return null;
  const type = data?.match(/^data:([^;,]+)/)?.[1] || fallbackType;
  return new Blob([buffer], { type });
}

export function googleUrl(content: string): string | null {
  const url = content.match(/https?:\/\/docs\.google\.com\/[^\s"\\]+/i)?.[0];
  if (url) return url.replace(/\\u0026/g, "&");
  try {
    const parsed = JSON.parse(content);
    const value = parsed.url || parsed.doc_url || parsed.resourceUrl;
    return typeof value === "string" && value.includes("docs.google.com") ? value : null;
  } catch {
    return null;
  }
}

export function fileLabel(kind: DocumentKind) {
  return (
    {
      markdown: "Markdown",
      mermaid: "Mermaid",
      board: "Board",
      text: "Text",
      docx: "Word",
      pdf: "PDF",
      spreadsheet: "Excel",
      csv: "CSV",
      json: "JSON",
      presentation: "Presentation",
      "google-doc": "Google Doc",
      "google-slide": "Google Slides",
      image: "Image",
      video: "Video",
      audio: "Audio",
      html: "HTML",
      unknown: "File",
    } as const
  )[kind];
}

/**
 * Asked before any exit that throws a draft away.
 *
 * Editors write only when the reader presses Done, so every other way out of
 * one — Cancel, Escape, switching documents — discards. Shared so the three
 * editors ask the same question in the same words.
 */
export const DISCARD_PROMPT = "This document has unsaved changes. Leave and discard them?";
