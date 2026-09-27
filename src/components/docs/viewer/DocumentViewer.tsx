import { memo } from "react";
// `xlsx` (~563 kB) and `jszip` (~273 kB) are imported where they are used, not
// here: a static import put both in the app's main chunk, so every reader
// downloaded a spreadsheet parser and a zip reader before they could open a
// markdown file. Word documents already followed this pattern with `mammoth`.
import { getDocumentKind } from "@/lib/markdown/document-utils";
import type { Props } from "./document-viewer/shared";
import { PdfViewer } from "./document-viewer/PdfViewer";
import { EditableOfficeViewer } from "./document-viewer/EditableOfficeViewer";
import { JsonViewer } from "./document-viewer/JsonViewer";
import { MermaidFileViewer } from "./document-viewer/MermaidFileViewer";
import { BoardFileViewer } from "./document-viewer/BoardFileViewer";
import { HtmlFileViewer } from "./document-viewer/HtmlFileViewer";
import { PresentationViewer } from "./document-viewer/PresentationViewer";
import { ImageViewer } from "./document-viewer/ImageViewer";
import { GoogleViewer } from "./document-viewer/GoogleViewer";
import { UnknownViewer } from "./document-viewer/UnknownViewer";

function DocumentViewerImpl(props: Props) {
  const { file } = props;
  const kind = file.kind ?? getDocumentKind(file.name, file.mimeType);
  if (kind === "pdf") return <PdfViewer {...props} />;
  if (kind === "docx" || kind === "spreadsheet" || kind === "csv")
    return <EditableOfficeViewer key={file.id} {...props} />;
  if (kind === "json") return <JsonViewer {...props} />;
  if (kind === "mermaid") return <MermaidFileViewer {...props} />;
  if (kind === "board") return <BoardFileViewer {...props} />;
  if (kind === "html") return <HtmlFileViewer {...props} />;
  if (kind === "presentation") return <PresentationViewer {...props} />;
  if (kind === "image") return <ImageViewer {...props} />;
  if (kind === "google-doc" || kind === "google-slide")
    return <GoogleViewer {...props} isSlides={kind === "google-slide"} />;
  return <UnknownViewer {...props} />;
}

/**
 * Memoized for the same reason as the markdown viewer: parsing a spreadsheet or
 * a deck is expensive, and an app-shell re-render must not trigger it again.
 */
export const DocumentViewer = memo(DocumentViewerImpl);
